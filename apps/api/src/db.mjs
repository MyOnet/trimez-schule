// Datenbankzugriff. Die App verbindet sich als schule_app (Zeilen-Sicherheit aktiv).
// mitSchule() öffnet eine Transaktion und setzt die Schule; ohne das sieht die App keine Daten.
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || "postgres://schule_app:dev-app@localhost/schule", max: 20 });
pg.types.setTypeParser(1700, (v) => (v == null ? null : Number(v))); // numeric → Zahl (Noten haben höchstens 2 Nachkommastellen)
pg.types.setTypeParser(1082, (v) => v); // date als Text «JJJJ-MM-TT»

export const sql = (text, params) => pool.query(text, params);

/** fn(q) mit q(text, params) → rows; alles in einer Transaktion mit gesetzter Schule */
export async function mitSchule(schuleId, fn) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.schule_id', $1, true)", [schuleId]);
    const q = async (text, params) => (await c.query(text, params)).rows;
    const out = await fn(q);
    await c.query("COMMIT");
    return out;
  } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; }
  finally { c.release(); }
}
export const ende = () => pool.end();
