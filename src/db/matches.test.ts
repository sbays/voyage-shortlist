import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Brief } from "../domain/brief.ts";
import { createBrief, saveBrief } from "./briefs.ts";
import type { Db } from "./db.ts";
import { countUnseenMatches, lastMatchRun, listMatches, markMatchesSeen } from "./matches.ts";
import { migrate } from "./migrate.ts";
import { createPgliteDb } from "./pglite.ts";
import { searchDepartures } from "./search.ts";
import { EDGE_CASES } from "./seed-data.ts";
import { seed } from "./seed.ts";

let db: Db;
let briefId: string;
let candidates: string[];

const brief = Brief.parse({
  rules: {
    windowStart: "2026-12-10",
    windowEnd: "2026-12-28",
    budgetPerPersonGbp: 12_000,
    partySize: 2,
  },
  partyDescription: "couple, December",
});

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db);
  await seed(db);
  briefId = await createBrief(db, "", brief);
  await saveBrief(db, briefId, []);
  candidates = (await searchDepartures(db, brief.rules)).candidates.map((c) => c.departureId);
});

afterAll(async () => {
  await db.close();
});

const saved = () => ({ id: briefId, brief });

async function addMatch(departureId: string, foundAt: string, seen = false) {
  await db.query(
    "INSERT INTO matches (brief_id, departure_id, found_at, seen) VALUES ($1, $2, $3, $4)",
    [briefId, departureId, foundAt, seen],
  );
}

describe("matches", () => {
  it("is empty for a brief with no matches and for an unknown brief", async () => {
    expect(await listMatches(db, saved())).toEqual([]);
    expect(
      await listMatches(db, { id: "00000000-0000-0000-0000-000000000000", brief }),
    ).toEqual([]);
  });

  it("lists matches newest first, marking each against current data", async () => {
    expect(candidates).toContain(EDGE_CASES.soldOutCompanion);
    const [first, second] = candidates.filter((id) => id !== EDGE_CASES.soldOutCompanion);
    await addMatch(first, "2026-11-01T02:00:00Z", true);
    await addMatch(EDGE_CASES.soldOutCompanion, "2026-11-03T02:00:00Z");
    await addMatch(second, "2026-11-02T02:00:00Z");
    // Sold out, so never a candidate: shows as gone, with its details.
    await addMatch(EDGE_CASES.soldOutFavourite, "2026-11-02T02:00:00Z");

    const matches = await listMatches(db, saved());
    expect(matches.map((m) => m.foundAt.slice(0, 10))).toEqual([
      "2026-11-03",
      "2026-11-02",
      "2026-11-02",
      "2026-11-01",
    ]);
    const companion = matches[0];
    expect(companion).toMatchObject({ status: "available", seen: false });
    expect(companion.departure.departureId).toBe(EDGE_CASES.soldOutCompanion);
    expect(companion.fare?.totalPerPersonGbp).toBeLessThanOrEqual(12_000);

    const favourite = matches.find((m) => m.departure.departureId === EDGE_CASES.soldOutFavourite);
    expect(favourite).toMatchObject({ status: "no_longer_available", fare: null });
    expect(favourite?.departure.shipName).toBeTruthy();
    expect(favourite?.departure.availabilityUpdatedAt).toMatch(/Z$/);
    // Same found_at: ordered by start date.
    const sameDay = matches.slice(1, 3).map((m) => m.departure.startDate);
    expect(sameDay).toEqual([...sameDay].sort());
  });

  it("marks a match no longer available once its berths run out, without deleting it", async () => {
    await db.query("UPDATE departure_fares SET berths_left = 0 WHERE departure_id = $1", [
      EDGE_CASES.soldOutCompanion,
    ]);
    const matches = await listMatches(db, saved());
    const companion = matches.find((m) => m.departure.departureId === EDGE_CASES.soldOutCompanion);

    expect(matches).toHaveLength(4);
    expect(companion).toMatchObject({ status: "no_longer_available", fare: null });
  });

  it("counts unseen matches per saved brief and marks them seen", async () => {
    const unsaved = await createBrief(db, "", brief);
    await db.query("INSERT INTO matches (brief_id, departure_id) VALUES ($1, $2)", [
      unsaved,
      candidates[0],
    ]);

    const counts = await countUnseenMatches(db);
    expect(counts.get(briefId)).toBe(3);
    expect(counts.has(unsaved)).toBe(false);

    expect(await markMatchesSeen(db, briefId)).toBe(3);
    expect((await countUnseenMatches(db)).has(briefId)).toBe(false);
    expect(await markMatchesSeen(db, "nope")).toBe(0);
  });
});

describe("lastMatchRun", () => {
  it("is null until a run finishes, then the latest finished run", async () => {
    await db.exec("DELETE FROM match_runs");
    expect(await lastMatchRun(db)).toBeNull();

    await db.query("INSERT INTO match_runs (started_at) VALUES ('2026-11-12T02:00:00Z')");
    expect(await lastMatchRun(db)).toBeNull();

    await db.query(
      `INSERT INTO match_runs (started_at, finished_at, briefs_checked, matches_written) VALUES
       ('2026-11-10T02:00:00Z', '2026-11-10T02:00:05Z', 1, 0),
       ('2026-11-11T02:00:00Z', '2026-11-11T02:00:07Z', 3, 2)`,
    );
    expect(await lastMatchRun(db)).toEqual({
      startedAt: "2026-11-11T02:00:00.000Z",
      finishedAt: "2026-11-11T02:00:07.000Z",
      briefsChecked: 3,
      matchesWritten: 2,
    });
  });
});
