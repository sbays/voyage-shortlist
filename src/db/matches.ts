import { getBrief, type StoredBrief } from "./briefs.ts";
import type { Db } from "./db.ts";
import { searchDepartures, type DepartureSummary, type FareOption } from "./search.ts";

// "New matches" for a saved brief. The nightly job (Phase 4) writes rows to
// `matches`; this reads them and checks each against current data, so a
// match that has since sold out or changed shows as "no longer available"
// rather than disappearing (DECISIONS.md, "what counts as a match").

export type MatchStatus = "available" | "no_longer_available";

export interface Match {
  departure: DepartureSummary;
  status: MatchStatus;
  /** The cheapest qualifying fare now, when the match is still available. */
  fare: FareOption | null;
  foundAt: string;
  seen: boolean;
}

interface MatchRow {
  departure_id: string;
  voyage_name: string;
  route: string;
  nights: number;
  embark_port: string;
  ship_name: string;
  passenger_capacity: number;
  operator_name: string;
  start_date: string;
  end_date: string;
  availability_updated_at: string;
  found_at: Date | string;
  seen: boolean;
}

const MATCHES_SQL = `
SELECT m.departure_id, v.name AS voyage_name, v.route::text AS route, v.nights,
       v.embark_port, sh.name AS ship_name, sh.passenger_capacity,
       op.name AS operator_name,
       d.start_date::text AS start_date, d.end_date::text AS end_date,
       to_char(d.availability_updated_at AT TIME ZONE 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS availability_updated_at,
       m.found_at, m.seen
FROM matches m
JOIN departures d ON d.id = m.departure_id
JOIN voyages v ON v.id = d.voyage_id
JOIN ships sh ON sh.id = v.ship_id
JOIN operators op ON op.id = sh.operator_id
WHERE m.brief_id = $1
ORDER BY m.found_at DESC, d.start_date, m.departure_id
`;

const iso = (value: Date | string) => (value instanceof Date ? value.toISOString() : value);

/**
 * The brief's matches, newest first, each checked against a fresh search.
 * Takes the brief the caller already loaded, so the page doesn't read it twice;
 * the search runs only when there are matches to check.
 */
export async function listMatches(
  db: Db,
  stored: Pick<StoredBrief, "id" | "brief">,
  options: { today?: string } = {},
): Promise<Match[]> {
  const rows = await db.query<MatchRow>(MATCHES_SQL, [stored.id]);
  if (rows.length === 0) return [];

  const { candidates } = await searchDepartures(db, stored.brief.rules, { today: options.today });
  const current = new Map(candidates.map((c) => [c.departureId, c]));

  return rows.map((row) => {
    const candidate = current.get(row.departure_id);
    const departure: DepartureSummary = {
      departureId: row.departure_id,
      voyageName: row.voyage_name,
      route: row.route,
      nights: row.nights,
      embarkPort: row.embark_port,
      shipName: row.ship_name,
      passengerCapacity: row.passenger_capacity,
      operatorName: row.operator_name,
      startDate: row.start_date,
      endDate: row.end_date,
      availabilityUpdatedAt: row.availability_updated_at,
    };
    return {
      departure,
      status: candidate ? "available" : "no_longer_available",
      fare: candidate?.fares[0] ?? null,
      foundAt: iso(row.found_at),
      seen: row.seen,
    };
  });
}

/** Unseen matches per saved brief, keyed by brief ID. Briefs with none are left out. */
export async function countUnseenMatches(db: Db): Promise<Map<string, number>> {
  const rows = await db.query<{ brief_id: string; unseen: number }>(
    `SELECT m.brief_id, count(*)::int AS unseen
     FROM matches m JOIN briefs b ON b.id = m.brief_id
     WHERE b.saved AND NOT m.seen
     GROUP BY m.brief_id`,
  );
  return new Map(rows.map((r) => [r.brief_id, r.unseen]));
}

/**
 * Marks every match for a brief as seen. Returns how many changed. Nothing
 * calls it yet: Phase 4 decides when a match counts as seen.
 */
export async function markMatchesSeen(db: Db, briefId: string): Promise<number> {
  const stored = await getBrief(db, briefId);
  if (!stored) return 0;
  const rows = await db.query<{ departure_id: string }>(
    "UPDATE matches SET seen = true WHERE brief_id = $1 AND NOT seen RETURNING departure_id",
    [stored.id],
  );
  return rows.length;
}

export interface MatchRun {
  startedAt: string;
  finishedAt: string;
  briefsChecked: number;
  matchesWritten: number;
}

/** The most recent finished run of the nightly match job, or null if none has finished. */
export async function lastMatchRun(db: Db): Promise<MatchRun | null> {
  const [row] = await db.query<{
    started_at: Date | string;
    finished_at: Date | string;
    briefs_checked: number;
    matches_written: number;
  }>(
    `SELECT started_at, finished_at, briefs_checked, matches_written FROM match_runs
     WHERE finished_at IS NOT NULL
     ORDER BY finished_at DESC LIMIT 1`,
  );
  if (!row) return null;
  return {
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at),
    briefsChecked: row.briefs_checked,
    matchesWritten: row.matches_written,
  };
}
