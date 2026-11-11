import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { HardRules } from "../domain/brief.ts";
import type { Db } from "./db.ts";
import { migrate } from "./migrate.ts";
import { createPgliteDb } from "./pglite.ts";
import { MAX_NEAR_MISSES, NEAR_MISSES_PER_RULE, searchDepartures } from "./search.ts";

// Hand-written fixtures, so each test states exactly what it relies on.
// The seeded catalogue is covered separately in seed.test.ts.

let db: Db;

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db);
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec(`
    TRUNCATE operators, ships, voyages, departures, cabin_categories,
             departure_fares, activities, departure_activities CASCADE;
    INSERT INTO operators VALUES ('op_a', 'Operator A');
    INSERT INTO ships VALUES ('ship_a', 'op_a', 'Ship A', 120);
    INSERT INTO voyages VALUES ('voy_a', 'ship_a', 'Peninsula Classic', 'peninsula', 'Ushuaia', 10);
    INSERT INTO cabin_categories VALUES
      ('cab_twin', 'ship_a', 'Twin', 2, 'Twin with window'),
      ('cab_suite', 'ship_a', 'Suite', 2, 'Suite with balcony'),
      ('cab_single', 'ship_a', 'Single', 1, 'Single cabin');
    INSERT INTO activities VALUES ('act_kayak', 'Kayaking', 'Paddle among the ice');
  `);
});

interface FareSpec {
  cabin: "cab_twin" | "cab_suite" | "cab_single";
  pp: number;
  solo?: number | null;
  berths?: number;
}

async function departure(
  id: string,
  start: string,
  end: string,
  fares: FareSpec[],
  kayak?: { places: number; price: number },
) {
  await db.query(
    "INSERT INTO departures VALUES ($1, 'voy_a', $2, $3, '2026-11-01T09:00:00Z')",
    [id, start, end],
  );
  for (const f of fares) {
    await db.query("INSERT INTO departure_fares VALUES ($1, $2, $3, $4, $5)", [
      id,
      f.cabin,
      f.pp,
      f.solo ?? null,
      f.berths ?? 10,
    ]);
  }
  if (kayak) {
    await db.query("INSERT INTO departure_activities VALUES ($1, 'act_kayak', $2, $3)", [
      id,
      kayak.places,
      kayak.price,
    ]);
  }
}

function brief(overrides: Partial<HardRules> = {}): HardRules {
  return HardRules.parse({
    windowStart: "2026-12-01",
    windowEnd: "2026-12-31",
    budgetPerPersonGbp: 10_000,
    partySize: 2,
    ...overrides,
  });
}

describe("candidates", () => {
  it("returns a fitting departure with only its qualifying fares, cheapest first", async () => {
    await departure("dep_1", "2026-12-05", "2026-12-15", [
      { cabin: "cab_suite", pp: 9_500 },
      { cabin: "cab_twin", pp: 8_000 },
      { cabin: "cab_single", pp: 12_000 },
    ]);

    const { candidates, nearMisses } = await searchDepartures(db, brief());

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      departureId: "dep_1",
      shipName: "Ship A",
      startDate: "2026-12-05",
      endDate: "2026-12-15",
      availabilityUpdatedAt: "2026-11-01T09:00:00Z",
    });
    expect(candidates[0].fares.map((f) => [f.cabinCategoryId, f.totalPerPersonGbp])).toEqual([
      ["cab_twin", 8_000],
      ["cab_suite", 9_500],
    ]);
    expect(nearMisses).toEqual([]);
  });

  it("orders candidates by start date", async () => {
    await departure("dep_late", "2026-12-20", "2026-12-30", [{ cabin: "cab_twin", pp: 8_000 }]);
    await departure("dep_early", "2026-12-02", "2026-12-12", [{ cabin: "cab_twin", pp: 9_000 }]);

    const { candidates } = await searchDepartures(db, brief());

    expect(candidates.map((c) => c.departureId)).toEqual(["dep_early", "dep_late"]);
  });

  it("accepts a voyage exactly on the window edges and a price exactly on budget", async () => {
    await departure("dep_edge", "2026-12-01", "2026-12-31", [{ cabin: "cab_twin", pp: 10_000 }]);

    const { candidates } = await searchDepartures(db, brief());

    expect(candidates.map((c) => c.departureId)).toEqual(["dep_edge"]);
  });

  it("counts must-have activities against the budget", async () => {
    await departure(
      "dep_kayak",
      "2026-12-05",
      "2026-12-15",
      [{ cabin: "cab_twin", pp: 9_000 }],
      { places: 8, price: 800 },
    );

    const withKayak = await searchDepartures(db, brief({ mustHaveActivityIds: ["act_kayak"] }));
    expect(withKayak.candidates[0].fares[0].totalPerPersonGbp).toBe(9_800);

    const tight = await searchDepartures(
      db,
      brief({ mustHaveActivityIds: ["act_kayak"], budgetPerPersonGbp: 9_500 }),
    );
    expect(tight.candidates).toEqual([]);
    expect(tight.nearMisses).toMatchObject([
      { departureId: "dep_kayak", rule: "over_budget", distance: 300 },
    ]);
  });

  it("treats a repeated must-have activity as one", async () => {
    await departure(
      "dep_kayak",
      "2026-12-05",
      "2026-12-15",
      [{ cabin: "cab_twin", pp: 8_000 }],
      { places: 8, price: 500 },
    );
    // Built by hand, not parsed, to prove the query itself copes.
    const rules: HardRules = { ...brief(), mustHaveActivityIds: ["act_kayak", "act_kayak"] };

    const { candidates } = await searchDepartures(db, rules);

    expect(candidates.map((c) => [c.departureId, c.fares[0].totalPerPersonGbp])).toEqual([
      ["dep_kayak", 8_500],
    ]);
  });

  it("excludes departures that don't offer a must-have activity at all", async () => {
    await departure("dep_no_kayak", "2026-12-05", "2026-12-15", [{ cabin: "cab_twin", pp: 8_000 }]);

    const result = await searchDepartures(db, brief({ mustHaveActivityIds: ["act_kayak"] }));

    expect(result).toEqual({ candidates: [], nearMisses: [] });
  });
});

