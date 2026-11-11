import { z } from "zod";
import type { Db } from "./db.ts";

// The availability CSV import (DECISIONS.md, "CSV import format"). An import
// only updates existing fares, never creates departures, and is all or
// nothing: one bad row rejects the whole file, listing every error with its
// row number. "Availability as of" comes from the file's updated_at values,
// not the upload time.

export const CSV_COLUMNS = [
  "departure_id",
  "cabin_category_id",
  "price_gbp_pp",
  "solo_price_gbp",
  "berths_left",
  "updated_at",
] as const;

export const MAX_IMPORT_BYTES = 1_000_000;
export const MAX_IMPORT_ROWS = 5_000;
/** How far ahead of now an updated_at may be, for clock skew. */
export const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

export interface ImportError {
  /**
   * The row as a spreadsheet numbers it: the header is row 1, so the first
   * data row is row 2, and blank lines still count. 0 for a problem with the
   * file itself.
   */
  row: number;
  message: string;
}

/** Upper bounds, so no value reaches Postgres outside its integer range. */
export const MAX_PRICE_GBP = 1_000_000;
export const MAX_BERTHS = 10_000;

export interface FareUpdate {
  /** The spreadsheet row it came from, for errors found later. */
  row: number;
  departureId: string;
  cabinCategoryId: string;
  pricePerPersonGbp: number;
  soloPriceGbp: number | null;
  berthsLeft: number;
  updatedAt: string;
}

export type ImportResult =
  | { status: "applied"; importId: string; rowsTotal: number; rowsUpdated: number; departuresUpdated: number }
  | { status: "rejected"; importId: string; rowsTotal: number; errors: ImportError[] };

// ---------------------------------------------------------------------------
// CSV parsing: RFC 4180 style, quoted fields with "" escapes, CRLF or LF.

export interface CsvRecord {
  cells: string[];
  /** The line the record starts on, counting from 1 like a spreadsheet's rows. */
  line: number;
}

/**
 * Splits CSV text into records, each with the line it starts on, so errors
 * can name the row a spreadsheet shows. Throws on an unterminated quote.
 */
export function parseCsv(text: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let recordLine = 1;
  let i = 0;
  const body = text.startsWith("\uFEFF") ? text.slice(1) : text;

  while (i < body.length) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"') {
        if (body[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      if (ch === "\n") line++;
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === "") {
      quoted = true;
      i++;
    } else if (ch === ",") {
      record.push(field);
      field = "";
      i++;
    } else if (ch === "\r" || ch === "\n") {
      record.push(field);
      records.push({ cells: record, line: recordLine });
      record = [];
      field = "";
      i += ch === "\r" && body[i + 1] === "\n" ? 2 : 1;
      line++;
      recordLine = line;
    } else {
      field += ch;
      i++;
    }
  }
  if (quoted) throw new Error("A quoted field is never closed");
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push({ cells: record, line: recordLine });
  }
  // Blank lines (a lone empty field) carry no data, but keep their place in
  // the line count above.
  return records.filter((r) => !(r.cells.length === 1 && r.cells[0].trim() === ""));
}

// ---------------------------------------------------------------------------
// Row validation

const wholeNumber = (label: string, max: number) =>
  z
    .string()
    .trim()
    .regex(/^\d+$/, `${label} must be a whole number of 0 or more`)
    .transform(Number)
    .refine((n) => n <= max, `${label} must be at most ${max.toLocaleString("en-GB")}`);

const Row = z.object({
  departure_id: z.string().trim().min(1, "departure_id is empty"),
  cabin_category_id: z.string().trim().min(1, "cabin_category_id is empty"),
  price_gbp_pp: wholeNumber("price_gbp_pp", MAX_PRICE_GBP).refine((n) => n > 0, "price_gbp_pp must be more than 0"),
  solo_price_gbp: z
    .string()
    .trim()
    .transform((s, ctx) => {
      if (s === "") return null;
      if (!/^\d+$/.test(s) || Number(s) <= 0) {
        ctx.addIssue({ code: "custom", message: "solo_price_gbp must be empty or a whole number more than 0" });
        return z.NEVER;
      }
      if (Number(s) > MAX_PRICE_GBP) {
        ctx.addIssue({
          code: "custom",
          message: `solo_price_gbp must be at most ${MAX_PRICE_GBP.toLocaleString("en-GB")}`,
        });
        return z.NEVER;
      }
      return Number(s);
    }),
  berths_left: wholeNumber("berths_left", MAX_BERTHS),
  updated_at: z.iso.datetime({ offset: true, message: "updated_at must be an ISO timestamp with a time zone" }),
});

