import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listDepartures } from "./catalogue.ts";
import type { Db } from "./db.ts";
import { migrate } from "./migrate.ts";
import { createPgliteDb } from "./pglite.ts";
import { EDGE_CASES } from "./seed-data.ts";
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

describe("listDepartures", () => {
  it("lists every departure in start-date order", async () => {
    const departures = await listDepartures(db);
    const [{ count }] = await db.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM departures",
    );

    expect(departures).toHaveLength(count);
    const starts = departures.map((d) => d.startDate);
    expect(starts).toEqual([...starts].sort());
  });

  it("shows a sold-out departure with no price and no berths", async () => {
    const departures = await listDepartures(db);
    const soldOut = departures.find((d) => d.departureId === EDGE_CASES.soldOutFavourite);

    expect(soldOut).toMatchObject({ fromPerPersonGbp: null, berthsLeft: 0 });
  });

  it("prices from the cheapest fare that still has berths", async () => {
    const departures = await listDepartures(db);
    const [{ min }] = await db.query<{ min: number }>(
      `SELECT min(price_gbp_pp) AS min FROM departure_fares
        WHERE departure_id = $1 AND berths_left > 0`,
      [EDGE_CASES.flyCruiseJustOverBudget],
    );
    const flyCruise = departures.find((d) => d.departureId === EDGE_CASES.flyCruiseJustOverBudget);

    expect(flyCruise?.fromPerPersonGbp).toBe(min);
    expect(flyCruise?.route).toBe("fly_cruise");
    expect(flyCruise?.availabilityUpdatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it("lists activity names alphabetically, or none", async () => {
    const departures = await listDepartures(db);

    for (const d of departures) {
      expect(d.activityNames).toEqual([...d.activityNames].sort());
    }
    expect(departures.some((d) => d.activityNames.length === 0)).toBe(true);
    expect(departures.some((d) => d.activityNames.length > 0)).toBe(true);
  });
});
