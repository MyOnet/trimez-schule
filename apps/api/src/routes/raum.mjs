// Klassenraum: ein Raum pro Unterricht mit Ankündigungen, Fragen und Beiträgen (mit Antworten und Dateien)
import { geschuetzt } from "../sitzung.mjs";
import { fehler } from "../fehler.mjs";
import { protokolliere } from "../protokoll.mjs";
import { pruefe, darf } from "@schule/shared";
import { id, text, pflicht, unterrichtLaden, schuelerVon, lehrpersonenVon, mitteilen, dateiLesen, dateiSpeichern, dateienVon, dateiLaden, dateiSenden, dateiEntfernen } from "../hilfen.mjs";

const ARTEN = ["ankuendigung", "beitrag", "frage"];

async function raum(q, ctx, uid) {
  const u = await unterrichtLaden(q, uid);
  pruefe(ctx, "raum.lesen", { unterrichtId: u.id });
  const mod = darf(ctx, "raum.moderieren", { unterrichtId: u.id });
  return { u, mod, schreiben: mod || u.raum_schueler_schreiben };
}
async function beitragLaden(q, ctx, bid) {
  const [b] = await q("SELECT * FROM beitrag WHERE id = $1", [id(bid)]);
  if (!b || b.geloescht_am) fehler(404, "Beitrag nicht gefunden.");
  const r = await raum(q, ctx, b.unterricht_id);
  return { b, ...r };
}

