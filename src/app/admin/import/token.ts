import { createHash, timingSafeEqual } from "node:crypto";

// The admin token check for uploads (DECISIONS.md, "protecting writes on the
// public demo"). Server-only.

export type TokenCheck = "ok" | "not_configured" | "wrong";

/**
 * Compares the given token with the configured one in constant time. Both are
 * hashed first so the comparison doesn't leak the token's length. With no
 * token configured, every upload is refused.
 */
export function checkAdminToken(given: string, expected: string | undefined): TokenCheck {
  if (!expected?.trim()) return "not_configured";
  // Trimmed: a token copied from a terminal often brings a trailing space or
  // newline, and the generated token never contains whitespace.
  const a = createHash("sha256").update(given.trim()).digest();
  const b = createHash("sha256").update(expected.trim()).digest();
  return timingSafeEqual(a, b) ? "ok" : "wrong";
}
