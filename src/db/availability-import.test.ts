import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  CSV_COLUMNS,
  importAvailability,
  listRecentImports,
  MAX_BERTHS,
  MAX_PRICE_GBP,
  parseCsv,
  sampleAvailabilityCsv,
  validateRows,
} from "./availability-import.ts";
import type { Db } from "./db.ts";
import { migrate } from "./migrate.ts";
import { createPgliteDb } from "./pglite.ts";
import { seed } from "./seed.ts";

let db: Db;

const NOW = new Date("2026-11-11T12:00:00Z");
const HEADER = CSV_COLUMNS.join(",");
const A = "dep_001,cab_katabatic_wind_triple";
const B = "dep_001,cab_katabatic_wind_twin_porthole";
const C = "dep_002";

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db);
});

beforeEach(async () => {
  await seed(db);
  await db.exec("DELETE FROM availability_imports");
});

afterAll(async () => {
  await db.close();
});

const csv = (...rows: string[]) => [HEADER, ...rows].join("\r\n");

async function fare(departureId: string, cabinCategoryId: string) {
  const [row] = await db.query<{ price_gbp_pp: number; solo_price_gbp: number | null; berths_left: number }>(
    "SELECT price_gbp_pp, solo_price_gbp, berths_left FROM departure_fares WHERE departure_id = $1 AND cabin_category_id = $2",
    [departureId, cabinCategoryId],
  );
  return row;
}

async function availabilityOf(departureId: string): Promise<string> {
  const [row] = await db.query<{ at: string }>(
    `SELECT to_char(availability_updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at
     FROM departures WHERE id = $1`,
    [departureId],
  );
  return row.at;
}

const allFares = () =>
  db.query("SELECT * FROM departure_fares ORDER BY departure_id, cabin_category_id");

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, CRLF and a trailing newline", () => {
    expect(parseCsv('a,"b,c","say ""hi"""\r\n1,2,3\n')).toEqual([
      { cells: ["a", "b,c", 'say "hi"'], line: 1 },
      { cells: ["1", "2", "3"], line: 2 },
    ]);
  });

  it("keeps each record's line, counting blank lines and line breaks inside quotes", () => {
    expect(parseCsv('h\n\na\n"b\nc"\n\uFEFFd').map((r) => r.line)).toEqual([1, 3, 4, 6]);
    expect(parseCsv("\uFEFFh,i\n1,2")[0].cells).toEqual(["h", "i"]);
  });

  it("rejects an unterminated quote", () => {
    expect(() => parseCsv('a,"b\n')).toThrow(/never closed/);
  });
});

