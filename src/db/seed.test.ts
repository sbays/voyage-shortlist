import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "./db.ts";
import { migrate } from "./migrate.ts";
import { createPgliteDb } from "./pglite.ts";
import { seed } from "./seed.ts";
import { EDGE_CASES } from "./seed-data.ts";

const TABLES = [
  "operators",
  "ships",
  "voyages",
  "departures",
  "cabin_categories",
  "departure_fares",
  "activities",
  "departure_activities",
] as const;

let db: Db;

async function counts(): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const table of TABLES) {
    const [row] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
    result[table] = row.n;
  }
  return result;
}

/** Every catalogue row as JSON, in a fixed order, for comparing two seeds. */
async function snapshot(): Promise<string> {
  const parts: unknown[] = [];
  for (const table of TABLES) {
    parts.push(await db.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`));
  }
  return JSON.stringify(parts);
}

async function faresOf(departureId: string) {
  return db.query<{ price_gbp_pp: number; solo_price_gbp: number | null; berths_left: number; sleeps: number }>(
    `SELECT f.price_gbp_pp, f.solo_price_gbp, f.berths_left, c.sleeps
       FROM departure_fares f JOIN cabin_categories c ON c.id = f.cabin_category_id
      WHERE f.departure_id = $1`,
    [departureId],
  );
}

async function departureOf(departureId: string) {
  const [row] = await db.query<{ start_date: string; end_date: string; route: string; passenger_capacity: number }>(
    `SELECT d.start_date::text, d.end_date::text, v.route::text, s.passenger_capacity
       FROM departures d JOIN voyages v ON v.id = d.voyage_id JOIN ships s ON s.id = v.ship_id
      WHERE d.id = $1`,
    [departureId],
  );
  return row;
}

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db);
  await seed(db);
});

afterAll(async () => {
  await db.close();
});

describe("seed", () => {
  it("gives identical data when run twice", async () => {
    const firstCounts = await counts();
    const first = await snapshot();
    await seed(db);
    expect(await counts()).toEqual(firstCounts);
    expect(await snapshot()).toBe(first);
  });

  it("has the target amount of data", async () => {
    const c = await counts();
    expect(c.operators).toBe(6);
    expect(c.ships).toBe(14);
    expect(c.departures).toBeGreaterThanOrEqual(70);
    expect(c.departures).toBeLessThanOrEqual(90);
    const [cabins] = await db.query<{ min: number; max: number }>(
      "SELECT min(n)::int AS min, max(n)::int AS max FROM (SELECT count(*) AS n FROM cabin_categories GROUP BY ship_id) x",
    );
    expect(cabins.min).toBeGreaterThanOrEqual(3);
    expect(cabins.max).toBeLessThanOrEqual(5);
  });

  it("keeps the edge case IDs stable, so other tests can name them", () => {
    expect(EDGE_CASES).toMatchInlineSnapshot(`
      {
        "bigCheapNoLanding": "dep_056",
        "flyCruiseCompanion": "dep_064",
        "flyCruiseJustOverBudget": "dep_067",
        "kayakCompanion": "dep_080",
        "kayakOnePlaceLeft": "dep_079",
        "noSoloButShareFits": "dep_017",
        "runsPastCompanion": "dep_053",
        "runsPastWindow": "dep_055",
        "soldOutCompanion": "dep_034",
        "soldOutFavourite": "dep_035",
        "soloCompanion": "dep_016",
      }
    `);
  });

  it("only prices cabins that are on the departure's ship", async () => {
    const rows = await db.query(
      `SELECT f.departure_id FROM departure_fares f
         JOIN departures d ON d.id = f.departure_id
         JOIN voyages v ON v.id = d.voyage_id
         JOIN cabin_categories c ON c.id = f.cabin_category_id
        WHERE c.ship_id <> v.ship_id`,
    );
    expect(rows).toEqual([]);
  });

  it("prices every cabin on the ship for every departure", async () => {
    const rows = await db.query(
      `SELECT d.id FROM departures d
         JOIN voyages v ON v.id = d.voyage_id
         JOIN cabin_categories c ON c.ship_id = v.ship_id
         LEFT JOIN departure_fares f ON f.departure_id = d.id AND f.cabin_category_id = c.id
        WHERE f.departure_id IS NULL`,
    );
    expect(rows).toEqual([]);
  });

  it("makes every departure last exactly the voyage's nights, inside the season", async () => {
    const rows = await db.query(
      `SELECT d.id FROM departures d JOIN voyages v ON v.id = d.voyage_id
        WHERE d.end_date - d.start_date <> v.nights
           OR d.start_date < '2026-11-01' OR d.end_date > '2027-03-31'`,
    );
    expect(rows).toEqual([]);
  });

  it("never has a ship on two departures at once", async () => {
    const rows = await db.query(
      `SELECT a.id FROM departures a
         JOIN voyages va ON va.id = a.voyage_id
         JOIN departures b ON b.id <> a.id
         JOIN voyages vb ON vb.id = b.voyage_id AND vb.ship_id = va.ship_id
        WHERE a.start_date <= b.end_date AND b.start_date <= a.end_date`,
    );
    expect(rows).toEqual([]);
  });

  it("never sells a single cabin for less than the shared price", async () => {
    const rows = await db.query(
      "SELECT departure_id FROM departure_fares WHERE solo_price_gbp < price_gbp_pp",
    );
    expect(rows).toEqual([]);
  });
});

describe("edge cases", () => {
  it("soldOutFavourite: small ship, mid-December peninsula, every fare at 0 berths", async () => {
    const dep = await departureOf(EDGE_CASES.soldOutFavourite);
    expect(dep.route).toBe("peninsula");
    expect(dep.passenger_capacity).toBeLessThanOrEqual(120);
    expect(dep.start_date >= "2026-12-10" && dep.start_date <= "2026-12-20").toBe(true);
    const fares = await faresOf(EDGE_CASES.soldOutFavourite);
    expect(fares.length).toBeGreaterThan(0);
    expect(fares.every((f) => f.berths_left === 0)).toBe(true);
  });

  it("flyCruiseJustOverBudget: cheapest fare is £12,400 with berths for a couple", async () => {
    const dep = await departureOf(EDGE_CASES.flyCruiseJustOverBudget);
    expect(dep.route).toBe("fly_cruise");
    const fares = await faresOf(EDGE_CASES.flyCruiseJustOverBudget);
    expect(Math.min(...fares.map((f) => f.price_gbp_pp))).toBe(12400);
    expect(fares.every((f) => f.berths_left >= 2)).toBe(true);
  });

  it("bigCheapNoLanding: over 500 passengers and the cheapest fares in the dataset", async () => {
    const dep = await departureOf(EDGE_CASES.bigCheapNoLanding);
    expect(dep.passenger_capacity).toBeGreaterThan(500);
    const [row] = await db.query<{ cheapest_ship: number }>(
      `SELECT s.passenger_capacity AS cheapest_ship
         FROM departure_fares f
         JOIN departures d ON d.id = f.departure_id
         JOIN voyages v ON v.id = d.voyage_id
         JOIN ships s ON s.id = v.ship_id
        ORDER BY f.price_gbp_pp LIMIT 1`,
    );
    expect(row.cheapest_ship).toBe(dep.passenger_capacity);
  });

  it("noSoloButShareFits: no solo price anywhere, a shared twin under £11,000", async () => {
    const fares = await faresOf(EDGE_CASES.noSoloButShareFits);
    expect(fares.every((f) => f.solo_price_gbp === null)).toBe(true);
    expect(fares.some((f) => f.sleeps >= 2 && f.price_gbp_pp <= 11000 && f.berths_left >= 1)).toBe(true);
  });

  it("kayakOnePlaceLeft: kayaking has exactly 1 place", async () => {
    const [row] = await db.query<{ places_left: number }>(
      "SELECT places_left FROM departure_activities WHERE departure_id = $1 AND activity_id = 'act_kayak'",
      [EDGE_CASES.kayakOnePlaceLeft],
    );
    expect(row.places_left).toBe(1);
  });

  it("runsPastWindow: ends on 2027-01-17", async () => {
    const dep = await departureOf(EDGE_CASES.runsPastWindow);
    expect(dep.end_date).toBe("2027-01-17");
  });

  it("companions are ordinary departures that fit the same brief", async () => {
    const soldOut = await departureOf(EDGE_CASES.soldOutCompanion);
    expect(soldOut.start_date >= "2026-12-10" && soldOut.end_date <= "2026-12-28").toBe(true);
    expect((await faresOf(EDGE_CASES.soldOutCompanion)).some((f) => f.price_gbp_pp <= 12000 && f.berths_left >= 2)).toBe(true);

    const fly = await departureOf(EDGE_CASES.flyCruiseCompanion);
    expect(fly.start_date >= "2027-01-15" && fly.end_date <= "2027-02-05").toBe(true);
    expect((await faresOf(EDGE_CASES.flyCruiseCompanion)).some((f) => f.price_gbp_pp <= 12000 && f.berths_left >= 2)).toBe(true);

    const solo = await faresOf(EDGE_CASES.soloCompanion);
    expect(solo.some((f) => f.solo_price_gbp !== null && f.solo_price_gbp <= 11000 && f.berths_left >= 1)).toBe(true);

    const [kayak] = await db.query<{ places_left: number; price_gbp: number }>(
      "SELECT places_left, price_gbp FROM departure_activities WHERE departure_id = $1 AND activity_id = 'act_kayak'",
      [EDGE_CASES.kayakCompanion],
    );
    expect(kayak.places_left).toBeGreaterThanOrEqual(2);
    expect(
      (await faresOf(EDGE_CASES.kayakCompanion)).some((f) => f.price_gbp_pp + kayak.price_gbp <= 14000 && f.berths_left >= 2),
    ).toBe(true);

    const past = await departureOf(EDGE_CASES.runsPastCompanion);
    expect(past.start_date >= "2027-01-01" && past.end_date <= "2027-01-15").toBe(true);
    expect((await faresOf(EDGE_CASES.runsPastCompanion)).some((f) => f.price_gbp_pp <= 16000 && f.berths_left >= 2)).toBe(true);
  });
});