/** Parses and checks the file's shape and each row, without touching the database. */
export function validateRows(
  text: string,
  now: Date,
): { updates: FareUpdate[]; errors: ImportError[]; rowsTotal: number } {
  const errors: ImportError[] = [];
  if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) {
    return { updates: [], errors: [{ row: 0, message: `The file is over ${MAX_IMPORT_BYTES / 1_000_000} MB` }], rowsTotal: 0 };
  }

  let records: CsvRecord[];
  try {
    records = parseCsv(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The file couldn't be read as CSV";
    return { updates: [], errors: [{ row: 0, message }], rowsTotal: 0 };
  }
  const [header, ...rows] = records;
  const headerText = (header?.cells ?? []).map((h) => h.trim()).join(",");
  if (headerText !== CSV_COLUMNS.join(",")) {
    return {
      updates: [],
      errors: [{ row: 0, message: `The header must be exactly: ${CSV_COLUMNS.join(",")}` }],
      rowsTotal: rows.length,
    };
  }
  if (rows.length === 0) {
    return { updates: [], errors: [{ row: 0, message: "The file has no data rows" }], rowsTotal: 0 };
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    return {
      updates: [],
      errors: [{ row: 0, message: `The file has ${rows.length} rows; the most is ${MAX_IMPORT_ROWS}` }],
      rowsTotal: rows.length,
    };
  }

  const updates: FareUpdate[] = [];
  const seen = new Map<string, number>();
  rows.forEach(({ cells, line: rowNumber }) => {
    if (cells.length !== CSV_COLUMNS.length) {
      errors.push({ row: rowNumber, message: `Expected ${CSV_COLUMNS.length} columns, found ${cells.length}` });
      return;
    }
    const parsed = Row.safeParse(Object.fromEntries(CSV_COLUMNS.map((c, i) => [c, cells[i]])));
    if (!parsed.success) {
      for (const issue of parsed.error.issues) errors.push({ row: rowNumber, message: issue.message });
      return;
    }
    const r = parsed.data;
    if (Date.parse(r.updated_at) > now.getTime() + FUTURE_TOLERANCE_MS) {
      errors.push({ row: rowNumber, message: "updated_at is in the future" });
      return;
    }
    const key = `${r.departure_id}|${r.cabin_category_id}`;
    const first = seen.get(key);
    if (first !== undefined) {
      errors.push({ row: rowNumber, message: `Repeats the fare in row ${first}` });
      return;
    }
    seen.set(key, rowNumber);
    updates.push({
      row: rowNumber,
      departureId: r.departure_id,
      cabinCategoryId: r.cabin_category_id,
      pricePerPersonGbp: r.price_gbp_pp,
      soloPriceGbp: r.solo_price_gbp,
      berthsLeft: r.berths_left,
      updatedAt: new Date(r.updated_at).toISOString(),
    });
  });
  return { updates, errors, rowsTotal: rows.length };
}

// ---------------------------------------------------------------------------
// Applying

