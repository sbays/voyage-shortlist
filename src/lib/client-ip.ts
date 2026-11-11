import { headers } from "next/headers";

// Kept out of the "use server" action files: anything exported from one of
// those becomes a public endpoint.

/**
 * The caller's address. Cloud Run's front end appends the connecting address
 * to X-Forwarded-For, so the last entry is the one a client can't forge
 * (checked on the live site: DECISIONS.md, "Phase 3 server actions").
 */
export async function clientIp(): Promise<string> {
  const forwarded = (await headers()).get("x-forwarded-for");
  return forwarded?.split(",").at(-1)?.trim() || "unknown";
}
