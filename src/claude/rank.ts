import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { Brief } from "../domain/brief.ts";
import {
  MAX_PICKS,
  MAX_RANKED_CANDIDATES,
  RankingOutput,
  type Shortlist,
  type ShortlistPick,
} from "../domain/shortlist.ts";
import type { Candidate, NearMiss, SearchResult } from "../db/search.ts";
import { routeLabel } from "../lib/routes.ts";
import { getAnthropic } from "./client.ts";
import { ClaudeCallError } from "./errors.ts";
import { MODELS, type CallUsage } from "./models.ts";
import { fillPlaceholders, findPlaceholders, placeholderSources } from "./placeholders.ts";
import { RANK_SYSTEM_PROMPT } from "./prompts/rank.ts";

// "Rank and explain". Claude orders only the candidates SQL returned. Every ID
// it sends back is checked against what it was given; one retry, then an
// error. Facts on screen and in the email come from the database.

type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type BetaMessage = Anthropic.Beta.Messages.BetaMessage;

/**
 * The one SDK method this call uses: the beta Messages endpoint, because the
 * server-side refusal fallback is a beta feature. Tests pass a fake.
 */
export interface RankClient {
  beta: {
    messages: {
      create(params: CreateParams, options?: Anthropic.RequestOptions): PromiseLike<BetaMessage>;
    };
  };
}

// Ranking can think for a while, so it gets longer than the client's 60s
// default, and only 1 SDK retry: a timed-out ranking is expensive to repeat.
const REQUEST_OPTIONS: Anthropic.RequestOptions = { timeout: 120_000, maxRetries: 1 };

export interface RankOptions {
  client?: RankClient;
  model?: string;
}

const MAX_TOKENS = 16_000;
// Claude Sonnet 5.5: "default" routes a refused request to a fallback model
// chosen by refusal category, inside the same call.
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

const OUTPUT_FORMAT = betaZodOutputFormat(RankingOutput);

function compactCandidate(c: Candidate) {
  return {
    departureId: c.departureId,
    voyage: c.voyageName,
    route: routeLabel(c.route),
    nights: c.nights,
    embarkPort: c.embarkPort,
    ship: c.shipName,
    passengerCapacity: c.passengerCapacity,
    operator: c.operatorName,
    startDate: c.startDate,
    endDate: c.endDate,
    fares: c.fares.map((f) => ({
      cabinCategoryId: f.cabinCategoryId,
      cabin: f.cabinName,
      sleeps: f.sleeps,
      booking: f.booking,
      totalPerPersonGbp: f.totalPerPersonGbp,
    })),
  };
}

function compactNearMiss(n: NearMiss) {
  return {
    departureId: n.departureId,
    breaks: n.rule,
    distance: n.distance,
    voyage: n.voyageName,
    route: routeLabel(n.route),
    nights: n.nights,
    ship: n.shipName,
    passengerCapacity: n.passengerCapacity,
    startDate: n.startDate,
    endDate: n.endDate,
    fare: {
      cabinCategoryId: n.fare.cabinCategoryId,
      cabin: n.fare.cabinName,
      booking: n.fare.booking,
      totalPerPersonGbp: n.fare.totalPerPersonGbp,
    },
  };
}

export function rankingUserMessage(brief: Brief, sent: Candidate[], nearMisses: NearMiss[]): string {
  const input = {
    brief: {
      dateWindow: { start: brief.rules.windowStart, end: brief.rules.windowEnd },
      budgetPerPersonGbp: brief.rules.budgetPerPersonGbp,
      partySize: brief.rules.partySize,
      soloPreference: brief.rules.partySize === 1 ? brief.rules.soloPreference : undefined,
      mustHaveActivityIds: brief.rules.mustHaveActivityIds,
      party: brief.partyDescription,
      softPreferences: brief.softPreferences,
    },
    candidates: sent.map(compactCandidate),
    nearMisses: nearMisses.map(compactNearMiss),
  };
  return `Rank these candidates for this brief.\n\n${JSON.stringify(input, null, 2)}`;
}

