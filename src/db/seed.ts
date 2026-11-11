import type { Db } from "./db.ts";
import {
  activities,
  cabinCategories,
  departureActivities,
  departureFares,
  departures,
  operators,
  ships,
  voyages,
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

/**
 * Replaces the whole catalogue with the deterministic seed data, in one
 * transaction. Safe to run repeatedly: the result is always the same.
 */
export async function seed(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.exec(`
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
      departures,
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
  });
}
