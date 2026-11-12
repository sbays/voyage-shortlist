import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ClaudeCallError } from "../claude/errors.ts";
import type { Db } from "../db/db.ts";
import { migrate } from "../db/migrate.ts";
import { createPgliteDb } from "../db/pglite.ts";
import { ipKey } from "../db/rate-limit.ts";
import { CALLS_PER_IP_PER_HOUR } from "../domain/limits.ts";
import type { Shortlist } from "../domain/shortlist.ts";
import { seed } from "../db/seed.ts";

// The actions against a real seeded PGlite database, with the two Claude
// calls and the request headers faked.

const state = vi.hoisted(() => ({ db: null as Db | null, ip: "203.0.113.1" }));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": `198.51.100.9, ${state.ip}` }),
}));
vi.mock("@/db/connection", () => ({
  getDb: async () => {
    if (!state.db) throw new Error("connection refused");
    return state.db;
  },
}));
const extractBrief = vi.hoisted(() => vi.fn());
const rankShortlist = vi.hoisted(() => vi.fn());
vi.mock("@/claude/extract", () => ({ extractBrief }));
vi.mock("@/claude/rank", () => ({ rankShortlist }));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ refresh }));

const { extractBriefAction, rebuildShortlistAction, runShortlistAction, saveBriefAction } =
  await import("./actions.ts");

let db: Db;

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db);
  await seed(db);
});

beforeEach(async () => {
  state.db = db;
  state.ip = `203.0.113.${Math.floor(Math.random() * 250)}`;
  extractBrief.mockReset();
  rankShortlist.mockReset();
  await db.exec("DELETE FROM rate_limits");
});

afterAll(async () => {
  await db.close();
});

const emptyShortlist: Shortlist = { picks: [], nearMisses: [], emailBody: "", unrankedCount: 0 };
const usage = { model: "claude-sonnet-5-5", inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, latencyMs: 100 };

function briefForm(overrides: Record<string, string> = {}): FormData {
  const values: Record<string, string> = {
    rawNotes: "couple, December, about 12k each",
    windowStart: "2026-12-10",
    windowEnd: "2026-12-28",
    budgetPerPersonGbp: "12000",
    partySize: "2",
    soloPreference: "either",
    partyDescription: "couple",
    softPreferences: "",
    ...overrides,
  };
  const form = new FormData();
  for (const [name, value] of Object.entries(values)) form.append(name, value);
  return form;
}

const notesForm = (notes: string) => {
  const form = new FormData();
  form.append("notes", notes);
  return form;
};

