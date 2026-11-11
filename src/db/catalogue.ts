import { seasonStartYear } from "../domain/season.ts";
import type { Db } from "./db.ts";

// Read-only views of the catalogue for browsing. The search for a brief is
// in search.ts.

export interface DepartureListing {
  departureId: string;
  startDate: string;
  endDate: string;
  nights: number;
  voyageName: string;
  route: string;
  embarkPort: string;
  shipName: string;
  passengerCapacity: number;
  operatorName: string;
  fromPerPersonGbp: number | null;
  berthsLeft: number;
  activityNames: string[];
  availabilityUpdatedAt: string;
}

/**
 * Every departure in start-date order, with its cheapest available fare.
 * With `today`, departures that have already sailed are left out.
 */
export async function listDepartures(
  db: Db,
  options: { today?: string } = {},
): Promise<DepartureListing[]> {
  return db.query<DepartureListing>(
    `
    SELECT d.id AS "departureId",
           d.start_date::text AS "startDate", d.end_date::text AS "endDate",
           v.nights, v.name AS "voyageName", v.route::text AS route,
           v.embark_port AS "embarkPort",
           s.name AS "shipName", s.passenger_capacity AS "passengerCapacity",
           o.name AS "operatorName",
           (SELECT min(f.price_gbp_pp) FROM departure_fares f
             WHERE f.departure_id = d.id AND f.berths_left > 0) AS "fromPerPersonGbp",
           (SELECT coalesce(sum(f.berths_left), 0)::int FROM departure_fares f
             WHERE f.departure_id = d.id) AS "berthsLeft",
           (SELECT coalesce(array_agg(a.name ORDER BY a.name), '{}') FROM departure_activities da
             JOIN activities a ON a.id = da.activity_id
             WHERE da.departure_id = d.id) AS "activityNames",
           to_char(d.availability_updated_at AT TIME ZONE 'UTC',
                   'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "availabilityUpdatedAt"
    FROM departures d
    JOIN voyages v ON v.id = d.voyage_id
    JOIN ships s ON s.id = v.ship_id
    JOIN operators o ON o.id = s.operator_id
    WHERE $1::date IS NULL OR d.start_date >= $1::date
    ORDER BY d.start_date, d.id
  `,
    [options.today ?? null],
  );
}

export interface ActivityOption {
  id: string;
  name: string;
}

/** The activities a brief can require, for the extraction prompt and the form. */
export async function listActivities(db: Db): Promise<ActivityOption[]> {
  return db.query<ActivityOption>("SELECT id, name FROM activities ORDER BY name");
}

/**
 * The year the season in the database starts in, from its earliest
 * departure. The seed rolls dates forward, so this follows the data rather
 * than the clock; an empty catalogue falls back to the current season.
 */
export async function seasonStartYearInCatalogue(db: Db, today = new Date()): Promise<number> {
  const [row] = await db.query<{ first: string | null }>(
    "SELECT min(start_date)::text AS first FROM departures",
  );
  return seasonStartYear(row?.first ? new Date(`${row.first}T00:00:00Z`) : today);
}
