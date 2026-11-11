import { createHash } from "node:crypto";
import { CALLS_PER_HOUR_GLOBAL, CALLS_PER_IP_PER_HOUR } from "../domain/limits.ts";
import type { Db } from "./db.ts";

// Fixed one-hour windows counted in Postgres, so the limit holds across
// Cloud Run instances. See DECISIONS.md, "rate limits and instance cap".

export const WINDOW_MS = 60 * 60 * 1000;
export { CALLS_PER_HOUR_GLOBAL, CALLS_PER_IP_PER_HOUR };

export type RateLimitResult =
  | { ok: true }
  | { ok: false; scope: "ip" | "global"; retryAfterSeconds: number };

/** The stored key for an address: a hash, so no raw IP sits in the table. */
export function ipKey(ip: string): string {
  return `ip:${createHash("sha256").update(ip).digest("hex").slice(0, 32)}`;
}

/**
 * Counts `calls` Claude calls against the caller's and the app's hourly
 * limits. Checks both before counting either, so a refused request uses up
 * nothing. Old windows are deleted as it goes.
 */
export async function consumeClaudeCalls(
  db: Db,
  ip: string,
  calls = 1,
  now = new Date(),
): Promise<RateLimitResult> {
  const windowStart = new Date(Math.floor(now.getTime() / WINDOW_MS) * WINDOW_MS);
  const retryAfterSeconds = Math.ceil((windowStart.getTime() + WINDOW_MS - now.getTime()) / 1000);
  const limits = [
    { key: ipKey(ip), limit: CALLS_PER_IP_PER_HOUR, scope: "ip" as const },
    { key: "global", limit: CALLS_PER_HOUR_GLOBAL, scope: "global" as const },
  ];

  return db.transaction(async (tx) => {
    await tx.query("DELETE FROM rate_limits WHERE window_start < $1", [windowStart]);
    for (const { key, limit, scope } of limits) {
      // Lock the row (or the key, before the row exists) so two requests
      // can't both read 29 and both proceed.
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [key]);
      const [row] = await tx.query<{ count: number }>(
        "SELECT count FROM rate_limits WHERE key = $1 AND window_start = $2",
        [key, windowStart],
      );
      if ((row?.count ?? 0) + calls > limit) {
        return { ok: false, scope, retryAfterSeconds };
      }
    }
    for (const { key } of limits) {
      await tx.query(
        `INSERT INTO rate_limits (key, window_start, count) VALUES ($1, $2, $3)
         ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + $3`,
        [key, windowStart, calls],
      );
    }
    return { ok: true };
  });
}
