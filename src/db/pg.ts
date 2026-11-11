import pg from "pg";
import { transactionDb, type Db, type Queries, type Row } from "./db.ts";

interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

function queries(client: Queryable): Queries {
  return {
    async query<T extends object = Row>(sql: string, params: unknown[] = []) {
      return (await client.query(sql, params)).rows as T[];
    },
    async exec(sql: string) {
      await client.query(sql);
    },
  };
}

/**
 * Postgres through `pg`, used on Cloud Run and by the db job. Use
 * `sslmode=verify-full` in the connection string. `pg` ignores Neon's
 * `channel_binding=require` parameter, so channel binding is turned on here.
 */
export function createPgDb(connectionString: string, options: { max?: number } = {}): Db {
  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? 5,
    enableChannelBinding: true,
  });
  // Neon closes idle connections when it suspends. pg reports that as an
  // 'error' event on the pool, which would crash the process with no listener.
  // The pool has already dropped the client, so logging is enough.
  pool.on("error", (error) => {
    console.error("Idle database connection closed:", error.message);
  });

  return {
    ...queries(pool),
    async transaction(fn) {
      const client = await pool.connect();
      let broken: Error | undefined;
      try {
        await client.query("BEGIN");
        const result = await fn(transactionDb(queries(client)));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          // The connection is unusable. Keep the original error for the
          // caller, and make the pool discard this client.
          broken = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
        }
        throw error;
      } finally {
        client.release(broken);
      }
    },
    close: () => pool.end(),
  };
}
