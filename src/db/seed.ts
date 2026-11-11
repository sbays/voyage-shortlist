import { addYears, seasonOffsetYears } from "../domain/season.ts";
import { listSavedBriefsForJobs, recordKnownDepartures } from "./briefs.ts";
import type { Db } from "./db.ts";
import { isoToday, searchDepartures } from "./search.ts";
import {
  AVAILABILITY_BASE,
  activities,
  cabinCategories,
  departureActivities,
  departureFares,
  departures,
  operators,
  ships,
  voyages,
  type DepartureRow,
} from "./seed-data.ts";

// Postgres allows 65,535 parameters per statement; this keeps well under it.
const MAX_PARAMS = 5000;

/** Table names and columns are fixed here, never taken from input. */
async function insertRows<T extends object>(
  tx: Db,
  table: string,
  columns: (keyof T & string)[],
  rows: T[],
): Promise<void> {
  const perStatement = Math.max(1, Math.floor(MAX_PARAMS / columns.length));
  for (let start = 0; start < rows.length; start += perStatement) {
    const batch = rows.slice(start, start + perStatement);
    const params: unknown[] = [];
    const tuples = batch.map((row) => {
      const placeholders = columns.map((column) => {
        params.push(row[column]);
        return `$${params.length}`;
      });
      return `(${placeholders.join(", ")})`;
    });
    await tx.query(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${tuples.join(", ")}`,
      params,
    );
  }
}

export interface SeedOptions {
  /**
   * When given, dates move to the season current on this day and
   * "availability as of" becomes relative to it. Left out, the catalogue is
   * exactly as generated, which tests and the evaluation rely on.
   */
  now?: Date;
}

/** The generated departures, shifted to the season current on `now`. */
export function seasonDepartures(now?: Date): DepartureRow[] {
  if (!now) return departures;
  const years = seasonOffsetYears(now);
  const availabilityShift = now.getTime() - AVAILABILITY_BASE;
  return departures.map((d) => ({
    ...d,
    start_date: addYears(d.start_date, years),
    end_date: addYears(d.end_date, years),
    availability_updated_at: new Date(Date.parse(d.availability_updated_at) + availabilityShift).toISOString(),
  }));
}

/**
 * Replaces the whole catalogue with the deterministic seed data, in one
 * transaction, then brings saved briefs up to date (DECISIONS.md, "a reseed
 * keeps saved briefs").
 *
 * TRUNCATE ... CASCADE empties each brief's known departures and matches.
 * Departure IDs are the same in every seed, so both are copied aside first and
 * put back for departures that still exist: a departure a brief has seen
 * before never comes back as "new", and unseen matches survive. That is plain
 * SQL, so the catalogue's locks are held only briefly. Each saved brief's
 * current candidates are then recorded as known in small transactions of
 * their own, after the catalogue is unlocked.
 */
export async function seed(db: Db, options: SeedOptions = {}): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.exec(`
      CREATE TEMP TABLE kept_known ON COMMIT DROP AS SELECT * FROM brief_known_departures;
      CREATE TEMP TABLE kept_matches ON COMMIT DROP AS SELECT * FROM matches;
      TRUNCATE departure_activities, departure_fares, activities,
        cabin_categories, departures, voyages, ships, operators CASCADE
    `);
    await insertRows(tx, "operators", ["id", "name"], operators);
    await insertRows(tx, "ships", ["id", "operator_id", "name", "passenger_capacity"], ships);
    await insertRows(tx, "voyages", ["id", "ship_id", "name", "route", "embark_port", "nights"], voyages);
    await insertRows(
      tx,
      "departures",
      ["id", "voyage_id", "start_date", "end_date", "availability_updated_at"],
      seasonDepartures(options.now),
    );
    await insertRows(tx, "cabin_categories", ["id", "ship_id", "name", "sleeps", "description"], cabinCategories);
    await insertRows(
      tx,
      "departure_fares",
      ["departure_id", "cabin_category_id", "price_gbp_pp", "solo_price_gbp", "berths_left"],
      departureFares,
    );
    await insertRows(tx, "activities", ["id", "name", "description"], activities);
    await insertRows(
      tx,
      "departure_activities",
      ["departure_id", "activity_id", "places_left", "price_gbp"],
      departureActivities,
    );
    await tx.exec(`
      INSERT INTO brief_known_departures (brief_id, departure_id)
      SELECT k.brief_id, k.departure_id FROM kept_known k
      JOIN departures d ON d.id = k.departure_id
      ON CONFLICT DO NOTHING;
      INSERT INTO matches (brief_id, departure_id, found_at, seen)
      SELECT m.brief_id, m.departure_id, m.found_at, m.seen FROM kept_matches m
      JOIN departures d ON d.id = m.departure_id
      ON CONFLICT DO NOTHING;
    `);
  });

  await recordCurrentCandidates(db, options.now);
}

/**
 * Records each saved brief's current candidates as known, one brief per
 * transaction. A brief that can't be read or searched is logged and skipped.
 */
async function recordCurrentCandidates(db: Db, now?: Date): Promise<void> {
  const { briefs, unreadable } = await listSavedBriefsForJobs(db);
  for (const { id, error } of unreadable) {
    console.error(`Skipping saved brief ${id}: its criteria no longer parse (${error})`);
  }
  const today = now ? isoToday(now) : undefined;
  for (const saved of briefs) {
    try {
      await db.transaction(async (tx) => {
        const { candidates } = await searchDepartures(tx, saved.brief.rules, { today });
        await recordKnownDepartures(
          tx,
          saved.id,
          candidates.map((c) => c.departureId),
        );
      });
    } catch (error) {
      console.error(`Skipping saved brief ${saved.id}: recording its candidates failed`, error);
    }
  }
}