describe("importAvailability", () => {
  it("applies a valid file and takes availability as of from the file", async () => {
    const result = await importAvailability(
      db,
      {
        filename: "feed.csv",
        storagePath: "imports/feed.csv",
        text: csv(
          `${A},6900,,0,2026-11-10T08:00:00Z`,
          `${B},8100,13900,2,2026-11-10T09:30:00+01:00`,
        ),
      },
      NOW,
    );

    expect(result).toMatchObject({ status: "applied", rowsTotal: 2, rowsUpdated: 2, departuresUpdated: 1 });
    expect(await fare("dep_001", "cab_katabatic_wind_triple")).toEqual({
      price_gbp_pp: 6900,
      solo_price_gbp: null,
      berths_left: 0,
    });
    expect(await fare("dep_001", "cab_katabatic_wind_twin_porthole")).toEqual({
      price_gbp_pp: 8100,
      solo_price_gbp: 13900,
      berths_left: 2,
    });
    // The departure takes its latest row's time: 09:30+01:00 is 08:30Z, after 08:00Z.
    expect(await availabilityOf("dep_001")).toBe("2026-11-10T08:30:00Z");
    expect(await listRecentImports(db)).toMatchObject([
      { filename: "feed.csv", status: "applied", rowsUpdated: 2, errorCount: 0 },
    ]);
  });

  it.each([
    ["an unknown fare", `${C},cab_nope,7000,,3,2026-11-10T08:00:00Z`, /No fare for departure dep_002/],
    ["negative berths", `${A},7000,,-1,2026-11-10T08:00:00Z`, /berths_left must be a whole number/],
    ["a future date", `${A},7000,,3,2026-12-01T08:00:00Z`, /in the future/],
    ["a missing column", `${A},7000,,3`, /Expected 6 columns/],
    ["a bad timestamp", `${A},7000,,3,10/11/2026`, /ISO timestamp/],
    ["a zero solo price", `${A},7000,0,3,2026-11-10T08:00:00Z`, /solo_price_gbp/],
    ["a price beyond the cap", `${A},${MAX_PRICE_GBP + 1},,3,2026-11-10T08:00:00Z`, /price_gbp_pp must be at most/],
    ["a solo price beyond the cap", `${A},7000,3000000000,3,2026-11-10T08:00:00Z`, /solo_price_gbp must be at most/],
    ["berths beyond the cap", `${A},7000,,${MAX_BERTHS + 1},2026-11-10T08:00:00Z`, /berths_left must be at most/],
    ["a row older than the stored availability", `${A},7000,,3,2026-01-01T08:00:00Z`, /older than the availability/],
  ])("rejects the whole file for %s, naming the row, and changes no fares", async (_label, badRow, message) => {
    const before = await allFares();
    const availabilityBefore = await availabilityOf("dep_001");

    const result = await importAvailability(
      db,
      { filename: "bad.csv", storagePath: null, text: csv(`${B},8100,13900,2,2026-11-10T08:00:00Z`, badRow) },
      NOW,
    );

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    // Spreadsheet numbering: header is row 1, the bad row is the second data row.
    expect(result.errors).toEqual([{ row: 3, message: expect.stringMatching(message) }]);
    expect(await allFares()).toEqual(before);
    expect(await availabilityOf("dep_001")).toBe(availabilityBefore);
    expect(await listRecentImports(db)).toMatchObject([{ status: "rejected", rowsUpdated: 0, errorCount: 1 }]);
  });

  it("reports a repeated fare against the row it repeats", async () => {
    const result = await importAvailability(
      db,
      {
        filename: "dup.csv",
        storagePath: null,
        text: csv(`${A},7000,,3,2026-11-10T08:00:00Z`, `${A},7100,,2,2026-11-10T08:00:00Z`),
      },
      NOW,
    );
    expect(result).toMatchObject({ status: "rejected", errors: [{ row: 3, message: "Repeats the fare in row 2" }] });
  });

  it("lists every error, not just the first", async () => {
    const result = await importAvailability(
      db,
      {
        filename: "many.csv",
        storagePath: null,
        text: csv(`${A},abc,,3,2026-11-10T08:00:00Z`, `${B},8000,,x,2026-11-10T08:00:00Z`),
      },
      NOW,
    );
    expect(result.status === "rejected" && result.errors.map((e) => e.row)).toEqual([2, 3]);
  });

  it("rejects a wrong header and an empty file", async () => {
    const wrong = await importAvailability(
      db,
      { filename: "h.csv", storagePath: null, text: `departure,cabin\n${A}` },
      NOW,
    );
    expect(wrong).toMatchObject({ status: "rejected", errors: [{ row: 0, message: expect.stringContaining("header") }] });

    const empty = await importAvailability(db, { filename: "e.csv", storagePath: null, text: HEADER }, NOW);
    expect(empty).toMatchObject({ status: "rejected", errors: [{ row: 0, message: "The file has no data rows" }] });
  });
});

describe("validateRows", () => {
  it("refuses a file over the size cap without parsing it", () => {
    const { errors } = validateRows("x".repeat(1_000_001), NOW);
    expect(errors).toEqual([{ row: 0, message: "The file is over 1 MB" }]);
  });
});

describe("row numbers", () => {
  it("match a spreadsheet's rows when the file has blank lines", async () => {
    const text = [HEADER, `${B},8100,13900,2,2026-11-10T08:00:00Z`, "", "", `${A},abc,,3,2026-11-10T08:00:00Z`].join("\n");
    const result = await importAvailability(db, { filename: "gaps.csv", storagePath: null, text }, NOW);
    expect(result).toMatchObject({ status: "rejected", errors: [{ row: 5 }] });
  });
});