describe("near misses", () => {
  it("measures each broken rule in its own unit", async () => {
    await departure("dep_budget", "2026-12-05", "2026-12-15", [{ cabin: "cab_twin", pp: 10_400 }]);
    await departure("dep_dates", "2026-12-23", "2027-01-02", [{ cabin: "cab_twin", pp: 8_000 }]);
    await departure("dep_berths", "2026-12-06", "2026-12-16", [
      { cabin: "cab_twin", pp: 8_000, berths: 1 },
    ]);
    await departure(
      "dep_places",
      "2026-12-07",
      "2026-12-17",
      [{ cabin: "cab_twin", pp: 8_000 }],
      { places: 1, price: 0 },
    );

    const { candidates, nearMisses } = await searchDepartures(
      db,
      brief({ mustHaveActivityIds: ["act_kayak"] }),
    );

    // Without kayaking on offer, three of them are excluded outright.
    expect(candidates).toEqual([]);
    expect(nearMisses.map((n) => [n.departureId, n.rule, n.distance])).toEqual([
      ["dep_places", "activity_places_short", 1],
    ]);
    expect(nearMisses[0].shortActivity).toBe("Kayaking");

    const noActivity = await searchDepartures(db, brief());
    expect(noActivity.nearMisses.map((n) => [n.departureId, n.rule, n.distance])).toEqual([
      ["dep_budget", "over_budget", 400],
      ["dep_dates", "outside_window", 2],
      ["dep_berths", "berths_short", 1],
    ]);
    expect(noActivity.candidates.map((c) => c.departureId)).toEqual(["dep_places"]);
  });

  it("counts days outside from whichever edge is crossed", async () => {
    await departure("dep_before", "2026-11-28", "2026-12-08", [{ cabin: "cab_twin", pp: 8_000 }]);

    const { nearMisses } = await searchDepartures(db, brief());

    expect(nearMisses).toMatchObject([
      { departureId: "dep_before", rule: "outside_window", distance: 3 },
    ]);
  });

  it("ignores departures that break two rules", async () => {
    await departure("dep_two", "2026-12-25", "2027-01-04", [{ cabin: "cab_twin", pp: 11_000 }]);

    expect(await searchDepartures(db, brief())).toEqual({ candidates: [], nearMisses: [] });
  });

  it("shows a near miss at its closest fare", async () => {
    await departure("dep_1", "2026-12-05", "2026-12-15", [
      { cabin: "cab_suite", pp: 14_000 },
      { cabin: "cab_twin", pp: 10_250 },
    ]);

    const { nearMisses } = await searchDepartures(db, brief());

    expect(nearMisses).toHaveLength(1);
    expect(nearMisses[0]).toMatchObject({ distance: 250, fare: { cabinCategoryId: "cab_twin" } });
  });

  it("never lists a candidate as a near miss", async () => {
    await departure("dep_1", "2026-12-05", "2026-12-15", [
      { cabin: "cab_twin", pp: 9_000 },
      { cabin: "cab_suite", pp: 10_100 },
    ]);

    const { candidates, nearMisses } = await searchDepartures(db, brief());

    expect(candidates).toHaveLength(1);
    expect(nearMisses).toEqual([]);
  });

  it(`keeps ${NEAR_MISSES_PER_RULE} per rule, closest first, ${MAX_NEAR_MISSES} at most`, async () => {
    for (let i = 1; i <= 4; i++) {
      await departure(`dep_over_${i}`, "2026-12-05", "2026-12-15", [
        { cabin: "cab_twin", pp: 10_000 + i * 100 },
      ]);
      await departure(`dep_out_${i}`, "2026-12-25", `2027-01-0${i}`, [
        { cabin: "cab_twin", pp: 8_000 },
      ]);
      await departure(`dep_short_${i}`, "2026-12-05", "2026-12-15", [
        { cabin: "cab_twin", pp: 8_000, berths: 2 - Math.min(i, 2) },
      ]);
    }
    await departure("dep_full", "2026-12-08", "2026-12-18", [
      { cabin: "cab_twin", pp: 8_000, berths: 0 },
    ]);

    const { nearMisses } = await searchDepartures(db, brief());

    expect(nearMisses.length).toBeLessThanOrEqual(MAX_NEAR_MISSES);
    expect(nearMisses.map((n) => [n.departureId, n.distance])).toEqual([
      ["dep_over_1", 100],
      ["dep_out_1", 1],
      ["dep_short_1", 1],
      ["dep_over_2", 200],
      ["dep_out_2", 2],
      // Equal distance: the earlier start date wins.
      ["dep_short_2", 2],
    ]);
  });
});

