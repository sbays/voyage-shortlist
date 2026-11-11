import { connection } from "next/server";
import { sampleAvailabilityCsv } from "@/db/availability-import";
import { getDb } from "@/db/connection";

// The sample availability file, built from the live catalogue at request
// time with "now" timestamps. A static file would go stale: once the season
// rolls forward, its rows would be older than the stored availability and
// the import would reject them.

export async function GET(): Promise<Response> {
  await connection();
  const csv = await sampleAvailabilityCsv(await getDb());
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="sample-availability.csv"',
      "Cache-Control": "no-store",
    },
  });
}