describe("applying inside one transaction", () => {
  it("rolls back and records a rejection when fewer fares update than were sent", async () => {
    // A trigger that silently skips one fare's update stands in for a row
    // that vanished or was blocked between the checks and the update.
    await db.exec(`
      CREATE FUNCTION skip_one() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.cabin_category_id = 'cab_katabatic_wind_triple' THEN RETURN NULL; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER skip_one BEFORE UPDATE ON departure_fares FOR EACH ROW EXECUTE FUNCTION skip_one();
    `);
    try {
      const before = await allFares();
      const availabilityBefore = await availabilityOf("dep_001");
      const result = await importAvailability(
        db,
        {
          filename: "skip.csv",
          storagePath: null,
          text: csv(`${A},6900,,0,2026-11-10T08:00:00Z`, `${B},8100,13900,2,2026-11-10T08:00:00Z`),
        },
        NOW,
      );

      expect(result).toMatchObject({
        status: "rejected",
        errors: [{ row: 0, message: expect.stringContaining("Only 1 of 2 fares") }],
      });
      expect(await allFares()).toEqual(before);
      expect(await availabilityOf("dep_001")).toBe(availabilityBefore);
      expect(await listRecentImports(db)).toMatchObject([{ status: "rejected", rowsUpdated: 0 }]);
    } finally {
      await db.exec("DROP TRIGGER skip_one ON departure_fares; DROP FUNCTION skip_one();");
    }
  });

  it("accepts a re-upload of the same file, since its rows aren't older", async () => {
    const text = csv(`${A},6900,,0,2026-11-10T08:00:00Z`);
    expect(await importAvailability(db, { filename: "a.csv", storagePath: null, text }, NOW)).toMatchObject({
      status: "applied",
    });
    expect(await importAvailability(db, { filename: "a.csv", storagePath: null, text }, NOW)).toMatchObject({
      status: "applied",
    });
  });
});

describe("the sample file", () => {
  it("is built from the catalogue, imports cleanly and opens berths on a sold-out cabin", async () => {
    const now = new Date();
    const text = await sampleAvailabilityCsv(db, now);
    const [, opened] = text.trim().split("\n");
    const [departureId, cabinId] = opened.split(",");
    expect((await fare(departureId, cabinId)).berths_left).toBe(0);
    expect(text.trim().split("\n")).toHaveLength(4);

    const result = await importAvailability(db, { filename: "sample-availability.csv", storagePath: null, text }, now);

    expect(result).toMatchObject({ status: "applied", rowsUpdated: 3 });
    expect((await fare(departureId, cabinId)).berths_left).toBe(4);
  });

  it("opens a departure that hasn't sailed yet, so it shows on /departures", async () => {
    // Mid-season: the earliest sold-out fares have already sailed.
    const now = new Date("2026-12-20T12:00:00Z");
    const [, opened] = (await sampleAvailabilityCsv(db, now)).trim().split("\n");
    const [departureId] = opened.split(",");
    const [{ start_date }] = await db.query<{ start_date: string }>(
      "SELECT start_date::text FROM departures WHERE id = $1",
      [departureId],
    );
    expect(start_date >= "2026-12-20").toBe(true);
  });
});

describe("the hand-testing files in samples/", () => {
  const read = (name: string) => readFileSync(new URL(`../../samples/${name}`, import.meta.url), "utf8");
  const at = new Date("2026-11-12T00:00:00Z");

  it("applies availability-good.csv, opening berths on a sold-out fare", async () => {
    const before = await fare("dep_078", "cab_storm_petrel_balcony");
    const result = await importAvailability(db, { filename: "good.csv", storagePath: null, text: read("availability-good.csv") }, at);

    expect(before?.berths_left).toBe(0);
    expect(result).toMatchObject({ status: "applied", rowsUpdated: 3 });
    expect((await fare("dep_078", "cab_storm_petrel_balcony"))?.berths_left).toBe(4);
    expect((await fare("dep_078", "cab_storm_petrel_twin_window"))?.berths_left).toBe(2);
  });

  it("rejects availability-bad.csv with the row numbers the README gives", async () => {
    const result = await importAvailability(db, { filename: "bad.csv", storagePath: null, text: read("availability-bad.csv") }, at);

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.errors.map((e) => e.row).sort()).toEqual([4, 5]);
    expect((await fare("dep_078", "cab_storm_petrel_balcony"))?.berths_left).toBe(0);
  });
});
