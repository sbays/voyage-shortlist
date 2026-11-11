import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "./db.ts";
import { migrate } from "./migrate.ts";
import { createPgliteDb } from "./pglite.ts";
import {
  adminTokenKey,
  CALLS_PER_HOUR_GLOBAL,
  CALLS_PER_IP_PER_HOUR,
  consumeClaudeCalls,
  countAgainst,
  FAILED_TOKEN_ATTEMPTS_PER_HOUR,
  ipKey,
  isOverLimit,
} from "./rate-limit.ts";

let db: Db;

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db);
});

beforeEach(async () => {
  await db.exec("DELETE FROM rate_limits");
});

afterAll(async () => {
  await db.close();
});

const at = (iso: string) => new Date(iso);

describe("consumeClaudeCalls", () => {
  it("allows 30 calls from one address in an hour, then refuses with the wait", async () => {
    for (let i = 0; i < CALLS_PER_IP_PER_HOUR; i++) {
      expect(await consumeClaudeCalls(db, "1.2.3.4", 1, at("2026-11-11T10:00:00Z"))).toEqual({ ok: true });
    }
    expect(await consumeClaudeCalls(db, "1.2.3.4", 1, at("2026-11-11T10:45:00Z"))).toEqual({
      ok: false,
      scope: "ip",
      retryAfterSeconds: 15 * 60,
    });
    // Another address is unaffected.
    expect(await consumeClaudeCalls(db, "5.6.7.8", 1, at("2026-11-11T10:45:00Z"))).toEqual({ ok: true });
  });

  it("starts again in the next hour and clears old windows", async () => {
    await consumeClaudeCalls(db, "1.2.3.4", CALLS_PER_IP_PER_HOUR, at("2026-11-11T10:00:00Z"));
    expect(await consumeClaudeCalls(db, "1.2.3.4", 1, at("2026-11-11T11:00:00Z"))).toEqual({ ok: true });
    const windows = await db.query("SELECT DISTINCT window_start FROM rate_limits");
    expect(windows).toHaveLength(1);
  });

  it("enforces the app-wide limit across addresses", async () => {
    await db.query("INSERT INTO rate_limits (key, window_start, count) VALUES ('global', $1, $2)", [
      at("2026-11-11T10:00:00Z"),
      CALLS_PER_HOUR_GLOBAL,
    ]);
    expect(await consumeClaudeCalls(db, "9.9.9.9", 1, at("2026-11-11T10:30:00Z"))).toMatchObject({
      ok: false,
      scope: "global",
    });
  });

  it("counts nothing when a request is refused", async () => {
    await consumeClaudeCalls(db, "1.2.3.4", CALLS_PER_IP_PER_HOUR, at("2026-11-11T10:00:00Z"));
    await consumeClaudeCalls(db, "1.2.3.4", 1, at("2026-11-11T10:00:01Z"));
    const [global] = await db.query<{ count: number }>("SELECT count FROM rate_limits WHERE key = 'global'");
    expect(global.count).toBe(CALLS_PER_IP_PER_HOUR);
  });

  it("stores a hash, never the address", async () => {
    await consumeClaudeCalls(db, "1.2.3.4", 1, at("2026-11-11T10:00:00Z"));
    const keys = await db.query<{ key: string }>("SELECT key FROM rate_limits ORDER BY key");
    expect(keys.map((k) => k.key)).toEqual(["global", ipKey("1.2.3.4")]);
    expect(keys.some((k) => k.key.includes("1.2.3.4"))).toBe(false);
  });
});

describe("failed admin token attempts", () => {
  it("refuses an address after 10 wrong tokens in an hour, and only that address", async () => {
    const now = at("2026-11-11T10:00:00Z");
    const key = adminTokenKey("1.2.3.4");
    for (let i = 0; i < FAILED_TOKEN_ATTEMPTS_PER_HOUR - 1; i++) await countAgainst(db, key, 1, now);
    expect(await isOverLimit(db, key, FAILED_TOKEN_ATTEMPTS_PER_HOUR, now)).toEqual({ over: false });

    await countAgainst(db, key, 1, now);
    expect(await isOverLimit(db, key, FAILED_TOKEN_ATTEMPTS_PER_HOUR, at("2026-11-11T10:40:00Z"))).toEqual({
      over: true,
      retryAfterSeconds: 20 * 60,
    });
    expect(
      await isOverLimit(db, adminTokenKey("5.6.7.8"), FAILED_TOKEN_ATTEMPTS_PER_HOUR, now),
    ).toEqual({ over: false });
    expect(await isOverLimit(db, key, FAILED_TOKEN_ATTEMPTS_PER_HOUR, at("2026-11-11T11:00:00Z"))).toEqual({
      over: false,
    });
  });

  it("keeps token attempts apart from Claude calls, and stores no address", async () => {
    await countAgainst(db, adminTokenKey("1.2.3.4"), 5, at("2026-11-11T10:00:00Z"));
    expect(await consumeClaudeCalls(db, "1.2.3.4", 1, at("2026-11-11T10:00:00Z"))).toEqual({ ok: true });
    const keys = await db.query<{ key: string }>("SELECT key FROM rate_limits");
    expect(keys.some((k) => k.key.includes("1.2.3.4"))).toBe(false);
  });
});
