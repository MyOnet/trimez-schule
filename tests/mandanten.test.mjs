// Zeilen-Sicherheit: Eine Schule sieht nie Daten einer anderen, auch wenn der Code die Schule falsch setzt oder vergisst.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";

const owner = new pg.Client({ connectionString: process.env.DATABASE_OWNER_URL || "postgres://schule_owner:dev-owner@localhost/schule" });
const app = new pg.Client({ connectionString: process.env.DATABASE_URL || "postgres://schule_app:dev-app@localhost/schule" });
let A, B;
beforeAll(async () => {
  await owner.connect(); await app.connect();
  await owner.query("DELETE FROM schule WHERE kurzname IN ('test-a','test-b')");
  A = (await owner.query("INSERT INTO schule (kurzname, name) VALUES ('test-a','Test A') RETURNING id")).rows[0].id;
  B = (await owner.query("INSERT INTO schule (kurzname, name) VALUES ('test-b','Test B') RETURNING id")).rows[0].id;
  await owner.query("INSERT INTO person (schule_id, vorname, nachname) VALUES ($1,'Anna','A'), ($2,'Beat','B')", [A, B]);
});
afterAll(async () => { await owner.query("DELETE FROM schule WHERE kurzname IN ('test-a','test-b')"); await owner.end(); await app.end(); });
const alsSchule = async (id, fn) => { await app.query("BEGIN"); await app.query("SELECT set_config('app.schule_id', $1, true)", [id]); try { return await fn(); } finally { await app.query("ROLLBACK"); } };

describe("Mandanten-Trennung in der Datenbank", () => {
  it("ohne gesetzte Schule sieht die App nichts", async () => {
    const r = await app.query("SELECT count(*)::int AS n FROM person");
    expect(r.rows[0].n).toBe(0);
  });
  it("Schule A sieht nur ihre Personen", async () => {
    const r = await alsSchule(A, () => app.query("SELECT vorname FROM person"));
    expect(r.rows.map((x) => x.vorname)).toEqual(["Anna"]);
  });
  it("Schule A kann nicht in Schule B schreiben", async () => {
    await expect(alsSchule(A, () => app.query("INSERT INTO person (schule_id, vorname, nachname) VALUES ($1,'X','Y')", [B]))).rejects.toThrow(/row-level security/);
  });
  it("Schule A kann Personen von B nicht ändern", async () => {
    const r = await alsSchule(A, () => app.query("UPDATE person SET vorname = 'gehackt' WHERE schule_id = $1", [B]));
    expect(r.rowCount).toBe(0);
  });
  it("das Protokoll lässt sich nicht ändern oder löschen", async () => {
    await expect(alsSchule(A, () => app.query("UPDATE protokoll SET aktion = 'x'"))).rejects.toThrow(/permission denied/);
    await expect(alsSchule(A, () => app.query("DELETE FROM protokoll"))).rejects.toThrow(/permission denied/);
  });
  it("die App kann keine Schulen anlegen", async () => {
    await expect(app.query("INSERT INTO schule (kurzname, name) VALUES ('boese','x')")).rejects.toThrow(/permission denied/);
  });
  it("Zeilen-Sicherheit gilt für alle Tabellen (auch Notenbuch und Material)", async () => {
    const r = await owner.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname NOT IN ('schule', '_migration') AND NOT (c.relrowsecurity AND c.relforcerowsecurity)`);
    expect(r.rows.map((x) => x.relname)).toEqual([]);
  });
});