const count = async (table: string) =>
  (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`))[0].n;

describe("extractBriefAction", () => {
  it("refuses empty and over-long notes without calling Claude", async () => {
    expect(await extractBriefAction({ status: "idle" }, notesForm("   "))).toMatchObject({ status: "error" });
    expect(await extractBriefAction({ status: "idle" }, notesForm("x".repeat(5_001)))).toMatchObject({
      status: "error",
    });
    expect(extractBrief).not.toHaveBeenCalled();
  });

  it("returns an error state, not a thrown error, when the database is down", async () => {
    state.db = null;
    expect(await extractBriefAction({ status: "idle" }, notesForm("notes"))).toEqual({
      status: "error",
      notes: "notes",
      message: "Something went wrong. Try again.",
    });
  });

  it("maps a Claude failure to its message", async () => {
    extractBrief.mockRejectedValue(new ClaudeCallError("refusal", "no"));
    const result = await extractBriefAction({ status: "idle" }, notesForm("notes"));
    expect(result).toMatchObject({ status: "error", message: expect.stringContaining("declined") });
  });
});

describe("runShortlistAction", () => {
  it("refuses at the rate limit before storing anything", async () => {
    await db.query(
      "INSERT INTO rate_limits (key, window_start, count) VALUES ($1, date_trunc('hour', now()), $2)",
      [ipKey(state.ip), CALLS_PER_IP_PER_HOUR],
    );
    const briefs = await count("briefs");

    const result = await runShortlistAction({ status: "idle" }, briefForm());
    expect(result).toMatchObject({ status: "error", message: expect.stringContaining("30 Claude calls") });
    expect(await count("briefs")).toBe(briefs);
    expect(rankShortlist).not.toHaveBeenCalled();
  });

  it("counts a run with nothing to rank and names the excluding rules", async () => {
    rankShortlist.mockResolvedValue({ shortlist: emptyShortlist, usage: [] });
    const result = await runShortlistAction(
      { status: "idle" },
      briefForm({ windowStart: "2026-06-01", windowEnd: "2026-06-05", budgetPerPersonGbp: "500" }),
    );

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.result.exclusions[0]).toMatchObject({ rule: "over_budget" });
    // Counted against the last X-Forwarded-For address, not the first.
    const [row] = await db.query<{ count: number }>("SELECT count FROM rate_limits WHERE key = $1", [
      ipKey(state.ip),
    ]);
    expect(row.count).toBe(1);
  });

  it("logs a failed ranking with its usage and returns the failure message", async () => {
    rankShortlist.mockRejectedValue(new ClaudeCallError("invalid_ids", "bad", { usage: [usage, usage] }));
    const result = await runShortlistAction({ status: "idle" }, briefForm());

    expect(result).toMatchObject({ status: "error", message: expect.stringContaining("rejected") });
    const [row] = await db.query<{ failure_kind: string; attempts: number }>(
      "SELECT failure_kind, attempts FROM shortlists ORDER BY created_at DESC LIMIT 1",
    );
    expect(row).toEqual({ failure_kind: "invalid_ids", attempts: 2 });
  });

  it("returns field errors for an invalid form without searching", async () => {
    const result = await runShortlistAction({ status: "idle" }, briefForm({ partySize: "0" }));
    expect(result).toMatchObject({ status: "invalid", fieldErrors: { partySize: expect.any(String) } });
    expect(rankShortlist).not.toHaveBeenCalled();
  });
});

describe("saveBriefAction", () => {
  it("records the candidates from a fresh search, not from the client", async () => {
    rankShortlist.mockResolvedValue({ shortlist: emptyShortlist, usage: [usage] });
    const run = await runShortlistAction({ status: "idle" }, briefForm());
    if (run.status !== "ok") throw new Error(`run failed: ${JSON.stringify(run)}`);

    const saved = await saveBriefAction(run.result.briefId);
    expect(saved).toMatchObject({ status: "saved", savedAt: expect.stringMatching(/T/) });
    const known = await db.query("SELECT 1 FROM brief_known_departures WHERE brief_id = $1", [
      run.result.briefId,
    ]);
    expect(known).toHaveLength(run.result.candidateCount);
  });

  it("reports an unknown brief instead of saving", async () => {
    expect(await saveBriefAction("00000000-0000-0000-0000-000000000000")).toEqual({
      status: "error",
      message: "That brief no longer exists.",
    });
  });
});

describe("rebuildShortlistAction", () => {
  async function savedBrief(): Promise<string> {
    rankShortlist.mockResolvedValue({ shortlist: emptyShortlist, usage: [usage] });
    const run = await runShortlistAction({ status: "idle" }, briefForm());
    if (run.status !== "ok") throw new Error(`run failed: ${JSON.stringify(run)}`);
    await saveBriefAction(run.result.briefId);
    return run.result.briefId;
  }

  it("logs a fresh shortlist, marks the brief's matches seen and refreshes the page", async () => {
    const briefId = await savedBrief();
    const [{ id: departureId }] = await db.query<{ id: string }>("SELECT id FROM departures LIMIT 1");
    await db.query("INSERT INTO matches (brief_id, departure_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [
      briefId,
      departureId,
    ]);
    const before = await count("shortlists");

    expect(await rebuildShortlistAction(briefId)).toEqual({ status: "rebuilt" });
    expect(await count("shortlists")).toBe(before + 1);
    const unseen = await db.query("SELECT 1 FROM matches WHERE brief_id = $1 AND NOT seen", [briefId]);
    expect(unseen).toHaveLength(0);
    expect(refresh).toHaveBeenCalled();
  });

  it("records what the rebuild showed as known, so the nightly job won't call it new", async () => {
    const briefId = await savedBrief();
    await db.query("DELETE FROM brief_known_departures WHERE brief_id = $1", [briefId]);

    expect(await rebuildShortlistAction(briefId)).toEqual({ status: "rebuilt" });
    const known = await db.query("SELECT 1 FROM brief_known_departures WHERE brief_id = $1", [briefId]);
    expect(known.length).toBeGreaterThan(0);
  });

  it("leaves a match found while the rebuild was ranking unseen", async () => {
    const briefId = await savedBrief();
    const [{ id: departureId }] = await db.query<{ id: string }>("SELECT id FROM departures LIMIT 1");
    // Found after the rebuild's search started, as if the job ran mid-rebuild.
    await db.query(
      "INSERT INTO matches (brief_id, departure_id, found_at) VALUES ($1, $2, now() + interval '1 hour')",
      [briefId, departureId],
    );

    await rebuildShortlistAction(briefId);
    const unseen = await db.query("SELECT 1 FROM matches WHERE brief_id = $1 AND NOT seen", [briefId]);
    expect(unseen).toHaveLength(1);
  });

  it("reports a rebuild it couldn't log, and changes nothing", async () => {
    const briefId = await savedBrief();
    const [{ id: departureId }] = await db.query<{ id: string }>("SELECT id FROM departures LIMIT 1");
    await db.query("INSERT INTO matches (brief_id, departure_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [
      briefId,
      departureId,
    ]);
    refresh.mockClear();
    await db.exec(`
      CREATE FUNCTION refuse_log() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'log unavailable'; END $$;
      CREATE TRIGGER refuse_log BEFORE INSERT ON shortlists FOR EACH ROW EXECUTE FUNCTION refuse_log();
    `);
    try {
      expect(await rebuildShortlistAction(briefId)).toMatchObject({ status: "error" });
    } finally {
      await db.exec("DROP TRIGGER refuse_log ON shortlists; DROP FUNCTION refuse_log();");
    }
    const unseen = await db.query("SELECT 1 FROM matches WHERE brief_id = $1 AND NOT seen", [briefId]);
    expect(unseen).toHaveLength(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refuses a brief that was never saved, without calling Claude", async () => {
    rankShortlist.mockResolvedValue({ shortlist: emptyShortlist, usage: [] });
    const run = await runShortlistAction({ status: "idle" }, briefForm());
    if (run.status !== "ok") throw new Error("run failed");
    rankShortlist.mockClear();

    expect(await rebuildShortlistAction(run.result.briefId)).toEqual({
      status: "error",
      message: "That brief no longer exists.",
    });
    expect(rankShortlist).not.toHaveBeenCalled();
  });

  it("is rate-limited like any other run", async () => {
    const briefId = await savedBrief();
    await db.query(
      "UPDATE rate_limits SET count = $2 WHERE key = $1",
      [ipKey(state.ip), CALLS_PER_IP_PER_HOUR],
    );
    rankShortlist.mockClear();

    expect(await rebuildShortlistAction(briefId)).toMatchObject({ status: "error" });
    expect(rankShortlist).not.toHaveBeenCalled();
  });
});
