import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Brief } from "../domain/brief.ts";
import type { Shortlist } from "../domain/shortlist.ts";
import {
  briefTitle,
  createBrief,
  getBrief,
  getLatestShortlist,
  listSavedBriefs,
  logShortlist,
  saveBrief,
} from "./briefs.ts";
import type { Db } from "./db.ts";
import { migrate } from "./migrate.ts";
import { createPgliteDb } from "./pglite.ts";
import { seed } from "./seed.ts";

let db: Db;

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db);
  await seed(db);
});

afterAll(async () => {
  await db.close();
});

const brief = Brief.parse({
  rules: { windowStart: "2026-12-01", windowEnd: "2026-12-31", budgetPerPersonGbp: 10_000, partySize: 2 },
  partyDescription: "retired couple, first polar trip",
  softPreferences: ["small ship"],
});

const emptyShortlist: Shortlist = { picks: [], nearMisses: [], emailBody: "", unrankedCount: 0 };

const usage = (inputTokens: number) => ({
  model: "claude-sonnet-5-5",
  inputTokens,
  outputTokens: 10,
  cacheReadTokens: 1,
  cacheWriteTokens: 2,
  latencyMs: 1000.4,
});

describe("briefs", () => {
  it("stores a brief and reads it back through the schema", async () => {
    const id = await createBrief(db, "raw notes", brief);
    const stored = await getBrief(db, id);

    expect(stored).toMatchObject({ rawNotes: "raw notes", brief, saved: false, savedAt: null });
    expect(stored?.title).toBe("retired couple, first polar trip");
  });

  it("returns null for an unknown or malformed ID", async () => {
    expect(await getBrief(db, "00000000-0000-0000-0000-000000000000")).toBeNull();
    expect(await getBrief(db, "'; DROP TABLE briefs; --")).toBeNull();
  });

  it("shortens a long party description to 80 characters", () => {
    const title = briefTitle({ ...brief, partyDescription: "x".repeat(200) });
    expect(title).toHaveLength(80);
    expect(title.endsWith("…")).toBe(true);
  });

  it("titles a brief with no party description by its dates", () => {
    expect(briefTitle({ ...brief, partyDescription: " " })).toBe(
      "2 travelling, 2026-12-01 to 2026-12-31",
    );
  });

  it("saves once, keeps the first saved time, and records known departures", async () => {
    const id = await createBrief(db, "", brief);
    const firstSavedAt = await saveBrief(db, id, ["dep_001", "not_a_departure"]);
    const secondSavedAt = await saveBrief(db, id, ["dep_001", "dep_002"]);

    expect(firstSavedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(secondSavedAt).toBe(firstSavedAt);
    expect((await getBrief(db, id))?.savedAt).toBe(firstSavedAt);
    const known = await db.query<{ departure_id: string }>(
      "SELECT departure_id FROM brief_known_departures WHERE brief_id = $1 ORDER BY 1",
      [id],
    );
    expect(known.map((k) => k.departure_id)).toEqual(["dep_001", "dep_002"]);
    expect((await listSavedBriefs(db)).map((b) => b.id)).toContain(id);
  });

  it("won't save an unknown brief", async () => {
    expect(await saveBrief(db, "00000000-0000-0000-0000-000000000000", [])).toBeNull();
  });
});

describe("shortlist log", () => {
  it("sums usage over attempts and returns the latest successful run", async () => {
    const briefId = await createBrief(db, "", brief);
    await logShortlist(db, {
      briefId,
      candidateIds: ["dep_001", "dep_002"],
      shortlist: emptyShortlist,
      failureKind: null,
      usage: [usage(100), usage(50)],
    });
    await logShortlist(db, {
      briefId,
      candidateIds: ["dep_001"],
      shortlist: null,
      failureKind: "invalid_ids",
      usage: [usage(7)],
    });

    const [row] = await db.query<Record<string, unknown>>(
      "SELECT attempts, input_tokens, latency_ms, model FROM shortlists WHERE brief_id = $1 AND result IS NOT NULL",
      [briefId],
    );
    expect(row).toMatchObject({ attempts: 2, input_tokens: 150, latency_ms: 2001, model: "claude-sonnet-5-5" });

    const latest = await getLatestShortlist(db, briefId);
    expect(latest).toMatchObject({ shortlist: emptyShortlist, candidateCount: 2 });
  });

  it("logs a run that made no call", async () => {
    const briefId = await createBrief(db, "", brief);
    await logShortlist(db, { briefId, candidateIds: [], shortlist: emptyShortlist, failureKind: null, usage: [] });
    const [row] = await db.query<Record<string, unknown>>(
      "SELECT attempts, model FROM shortlists WHERE brief_id = $1",
      [briefId],
    );
    expect(row).toEqual({ attempts: 0, model: null });
  });
});
