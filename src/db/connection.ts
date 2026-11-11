import { LOCAL_DATA_DIR, type Db } from "./db.ts";

// The app's shared database handle. On Cloud Run, DATABASE_URL points at
// Neon. Locally, without it, the app opens the PGlite database in .data/,
// which `pnpm dev` migrates and seeds first (`node src/db/cli.ts setup`).

const globalForDb = globalThis as typeof globalThis & { voyageDb?: Promise<Db> };

async function open(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { createPgDb } = await import("./pg.ts");
    return createPgDb(url);
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL must be set in production");
  }
  const { createPgliteDb } = await import("./pglite.ts");
  return createPgliteDb(LOCAL_DATA_DIR);
}

/** One handle per server process, kept across dev hot reloads. */
export function getDb(): Promise<Db> {
  globalForDb.voyageDb ??= open().catch((error: unknown) => {
    globalForDb.voyageDb = undefined;
    throw error;
  });
  return globalForDb.voyageDb;
}
