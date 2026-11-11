import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "./db.ts";

const MIGRATIONS_DIR = join(import.meta.dirname, "migrations");
// Any fixed number works; it only has to be the same for every migrate run.
const MIGRATE_LOCK_ID = 7_212_001;

export interface Migration {
  name: string;
  sql: string;
}

export function loadMigrations(dir = MIGRATIONS_DIR): Migration[] {
  return readdirSync(dir)
    .filter((file) => /^\d{3}_[a-z0-9_]+\.sql$/.test(file))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(dir, name), "utf8") }));
}

/**
 * Applies every migration not yet recorded in `schema_migrations`, in name
 * order, each in its own transaction. An advisory lock stops two runs from
 * applying the same migration at once. Returns the names it applied.
 */
export async function migrate(
  db: Db,
  migrations: Migration[] = loadMigrations(),
): Promise<string[]> {
  // Creating the table under the same lock stops two runs racing on it.
  await db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock($1)", [MIGRATE_LOCK_ID]);
    await tx.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  });

  const applied: string[] = [];
  for (const migration of migrations) {
    const didApply = await db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock($1)", [MIGRATE_LOCK_ID]);
      const done = await tx.query("SELECT 1 FROM schema_migrations WHERE name = $1", [
        migration.name,
      ]);
      if (done.length > 0) return false;
      await tx.exec(migration.sql);
      await tx.query("INSERT INTO schema_migrations (name) VALUES ($1)", [migration.name]);
      return true;
    });
    if (didApply) applied.push(migration.name);
  }
  return applied;
}

/**
 * Lets the web app's role read and write rows, but not change the schema.
 * Default privileges cover tables that later migrations create.
 */
export async function grantWebRole(db: Db, role: string): Promise<void> {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) {
    throw new Error(`Invalid role name: ${role}`);
  }
  const r = `"${role}"`;
  await db.exec(`
    GRANT USAGE ON SCHEMA public TO ${r};
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${r};
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${r};
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${r};
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT USAGE, SELECT ON SEQUENCES TO ${r};
    REVOKE INSERT, UPDATE, DELETE ON schema_migrations FROM ${r};
  `);
}
