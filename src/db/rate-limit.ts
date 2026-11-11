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

/** Wrong admin tokens one address may send in an hour before it's refused. */
export const FAILED_TOKEN_ATTEMPTS_PER_HOUR = 10;

const addressHash = (ip: string) => createHash("sha256").update(ip).digest("hex").slice(0, 32);

/** The stored key for an address: a hash, so no raw IP sits in the table. */
export function ipKey(ip: string): string {
  return `ip:${addressHash(ip)}`;
}

/** The key that counts an address's wrong admin tokens, also hashed. */
export function adminTokenKey(ip: string): string {
  return `admin-token:${addressHash(ip)}`;
}

function windowFor(now: Date) {
  const windowStart = new Date(Math.floor(now.getTime() / WINDOW_MS) * WINDOW_MS);
  const retryAfterSeconds = Math.ceil((windowStart.getTime() + WINDOW_MS - now.getTime()) / 1000);
  return { windowStart, retryAfterSeconds };
}

/**
 * Whether a key has reached its limit in the current hour, without counting
 * anything. Used to refuse an address before doing any work for it.
 */
export async function isOverLimit(
  db: Db,
  key: string,
  limit: number,
  now = new Date(),
): Promise<{ over: false } | { over: true; retryAfterSeconds: number }> {
  const { windowStart, retryAfterSeconds } = windowFor(now);
  const [row] = await db.query<{ count: number }>(
    "SELECT count FROM rate_limits WHERE key = $1 AND window_start = $2",
    [key, windowStart],
  );
  return (row?.count ?? 0) >= limit ? { over: true, retryAfterSeconds } : { over: false };
}

/** Adds to a key's count for the current hour. */
export async function countAgainst(db: Db, key: string, amount = 1, now = new Date()): Promise<void> {
  const { windowStart } = windowFor(now);
  await db.query(
    `INSERT INTO rate_limits (key, window_start, count) VALUES ($1, $2, $3)
     ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + $3`,
    [key, windowStart, amount],
  );
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
  const { windowStart, retryAfterSeconds } = windowFor(now);
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