async function recordImport(
  db: Db,
  meta: { filename: string; storagePath: string | null },
  status: "applied" | "rejected",
  rowsTotal: number,
  rowsUpdated: number,
  errors: ImportError[],
): Promise<string> {
  const [row] = await db.query<{ id: string }>(
    `INSERT INTO availability_imports (filename, storage_path, status, rows_total, rows_updated, errors)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [meta.filename, meta.storagePath, status, rowsTotal, rowsUpdated, JSON.stringify(errors)],
  );
  return row.id;
}

/** Raised inside the apply transaction to roll it back with a reason. */
class ImportRejected extends Error {
  readonly errors: ImportError[];

  constructor(errors: ImportError[]) {
    super("Import rejected");
    this.errors = errors;
  }
}

/**
 * Checks every fare against the database inside the transaction that updates
 * them, with the fare and departure rows locked, so a reseed or another
 * import can't change them in between. Returns the errors, if any.
 */
async function checkAgainstDatabase(tx: Db, updates: FareUpdate[]): Promise<ImportError[]> {
  const current = await tx.query<{
    departure_id: string;
    cabin_category_id: string;
    availability_updated_at: Date | string;
  }>(
    `SELECT f.departure_id, f.cabin_category_id, d.availability_updated_at
     FROM departure_fares f
     JOIN departures d ON d.id = f.departure_id
     WHERE (f.departure_id, f.cabin_category_id) IN (
       SELECT * FROM unnest($1::text[], $2::text[]))
     FOR UPDATE OF f, d`,
    [updates.map((u) => u.departureId), updates.map((u) => u.cabinCategoryId)],
  );
  const stored = new Map(
    current.map((c) => [
      `${c.departure_id}|${c.cabin_category_id}`,
      new Date(c.availability_updated_at).getTime(),
    ]),
  );

  const errors: ImportError[] = [];
  for (const u of updates) {
    const storedAt = stored.get(`${u.departureId}|${u.cabinCategoryId}`);
    if (storedAt === undefined) {
      // An import never creates a fare.
      errors.push({ row: u.row, message: `No fare for departure ${u.departureId} in cabin ${u.cabinCategoryId}` });
    } else if (Date.parse(u.updatedAt) < storedAt) {
      // An older file must never move "availability as of" backwards or
      // overwrite newer fares.
      errors.push({
        row: u.row,
        message: `updated_at is older than the availability already held for ${u.departureId} (${new Date(storedAt).toISOString()})`,
      });
    }
  }
  return errors;
}

/**
 * Validates and applies an availability file. Any error rejects the whole
 * file: no fare changes, and the errors are recorded with the import.
 */
export async function importAvailability(
  db: Db,
  input: { filename: string; text: string; storagePath: string | null },
  now = new Date(),
): Promise<ImportResult> {
  const meta = { filename: input.filename.slice(0, 200), storagePath: input.storagePath };
  const { updates, errors, rowsTotal } = validateRows(input.text, now);

  const reject = async (found: ImportError[]): Promise<ImportResult> => {
    const sorted = [...found].sort((a, b) => a.row - b.row);
    const importId = await recordImport(db, meta, "rejected", rowsTotal, 0, sorted);
    return { status: "rejected", importId, rowsTotal, errors: sorted };
  };
  if (errors.length > 0) {
    // Report every problem at once: the rows that passed the format checks
    // are still checked against the database (unknown fares, stale times).
    const dbErrors =
      updates.length > 0 ? await db.transaction((tx) => checkAgainstDatabase(tx, updates)) : [];
    return reject([...errors, ...dbErrors]);
  }

  try {
    return await db.transaction(async (tx) => {
      const found = await checkAgainstDatabase(tx, updates);
      if (found.length > 0) throw new ImportRejected(found);

      const changed = await tx.query<{ departure_id: string }>(
        `UPDATE departure_fares f
         SET price_gbp_pp = u.price, solo_price_gbp = u.solo, berths_left = u.berths
         FROM unnest($1::text[], $2::text[], $3::int[], $4::int[], $5::int[])
           AS u(departure_id, cabin_category_id, price, solo, berths)
         WHERE f.departure_id = u.departure_id AND f.cabin_category_id = u.cabin_category_id
         RETURNING f.departure_id`,
        [
          updates.map((u) => u.departureId),
          updates.map((u) => u.cabinCategoryId),
          updates.map((u) => u.pricePerPersonGbp),
          updates.map((u) => u.soloPriceGbp),
          updates.map((u) => u.berthsLeft),
        ],
      );
      // The rows are locked, so this only differs if something is badly
      // wrong; either way, report what changed and never half an import.
      if (changed.length !== updates.length) {
        throw new ImportRejected([
          {
            row: 0,
            message: `Only ${changed.length} of ${updates.length} fares could be updated, so nothing was changed. Upload the file again.`,
          },
        ]);
      }
      const touched = await tx.query<{ id: string }>(
        `UPDATE departures d SET availability_updated_at = greatest(d.availability_updated_at, u.updated_at)
         FROM (
           SELECT departure_id, max(updated_at) AS updated_at
           FROM unnest($1::text[], $2::timestamptz[]) AS t(departure_id, updated_at)
           GROUP BY departure_id
         ) u
         WHERE d.id = u.departure_id
         RETURNING d.id`,
        [updates.map((u) => u.departureId), updates.map((u) => u.updatedAt)],
      );
      const importId = await recordImport(tx, meta, "applied", rowsTotal, changed.length, []);
      const result: ImportResult = {
        status: "applied",
        importId,
        rowsTotal,
        rowsUpdated: changed.length,
        departuresUpdated: touched.length,
      };
      return result;
    });
  } catch (error) {
    if (error instanceof ImportRejected) return reject(error.errors);
    throw error;
  }
}

/**
 * A sample file built from the live catalogue: one sold-out fare opened with
 * 4 berths, plus up to 2 other fares on the same departure unchanged, all
 * stamped `now`. Generated rather than static, because a fixed file goes
 * stale once the season rolls forward and older rows are rejected.
 */
export async function sampleAvailabilityCsv(db: Db, now = new Date()): Promise<string> {
  const rows = await db.query<{
    departure_id: string;
    cabin_category_id: string;
    price_gbp_pp: number;
    solo_price_gbp: number | null;
    berths_left: number;
    opened: boolean;
  }>(
    `WITH sold_out AS (
       SELECT f.departure_id, f.cabin_category_id
       FROM departure_fares f JOIN departures d ON d.id = f.departure_id
       WHERE f.berths_left = 0
       -- One that hasn't sailed, so it shows on /departures and in searches;
       -- a sailed one only if nothing else is sold out.
       ORDER BY (d.start_date >= $1::date) DESC, d.start_date, f.departure_id, f.cabin_category_id
       LIMIT 1
     )
     SELECT f.departure_id, f.cabin_category_id, f.price_gbp_pp, f.solo_price_gbp, f.berths_left,
            (f.departure_id, f.cabin_category_id) = (s.departure_id, s.cabin_category_id) AS opened
     FROM departure_fares f JOIN sold_out s ON s.departure_id = f.departure_id
     ORDER BY opened DESC, f.cabin_category_id
     LIMIT 3`,
    [now.toISOString().slice(0, 10)],
  );
  const stamp = new Date(Math.floor(now.getTime() / 1000) * 1000).toISOString().replace(".000Z", "Z");
  const lines = rows.map((r) =>
    [
      r.departure_id,
      r.cabin_category_id,
      r.price_gbp_pp,
      r.solo_price_gbp ?? "",
      r.opened ? 4 : r.berths_left,
      stamp,
    ].join(","),
  );
  return [CSV_COLUMNS.join(","), ...lines].join("\n") + "\n";
}

export interface ImportSummary {
  id: string;
  filename: string;
  status: "applied" | "rejected";
  rowsTotal: number;
  rowsUpdated: number;
  errorCount: number;
  uploadedAt: string;
}

/** The most recent imports, newest first. */
export async function listRecentImports(db: Db, limit = 10): Promise<ImportSummary[]> {
  const rows = await db.query<{
    id: string;
    filename: string;
    status: "applied" | "rejected";
    rows_total: number;
    rows_updated: number;
    error_count: number;
    uploaded_at: Date | string;
  }>(
    `SELECT id, filename, status, rows_total, rows_updated,
            jsonb_array_length(errors)::int AS error_count, uploaded_at
     FROM availability_imports ORDER BY uploaded_at DESC, id LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    id: r.id,
    filename: r.filename,
    status: r.status,
    rowsTotal: r.rows_total,
    rowsUpdated: r.rows_updated,
    errorCount: r.error_count,
    uploadedAt: r.uploaded_at instanceof Date ? r.uploaded_at.toISOString() : r.uploaded_at,
  }));
}
