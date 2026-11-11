import Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivityOption } from "../db/catalogue.ts";
import type { ExtractionOutput } from "../domain/draft-brief.ts";
import { ClaudeCallError } from "./errors.ts";
import { extractBrief, toDraftBrief } from "./extract.ts";

const ACTIVITIES: ActivityOption[] = [
  { id: "act_kayak", name: "Sea kayaking" },
  { id: "act_camp", name: "Overnight camping" },
];

function output(overrides: Partial<ExtractionOutput> = {}): ExtractionOutput {
  return {
    windowStart: "2027-01-10",
    windowEnd: "2027-01-31",
    budgetAmountGbp: 12_000,
    budgetBasis: "per_person",
    partySize: 2,
    partyDescription: "retired couple",
    soloPreference: "either",
    mustHaveActivityIds: [],
    softPreferences: ["worried about seasickness"],
    unclear: [],
    ...overrides,
  };
}

function message(
  text: string,
  stopReason: Anthropic.StopReason = "end_turn",
): Anthropic.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    container: null,
    diagnostics: null,
    content: [{ type: "text", text, citations: null }],
    stop_reason: stopReason,
    stop_sequence: null,
    stop_details: null,
    usage: {
      input_tokens: 900,
      output_tokens: 150,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 600,
      cache_creation: null,
      inference_geo: null,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: "standard",
      speed: "standard",
    },
  };
}