export default async function (app) {
  /* ---------- Meine Räume mit Zahl der neuen Beiträge ---------- */
  app.get("/api/raeume", geschuetzt(async (req, res, q) => {
    const ids = [...req.ctx.unterricht].filter((u) => darf(req.ctx, "raum.lesen", { unterrichtId: u }));
    if (!ids.length) return [];
    return q(`SELECT u.id, k.name AS klasse, f.name AS fach, f.farbe, u.gruppe,
        (SELECT count(*)::int FROM beitrag b WHERE b.unterricht_id = u.id AND b.geloescht_am IS NULL AND b.autor_id IS DISTINCT FROM $2
          AND b.erstellt_am > coalesce((SELECT zuletzt FROM raum_gelesen g WHERE g.unterricht_id = u.id AND g.person_id = $2), '-infinity')) AS neu,
        (SELECT max(b.erstellt_am) FROM beitrag b WHERE b.unterricht_id = u.id AND b.geloescht_am IS NULL) AS zuletzt
      FROM unterricht u JOIN klasse k ON k.id = u.klasse_id JOIN fach f ON f.id = u.fach_id JOIN schuljahr j ON j.id = k.schuljahr_id AND j.aktiv
      WHERE u.id = ANY($1) ORDER BY zuletzt DESC NULLS LAST, f.name`, [ids, req.ctx.personId]);
  }));

  /* ---------- Raum lesen ---------- */
  app.get("/api/raum/:uid", geschuetzt(async (req, res, q) => {
    const { u, mod, schreiben } = await raum(q, req.ctx, req.params.uid);
    const [g] = await q("SELECT zuletzt FROM raum_gelesen WHERE unterricht_id = $1 AND person_id = $2", [u.id, req.ctx.personId]);
    const vor = req.query.vor && !isNaN(new Date(req.query.vor)) ? new Date(req.query.vor).toISOString() : null;
    const filter = ARTEN.includes(req.query.art) ? req.query.art : null;
    const oben = await q(`SELECT b.id, b.art, b.text, b.angeheftet, b.beantwortet, b.erstellt_am, b.bearbeitet_am, b.autor_id, p.vorname, p.nachname,
        EXISTS (SELECT 1 FROM unterricht_lp ul WHERE ul.unterricht_id = b.unterricht_id AND ul.person_id = b.autor_id) AS von_lp
      FROM beitrag b LEFT JOIN person p ON p.id = b.autor_id
      WHERE b.unterricht_id = $1 AND b.eltern_id IS NULL AND b.geloescht_am IS NULL AND ($2::timestamptz IS NULL OR b.erstellt_am < $2) AND ($3::text IS NULL OR b.art = $3)
      ORDER BY ${vor ? "" : "b.angeheftet DESC,"} b.erstellt_am DESC LIMIT 40`, [u.id, vor, filter]);
    const antworten = oben.length ? await q(`SELECT b.id, b.eltern_id, b.text, b.erstellt_am, b.bearbeitet_am, b.autor_id, b.geloescht_am IS NOT NULL AS geloescht, p.vorname, p.nachname,
        EXISTS (SELECT 1 FROM unterricht_lp ul WHERE ul.unterricht_id = b.unterricht_id AND ul.person_id = b.autor_id) AS von_lp
      FROM beitrag b LEFT JOIN person p ON p.id = b.autor_id WHERE b.eltern_id = ANY($1) ORDER BY b.erstellt_am`, [oben.map((b) => b.id)]) : [];
    const dateien = await dateienVon(q, "beitrag", [...oben.map((b) => b.id), ...antworten.map((b) => b.id)]);
    const mit = (b) => ({ ...b, mein: b.autor_id === req.ctx.personId, dateien: dateien.filter((d) => d.bezug_id === b.id), neu: !!(g && b.autor_id !== req.ctx.personId && new Date(b.erstellt_am) > new Date(g.zuletzt)) });
    if (!vor) await q("INSERT INTO raum_gelesen (unterricht_id, person_id) VALUES ($1,$2) ON CONFLICT (unterricht_id, person_id) DO UPDATE SET zuletzt = now()", [u.id, req.ctx.personId]);
    return {
      unterricht: u, darfModerieren: mod, darfSchreiben: schreiben,
      beitraege: oben.map((b) => ({ ...mit(b), antworten: antworten.filter((a) => a.eltern_id === b.id).map((a) => (a.geloescht ? { id: a.id, geloescht: true, erstellt_am: a.erstellt_am } : mit(a))) })),
      mehr: oben.length === 40,
    };
  }));

  /* ---------- Schreiben ---------- */
  app.post("/api/raum/:uid/beitraege", geschuetzt(async (req, res, q) => {
    const { u, mod, schreiben } = await raum(q, req.ctx, req.params.uid);
    const b = req.body || {};
    const eltern = b.eltern_id ? (await beitragLaden(q, req.ctx, b.eltern_id)).b : null;
    if (eltern && (eltern.eltern_id || eltern.unterricht_id !== u.id)) fehler(400, "Antworten nur auf Beiträge in diesem Raum.");
    if (!schreiben) fehler(403, "In diesem Raum schreibt nur die Lehrperson.");
    const art = eltern ? "beitrag" : ARTEN.includes(b.art) ? b.art : "beitrag";
    if (art === "ankuendigung" && !mod) fehler(403, "Ankündigungen macht die Lehrperson.");
    const [neu] = await q("INSERT INTO beitrag (unterricht_id, autor_id, art, eltern_id, text) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [u.id, req.ctx.personId, art, eltern ? eltern.id : null, pflicht(b.text, 8000, "Bitte einen Text eingeben.", "text")]);
    // Mitteilungen: Ankündigung an die Klasse, Frage an die Lehrpersonen, Antwort an die Person, die gefragt hat
    const kurz = neu.text.replace(/\s+/g, " ").slice(0, 140);
    if (art === "ankuendigung") await mitteilen(q, (await schuelerVon(q, u)).map((s) => s.id), { art: "raum", titel: `Ankündigung in ${u.fach}`, text: kurz, link: `/raum/${u.id}` });
    else if (art === "frage") await mitteilen(q, (await lehrpersonenVon(q, u.id)).map((p) => p.id).filter((p) => p !== req.ctx.personId), { art: "raum", titel: `Neue Frage in ${u.fach} ${u.klasse}`, text: kurz, link: `/raum/${u.id}` });
    else if (eltern && eltern.autor_id && eltern.autor_id !== req.ctx.personId) await mitteilen(q, [eltern.autor_id], { art: "raum", titel: `Antwort in ${u.fach}`, text: kurz, link: `/raum/${u.id}`, schluessel: `antwort:${eltern.id}:${req.ctx.personId}` });
    await q("INSERT INTO raum_gelesen (unterricht_id, person_id) VALUES ($1,$2) ON CONFLICT (unterricht_id, person_id) DO UPDATE SET zuletzt = now()", [u.id, req.ctx.personId]);
    return neu;
  }));
  app.put("/api/beitraege/:id", geschuetzt(async (req, res, q) => {
    const { b } = await beitragLaden(q, req.ctx, req.params.id);
    if (b.autor_id !== req.ctx.personId) fehler(403, "Nur eigene Beiträge lassen sich bearbeiten.");
    const [n] = await q("UPDATE beitrag SET text = $1, bearbeitet_am = now() WHERE id = $2 RETURNING *", [pflicht(req.body.text, 8000, "Bitte einen Text eingeben.", "text"), b.id]);
    return n;
  }));
  app.delete("/api/beitraege/:id", geschuetzt(async (req, res, q) => {
    const { b, mod } = await beitragLaden(q, req.ctx, req.params.id);
    if (b.autor_id !== req.ctx.personId && !mod) fehler(403, "Nur eigene Beiträge lassen sich löschen.");
    await q("UPDATE beitrag SET geloescht_am = now(), geloescht_von = $2 WHERE id = $1", [b.id, req.ctx.personId]);
    for (const f of await q("SELECT * FROM datei WHERE bezug_typ = 'beitrag' AND bezug_id = $1 AND geloescht_am IS NULL", [b.id])) await dateiEntfernen(q, f);
    // Löscht die Lehrperson einen fremden Beitrag, steht das im Protokoll (mit dem Text, für Nachfragen)
    if (b.autor_id !== req.ctx.personId) await protokolliere(q, req, "beitrag.entfernt", "beitrag", b.id, { autor: b.autor_id, text: b.text.slice(0, 500) });
    return { ok: true };
  }));
  app.post("/api/beitraege/:id/anheften", geschuetzt(async (req, res, q) => {
    const { b, mod } = await beitragLaden(q, req.ctx, req.params.id);
    if (!mod) fehler(403, "Anheften kann die Lehrperson.");
    if (b.eltern_id) fehler(400, "Antworten lassen sich nicht anheften.");
    await q("UPDATE beitrag SET angeheftet = $1 WHERE id = $2", [req.body.an !== false, b.id]);
    return { ok: true };
  }));
  app.post("/api/beitraege/:id/beantwortet", geschuetzt(async (req, res, q) => {
    const { b, mod } = await beitragLaden(q, req.ctx, req.params.id);
    if (b.art !== "frage") fehler(400, "Nur Fragen lassen sich als beantwortet markieren.");
    if (!mod && b.autor_id !== req.ctx.personId) fehler(403, "Dafür fehlt Ihnen die Berechtigung.");
    await q("UPDATE beitrag SET beantwortet = $1 WHERE id = $2", [req.body.an !== false, b.id]);
    return { ok: true };
  }));
  app.put("/api/raum/:uid/einstellungen", geschuetzt(async (req, res, q) => {
    const { u, mod } = await raum(q, req.ctx, req.params.uid);
    if (!mod) fehler(403, "Dafür fehlt Ihnen die Berechtigung.");
    await q("UPDATE unterricht SET raum_schueler_schreiben = $1 WHERE id = $2", [req.body.schueler_schreiben !== false, u.id]);
    return { ok: true };
  }));

  /* ---------- Dateien an Beiträgen ---------- */
  app.post("/api/beitraege/:id/dateien", geschuetzt(async (req, res, q) => {
    const { b } = await beitragLaden(q, req.ctx, req.params.id);
    if (b.autor_id !== req.ctx.personId) fehler(403, "Dateien nur an eigene Beiträge.");
    const [{ n }] = await q("SELECT count(*)::int AS n FROM datei WHERE bezug_typ = 'beitrag' AND bezug_id = $1 AND geloescht_am IS NULL", [b.id]);
    if (n >= 6) fehler(400, "Höchstens 6 Dateien pro Beitrag.");
    const { datei } = await dateiLesen(req);
    return dateiSpeichern(q, req, { bezugTyp: "beitrag", bezugId: b.id }, datei);
  }));
  app.get("/api/beitrag-dateien/:did", geschuetzt(async (req, res, q) => {
    const f = await dateiLaden(q, req.params.did);
    if (f.bezug_typ !== "beitrag") fehler(404, "Datei nicht gefunden.");
    await beitragLaden(q, req.ctx, f.bezug_id);
    return dateiSenden(res, f, req.query.ansicht === "1");
  }));
}
