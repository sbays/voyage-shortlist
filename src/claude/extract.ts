import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { ActivityOption } from "../db/catalogue.ts";
import {
  ExtractionOutput,
  type DraftBrief,
  type DraftField,
} from "../domain/draft-brief.ts";
import { formatGbp } from "../lib/money.ts";
import { getAnthropic, type MessagesClient } from "./client.ts";
import { ClaudeCallError } from "./errors.ts";
import { MODELS, type CallUsage } from "./models.ts";
import { extractSystemPrompt, extractUserMessage } from "./prompts/extract.ts";

// "Extract the brief": one structured-outputs call that turns call notes into
// the form's starting values. Nothing here is searched on until the
// specialist has checked it.

// Built once: the JSON schema doesn't change between calls.
const OUTPUT_FORMAT = zodOutputFormat(ExtractionOutput);
const MAX_TOKENS = 2_000;

export interface ExtractOptions {
  client?: MessagesClient;
  model?: string;
  /** ISO date the notes are read against, so "mid-January" gets a year. */
  today?: string;
}

/**
 * Calls Claude and returns the draft brief. Uses `messages.create` and
 * validates the text itself, rather than `messages.parse`: parse validates
 * before returning, so a reply cut off at max_tokens would surface as a
 * schema error and the stop reason would be lost.
 */
export async function extractBrief(
  notes: string,
  activities: ActivityOption[],
  opts: ExtractOptions = {},
): Promise<{ draft: DraftBrief; usage: CallUsage }> {
  const client = opts.client ?? getAnthropic();
  const model = opts.model ?? MODELS.extract;
  const today = opts.today ?? new Date().toISOString().slice(0, 10);

  const started = performance.now();
  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system: extractSystemPrompt(activities),
      messages: [{ role: "user", content: extractUserMessage(notes, today) }],
      output_config: { format: OUTPUT_FORMAT, effort: "low" },
    });
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      throw new ClaudeCallError("api", `Extraction call failed: ${error.message}`, { cause: error });
    }
    throw error;
  }
  const usage: CallUsage = {
    model: response.model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
    latencyMs: Math.round(performance.now() - started),
  };

  // Every failure from here on was billed, so it carries the usage.
  if (response.stop_reason === "refusal") {
    throw new ClaudeCallError("refusal", "Claude declined to read these notes", { usage: [usage] });
  }
  if (response.stop_reason === "max_tokens") {
    throw new ClaudeCallError("max_tokens", "The extracted brief was cut off", { usage: [usage] });
  }

  const output = parseOutput(response, usage);
  return { draft: toDraftBrief(output, activities), usage };
}

function parseOutput(response: Anthropic.Message, usage: CallUsage): ExtractionOutput {
  const text = response.content.find((block) => block.type === "text")?.text;
  if (text === undefined) {
    throw new ClaudeCallError("invalid_output", "The reply had no brief in it", { usage: [usage] });
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new ClaudeCallError("invalid_output", "The brief wasn't valid JSON", {
      cause: error,
      usage: [usage],
    });
  }
  const result = ExtractionOutput.safeParse(json);
  if (!result.success) {
    throw new ClaudeCallError("invalid_output", "The brief didn't match the schema", {
      cause: result.error,
      usage: [usage],
    });
  }
  return result.data;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * Turns the model's output into the form's starting values, applying every
 * range check the structured-outputs schema can't express. Pure, so the
 * conversions are tested without a model.
 */
export function toDraftBrief(output: ExtractionOutput, activities: ActivityOption[]): DraftBrief {
  const unclear: { field: DraftField; note: string }[] = [...output.unclear];
  const flag = (field: DraftField, note: string) => unclear.push({ field, note });

  // Dates
  const checkDate = (value: string | null, label: string): string | null => {
    if (value === null) return null;
    if (isIsoDate(value)) return value;
    flag("window", `The ${label} date "${value}" isn't a valid date.`);
    return null;
  };
  const windowStart = checkDate(output.windowStart, "start");
  const windowEnd = checkDate(output.windowEnd, "end");
  if (windowStart && windowEnd && windowEnd < windowStart) {
    flag("window", "The window ends before it starts.");
  }

  // Party
  let partySize: number | null = null;
  if (output.partySize !== null) {
    if (Number.isInteger(output.partySize) && output.partySize > 0) {
      partySize = output.partySize;
    } else {
      flag("party_size", `"${output.partySize}" isn't a number of travellers.`);
    }
  }

  // Budget, always per person
  let budgetPerPersonGbp: number | null = null;
  let budgetConversion: string | null = null;
  const amount = output.budgetAmountGbp;
  if (amount !== null) {
    const pounds = Math.round(amount);
    if (!(pounds > 0)) {
      flag("budget", `A budget of ${amount} pounds doesn't make sense.`);
    } else if (output.budgetBasis === "per_person") {
      budgetPerPersonGbp = pounds;
    } else if (output.budgetBasis === "total") {
      if (partySize === null) {
        flag("budget", `${formatGbp(pounds)} is a total, but the party size isn't known.`);
      } else {
        budgetPerPersonGbp = Math.round(pounds / partySize);
        const people = partySize === 1 ? "person" : "people";
        budgetConversion = `${formatGbp(pounds)} total ÷ ${partySize} ${people}`;
      }
    } else {
      budgetPerPersonGbp = pounds;
      flag("budget", `Not clear whether ${formatGbp(pounds)} is per person or in total.`);
    }
  }

  // Activities: known IDs only, each once
  const known = new Set(activities.map((a) => a.id));
  const mustHaveActivityIds: string[] = [];
  for (const id of output.mustHaveActivityIds) {
    if (!known.has(id)) {
      flag("activities", `"${id}" isn't an activity in the catalogue.`);
    } else if (!mustHaveActivityIds.includes(id)) {
      mustHaveActivityIds.push(id);
    }
  }

  return {
    windowStart,
    windowEnd,
    budgetPerPersonGbp,
    budgetConversion,
    partySize,
    partyDescription: output.partyDescription.trim(),
    soloPreference: output.soloPreference,
    mustHaveActivityIds,
    softPreferences: [...new Set(output.softPreferences.map((p) => p.trim()).filter(Boolean))],
    unclear,
  };
}