/**
 * Everything wrong with a ranking, as sentences Claude can act on in the
 * retry. An empty list means it is safe to render.
 */
export function rankingProblems(
  output: RankingOutput,
  sent: Candidate[],
  nearMisses: NearMiss[],
): string[] {
  const problems: string[] = [];
  const candidates = new Map(sent.map((c) => [c.departureId, c]));
  const nearMissIds = new Set(nearMisses.map((n) => n.departureId));

  const expected = Math.min(MAX_PICKS, sent.length);
  if (output.picks.length !== expected) {
    problems.push(`Return exactly ${expected} picks; you returned ${output.picks.length}.`);
  }

  const seen = new Set<string>();
  for (const pick of output.picks) {
    const candidate = candidates.get(pick.departureId);
    if (!candidate) {
      problems.push(`Pick ${pick.departureId} is not in the candidate list.`);
      continue;
    }
    if (seen.has(pick.departureId)) {
      problems.push(`Departure ${pick.departureId} is picked more than once.`);
    }
    seen.add(pick.departureId);
    if (!candidate.fares.some((f) => f.cabinCategoryId === pick.cabinCategoryId)) {
      problems.push(
        `Cabin ${pick.cabinCategoryId} is not a qualifying fare on ${pick.departureId}; choose one of ${candidate.fares
          .map((f) => f.cabinCategoryId)
          .join(", ")}.`,
      );
    }
  }

  for (const note of output.nearMissNotes) {
    if (!nearMissIds.has(note.departureId)) {
      problems.push(`Near-miss note ${note.departureId} is not in the near-miss list.`);
    }
  }

  const mentionable = new Set([
    ...output.picks.filter((p) => candidates.has(p.departureId)).map((p) => p.departureId),
    ...output.nearMissNotes.filter((n) => nearMissIds.has(n.departureId)).map((n) => n.departureId),
  ]);
  for (const placeholder of findPlaceholders(output.emailBody)) {
    if (placeholder.kind === "invalid") {
      problems.push(`The email contains ${placeholder.raw}, which is not a valid placeholder.`);
    } else if (placeholder.kind === "departure" && !mentionable.has(placeholder.departureId)) {
      problems.push(
        `The email placeholder ${placeholder.raw} names a departure that is neither a pick nor a noted near miss.`,
      );
    }
  }
  return problems;
}

function usageOf(response: BetaMessage, latencyMs: number): CallUsage {
  return {
    model: response.model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
    latencyMs,
  };
}

function parseOutput(response: BetaMessage): RankingOutput {
  if (response.stop_reason === "refusal") {
    const category = response.stop_details?.category ?? "unspecified";
    throw new ClaudeCallError("refusal", `Ranking was declined (${category})`);
  }
  if (response.stop_reason === "max_tokens") {
    throw new ClaudeCallError("max_tokens", "Ranking was cut off at max_tokens");
  }
  const text = response.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new ClaudeCallError("invalid_output", "Ranking output was not JSON", { cause: error });
  }
  const parsed = RankingOutput.safeParse(json);
  if (!parsed.success) {
    throw new ClaudeCallError("invalid_output", `Ranking output didn't match the schema: ${parsed.error.message}`);
  }
  return parsed.data;
}

async function callOnce(
  client: RankClient,
  model: string,
  messages: Anthropic.Beta.Messages.BetaMessageParam[],
): Promise<{ response: BetaMessage; latencyMs: number }> {
  const started = performance.now();
  try {
    const response = await client.beta.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      system: [{ type: "text", text: RANK_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      // The SDK helper builds the JSON schema; the response is parsed below,
      // after the stop reason is checked, so a cut-off reply isn't mistaken
      // for a schema error.
      output_config: { effort: "medium", format: OUTPUT_FORMAT },
      messages,
    }, REQUEST_OPTIONS);
    return { response, latencyMs: Math.round(performance.now() - started) };
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      throw new ClaudeCallError("api", `Ranking call failed: ${error.message}`, { cause: error });
    }
    throw error;
  }
}