/** A real client whose `messages.create` never reaches the network. */
function fakeClient(reply: Anthropic.Message | Error) {
  const client = new Anthropic({ apiKey: "test-key" });
  const create = vi.spyOn(client.messages, "create");
  if (reply instanceof Error) create.mockRejectedValue(reply);
  else create.mockResolvedValue(reply);
  return { client, create };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("extractBrief", () => {
  it("returns the draft and usage for a valid reply", async () => {
    const { client } = fakeClient(message(JSON.stringify(output())));

    const { draft, usage } = await extractBrief("notes", ACTIVITIES, { client, today: "2026-11-11" });

    expect(draft).toMatchObject({
      windowStart: "2027-01-10",
      windowEnd: "2027-01-31",
      budgetPerPersonGbp: 12_000,
      budgetConversion: null,
      partySize: 2,
      softPreferences: ["worried about seasickness"],
    });
    expect(usage).toMatchObject({
      model: "claude-haiku-5-5",
      inputTokens: 900,
      outputTokens: 150,
      cacheReadTokens: 600,
      cacheWriteTokens: 0,
    });
    expect(usage.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("sends the activity list in a cached system prompt and today's date with the notes", async () => {
    const { client, create } = fakeClient(message(JSON.stringify(output())));

    await extractBrief("Two of us, mid-January", ACTIVITIES, { client, today: "2026-11-11" });

    const params = create.mock.calls[0][0];
    const system = params.system;
    expect(Array.isArray(system)).toBe(true);
    const blocks = Array.isArray(system) ? system : [];
    expect(blocks[0].cache_control).toEqual({ type: "ephemeral" });
    const systemText = blocks.map((b) => b.text).join("\n");
    for (const a of ACTIVITIES) expect(systemText).toContain(a.id);
    expect(JSON.stringify(params.messages)).toContain("2026-11-11");
    expect(JSON.stringify(params.messages)).toContain("Two of us, mid-January");
    expect(params.output_config?.format?.type).toBe("json_schema");
  });

  it("reports a refusal", async () => {
    const { client } = fakeClient(message("", "refusal"));

    await expect(extractBrief("notes", ACTIVITIES, { client })).rejects.toMatchObject({
      kind: "refusal",
    });
  });

  it("keeps the usage of a billed call that failed", async () => {
    const { client } = fakeClient(message("not json"));

    const error = await extractBrief("notes", ACTIVITIES, { client }).catch((e: unknown) => e);

    expect(error).toMatchObject({ kind: "invalid_output" });
    expect(error).toHaveProperty("usage", [expect.objectContaining({ model: expect.any(String) })]);
  });

  it("reports a reply cut off at max_tokens, even though its JSON is broken", async () => {
    const { client } = fakeClient(message('{"windowStart": "2027-01', "max_tokens"));

    await expect(extractBrief("notes", ACTIVITIES, { client })).rejects.toMatchObject({
      kind: "max_tokens",
    });
  });

  it("reports output that doesn't match the schema", async () => {
    const { client } = fakeClient(message(JSON.stringify({ windowStart: 5 })));

    const error = await extractBrief("notes", ACTIVITIES, { client }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ClaudeCallError);
    expect(error).toMatchObject({ kind: "invalid_output" });
  });

  it("reports output that isn't JSON", async () => {
    const { client } = fakeClient(message("Here is the brief: dates are January."));

    await expect(extractBrief("notes", ACTIVITIES, { client })).rejects.toMatchObject({
      kind: "invalid_output",
    });
  });

  it("wraps API errors", async () => {
    const { client } = fakeClient(new Anthropic.APIConnectionError({ message: "socket hang up" }));

    const error = await extractBrief("notes", ACTIVITIES, { client }).catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "api" });
    expect(error instanceof ClaudeCallError && error.cause).toBeInstanceOf(Anthropic.APIError);
  });
});

describe("toDraftBrief", () => {
  it("divides a total budget by the party size and says so", () => {
    const draft = toDraftBrief(output({ budgetAmountGbp: 24_000, budgetBasis: "total" }), ACTIVITIES);

    expect(draft.budgetPerPersonGbp).toBe(12_000);
    expect(draft.budgetConversion).toBe("£24,000 total ÷ 2 people");
  });

  it("rounds a total that doesn't divide evenly to whole pounds", () => {
    const draft = toDraftBrief(
      output({ budgetAmountGbp: 25_000, budgetBasis: "total", partySize: 3 }),
      ACTIVITIES,
    );

    expect(draft.budgetPerPersonGbp).toBe(8_333);
  });

  it("leaves a total budget empty when the party size isn't known", () => {
    const draft = toDraftBrief(
      output({ budgetAmountGbp: 24_000, budgetBasis: "total", partySize: null }),
      ACTIVITIES,
    );

    expect(draft.budgetPerPersonGbp).toBeNull();
    expect(draft.unclear.map((u) => u.field)).toContain("budget");
  });

  it("keeps an amount of unknown basis as per person but flags it", () => {
    const draft = toDraftBrief(output({ budgetBasis: "unknown" }), ACTIVITIES);

    expect(draft.budgetPerPersonGbp).toBe(12_000);
    expect(draft.unclear.map((u) => u.field)).toContain("budget");
  });

  it("rejects a non-positive budget", () => {
    const draft = toDraftBrief(output({ budgetAmountGbp: 0 }), ACTIVITIES);

    expect(draft.budgetPerPersonGbp).toBeNull();
    expect(draft.unclear.map((u) => u.field)).toContain("budget");
  });

  it("drops invalid dates and flags them", () => {
    const draft = toDraftBrief(
      output({ windowStart: "2027-02-30", windowEnd: "late January" }),
      ACTIVITIES,
    );

    expect(draft.windowStart).toBeNull();
    expect(draft.windowEnd).toBeNull();
    expect(draft.unclear.filter((u) => u.field === "window")).toHaveLength(2);
  });

  it("keeps a window that ends before it starts, flagged for the specialist", () => {
    const draft = toDraftBrief(
      output({ windowStart: "2027-01-31", windowEnd: "2027-01-10" }),
      ACTIVITIES,
    );

    expect([draft.windowStart, draft.windowEnd]).toEqual(["2027-01-31", "2027-01-10"]);
    expect(draft.unclear.map((u) => u.field)).toContain("window");
  });

  it("rejects a party size that isn't a positive whole number", () => {
    const draft = toDraftBrief(output({ partySize: 2.5, budgetBasis: "total" }), ACTIVITIES);

    expect(draft.partySize).toBeNull();
    expect(draft.budgetPerPersonGbp).toBeNull();
    expect(draft.unclear.map((u) => u.field)).toEqual(
      expect.arrayContaining(["party_size", "budget"]),
    );
  });

  it("drops unknown activities with a note and removes repeats", () => {
    const draft = toDraftBrief(
      output({ mustHaveActivityIds: ["act_kayak", "act_diving", "act_kayak"] }),
      ACTIVITIES,
    );

    expect(draft.mustHaveActivityIds).toEqual(["act_kayak"]);
    expect(draft.unclear).toContainEqual({
      field: "activities",
      note: '"act_diving" isn\'t an activity in the catalogue.',
    });
  });

  it("keeps the model's own unclear notes and removes repeated preferences", () => {
    const draft = toDraftBrief(
      output({
        unclear: [{ field: "solo_preference", note: "Doesn't say whether they'd share." }],
        softPreferences: ["small ship", " small ship ", ""],
      }),
      ACTIVITIES,
    );

    expect(draft.unclear[0]).toEqual({
      field: "solo_preference",
      note: "Doesn't say whether they'd share.",
    });
    expect(draft.softPreferences).toEqual(["small ship"]);
  });
});
