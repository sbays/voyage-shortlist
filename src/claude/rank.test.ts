import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import type { Brief } from "../domain/brief.ts";
import type { RankingOutput } from "../domain/shortlist.ts";
import type { Candidate, NearMiss, SearchResult } from "../db/search.ts";
import { ClaudeCallError } from "./errors.ts";
import { rankShortlist, type RankClient } from "./rank.ts";

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

const brief: Brief = {
  rules: {
    windowStart: "2026-12-01",
    windowEnd: "2027-01-31",
    budgetPerPersonGbp: 12_000,
    partySize: 2,
    soloPreference: "either",
    mustHaveActivityIds: [],
  },
  partyDescription: "Couple in their sixties, first polar trip",
  softPreferences: ["worried about seasickness"],
};

function candidate(n: number): Candidate {
  const id = `dep_${String(n).padStart(3, "0")}`;
  return {
    departureId: id,
    voyageName: `Voyage ${n}`,
    route: "peninsula",
    nights: 10,
    embarkPort: "Ushuaia",
    shipName: `Ship ${n}`,
    passengerCapacity: 120,
    operatorName: "Operator A",
    startDate: "2026-12-05",
    endDate: "2026-12-15",
    availabilityUpdatedAt: "2026-11-01T09:00:00Z",
    fares: [
      {
        cabinCategoryId: `cab_${n}_twin`,
        cabinName: "Twin with window",
        sleeps: 2,
        booking: "party",
        farePerPersonGbp: 9_000 + n,
        totalPerPersonGbp: 9_000 + n,
        berthsLeft: 6,
      },
    ],
  };
}

const nearMiss: NearMiss = {
  ...candidate(90),
  rule: "over_budget",
  distance: 400,
  fare: { ...candidate(90).fares[0], totalPerPersonGbp: 12_400, farePerPersonGbp: 12_400 },
};

function search(count: number, nearMisses: NearMiss[] = [nearMiss]): SearchResult {
  return { candidates: Array.from({ length: count }, (_, i) => candidate(i + 1)), nearMisses };
}

function pick(n: number, cabin = `cab_${n}_twin`) {
  return {
    departureId: `dep_${String(n).padStart(3, "0")}`,
    cabinCategoryId: cabin,
    reason: `Fits because ${n}.`,
    tradeOff: `Downside ${n}.`,
  };
}

const validOutput: RankingOutput = {
  picks: [pick(2), pick(1), pick(3)],
  nearMissNotes: [{ departureId: "dep_090", note: "For £400 more, a better ship." }],
  emailBody:
    "{{departure:dep_002.ship}} sails {{departure:dep_002.dates}} from {{departure:dep_002.price}}. Or {{departure:dep_090.ship}}. {{specialist_name}}",
};

function message(
  output: unknown,
  overrides: Partial<Pick<BetaMessage, "stop_reason" | "stop_details">> = {},
): BetaMessage {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    container: null,
    context_management: null,
    diagnostics: null,
    stop_reason: "end_turn",
    stop_details: null,
    stop_sequence: null,
    content: [
      { type: "text", text: typeof output === "string" ? output : JSON.stringify(output), citations: null },
    ],
    usage: {
      input_tokens: 1_000,
      output_tokens: 300,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 800,
      cache_creation: null,
      fallback_credit: null,
      inference_geo: null,
      iterations: null,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: "standard",
      speed: "standard",
    },
    ...overrides,
  };
}

function fakeClient(...responses: (BetaMessage | Error)[]) {
  const create = vi.fn(
    async (params: CreateParams, options?: Anthropic.RequestOptions): Promise<BetaMessage> => {
    void params;
    void options;
    const next = responses.shift();
    if (!next) throw new Error("No more fake responses");
    if (next instanceof Error) throw next;
    return next;
  },
  );
  const client: RankClient = { beta: { messages: { create } } };
  return { client, create };
}

function sentUserMessage(params: CreateParams): string {
  const first = params.messages[0];
  if (typeof first.content !== "string") throw new Error("Expected a string user message");
  return first.content;
}

