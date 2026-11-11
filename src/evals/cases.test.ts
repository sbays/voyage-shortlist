import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../db/db.ts";
import { migrate } from "../db/migrate.ts";
import { createPgliteDb } from "../db/pglite.ts";
import { searchDepartures } from "../db/search.ts";
import { seed } from "../db/seed.ts";
import { HardRules } from "../domain/brief.ts";
import { MAX_RANKED_CANDIDATES } from "../domain/shortlist.ts";
import { EVAL_CASES } from "./cases.ts";

// No API calls: checks that the evaluation set is a fair test against the
// seeded catalogue, so a bad score means a bad ranking, not a bad case.

let db: Db;

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db);
  await seed(db);
});

afterAll(async () => {
  await db.close();
});

describe("evaluation cases", () => {
  it("has 10 cases with unique IDs", () => {
    expect(EVAL_CASES).toHaveLength(10);
    expect(new Set(EVAL_CASES.map((c) => c.id)).size).toBe(EVAL_CASES.length);
  });

  it.each(EVAL_CASES)("$id: rules are a valid brief", (c) => {
    expect(HardRules.parse(c.rules)).toEqual(c.rules);
  });

  it.each(EVAL_CASES)("$id: the expected pick is a ranked candidate among at least 3", async (c) => {
    const { candidates } = await searchDepartures(db, HardRules.parse(c.rules));
    const ranked = candidates.slice(0, MAX_RANKED_CANDIDATES).map((d) => d.departureId);

    expect(candidates.length).toBeGreaterThanOrEqual(3);
    expect(ranked).toContain(c.expectedTop);
  });

  it.each(EVAL_CASES)("$id: the named competitor is a candidate too", async (c) => {
    const { candidates } = await searchDepartures(db, HardRules.parse(c.rules));
    const competitorId = c.competitor.split(" ")[0];

    expect(competitorId).not.toBe(c.expectedTop);
    expect(candidates.map((d) => d.departureId)).toContain(competitorId);
  });
});
