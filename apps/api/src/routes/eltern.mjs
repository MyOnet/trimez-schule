// Elternzugang: nur lesen. Eltern sehen Noten, Absenzen, Termine und Mitteilungen ihrer Kinder unter 18
// (volljährige Kinder nur, wenn sie selbst zustimmen). Die Verknüpfung erfasst die Schuladministration.
import { geschuetzt } from "../sitzung.mjs";
import { fehler } from "../fehler.mjs";
import { protokolliere } from "../protokoll.mjs";
import { pruefe } from "@schule/shared";
import { id, text, klasseVon } from "../hilfen.mjs";

const BEZIEHUNG = ["mutter", "vater", "elternteil", "beistand", "andere"];

export default async function (app) {
  /* ---------- Eltern: meine Kinder ---------- */
  app.get("/api/eltern/kinder", geschuetzt(async (req, res, q) => {
    if (!req.ctx.rollen.has("eltern")) fehler(403, "Dieser Bereich ist für Eltern.");
    const kinder = await q(`SELECT p.id, p.vorname, p.nachname, p.geburtsdatum::text AS geburtsdatum, p.eltern_freigabe, ek.beziehung
      FROM eltern_kind ek JOIN person p ON p.id = ek.kind_id WHERE ek.eltern_id = $1 AND p.status = 'aktiv' ORDER BY p.vorname`, [req.ctx.personId]);
    const liste = [];
    for (const k of kinder) {
      const sichtbar = req.ctx.kinder.has(k.id);
      if (!sichtbar) { liste.push({ id: k.id, vorname: k.vorname, nachname: k.nachname, sichtbar: false }); continue; }
      const klasse = await klasseVon(q, k.id);
      const [kl] = klasse ? await q("SELECT p.vorname || ' ' || p.nachname AS name, p.email FROM klasse k JOIN person p ON p.id = k.klassenlehrperson_id WHERE k.id = $1", [klasse.id]) : [];
      const [a] = await q(`SELECT count(*) FILTER (WHERE status = 'offen')::int AS offen, count(*) FILTER (WHERE status = 'unentschuldigt')::int AS unentschuldigt
        FROM absenz WHERE schueler_id = $1 AND datum >= (SELECT min(s.von) FROM semester s JOIN schuljahr j ON j.id = s.schuljahr_id AND j.aktiv)`, [k.id]);
      liste.push({ ...k, sichtbar: true, klasse: klasse ? klasse.name : null, klassenlehrperson: kl || null, absenzen: a || { offen: 0, unentschuldigt: 0 } });
    }
    return { kinder: liste };
  }));

  /* ---------- Schüler/in: Eltern-Freigabe (ab 18) ---------- */
  app.get("/api/mein-konto/eltern", geschuetzt(async (req, res, q) => {
    const [p] = await q("SELECT geburtsdatum::text AS geburtsdatum, eltern_freigabe, (geburtsdatum IS NOT NULL AND geburtsdatum <= current_date - interval '18 years') AS volljaehrig FROM person WHERE id = $1", [req.ctx.personId]);
    const eltern = await q("SELECT p.vorname, p.nachname, ek.beziehung FROM eltern_kind ek JOIN person p ON p.id = ek.eltern_id WHERE ek.kind_id = $1 ORDER BY p.nachname", [req.ctx.personId]);
    return { ...p, eltern };
  }));
  app.put("/api/mein-konto/eltern", geschuetzt(async (req, res, q) => {
    if (!req.ctx.rollen.has("schueler")) fehler(403, "Dafür fehlt Ihnen die Berechtigung.");
    const [p] = await q("SELECT eltern_freigabe, (geburtsdatum IS NOT NULL AND geburtsdatum <= current_date - interval '18 years') AS volljaehrig FROM person WHERE id = $1", [req.ctx.personId]);
    if (!p.volljaehrig) fehler(409, "Bis 18 sehen Ihre Eltern Noten und Absenzen ohnehin. Die Freigabe gilt ab der Volljährigkeit.");
    const frei = req.body.freigabe === true;
    await q("UPDATE person SET eltern_freigabe = $1 WHERE id = $2", [frei, req.ctx.personId]);
    await protokolliere(q, req, "eltern.freigabe", "person", req.ctx.personId, { freigabe: p.eltern_freigabe }, { freigabe: frei });
    return { ok: true, freigabe: frei };
  }));

  /* ---------- Administration: Eltern mit Kindern verknüpfen ---------- */
  app.get("/api/personen/:id/kinder", geschuetzt(async (req, res, q) => {
    pruefe(req.ctx, "eltern.verwalten");
    const pid = id(req.params.id);
    const kinder = await q(`SELECT p.id, p.vorname, p.nachname, ek.beziehung FROM eltern_kind ek JOIN person p ON p.id = ek.kind_id WHERE ek.eltern_id = $1 ORDER BY p.vorname`, [pid]);
    const eltern = await q(`SELECT p.id, p.vorname, p.nachname, p.email, ek.beziehung FROM eltern_kind ek JOIN person p ON p.id = ek.eltern_id WHERE ek.kind_id = $1 ORDER BY p.nachname`, [pid]);
    return { kinder, eltern, beziehungen: BEZIEHUNG };
  }));
  app.post("/api/personen/:id/kinder", geschuetzt(async (req, res, q) => {
    pruefe(req.ctx, "eltern.verwalten");
    const eid = id(req.params.id), kid = id(req.body.kind_id);
    if (eid === kid) fehler(400, "Eine Person kann nicht ihr eigenes Kind sein.");
    const [e] = await q("SELECT 1 FROM rolle WHERE person_id = $1 AND art = 'eltern'", [eid]);
    if (!e) fehler(400, "Diese Person hat keine Eltern-Rolle.");
    const [k] = await q("SELECT 1 FROM rolle WHERE person_id = $1 AND art = 'schueler'", [kid]);
    if (!k) fehler(400, "Bitte eine Schülerin oder einen Schüler wählen.", "kind_id");
    const beziehung = BEZIEHUNG.includes(req.body.beziehung) ? req.body.beziehung : "elternteil";
    await q("INSERT INTO eltern_kind (eltern_id, kind_id, beziehung) VALUES ($1,$2,$3) ON CONFLICT (eltern_id, kind_id) DO UPDATE SET beziehung = EXCLUDED.beziehung", [eid, kid, beziehung]);
    await protokolliere(q, req, "eltern.verknuepft", "person", eid, null, { kind: kid, beziehung });
    return { ok: true };
  }));
  app.delete("/api/personen/:id/kinder/:kid", geschuetzt(async (req, res, q) => {
    pruefe(req.ctx, "eltern.verwalten");
    const eid = id(req.params.id), kid = id(req.params.kid);
    const r = await q("DELETE FROM eltern_kind WHERE eltern_id = $1 AND kind_id = $2 RETURNING 1", [eid, kid]);
    if (!r.length) fehler(404, "Verknüpfung nicht gefunden.");
    await protokolliere(q, req, "eltern.getrennt", "person", eid, { kind: kid }, null, text(req.body && req.body.grund, 300) || null);
    return { ok: true };
  }));
}