describe("rankShortlist", () => {
  it("builds the shortlist from database facts, in Claude's order", async () => {
    const { client, create } = fakeClient(message(validOutput));

    const { shortlist, usage } = await rankShortlist(brief, search(3), { client });

    expect(shortlist.picks.map((p) => [p.rank, p.candidate.departureId, p.fare.totalPerPersonGbp])).toEqual([
      [1, "dep_002", 9_002],
      [2, "dep_001", 9_001],
      [3, "dep_003", 9_003],
    ]);
    expect(shortlist.nearMisses).toEqual([{ nearMiss, note: "For £400 more, a better ship." }]);
    expect(shortlist.emailBody).toBe(
      "Ship 2 sails 5 Dec 2026 to 15 Dec 2026 from £9,002 per person. Or Ship 90. {{specialist_name}}",
    );
    expect(shortlist.unrankedCount).toBe(0);
    expect(usage).toEqual([
      expect.objectContaining({ model: "claude-sonnet-5-5", inputTokens: 1_000, cacheReadTokens: 800 }),
    ]);
    expect(create).toHaveBeenCalledOnce();
  });

  it("sends a cached system prompt, the fallback beta and structured output", async () => {
    const { client, create } = fakeClient(message(validOutput));

    await rankShortlist(brief, search(3), { client });

    const params = create.mock.calls[0][0];
    expect(params.model).toBe("claude-sonnet-5-5");
    expect(params.system).toEqual([
      expect.objectContaining({ type: "text", cache_control: { type: "ephemeral" } }),
    ]);
    expect(params.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(params.fallbacks).toBe("default");
    expect(params.output_config?.format?.type).toBe("json_schema");
    expect(params.output_config?.effort).toBe("medium");
  });

  it("retries once when a pick names a departure it wasn't given", async () => {
    const invented = { ...validOutput, picks: [pick(2), pick(1), pick(77)] };
    const { client, create } = fakeClient(message(invented), message(validOutput));

    const { shortlist, usage } = await rankShortlist(brief, search(3), { client });

    expect(shortlist.picks.map((p) => p.candidate.departureId)).toEqual(["dep_002", "dep_001", "dep_003"]);
    expect(usage).toHaveLength(2);
    const retry = create.mock.calls[1][0].messages;
    expect(retry).toHaveLength(3);
    expect(retry[1].role).toBe("assistant");
    expect(JSON.stringify(retry[2].content)).toContain("dep_077 is not in the candidate list");
  });

  it("fails with invalid_ids when the retry is still invalid", async () => {
    const invented = { ...validOutput, picks: [pick(2), pick(1), pick(77)] };
    const { client } = fakeClient(message(invented), message(invented));

    await expect(rankShortlist(brief, search(3), { client })).rejects.toMatchObject({
      kind: "invalid_ids",
    });
  });

  it("keeps the usage of both billed attempts when the retry fails", async () => {
    const invented = { ...validOutput, picks: [pick(2), pick(1), pick(77)] };
    const { client } = fakeClient(message(invented), message(invented));

    const error = await rankShortlist(brief, search(3), { client }).catch((e: unknown) => e);

    expect(error).toMatchObject({ kind: "invalid_ids" });
    expect(error).toHaveProperty("usage", [
      expect.objectContaining({ model: "claude-sonnet-5-5" }),
      expect.objectContaining({ model: "claude-sonnet-5-5" }),
    ]);
  });

  it("gives ranking a longer timeout and a single SDK retry", async () => {
    const { client, create } = fakeClient(message(validOutput));

    await rankShortlist(brief, search(3), { client });

    expect(create.mock.calls[0][1]).toEqual({ timeout: 120_000, maxRetries: 1 });
  });

  it("retries when a pick names a cabin that isn't a qualifying fare", async () => {
    const wrongCabin = { ...validOutput, picks: [pick(2), pick(1), pick(3, "cab_3_suite")] };
    const { client, create } = fakeClient(message(wrongCabin), message(validOutput));

    await rankShortlist(brief, search(3), { client });

    expect(JSON.stringify(create.mock.calls[1][0].messages[2].content)).toContain(
      "Cabin cab_3_suite is not a qualifying fare on dep_003",
    );
  });

  it("retries when the email names a departure that isn't shown", async () => {
    const leaky = { ...validOutput, emailBody: "Try {{departure:dep_055.price}}. {{specialist_name}}" };
    const { client, create } = fakeClient(message(leaky), message(validOutput));

    await rankShortlist(brief, search(3), { client });

    expect(create).toHaveBeenCalledTimes(2);
  });

  it("retries when the email contains a fact-shaped placeholder that doesn't exist", async () => {
    const leaky = { ...validOutput, emailBody: "From {{departure:dep_002.discount}}. {{specialist_name}}" };
    const { client, create } = fakeClient(message(leaky), message(validOutput));

    await rankShortlist(brief, search(3), { client });

    expect(create).toHaveBeenCalledTimes(2);
  });

  it("retries when it returns too few picks or the same departure twice", async () => {
    const short = { ...validOutput, picks: [pick(2), pick(2)] };
    const { client, create } = fakeClient(message(short), message(validOutput));

    await rankShortlist(brief, search(3), { client });

    const feedback = JSON.stringify(create.mock.calls[1][0].messages[2].content);
    expect(feedback).toContain("Return exactly 3 picks");
    expect(feedback).toContain("dep_002 is picked more than once");
  });

  it("reports a refusal", async () => {
    const { client } = fakeClient(
      message("", {
        stop_reason: "refusal",
        stop_details: {
          type: "refusal",
          category: "general_harms",
          explanation: null,
          fallback_credit_token: null,
          fallback_has_prefill_claim: null,
          recommended_model: null,
        },
      }),
    );

    await expect(rankShortlist(brief, search(3), { client })).rejects.toMatchObject({ kind: "refusal" });
  });

  it("reports output cut off at max_tokens rather than parsing it", async () => {
    const { client } = fakeClient(message('{"picks": [', { stop_reason: "max_tokens" }));

    await expect(rankShortlist(brief, search(3), { client })).rejects.toMatchObject({
      kind: "max_tokens",
    });
  });

  it("reports output that doesn't match the schema", async () => {
    const { client } = fakeClient(message({ picks: "first one" }));

    await expect(rankShortlist(brief, search(3), { client })).rejects.toMatchObject({
      kind: "invalid_output",
    });
  });

  it("reports output that isn't JSON", async () => {
    const { client } = fakeClient(message("Here is my ranking: dep_002"));

    await expect(rankShortlist(brief, search(3), { client })).rejects.toMatchObject({
      kind: "invalid_output",
    });
  });

  it("reports an API failure after the SDK's retries", async () => {
    const { client } = fakeClient(new Anthropic.APIConnectionError({ message: "socket hang up" }));

    const error = await rankShortlist(brief, search(3), { client }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ClaudeCallError);
    expect(error).toMatchObject({ kind: "api" });
  });

  it("makes no call when there is nothing to rank or explain", async () => {
    const { client, create } = fakeClient();

    const result = await rankShortlist(brief, search(0, []), { client });

    expect(result).toEqual({
      shortlist: { picks: [], nearMisses: [], emailBody: "", unrankedCount: 0 },
      usage: [],
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("sends only the first 20 candidates and counts the rest", async () => {
    const { client, create } = fakeClient(message(validOutput));

    const { shortlist } = await rankShortlist(brief, search(25), { client });

    const sent = JSON.parse(sentUserMessage(create.mock.calls[0][0]).split("\n\n")[1]) as {
      candidates: { departureId: string }[];
    };
    expect(sent.candidates).toHaveLength(20);
    expect(sent.candidates.at(-1)?.departureId).toBe("dep_020");
    expect(shortlist.unrankedCount).toBe(5);
  });

  it("rejects a pick from beyond the 20 that were sent", async () => {
    const late = { ...validOutput, picks: [pick(2), pick(1), pick(22)] };
    const { client } = fakeClient(message(late), message(late));

    await expect(rankShortlist(brief, search(25), { client })).rejects.toMatchObject({
      kind: "invalid_ids",
    });
  });

  it("with fewer than 3 candidates expects that many picks, never padding", async () => {
    const one = {
      picks: [pick(1)],
      nearMissNotes: [],
      emailBody: "{{departure:dep_001.ship}}. {{specialist_name}}",
    };
    const { client } = fakeClient(message(one));

    const { shortlist } = await rankShortlist(brief, search(1), { client });

    expect(shortlist.picks).toHaveLength(1);
  });

  it("with no candidates returns no picks and explains the near misses", async () => {
    const explain = {
      picks: [],
      nearMissNotes: [{ departureId: "dep_090", note: "£400 over budget." }],
      emailBody: "It would take {{departure:dep_090.price}}. {{specialist_name}}",
    };
    const { client } = fakeClient(message(explain));

    const { shortlist } = await rankShortlist(brief, search(0), { client });

    expect(shortlist.picks).toEqual([]);
    expect(shortlist.nearMisses[0].note).toBe("£400 over budget.");
    expect(shortlist.emailBody).toBe("It would take £12,400 per person. {{specialist_name}}");
  });

  it("rejects a near-miss note for a departure that isn't a near miss", async () => {
    const bad = { ...validOutput, nearMissNotes: [{ departureId: "dep_055", note: "Invented." }] };
    const { client } = fakeClient(message(bad), message(bad));

    await expect(rankShortlist(brief, search(3), { client })).rejects.toMatchObject({
      kind: "invalid_ids",
    });
  });

  it("sends the soft preferences and party, and leaves out solo preference for a couple", async () => {
    const { client, create } = fakeClient(message(validOutput));

    await rankShortlist(brief, search(3), { client });

    const text = sentUserMessage(create.mock.calls[0][0]);
    expect(text).toContain("worried about seasickness");
    expect(text).toContain("first polar trip");
    expect(text).not.toContain("soloPreference");
  });
});
