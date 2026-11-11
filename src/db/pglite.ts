import { mkdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { transactionDb, type Db, type Queries, type Row } from "./db.ts";

interface PgliteLike {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<unknown>;
}

function queries(client: PgliteLike): Queries {
  return {
    async query<T extends Row = Row>(sql: string, params: unknown[] = []) {
      return (await client.query<T>(sql, params)).rows;
    },
    async exec(sql: string) {
      await client.exec(sql);
    },
  };
}

/**
 * PGlite for tests and local dev. With no `dataDir` the database lives in
 * memory and disappears when closed.
 */
export async function createPgliteDb(dataDir?: string): Promise<Db> {
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const pglite = await PGlite.create(dataDir);
  return {
    ...queries(pglite),
    transaction: (fn) => pglite.transaction((tx) => fn(transactionDb(queries(tx)))),
    close: () => pglite.close(),
  };
}
