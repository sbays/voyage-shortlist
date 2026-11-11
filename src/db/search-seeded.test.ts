import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HardRules } from "../domain/brief.ts";
import type { Db } from "./db.ts";
import { migrate } from "./migrate.ts";
import { createPgliteDb } from "./pglite.ts";
import { exclusionCounts, searchDepartures, type SearchResult } from "./search.ts";
import { EDGE_CASES } from "./seed-data.ts";
import { seed } from "./seed.ts";

// Phase 1's "done when": hand-written briefs against the seeded catalogue,
// one per deliberate edge case. Each brief puts the edge case one rule away
// from fitting, next to a companion departure that does fit.

let db: Db;

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db);
  await seed(db);
});

afterAll(async () => {
  await db.close();
});

function search(rules: Partial<HardRules>): Promise<SearchResult> {
  return searchDepartures(db, HardRules.parse({ partySize: 2, ...rules }));
}

const ids = (r: SearchResult) => r.candidates.map((c) => c.departureId);

function nearMiss(r: SearchResult, departureId: string) {
  return r.nearMisses.find((n) => n.departureId === departureId);
}

describe("seeded edge cases", () => {
  it("the sold-out favourite is a berths near miss, not a candidate", async () => {
    const r = await search({
      windowStart: "2026-12-10",
      windowEnd: "2026-12-28",
      budgetPerPersonGbp: 12_000,
    });

    expect(ids(r)).toContain(EDGE_CASES.soldOutCompanion);
    expect(ids(r)).not.toContain(EDGE_CASES.soldOutFavourite);
    expect(nearMiss(r, EDGE_CASES.soldOutFavourite)).toMatchObject({
      rule: "berths_short",
      distance: 2,
    });
  });

  it("the fly-cruise just over budget is a budget near miss", async () => {
    const r = await search({
      windowStart: "2027-01-15",
      windowEnd: "2027-02-05",
      budgetPerPersonGbp: 12_000,
    });

    expect(ids(r)).toContain(EDGE_CASES.flyCruiseCompanion);
    expect(nearMiss(r, EDGE_CASES.flyCruiseJustOverBudget)).toMatchObject({
      rule: "over_budget",
      distance: 400,
    });
  });

  it("the big cheap ship passes the hard rules, so ranking has to mark it down", async () => {
    const r = await search({
      windowStart: "2027-01-01",
      windowEnd: "2027-01-20",
      budgetPerPersonGbp: 12_000,
    });

    expect(ids(r)).toEqual(
      expect.arrayContaining([EDGE_CASES.bigCheapNoLanding, EDGE_CASES.runsPastCompanion]),
    );
    const bigShip = r.candidates.find((c) => c.departureId === EDGE_CASES.bigCheapNoLanding);
    expect(bigShip?.passengerCapacity).toBeGreaterThan(500);
  });

  it("no solo price is flagged when sharing would fit", async () => {
    const r = await search({
      windowStart: "2026-11-15",
      windowEnd: "2026-12-05",
      budgetPerPersonGbp: 11_000,
      partySize: 1,
      soloPreference: "own_cabin",
    });

    expect(ids(r)).toContain(EDGE_CASES.soloCompanion);
    expect(nearMiss(r, EDGE_CASES.noSoloButShareFits)).toMatchObject({
      rule: "no_solo_price",
      fare: { booking: "shared" },
    });
  });

  it("kayaking with one place left is short for a couple", async () => {
    const r = await search({
      windowStart: "2027-02-01",
      windowEnd: "2027-02-28",
      budgetPerPersonGbp: 14_000,
      mustHaveActivityIds: ["act_kayak"],
    });

    expect(ids(r)).toContain(EDGE_CASES.kayakCompanion);
    expect(nearMiss(r, EDGE_CASES.kayakOnePlaceLeft)).toMatchObject({
      rule: "activity_places_short",
      distance: 1,
      shortActivity: "Sea kayaking",
    });
    // Only the activity rule names an activity.
    for (const n of r.nearMisses.filter((m) => m.rule !== "activity_places_short")) {
      expect(n.shortActivity).toBeNull();
    }
  });

  it("a voyage ending 2 days after the window is a date near miss", async () => {
    const r = await search({
      windowStart: "2027-01-01",
      windowEnd: "2027-01-15",
      budgetPerPersonGbp: 16_000,
    });

    expect(ids(r)).toContain(EDGE_CASES.runsPastCompanion);
    expect(nearMiss(r, EDGE_CASES.runsPastWindow)).toMatchObject({
      rule: "outside_window",
      distance: 2,
    });
  });

  it("every candidate fare really meets the brief", async () => {
    const r = await search({
      windowStart: "2026-11-01",
      windowEnd: "2027-03-31",
      budgetPerPersonGbp: 15_000,
    });

    expect(r.candidates.length).toBeGreaterThan(20);
    for (const c of r.candidates) {
      expect(c.startDate >= "2026-11-01" && c.endDate <= "2027-03-31").toBe(true);
      for (const f of c.fares) {
        expect(f.totalPerPersonGbp).toBeLessThanOrEqual(15_000);
        expect(f.berthsLeft).toBeGreaterThanOrEqual(2);
      }
    }
  });
});

describe("exclusionCounts", () => {
  it("names the rule that excludes the most departures when nothing is close", async () => {
    const rules = HardRules.parse({
      windowStart: "2026-06-01",
      windowEnd: "2026-06-10",
      budgetPerPersonGbp: 500,
      partySize: 2,
      mustHaveActivityIds: ["act_kayak"],
    });
    const result = await searchDepartures(db, rules);
    expect(result).toEqual({ candidates: [], nearMisses: [] });

    const counts = await exclusionCounts(db, rules);
    const [{ count }] = await db.query<{ count: number }>("SELECT count(*)::int AS count FROM departures");
    // Every departure is out of season and over budget; budget comes first on a tie.
    expect(counts.slice(0, 2)).toEqual([
      { rule: "over_budget", departures: count },
      { rule: "outside_window", departures: count },
    ]);
    expect(counts.map((c) => c.rule)).toContain("activity_not_offered");
    const sizes = counts.map((c) => c.departures);
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
    expect(counts.every((c) => c.departures > 0)).toBe(true);
  });

  it("counts own-cabin requests against departures with no solo price", async () => {
    const counts = await exclusionCounts(
      db,
      HardRules.parse({
        windowStart: "2026-11-01",
        windowEnd: "2027-03-31",
        budgetPerPersonGbp: 100_000,
        partySize: 1,
        soloPreference: "own_cabin",
      }),
    );
    expect(counts.find((c) => c.rule === "over_budget")).toBeUndefined();
    expect(counts.find((c) => c.rule === "no_solo_price")?.departures).toBeGreaterThan(0);
  });
});
