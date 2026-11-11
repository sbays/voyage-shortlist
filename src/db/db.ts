// The one database interface the app, the queries and the scripts use.
// Cloud Run and the db job use Postgres (Neon) through `pg`; tests and local
// dev use PGlite. Dates are selected as text (`::text`) so neither driver
// converts them through a time zone.

export type Row = Record<string, unknown>;

export interface Db {
  query<T extends object = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Runs one or more statements with no parameters, such as a migration. */
  exec(sql: string): Promise<void>;
  /** Runs `fn` in a transaction, rolling back if it throws. */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export type Queries = Pick<Db, "query" | "exec">;

/** Where local dev keeps its PGlite database when DATABASE_URL isn't set. */
export const LOCAL_DATA_DIR = ".data/pglite";

/** The handle a transaction callback gets: nesting or closing it is a bug. */
export function transactionDb(queries: Queries): Db {
  return {
    ...queries,
    transaction: () => Promise.reject(new Error("Nested transactions aren't supported")),
    close: () => Promise.reject(new Error("Close the outer database, not a transaction")),
  };
}
