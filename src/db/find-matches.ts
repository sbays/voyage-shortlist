import { listSavedBriefsForJobs, recordKnownDepartures } from "./briefs.ts";
import type { Db } from "./db.ts";
import { isoToday, searchDepartures } from "./search.ts";

// The nightly job: finds departures that newly fit each saved brief. A match
// is a departure that is a candidate now and has never been one for that
// brief before (DECISIONS.md, "what counts as a match"), so a price change
// alone never creates one, and each match is written once.

export interface MatchRunResult {
  briefsChecked: number;
  /** Briefs skipped: stored criteria that no longer parse, or a failed search. */
  briefsFailed: number;
  matchesWritten: number;
}

/**
 * Checks every saved brief against current availability and writes its new
 * matches. Each brief is checked in its own transaction, and a brief that
 * can't be read or searched is logged and skipped, so one bad brief never
 * stops the others. The run is always finished in match_runs, even if it
 * fails part way, so "Matches last checked" stays honest.
 */
export async function findNewMatches(db: Db, now = new Date()): Promise<MatchRunResult> {
  const [run] = await db.query<{ id: string }>(
    "INSERT INTO match_runs (started_at) VALUES ($1) RETURNING id",
    [now],
  );

  const result: MatchRunResult = { briefsChecked: 0, briefsFailed: 0, matchesWritten: 0 };
  try {
    const { briefs, unreadable } = await listSavedBriefsForJobs(db);
    for (const { id, error } of unreadable) {
      console.error(`Skipping saved brief ${id}: its criteria no longer parse (${error})`);
    }
    result.briefsFailed += unreadable.length;

    const today = isoToday(now);
    for (const saved of briefs) {
      try {
        result.matchesWritten += await db.transaction(async (tx) => {
          const { candidates } = await searchDepartures(tx, saved.brief.rules, { today });
          const candidateIds = candidates.map((c) => c.departureId);
          const known = await tx.query<{ departure_id: string }>(
            "SELECT departure_id FROM brief_known_departures WHERE brief_id = $1",
            [saved.id],
          );
          const knownIds = new Set(known.map((k) => k.departure_id));
          const fresh = candidateIds.filter((id) => !knownIds.has(id));
          if (fresh.length === 0) return 0;

          const written = await tx.query<{ departure_id: string }>(
            `INSERT INTO matches (brief_id, departure_id, found_at)
             SELECT $1, unnest($2::text[]), $3
             ON CONFLICT DO NOTHING
             RETURNING departure_id`,
            [saved.id, fresh, now],
          );
          await recordKnownDepartures(tx, saved.id, fresh);
          return written.length;
        });
        result.briefsChecked += 1;
      } catch (error) {
        console.error(`Skipping saved brief ${saved.id}: its check failed`, error);
        result.briefsFailed += 1;
      }
    }
  } finally {
    await db.query(
      `UPDATE match_runs
       SET finished_at = now(), briefs_checked = $2, briefs_failed = $3, matches_written = $4
       WHERE id = $1`,
      [run.id, result.briefsChecked, result.briefsFailed, result.matchesWritten],
    );
  }
  return result;
}