describe("travelling alone", () => {
  beforeEach(async () => {
    await departure("dep_solo", "2026-12-05", "2026-12-15", [
      { cabin: "cab_twin", pp: 7_000, solo: 11_000 },
      { cabin: "cab_single", pp: 9_000, solo: 9_000 },
    ]);
  });

  it("own cabin uses the solo price", async () => {
    const { candidates } = await searchDepartures(
      db,
      brief({ partySize: 1, soloPreference: "own_cabin" }),
    );

    expect(candidates[0].fares.map((f) => [f.cabinCategoryId, f.booking, f.totalPerPersonGbp])).toEqual([
      ["cab_single", "own_cabin", 9_000],
    ]);
  });

  it("will share uses the per-person fare, and only cabins that sleep two or more", async () => {
    const { candidates } = await searchDepartures(
      db,
      brief({ partySize: 1, soloPreference: "will_share" }),
    );

    expect(candidates[0].fares.map((f) => [f.cabinCategoryId, f.booking, f.totalPerPersonGbp])).toEqual([
      ["cab_twin", "shared", 7_000],
    ]);
  });

  it("either counts the cheaper option for each fare", async () => {
    const { candidates } = await searchDepartures(db, brief({ partySize: 1 }));

    expect(candidates[0].fares.map((f) => [f.cabinCategoryId, f.booking, f.totalPerPersonGbp])).toEqual([
      ["cab_twin", "shared", 7_000],
      ["cab_single", "own_cabin", 9_000],
    ]);
  });

  describe("own cabin needs every bed in it free", () => {
    // berths_left counts beds. One bed left in a twin is a bed in a cabin
    // someone else already has, so it can't be sold as a private cabin.
    async function twinWithBerths(berths: number) {
      await db.exec("DELETE FROM departure_fares WHERE departure_id = 'dep_solo'");
      await db.query("INSERT INTO departure_fares VALUES ('dep_solo', 'cab_twin', 7000, 9000, $1)", [
        berths,
      ]);
    }

    it("doesn't offer a twin with 1 bed left as a private cabin", async () => {
      await twinWithBerths(1);

      const { candidates, nearMisses } = await searchDepartures(
        db,
        brief({ partySize: 1, soloPreference: "own_cabin" }),
      );

      expect(candidates).toEqual([]);
      expect(nearMisses).toMatchObject([
        {
          departureId: "dep_solo",
          rule: "berths_short",
          distance: 1,
          fare: { booking: "own_cabin", berthsLeft: 1 },
        },
      ]);
    });

    it("offers a twin as a private cabin when both beds are free", async () => {
      await twinWithBerths(2);

      const { candidates } = await searchDepartures(
        db,
        brief({ partySize: 1, soloPreference: "own_cabin" }),
      );

      expect(candidates[0].fares).toMatchObject([
        { cabinCategoryId: "cab_twin", booking: "own_cabin", totalPerPersonGbp: 9_000 },
      ]);
    });

    it("still lets the last bed in a twin be shared", async () => {
      await twinWithBerths(1);

      const { candidates } = await searchDepartures(
        db,
        brief({ partySize: 1, soloPreference: "will_share" }),
      );

      expect(candidates[0].fares).toMatchObject([
        { cabinCategoryId: "cab_twin", booking: "shared", totalPerPersonGbp: 7_000 },
      ]);
    });

    it("either falls back to sharing when the private option isn't free", async () => {
      // Make sharing the dearer option, so only availability can explain the choice.
      await db.exec("DELETE FROM departure_fares WHERE departure_id = 'dep_solo'");
      await db.query("INSERT INTO departure_fares VALUES ('dep_solo', 'cab_twin', 9500, 9000, 1)");

      const { candidates } = await searchDepartures(db, brief({ partySize: 1 }));

      expect(candidates[0].fares).toMatchObject([
        { cabinCategoryId: "cab_twin", booking: "shared", totalPerPersonGbp: 9_500 },
      ]);
    });

    it("a single cabin needs only its 1 bed", async () => {
      await db.exec("DELETE FROM departure_fares WHERE departure_id = 'dep_solo'");
      await db.query("INSERT INTO departure_fares VALUES ('dep_solo', 'cab_single', 9000, 9000, 1)");

      const { candidates } = await searchDepartures(
        db,
        brief({ partySize: 1, soloPreference: "own_cabin" }),
      );

      expect(candidates[0].fares).toMatchObject([
        { cabinCategoryId: "cab_single", booking: "own_cabin" },
      ]);
    });
  });

  it("flags a fare with no solo price as a near miss when sharing would fit", async () => {
    await db.exec("DELETE FROM departure_fares WHERE departure_id = 'dep_solo'");
    await db.query("INSERT INTO departure_fares VALUES ('dep_solo', 'cab_twin', 7000, NULL, 4)");

    const { candidates, nearMisses } = await searchDepartures(
      db,
      brief({ partySize: 1, soloPreference: "own_cabin" }),
    );

    expect(candidates).toEqual([]);
    expect(nearMisses).toMatchObject([
      { departureId: "dep_solo", rule: "no_solo_price", distance: 0, fare: { booking: "shared" } },
    ]);
  });

  it("doesn't flag a missing solo price when sharing wouldn't fit either", async () => {
    await db.exec("DELETE FROM departure_fares WHERE departure_id = 'dep_solo'");
    await db.query("INSERT INTO departure_fares VALUES ('dep_solo', 'cab_twin', 12000, NULL, 4)");

    const result = await searchDepartures(db, brief({ partySize: 1, soloPreference: "own_cabin" }));

    expect(result).toEqual({ candidates: [], nearMisses: [] });
  });
});

describe("the short activity's name", () => {
  it("names the must-have with the biggest shortfall, then by name", async () => {
    await db.exec(`
      INSERT INTO activities VALUES
        ('act_camp', 'Camping', 'A night ashore'),
        ('act_shoe', 'Snowshoeing', 'Walks above the landing');
    `);
    await departure("dep_two_short", "2026-12-05", "2026-12-15", [{ cabin: "cab_twin", pp: 8_000 }], {
      places: 1,
      price: 0,
    });
    // Party of 2: kayaking is 1 short, camping 2 short, snowshoeing 2 short.
    await db.query(`
      INSERT INTO departure_activities VALUES
        ('dep_two_short', 'act_camp', 0, 0),
        ('dep_two_short', 'act_shoe', 0, 0)
    `);

    const { nearMisses } = await searchDepartures(
      db,
      brief({ mustHaveActivityIds: ["act_kayak", "act_camp", "act_shoe"] }),
    );
    expect(nearMisses).toHaveLength(1);
    expect(nearMisses[0]).toMatchObject({
      rule: "activity_places_short",
      distance: 2,
      shortActivity: "Camping",
    });
  });
});
