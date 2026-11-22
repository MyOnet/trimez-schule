// Mitteilungen (Glocke) und Schulmitteilungen der Schulleitung
import { geschuetzt } from "../sitzung.mjs";
import { fehler } from "../fehler.mjs";
import { protokolliere } from "../protokoll.mjs";
import { pruefe } from "@schule/shared";
import { id, text, pflicht, optZeitpunkt } from "../hilfen.mjs";

const ZIEL = ["lehrperson", "schueler", "eltern"];
/** Zielgruppen, zu denen eine Person gehört (Schulleitung und Administration sehen alle Mitteilungen) */
const gruppen = (ctx) => (ctx.rollen.has("schulleitung") || ctx.rollen.has("admin") ? ZIEL : ZIEL.filter((g) => ctx.rollen.has(g)));

export default async function (app) {
  /* ---------- Glocke ---------- */
  app.get("/api/mitteilungen", geschuetzt(async (req, res, q) => {
    const liste = await q("SELECT id, art, titel, text, link, erstellt_am, gelesen_am FROM mitteilung WHERE person_id = $1 ORDER BY erstellt_am DESC LIMIT 60", [req.ctx.personId]);
    const [{ n }] = await q("SELECT count(*)::int AS n FROM mitteilung WHERE person_id = $1 AND gelesen_am IS NULL", [req.ctx.personId]);
    // Ungelesene Schulmitteilungen zählen mit
    const g = gruppen(req.ctx);
    const [{ s }] = await q(`SELECT count(*)::int AS s FROM schulmitteilung m WHERE m.zielgruppe && $1 AND m.ab <= now() AND (m.bis IS NULL OR m.bis > now())
      AND NOT EXISTS (SELECT 1 FROM schulmitteilung_gelesen x WHERE x.mitteilung_id = m.id AND x.person_id = $2)`, [g, req.ctx.personId]);
    return { liste, ungelesen: n, schulmitteilungen: s };
  }));
  app.post("/api/mitteilungen/gelesen", geschuetzt(async (req, res, q) => {
    if (req.body && Array.isArray(req.body.ids)) await q("UPDATE mitteilung SET gelesen_am = now() WHERE person_id = $1 AND id = ANY($2) AND gelesen_am IS NULL", [req.ctx.personId, req.body.ids.slice(0, 200).map(id)]);
    else await q("UPDATE mitteilung SET gelesen_am = now() WHERE person_id = $1 AND gelesen_am IS NULL", [req.ctx.personId]);
    return { ok: true };
  }));

  /* ---------- Schulmitteilungen ---------- */
  app.get("/api/schulmitteilungen", geschuetzt(async (req, res, q) => {
    const verfasser = req.ctx.rollen.has("schulleitung") || req.ctx.rollen.has("admin");
    const g = gruppen(req.ctx);
    const liste = await q(`SELECT m.id, m.titel, m.text, m.zielgruppe, m.wichtig, m.ab, m.bis, m.erstellt_am, p.vorname || ' ' || p.nachname AS autor,
        EXISTS (SELECT 1 FROM schulmitteilung_gelesen x WHERE x.mitteilung_id = m.id AND x.person_id = $2) AS gelesen
        ${verfasser ? ", (SELECT count(*)::int FROM schulmitteilung_gelesen x WHERE x.mitteilung_id = m.id) AS gelesen_von" : ""}
      FROM schulmitteilung m LEFT JOIN person p ON p.id = m.autor_id
      WHERE m.zielgruppe && $1 AND (${verfasser ? "TRUE" : "m.ab <= now() AND (m.bis IS NULL OR m.bis > now())"})
      ORDER BY m.wichtig DESC, m.ab DESC LIMIT 100`, [g, req.ctx.personId]);
    return { liste, darfVerfassen: verfasser };
  }));
  app.post("/api/schulmitteilungen/:id/gelesen", geschuetzt(async (req, res, q) => {
    await q("INSERT INTO schulmitteilung_gelesen (mitteilung_id, person_id) SELECT id, $2 FROM schulmitteilung WHERE id = $1 ON CONFLICT DO NOTHING", [id(req.params.id), req.ctx.personId]);
    return { ok: true };
  }));
  const daten = (b) => {
    const z = Array.isArray(b.zielgruppe) ? b.zielgruppe.filter((x) => ZIEL.includes(x)) : [];
    if (!z.length) fehler(400, "Bitte mindestens eine Zielgruppe wählen.", "zielgruppe");
    const ab = optZeitpunkt(b.ab, "ab") || new Date().toISOString(), bis = optZeitpunkt(b.bis, "bis");
    if (bis && bis <= ab) fehler(400, "Das Ende muss nach dem Beginn liegen.", "bis");
    return { titel: pflicht(b.titel, 160, "Bitte einen Titel eingeben.", "titel"), text: pflicht(b.text, 10000, "Bitte einen Text eingeben.", "text"), zielgruppe: [...new Set(z)], wichtig: b.wichtig === true, ab, bis };
  };
  app.post("/api/schulmitteilungen", geschuetzt(async (req, res, q) => {
    pruefe(req.ctx, "schulmitteilung.verfassen");
    const d = daten(req.body || {});
    const [m] = await q("INSERT INTO schulmitteilung (autor_id, titel, text, zielgruppe, wichtig, ab, bis) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
      [req.ctx.personId, d.titel, d.text, d.zielgruppe, d.wichtig, d.ab, d.bis]);
    await protokolliere(q, req, "schulmitteilung.erstellt", "schulmitteilung", m.id, null, { titel: d.titel, zielgruppe: d.zielgruppe });
    return m;
  }));
  app.put("/api/schulmitteilungen/:id", geschuetzt(async (req, res, q) => {
    pruefe(req.ctx, "schulmitteilung.verfassen");
    const d = daten(req.body || {});
    const [m] = await q("UPDATE schulmitteilung SET titel=$1, text=$2, zielgruppe=$3, wichtig=$4, ab=$5, bis=$6 WHERE id=$7 RETURNING *", [d.titel, d.text, d.zielgruppe, d.wichtig, d.ab, d.bis, id(req.params.id)]);
    if (!m) fehler(404, "Mitteilung nicht gefunden.");
    return m;
  }));
  app.delete("/api/schulmitteilungen/:id", geschuetzt(async (req, res, q) => {
    pruefe(req.ctx, "schulmitteilung.verfassen");
    const [m] = await q("DELETE FROM schulmitteilung WHERE id = $1 RETURNING titel", [id(req.params.id)]);
    if (!m) fehler(404, "Mitteilung nicht gefunden.");
    await protokolliere(q, req, "schulmitteilung.geloescht", "schulmitteilung", req.params.id, { titel: m.titel });
    return { ok: true };
  }));
}