function emptyShortlist(unrankedCount: number): Shortlist {
  return { picks: [], nearMisses: [], emailBody: "", unrankedCount };
}

/**
 * Ranks a brief's candidates and explains the order. Makes no call when
 * there is nothing to rank or explain.
 */
export async function rankShortlist(
  brief: Brief,
  search: SearchResult,
  opts: RankOptions = {},
): Promise<{ shortlist: Shortlist; usage: CallUsage[] }> {
  const sent = search.candidates.slice(0, MAX_RANKED_CANDIDATES);
  const unrankedCount = search.candidates.length - sent.length;
  const { nearMisses } = search;
  if (sent.length === 0 && nearMisses.length === 0) {
    return { shortlist: emptyShortlist(0), usage: [] };
  }

  const client = opts.client ?? getAnthropic();
  const model = opts.model ?? MODELS.rank;
  const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [
    { role: "user", content: rankingUserMessage(brief, sent, nearMisses) },
  ];
  const usage: CallUsage[] = [];
  try {
    return await rankWithRetry(client, model, messages, usage, sent, nearMisses, unrankedCount);
  } catch (error) {
    // Keep what was billed before the failure.
    if (error instanceof ClaudeCallError) {
      throw new ClaudeCallError(error.kind, error.message, { cause: error.cause, usage });
    }
    throw error;
  }
}

async function rankWithRetry(
  client: RankClient,
  model: string,
  messages: Anthropic.Beta.Messages.BetaMessageParam[],
  usage: CallUsage[],
  sent: Candidate[],
  nearMisses: NearMiss[],
  unrankedCount: number,
): Promise<{ shortlist: Shortlist; usage: CallUsage[] }> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { response, latencyMs } = await callOnce(client, model, messages);
    usage.push(usageOf(response, latencyMs));
    const output = parseOutput(response);
    const problems = rankingProblems(output, sent, nearMisses);
    if (problems.length === 0) {
      return { shortlist: buildShortlist(output, sent, nearMisses, unrankedCount), usage };
    }
    if (attempt === 2) {
      throw new ClaudeCallError("invalid_ids", `Ranking was invalid twice: ${problems.join(" ")}`);
    }
    messages.push(
      { role: "assistant", content: response.content },
      {
        role: "user",
        content: `That ranking can't be used:\n${problems.map((p) => `- ${p}`).join("\n")}\nReturn the full ranking again, using only the IDs you were given.`,
      },
    );
  }
  // The loop always returns or throws.
  throw new ClaudeCallError("invalid_ids", "Ranking failed");
}

function buildShortlist(
  output: RankingOutput,
  sent: Candidate[],
  nearMisses: NearMiss[],
  unrankedCount: number,
): Shortlist {
  const candidates = new Map(sent.map((c) => [c.departureId, c]));
  const picks: ShortlistPick[] = output.picks.map((pick, i) => {
    const candidate = candidates.get(pick.departureId);
    const fare = candidate?.fares.find((f) => f.cabinCategoryId === pick.cabinCategoryId);
    if (!candidate || !fare) {
      throw new ClaudeCallError("invalid_ids", `Pick ${pick.departureId} failed validation`);
    }
    return { rank: i + 1, candidate, fare, reason: pick.reason, tradeOff: pick.tradeOff };
  });

  const notes = new Map(output.nearMissNotes.map((n) => [n.departureId, n.note]));
  const shortlistNearMisses = nearMisses.map((nearMiss) => ({
    nearMiss,
    note: notes.get(nearMiss.departureId) ?? null,
  }));

  const emailBody = fillPlaceholders(output.emailBody, placeholderSources(picks, nearMisses));
  return { picks, nearMisses: shortlistNearMisses, emailBody, unrankedCount };
}
