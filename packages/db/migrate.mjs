import { fileURLToPath } from "node:url";
// Migrationen der Reihe nach ausführen (als Besitzer der Datenbank). Bereits ausgeführte werden übersprungen.
//   DATABASE_OWNER_URL=postgres://schule_owner:…@localhost/schule node packages/db/migrate.mjs
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const url = process.env.DATABASE_OWNER_URL || "postgres://schule_owner:dev-owner@localhost/schule";
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");
const c = new pg.Client({ connectionString: url });
await c.connect();
await c.query("CREATE TABLE IF NOT EXISTS _migration (name text PRIMARY KEY, am timestamptz NOT NULL DEFAULT now())");
const done = new Set((await c.query("SELECT name FROM _migration")).rows.map((r) => r.name));
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
  if (done.has(f)) continue;
  process.stdout.write(`Migration ${f} … `);
  await c.query("BEGIN");
  try { await c.query(fs.readFileSync(path.join(dir, f), "utf8")); await c.query("INSERT INTO _migration (name) VALUES ($1)", [f]); await c.query("COMMIT"); console.log("ok"); }
  catch (e) { await c.query("ROLLBACK"); console.error("FEHLER\n", e.message); process.exit(1); }
}
await c.end();
