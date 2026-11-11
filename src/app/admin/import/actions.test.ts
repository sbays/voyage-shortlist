import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CSV_COLUMNS, MAX_IMPORT_BYTES } from "../../../db/availability-import.ts";
import type { Db } from "../../../db/db.ts";
import { migrate } from "../../../db/migrate.ts";
import { createPgliteDb } from "../../../db/pglite.ts";
import { adminTokenKey, FAILED_TOKEN_ATTEMPTS_PER_HOUR } from "../../../db/rate-limit.ts";
import { seed } from "../../../db/seed.ts";
import { MAX_UPLOAD_BYTES } from "./state.ts";

// The upload action against a seeded PGlite database, with the request
// headers and Cloud Storage faked.

const TOKEN = "correct-horse-battery-staple";
const state = vi.hoisted(() => ({ db: null as Db | null, ip: "203.0.113.7" }));
const storeImportFile = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": `198.51.100.1, ${state.ip}` }),
}));
vi.mock("@/db/connection", () => ({
  getDb: async () => {
    if (!state.db) throw new Error("connection refused");
    return state.db;
  },
}));
vi.mock("@/lib/storage", () => ({ storeImportFile }));

const { importAvailabilityAction } = await import("./actions.ts");

let db: Db;
const IDLE = { status: "idle" } as const;
const FARE = "dep_001,cab_katabatic_wind_triple";

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db);
});

beforeEach(async () => {
  await seed(db);
  await db.exec("DELETE FROM availability_imports; DELETE FROM rate_limits");
  state.db = db;
  state.ip = `203.0.113.${Math.floor(Math.random() * 250)}`;
  process.env.DEMO_ADMIN_TOKEN = TOKEN;
  storeImportFile.mockReset();
  storeImportFile.mockResolvedValue("gs://bucket/imports/x.csv");
});

afterAll(async () => {
  delete process.env.DEMO_ADMIN_TOKEN;
  await db.close();
});

function form(fields: { token?: string; csv?: string; filename?: string; intent?: string }): FormData {
  const data = new FormData();
  if (fields.token !== undefined) data.append("token", fields.token);
  if (fields.csv !== undefined) {
    data.append("file", new File([fields.csv], fields.filename ?? "feed.csv", { type: "text/csv" }));
  }
  if (fields.intent) data.append("intent", fields.intent);
  return data;
}

const csv = (...rows: string[]) => [CSV_COLUMNS.join(","), ...rows].join("\n");
const goodCsv = csv(`${FARE},6900,,7,2026-11-10T08:00:00Z`);

async function berths(): Promise<number> {
  const [row] = await db.query<{ berths_left: number }>(
    "SELECT berths_left FROM departure_fares WHERE departure_id = 'dep_001' AND cabin_category_id = 'cab_katabatic_wind_triple'",
  );
  return row.berths_left;
}

const importCount = async () =>
  (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM availability_imports"))[0].n;

describe("importAvailabilityAction", () => {
  it("keeps the browser and server size caps equal", () => {
    expect(MAX_UPLOAD_BYTES).toBe(MAX_IMPORT_BYTES);
  });

  it("never stores or imports with a wrong token, and counts the failed attempt", async () => {
    const before = await berths();
    const result = await importAvailabilityAction(IDLE, form({ token: "guess", csv: goodCsv }));

    expect(result).toEqual({ status: "error", message: "That admin token isn't right." });
    expect(storeImportFile).not.toHaveBeenCalled();
    expect(await berths()).toBe(before);
    expect(await importCount()).toBe(0);
    const [row] = await db.query<{ count: number }>("SELECT count FROM rate_limits WHERE key = $1", [
      adminTokenKey(state.ip),
    ]);
    expect(row.count).toBe(1);
  });

  it("refuses an address after 10 wrong tokens, even with the right one", async () => {
    for (let i = 0; i < FAILED_TOKEN_ATTEMPTS_PER_HOUR; i++) {
      await importAvailabilityAction(IDLE, form({ token: `guess-${i}`, csv: goodCsv }));
    }
    const result = await importAvailabilityAction(IDLE, form({ token: TOKEN, csv: goodCsv }));

    expect(result).toMatchObject({ status: "error", message: expect.stringContaining("Too many wrong admin tokens") });
    expect(storeImportFile).not.toHaveBeenCalled();
  });

  it("gives the public a neutral message when no token is configured", async () => {
    delete process.env.DEMO_ADMIN_TOKEN;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await importAvailabilityAction(IDLE, form({ token: TOKEN, csv: goodCsv }));

    expect(result).toEqual({ status: "error", message: "Uploads aren't available right now." });
    expect(JSON.stringify(result)).not.toContain("DEMO_ADMIN_TOKEN");
    errors.mockRestore();
  });

  it("refuses an empty and an oversized file", async () => {
    expect(await importAvailabilityAction(IDLE, form({ token: TOKEN, csv: "" }))).toEqual({
      status: "error",
      message: "Choose a CSV file to upload.",
    });
    expect(
      await importAvailabilityAction(IDLE, form({ token: TOKEN, csv: "x".repeat(MAX_IMPORT_BYTES + 1) })),
    ).toEqual({ status: "error", message: "The file is over 1 MB." });
    expect(storeImportFile).not.toHaveBeenCalled();
  });

  it("changes no fares when storing the file fails", async () => {
    storeImportFile.mockRejectedValue(new Error("bucket unavailable"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const before = await berths();

    const result = await importAvailabilityAction(IDLE, form({ token: TOKEN, csv: goodCsv }));

    expect(result).toMatchObject({ status: "error", message: expect.stringContaining("Nothing was changed") });
    expect(await berths()).toBe(before);
    expect(await importCount()).toBe(0);
    errors.mockRestore();
  });

  it("applies a good file and returns the recent imports", async () => {
    const result = await importAvailabilityAction(IDLE, form({ token: TOKEN, csv: goodCsv }));

    expect(result).toMatchObject({
      status: "applied",
      filename: "feed.csv",
      rowsUpdated: 1,
      departuresUpdated: 1,
      recent: [{ filename: "feed.csv", status: "applied" }],
    });
    expect(await berths()).toBe(7);
    expect(storeImportFile).toHaveBeenCalledWith("feed.csv", goodCsv);
  });

  it("rejects a bad file with row-numbered errors", async () => {
    const result = await importAvailabilityAction(
      IDLE,
      form({ token: TOKEN, csv: csv(`${FARE},-5,,7,2026-11-10T08:00:00Z`), filename: "bad.csv" }),
    );
    expect(result).toMatchObject({
      status: "rejected",
      filename: "bad.csv",
      errors: [{ row: 2 }],
      recent: [{ filename: "bad.csv", status: "rejected" }],
    });
  });

  it("returns the recent imports only after a valid token", async () => {
    await importAvailabilityAction(IDLE, form({ token: TOKEN, csv: goodCsv, filename: "private-name.csv" }));

    const wrong = await importAvailabilityAction(IDLE, form({ token: "guess", intent: "list" }));
    expect(wrong.status).toBe("error");
    expect(JSON.stringify(wrong)).not.toContain("private-name.csv");

    const right = await importAvailabilityAction(IDLE, form({ token: TOKEN, intent: "list" }));
    expect(right).toMatchObject({ status: "recent", recent: [{ filename: "private-name.csv" }] });
  });

  it("returns an error state, not a thrown error, when the database is down", async () => {
    state.db = null;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await importAvailabilityAction(IDLE, form({ token: TOKEN, csv: goodCsv }))).status).toBe("error");
    errors.mockRestore();
  });
});
