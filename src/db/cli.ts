// Entry point for the `voyage-db` Cloud Run job and for local scripts:
//   node src/db/cli.ts migrate   apply pending migrations
//   node src/db/cli.ts seed      reset the catalogue to the seed data
//   node src/db/cli.ts setup     migrate, then seed only if there are no departures
// Connects to DATABASE_URL, or to the local PGlite database in .data/ when
// it isn't set.

import { LOCAL_DATA_DIR, type Db } from "./db.ts";
import { grantWebRole, migrate } from "./migrate.ts";
import { seed } from "./seed.ts";

async function connect(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { createPgDb } = await import("./pg.ts");
    return createPgDb(url, { max: 1 });
  }
  // Without this, a job missing its secret would "migrate" a throwaway
  // PGlite database inside the container and report success.
  if (process.env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL must be set in production");
  }
  const { createPgliteDb } = await import("./pglite.ts");
  console.log(`DATABASE_URL isn't set, using local PGlite in ${LOCAL_DATA_DIR}`);
  return createPgliteDb(LOCAL_DATA_DIR);
}

async function main(command: string | undefined): Promise<void> {
  if (command !== "migrate" && command !== "seed" && command !== "setup") {
    console.error("Usage: node src/db/cli.ts migrate|seed|setup");
    process.exitCode = 2;
    return;
  }

  const db = await connect();
  try {
    if (command === "migrate") {
      const applied = await migrate(db);
      console.log(applied.length ? `Applied: ${applied.join(", ")}` : "No pending migrations");
      const webRole = process.env.DB_WEB_ROLE;
      if (webRole) {
        await grantWebRole(db, webRole);
        console.log(`Granted row access to ${webRole}`);
      }
    } else if (command === "seed") {
      await migrate(db);
      await seed(db);
      console.log("Catalogue reset to the seed data");
    } else {
      await migrate(db);
      const [{ count }] = await db.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM departures",
      );
      if (count === 0) {
        await seed(db);
        console.log("Empty catalogue seeded");
      } else {
        console.log(`Catalogue has ${count} departures, not reseeding`);
      }
    }
  } finally {
    await db.close();
  }
}

main(process.argv[2]).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
