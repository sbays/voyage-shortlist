import { headers } from "next/headers";
import { ipKey } from "@/db/rate-limit";

// Kept out of the "use server" action files: anything exported from one of
// those becomes a public endpoint.

// Headers that might carry the visitor's address behind Firebase Hosting.
// Sources disagree on which one Firebase sets, so the diagnostic below logs
// what actually arrives (DECISIONS.md, "Open").
const CANDIDATE_HEADERS = ["fastly-client-ip", "x-fah-client-ip", "x-real-ip"] as const;

/**
 * The caller's address. Cloud Run's front end appends the connecting address
 * to X-Forwarded-For, so the last entry is the one a client can't forge
 * (checked on the live site: DECISIONS.md, "Phase 3 server actions"). Behind
 * Firebase Hosting the last entry is Firebase's own address: being fixed.
 */
export async function clientIp(): Promise<string> {
  const all = await headers();
  const forwarded = all.get("x-forwarded-for");
  logAddressShape(all, forwarded);
  return forwarded?.split(",").at(-1)?.trim() || "unknown";
}

/**
 * Temporary: logs where addresses sit in the request, as rate-limit key
 * hashes so no raw IP reaches the logs. Compare them with your own key to
 * find which entry is the visitor. Remove once clientIp is fixed.
 */
function logAddressShape(all: Headers, forwarded: string | null) {
  const entries = forwarded?.split(",").map((e) => e.trim()) ?? [];
  console.info(
    JSON.stringify({
      message: "client-ip diagnostic",
      host: all.get("host"),
      forwardedHost: all.get("x-forwarded-host"),
      forwardedFor: entries.map((e) => ipKey(e)),
      ...Object.fromEntries(
        CANDIDATE_HEADERS.map((name) => {
          const value = all.get(name);
          return [name, value ? ipKey(value.trim()) : null];
        }),
      ),
    }),
  );
}
