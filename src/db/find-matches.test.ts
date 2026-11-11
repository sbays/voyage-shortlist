import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Brief } from "../domain/brief.ts";
import { createBrief, saveBrief } from "./briefs.ts";
import type { Db } from "./db.ts";
import { findNewMatches } from "./find-matches.ts";
import { migrate } from "./migrate.ts";
import { createPgliteDb } from "./pglite.ts";
import { searchDepartures } from "./search.ts";
import { EDGE_CASES } from "./seed-data.ts";
import { seed } from "./seed.ts";

let db: Db;

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db);
});

beforeEach(async () => {
  // Deleting briefs cascades to their known departures, matches and shortlists.
  await db.exec("DELETE FROM briefs; DELETE FROM match_runs;");
  await seed(db);
});

afterAll(async () => {
  await db.close();
});

/** A couple in mid-December: the sold-out favourite is 2 berths short. */
const december = Brief.parse({
  rules: { windowStart: "2026-12-10", windowEnd: "2026-12-28", budgetPerPersonGbp: 12_000, partySize: 2 },
  partyDescription: "couple, December",
});

/** Saves a brief the way the app does: its current candidates become known. */
async function saveLikeTheApp(brief: Brief): Promise<string> {
  const id = await createBrief(db, "", brief);
  const { candidates } = await searchDepartures(db, brief.rules);
  await saveBrief(
    db,
    id,
    candidates.map((c) => c.departureId),
  );
  return id;
}

async function matchesFor(briefId: string): Promise<string[]> {
  const rows = await db.query<{ departure_id: string }>(
    "SELECT departure_id FROM matches WHERE brief_id = $1 ORDER BY departure_id",
    [briefId],
  );
  return rows.map((r) => r.departure_id);
}

/** What an availability import that opens berths does to the fares. */
async function openBerths(departureId: string, berths: number) {
  await db.query("UPDATE departure_fares SET berths_left = $2 WHERE departure_id = $1", [
    departureId,
    berths,
  ]);
}

// A fixed "today" before the seeded season, so departures never count as
// sailed however far the real clock moves on.
const SEASON_START = new Date("2026-11-01T00:00:00Z");

describe("findNewMatches", () => {
  it("does nothing, but records the run, when no brief is saved", async () => {
    expect(await findNewMatches(db, SEASON_START)).toEqual({ briefsChecked: 0, briefsFailed: 0, matchesWritten: 0 });
    const runs = await db.query<{ briefs_checked: number; finished_at: unknown }>(
      "SELECT briefs_checked, finished_at FROM match_runs",
    );
    expect(runs).toHaveLength(1);
    expect(runs[0].finished_at).not.toBeNull();
  });

  it("writes nothing when every candidate was already known at save time", async () => {
    const id = await saveLikeTheApp(december);
    expect(await findNewMatches(db, SEASON_START)).toEqual({ briefsChecked: 1, briefsFailed: 0, matchesWritten: 0 });
    expect(await matchesFor(id)).toEqual([]);
  });

  it("finds a departure once berths open on it, and only once", async () => {
    const id = await saveLikeTheApp(december);
    await openBerths(EDGE_CASES.soldOutFavourite, 4);

    const now = new Date("2026-11-12T02:00:00Z");
    expect(await findNewMatches(db, now)).toEqual({ briefsChecked: 1, briefsFailed: 0, matchesWritten: 1 });
    expect(await matchesFor(id)).toEqual([EDGE_CASES.soldOutFavourite]);
    const [match] = await db.query<{ found_at: Date | string; seen: boolean }>(
      "SELECT found_at, seen FROM matches WHERE brief_id = $1",
      [id],
    );
    expect(new Date(match.found_at).toISOString()).toBe(now.toISOString());
    expect(match.seen).toBe(false);

    expect(await findNewMatches(db, SEASON_START)).toEqual({ briefsChecked: 1, briefsFailed: 0, matchesWritten: 0 });
    expect(await matchesFor(id)).toEqual([EDGE_CASES.soldOutFavourite]);
  });

  it("doesn't report a departure again after it sells out and reopens", async () => {
    const id = await saveLikeTheApp(december);
    await openBerths(EDGE_CASES.soldOutFavourite, 4);
    await findNewMatches(db, SEASON_START);
    await openBerths(EDGE_CASES.soldOutFavourite, 0);
    await findNewMatches(db, SEASON_START);
    await openBerths(EDGE_CASES.soldOutFavourite, 4);

    expect(await findNewMatches(db, SEASON_START)).toMatchObject({ matchesWritten: 0 });
    expect(await matchesFor(id)).toEqual([EDGE_CASES.soldOutFavourite]);
  });

  it("never creates a match from a price change alone", async () => {
    const id = await saveLikeTheApp(december);
    await db.query("UPDATE departure_fares SET price_gbp_pp = price_gbp_pp - 500");

    // Cheaper fares can bring in departures that were over budget: those are
    // new candidates and count. Known departures that just got cheaper don't.
    const { candidates } = await searchDepartures(db, december.rules);
    const known = await db.query<{ departure_id: string }>(
      "SELECT departure_id FROM brief_known_departures WHERE brief_id = $1",
      [id],
    );
    const knownIds = new Set(known.map((k) => k.departure_id));
    const newlyAffordable = candidates.map((c) => c.departureId).filter((d) => !knownIds.has(d));

    await findNewMatches(db, SEASON_START);
    expect(await matchesFor(id)).toEqual([...newlyAffordable].sort());
    for (const departureId of knownIds) {
      expect(await matchesFor(id)).not.toContain(departureId);
    }
  });

  it("ignores briefs that were never saved", async () => {
    const unsaved = await createBrief(db, "", december);
    await openBerths(EDGE_CASES.soldOutFavourite, 4);

    expect(await findNewMatches(db, SEASON_START)).toEqual({ briefsChecked: 0, briefsFailed: 0, matchesWritten: 0 });
    expect(await matchesFor(unsaved)).toEqual([]);
  });

  it("records each run's counts", async () => {
    await saveLikeTheApp(december);
    await saveLikeTheApp(december);
    await openBerths(EDGE_CASES.soldOutFavourite, 4);
    await findNewMatches(db, new Date("2026-11-12T02:00:00Z"));

    const [run] = await db.query<{ briefs_checked: number; matches_written: number }>(
      "SELECT briefs_checked, matches_written FROM match_runs",
    );
    expect(run).toEqual({ briefs_checked: 2, matches_written: 2 });
  });
});

describe("a saved brief that can't be checked", () => {
  it("is skipped and counted, the others are still checked, and the run is finished", async () => {
    const good = await saveLikeTheApp(
      Brief.parse({
        rules: { windowStart: "2026-12-10", windowEnd: "2026-12-28", budgetPerPersonGbp: 12_000, partySize: 2 },
      }),
    );
    // A brief stored under an older schema: no longer a valid Brief.
    await db.query(
      `INSERT INTO briefs (raw_notes, criteria, saved, saved_at)
       VALUES ('', '{"rules": {"partySize": "two"}}', true, now() + interval '1 minute')`,
    );

    const result = await findNewMatches(db, SEASON_START);

    expect(result).toMatchObject({ briefsChecked: 1, briefsFailed: 1 });
    const [run] = await db.query<{ finished_at: Date | null; briefs_failed: number }>(
      "SELECT finished_at, briefs_failed FROM match_runs ORDER BY started_at DESC LIMIT 1",
    );
    expect(run.finished_at).not.toBeNull();
    expect(run.briefs_failed).toBe(1);
    expect(await matchesFor(good)).toEqual([]);
  });
});
