// Prüfungen erstellen: Liste, Editor (Teile), Reihenfolge, Kopie für eine Parallelklasse, Aufgabenbank,
// Umwandlung aus Word/PDF mit Bestätigung. Durchführung und Korrektur folgen in Phase 5.
import crypto from "node:crypto";
import { geschuetzt } from "../sitzung.mjs";
import { fehler } from "../fehler.mjs";
import { protokolliere } from "../protokoll.mjs";
import { pruefe, darf, teilEntwurf, suchText, TYPEN } from "@schule/shared";
import { speicher, neuerKey } from "../material/speicher.mjs";
import { dateiart, sauberName, inhaltPasst, MAX_GROESSE } from "../material/dateien.mjs";
import { textAusDatei, mitRegeln, mitKi, kiVerfuegbar } from "../pruefung/umwandeln.mjs";

const id = (x) => (/^[0-9a-f-]{36}$/.test(String(x || "")) ? x : fehler(400, "Ungültige Kennung."));
const text = (x, max) => (x == null ? "" : String(x).trim().slice(0, max));
const datum = (x) => (!x ? null : /^\d{4}-\d{2}-\d{2}$/.test(String(x)) ? x : fehler(400, "Ungültiges Datum.", "datum"));

async function pruefungLaden(q, ctx, pid) {
  const [p] = await q(`SELECT p.*, k.name AS klasse, k.id AS klasse_id, f.name AS fach, f.id AS fach_id, f.farbe, u.gruppe
    FROM pruefung p JOIN unterricht u ON u.id = p.unterricht_id JOIN klasse k ON k.id = u.klasse_id JOIN fach f ON f.id = u.fach_id WHERE p.id = $1`, [id(pid)]);
  if (!p || !darf(ctx, "pruefung.verwalten", { unterrichtId: p.unterricht_id })) fehler(404, "Prüfung nicht gefunden.");
  return p;
}
async function teileLaden(q, pid) {
  const rows = await q("SELECT id, nr, typ, inhalt, loesung, punkte, aufgabe_id FROM pruefung_teil WHERE pruefung_id = $1 ORDER BY nr", [pid]);
  return rows.map((r) => { let f = null; try { f = teilEntwurf(r).fehler; } catch (e) { f = e.message; } return { ...r, fehler: f }; });
}
// Erlaubte Seiten während der Prüfung: nur https, höchstens 20
export function seitenLesen(liste) {
  return (Array.isArray(liste) ? liste : []).slice(0, 20).map((x) => {
    const url = String(x && x.url || "").trim();
    let u; try { u = new URL(url); } catch { fehler(400, `«${url}» ist keine gültige Adresse.`, "seiten"); }
    if (u.protocol !== "https:") fehler(400, "Erlaubte Seiten müssen mit https:// beginnen.", "seiten");
    return { titel: String(x.titel || u.hostname).trim().slice(0, 80), url: u.origin + u.pathname.replace(/\/$/, "") };
  });
}
// Aufgaben ändern nur, solange die Prüfung nicht gestartet ist
const offenFuerAenderung = (p) => { if (!["entwurf", "bereit"].includes(p.status)) fehler(409, "Die Prüfung wurde schon gestartet. Aufgaben lassen sich nicht mehr ändern; kopieren Sie die Prüfung, um sie erneut zu verwenden."); return p; };
const summe = (teile) => Math.round(teile.reduce((a, t) => a + Number(t.punkte || 0), 0) * 100) / 100;
const beruehrt = (q, pid) => q("UPDATE pruefung SET geaendert_am = now() WHERE id = $1", [pid]);
// Bereit nur, wenn alles vollständig ist; nach einer unvollständigen Änderung zurück auf Entwurf
async function statusPruefen(q, pid) {
  const teile = await teileLaden(q, pid);
  if (teile.some((t) => t.fehler)) await q("UPDATE pruefung SET status = 'entwurf' WHERE id = $1 AND status = 'bereit'", [pid]);
}
async function teilEinfuegen(q, pid, teil, nach = null, aufgabeId = null) {
  const [{ max }] = await q("SELECT coalesce(max(nr), 0) AS max FROM pruefung_teil WHERE pruefung_id = $1", [pid]);
  let nr = max + 1;
  if (nach != null && nach < max) { await q("UPDATE pruefung_teil SET nr = nr + 1 WHERE pruefung_id = $1 AND nr > $2", [pid, nach]); nr = nach + 1; }
  const [t] = await q("INSERT INTO pruefung_teil (pruefung_id, nr, typ, inhalt, loesung, punkte, aufgabe_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, nr, typ, inhalt, loesung, punkte, aufgabe_id",
    [pid, nr, teil.typ, teil.inhalt, teil.loesung, teil.punkte, aufgabeId]);
  return t;
}

export default async function (app) {
  /* ---------- Liste ---------- */
  app.get("/api/pruefungen", geschuetzt(async (req, res, q) => {
    pruefe(req.ctx, "pruefung.verwalten");
    const uids = [...req.ctx.lehrt];
    const pruefungen = await q(`SELECT p.id, p.titel, p.datum, p.dauer_min, p.status, p.quelle, p.geaendert_am, p.unterricht_id, k.name AS klasse, f.name AS fach, f.farbe, u.gruppe,
        (SELECT count(*)::int FROM pruefung_teil t WHERE t.pruefung_id = p.id AND t.typ <> 'abschnitt') AS aufgaben,
        (SELECT coalesce(sum(t.punkte), 0) FROM pruefung_teil t WHERE t.pruefung_id = p.id) AS punkte
      FROM pruefung p JOIN unterricht u ON u.id = p.unterricht_id JOIN klasse k ON k.id = u.klasse_id JOIN fach f ON f.id = u.fach_id
      WHERE p.unterricht_id = ANY($1) ORDER BY p.datum NULLS LAST, p.geaendert_am DESC`, [uids]);
    const meinUnterricht = await q(`SELECT u.id, u.gruppe, k.name AS klasse, f.name AS fach, f.farbe FROM unterricht u JOIN klasse k ON k.id = u.klasse_id JOIN fach f ON f.id = u.fach_id
      JOIN schuljahr j ON j.id = k.schuljahr_id WHERE u.id = ANY($1) AND j.aktiv ORDER BY k.name, f.name`, [uids]);
    return { pruefungen, meinUnterricht };
  }));

  app.post("/api/pruefungen", geschuetzt(async (req, res, q) => {
    const b = req.body || {}, uid = id(b.unterricht_id);
    pruefe(req.ctx, "pruefung.verwalten", { unterrichtId: uid });
    const titel = text(b.titel, 160) || fehler(400, "Bitte einen Titel eingeben.", "titel");
    const dauer = b.dauer_min ? Math.round(Number(b.dauer_min)) : null;
    if (dauer !== null && !(dauer >= 1 && dauer <= 600)) fehler(400, "Dauer zwischen 1 und 600 Minuten.", "dauer_min");
    const [p] = await q("INSERT INTO pruefung (unterricht_id, erstellt_von, titel, datum, dauer_min, quelle) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
      [uid, req.ctx.personId, titel, datum(b.datum), dauer, b.quelle === "umwandlung" ? "umwandlung" : "editor"]);
    await protokolliere(q, req, "pruefung.erstellt", "pruefung", p.id, null, { titel });
    return p;
  }));

  /* ---------- Eine Prüfung ---------- */
  app.get("/api/pruefungen/:id", geschuetzt(async (req, res, q) => {
    const p = await pruefungLaden(q, req.ctx, req.params.id);
    const teile = await teileLaden(q, p.id);
    const schluessel = await q("SELECT id, name, art, parameter, rundung FROM notenschluessel WHERE besitzer_id IS NULL OR besitzer_id = $1 OR geteilt = 'schule' ORDER BY name", [req.ctx.personId]);
    const [s] = await q("SELECT einstellungen FROM schule");
    return { ...p, teile, punkte: summe(teile), schluessel, ki: kiVerfuegbar(s.einstellungen) };
  }));

  app.put("/api/pruefungen/:id", geschuetzt(async (req, res, q) => {
    const p = offenFuerAenderung(await pruefungLaden(q, req.ctx, req.params.id)), b = req.body || {};
    const titel = b.titel !== undefined ? text(b.titel, 160) || fehler(400, "Bitte einen Titel eingeben.", "titel") : p.titel;
    const dauer = b.dauer_min !== undefined ? (b.dauer_min === "" || b.dauer_min === null ? null : Math.round(Number(b.dauer_min))) : p.dauer_min;
    if (dauer !== null && !(dauer >= 1 && dauer <= 600)) fehler(400, "Dauer zwischen 1 und 600 Minuten.", "dauer_min");
    const e = b.einstellungen ? { ...p.einstellungen,
      ...(b.einstellungen.hinweise !== undefined ? { hinweise: text(b.einstellungen.hinweise, 5000) } : {}),
      ...(b.einstellungen.hilfsmittel !== undefined ? { hilfsmittel: text(b.einstellungen.hilfsmittel, 500) } : {}),
      ...(b.einstellungen.rueckwaerts !== undefined ? { rueckwaerts: !!b.einstellungen.rueckwaerts } : {}),
      ...(b.einstellungen.mischen !== undefined ? { mischen: !!b.einstellungen.mischen } : {}),
      ...(b.einstellungen.modus !== undefined ? { modus: b.einstellungen.modus === "lernumgebung" ? "lernumgebung" : "browser" } : {}),
      ...(b.einstellungen.rechner !== undefined ? { rechner: !!b.einstellungen.rechner } : {}),
      ...(b.einstellungen.notizbuch !== undefined ? { notizbuch: !!b.einstellungen.notizbuch } : {}),
      ...(b.einstellungen.seiten !== undefined ? { seiten: seitenLesen(b.einstellungen.seiten) } : {}) } : p.einstellungen;
    const schl = b.notenschluessel_id !== undefined ? (b.notenschluessel_id ? id(b.notenschluessel_id) : null) : p.notenschluessel_id;
    let status = p.status;
    if (b.status === "bereit" && p.status !== "bereit") {
      const teile = await teileLaden(q, p.id);
      if (!teile.some((t) => TYPEN[t.typ].punkte)) fehler(400, "Die Prüfung hat noch keine Aufgabe.");
      const offen = teile.filter((t) => t.fehler);
      if (offen.length) fehler(400, `Noch ${offen.length === 1 ? "eine Aufgabe ist" : offen.length + " Aufgaben sind"} unvollständig (z. B. Nr. ${offen[0].nr}: ${offen[0].fehler})`);
      status = "bereit";
    } else if (b.status === "entwurf") status = "entwurf";
    await q("UPDATE pruefung SET titel=$1, datum=$2, dauer_min=$3, einstellungen=$4, notenschluessel_id=$5, status=$6, geaendert_am=now() WHERE id=$7",
      [titel, b.datum !== undefined ? datum(b.datum) : p.datum, dauer, e, schl, status, p.id]);
    if (status !== p.status) await protokolliere(q, req, "pruefung.status", "pruefung", p.id, { status: p.status }, { status });
    return { ok: true, status };
  }));

  app.delete("/api/pruefungen/:id", geschuetzt(async (req, res, q) => {
    const p = await pruefungLaden(q, req.ctx, req.params.id);
    const [{ n }] = await q("SELECT count(*)::int AS n FROM versuch WHERE pruefung_id = $1", [p.id]);
    if (n || p.status === "laeuft") fehler(409, p.status === "laeuft" ? "Die Prüfung läuft. Beenden Sie sie zuerst." : "Diese Prüfung wurde schon geschrieben und kann nicht gelöscht werden.");
    const keys = (await q("SELECT datei_key FROM umwandlung WHERE pruefung_id = $1", [p.id])).map((r) => r.datei_key);
    await q("DELETE FROM pruefung WHERE id = $1", [p.id]);
    await protokolliere(q, req, "pruefung.geloescht", "pruefung", p.id, { titel: p.titel });
    for (const k of keys) await speicher.loeschen(k).catch(() => {});
    return { ok: true };
  }));

  // Kopie, z. B. für die Parallelklasse
  app.post("/api/pruefungen/:id/kopieren", geschuetzt(async (req, res, q) => {
    const p = await pruefungLaden(q, req.ctx, req.params.id), uid = id(req.body && req.body.unterricht_id);
    pruefe(req.ctx, "pruefung.verwalten", { unterrichtId: uid });
    const [n] = await q(`INSERT INTO pruefung (unterricht_id, erstellt_von, titel, datum, dauer_min, einstellungen, notenschluessel_id, quelle)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [uid, req.ctx.personId, text(req.body.titel, 160) || p.titel, p.datum, p.dauer_min, p.einstellungen, p.notenschluessel_id, p.quelle]);
    await q(`INSERT INTO pruefung_teil (pruefung_id, nr, typ, inhalt, loesung, punkte, aufgabe_id) SELECT $1, nr, typ, inhalt, loesung, punkte, aufgabe_id FROM pruefung_teil WHERE pruefung_id = $2`, [n.id, p.id]);
    await protokolliere(q, req, "pruefung.kopiert", "pruefung", n.id, { von: p.id });
    return n;
  }));

  /* ---------- Teile ---------- */
  app.post("/api/pruefungen/:id/teile", geschuetzt(async (req, res, q) => {
    const p = offenFuerAenderung(await pruefungLaden(q, req.ctx, req.params.id)), b = req.body || {};
    const { teil, fehler: f } = teilEntwurf(b.teil);
    const t = await teilEinfuegen(q, p.id, teil, b.nach_nr != null ? Number(b.nach_nr) : null);
    await statusPruefen(q, p.id); await beruehrt(q, p.id);
    return { ...t, fehler: f };
  }));
  const teilMitRecht = async (q, ctx, tid) => {
    const [t] = await q("SELECT id, pruefung_id, nr FROM pruefung_teil WHERE id = $1", [id(tid)]);
    if (!t) fehler(404, "Aufgabe nicht gefunden.");
    offenFuerAenderung(await pruefungLaden(q, ctx, t.pruefung_id));
    return t;
  };
  app.put("/api/teile/:id", geschuetzt(async (req, res, q) => {
    const t0 = await teilMitRecht(q, req.ctx, req.params.id);
    const { teil, fehler: f } = teilEntwurf(req.body && req.body.teil);
    const [t] = await q("UPDATE pruefung_teil SET typ=$1, inhalt=$2, loesung=$3, punkte=$4 WHERE id=$5 RETURNING id, nr, typ, inhalt, loesung, punkte, aufgabe_id", [teil.typ, teil.inhalt, teil.loesung, teil.punkte, t0.id]);
    await statusPruefen(q, t0.pruefung_id); await beruehrt(q, t0.pruefung_id);
    return { ...t, fehler: f };
  }));
  app.delete("/api/teile/:id", geschuetzt(async (req, res, q) => {
    const t = await teilMitRecht(q, req.ctx, req.params.id);
    await q("DELETE FROM pruefung_teil WHERE id = $1", [t.id]);
    await q("UPDATE pruefung_teil SET nr = nr - 1 WHERE pruefung_id = $1 AND nr > $2", [t.pruefung_id, t.nr]);
    await beruehrt(q, t.pruefung_id);
    return { ok: true };
  }));
  app.post("/api/pruefungen/:id/reihenfolge", geschuetzt(async (req, res, q) => {
    const p = offenFuerAenderung(await pruefungLaden(q, req.ctx, req.params.id));
    const ids = (Array.isArray(req.body && req.body.ids) ? req.body.ids : []).map(id);
    const vorhanden = (await q("SELECT id FROM pruefung_teil WHERE pruefung_id = $1", [p.id])).map((r) => r.id);
    if (ids.length !== vorhanden.length || !vorhanden.every((x) => ids.includes(x))) fehler(400, "Die Liste der Aufgaben stimmt nicht.");
    for (let k = 0; k < ids.length; k++) await q("UPDATE pruefung_teil SET nr = $1 WHERE id = $2", [k + 1, ids[k]]); // Eindeutigkeit wird am Ende der Transaktion geprüft
    await beruehrt(q, p.id);
    return { ok: true };
  }));

  /* ---------- Aufgabenbank ---------- */
  app.get("/api/aufgaben", geschuetzt(async (req, res, q) => {
    pruefe(req.ctx, "pruefung.verwalten");
    const p = [req.ctx.personId, [...(req.ctx.faecher || [])]];
    let w = `(a.besitzer_id = $1 OR a.geteilt = 'schule' OR (a.geteilt = 'fachgruppe' AND a.fach_id = ANY($2::uuid[])))`;
    if (req.query.fach) { p.push(id(req.query.fach)); w += ` AND a.fach_id = $${p.length}`; }
    if (req.query.typ && TYPEN[req.query.typ]) { p.push(req.query.typ); w += ` AND a.typ = $${p.length}`; }
    const s = String(req.query.suche || "").trim().slice(0, 80);
    if (s) { p.push("%" + s.toLowerCase().replace(/[%_\\]/g, "") + "%"); w += ` AND lower(a.such_text || ' ' || array_to_string(a.schlagworte, ' ')) LIKE $${p.length}`; }
    return q(`SELECT a.id, a.typ, a.inhalt, a.loesung, a.punkte, a.schlagworte, a.geteilt, a.fach_id, f.name AS fach, a.besitzer_id = $1 AS mein,
        pe.vorname || ' ' || pe.nachname AS besitzer, a.geaendert_am
      FROM aufgabe a LEFT JOIN fach f ON f.id = a.fach_id JOIN person pe ON pe.id = a.besitzer_id WHERE ${w} ORDER BY a.geaendert_am DESC LIMIT 200`, p);
  }));
  app.post("/api/aufgaben", geschuetzt(async (req, res, q) => {
    pruefe(req.ctx, "pruefung.verwalten");
    const b = req.body || {};
    const { teil, fehler: f } = teilEntwurf(b.teil);
    if (f) fehler(400, "Nur vollständige Aufgaben können in die Aufgabenbank: " + f);
    if (teil.typ === "abschnitt" && !teil.inhalt.text) fehler(400, "Dieser Abschnitt hat keinen Text.");
    const geteilt = ["privat", "fachgruppe", "schule"].includes(b.geteilt) ? b.geteilt : "privat";
    const fach = b.fach_id ? id(b.fach_id) : null;
    if (geteilt === "fachgruppe" && !fach) fehler(400, "Zum Teilen mit der Fachgruppe bitte ein Fach wählen.");
    const sw = [...new Set((Array.isArray(b.schlagworte) ? b.schlagworte : String(b.schlagworte || "").split(",")).map((x) => text(x, 40).toLowerCase()).filter(Boolean))].slice(0, 20);
    const [a] = await q("INSERT INTO aufgabe (besitzer_id, fach_id, typ, inhalt, loesung, punkte, schlagworte, geteilt, such_text) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id",
      [req.ctx.personId, fach, teil.typ, teil.inhalt, teil.loesung, teil.punkte, sw, geteilt, suchText(teil)]);
    if (b.teil_id) await q("UPDATE pruefung_teil SET aufgabe_id = $1 WHERE id = $2", [a.id, (await teilMitRecht(q, req.ctx, b.teil_id)).id]);
    return a;
  }));
  app.put("/api/aufgaben/:id", geschuetzt(async (req, res, q) => {
    const [a] = await q("SELECT besitzer_id, fach_id FROM aufgabe WHERE id = $1", [id(req.params.id)]);
    if (!a || !darf(req.ctx, "aufgabe.bearbeiten", { besitzerId: a.besitzer_id })) fehler(404, "Aufgabe nicht gefunden.");
    const g = req.body && req.body.geteilt;
    if (!["privat", "fachgruppe", "schule"].includes(g)) fehler(400, "Ungültige Freigabe.");
    if (g === "fachgruppe" && !a.fach_id) fehler(400, "Zum Teilen mit der Fachgruppe braucht die Aufgabe ein Fach.");
    await q("UPDATE aufgabe SET geteilt = $1, geaendert_am = now() WHERE id = $2", [g, req.params.id]);
    return { ok: true };
  }));
  app.delete("/api/aufgaben/:id", geschuetzt(async (req, res, q) => {
    const [a] = await q("SELECT besitzer_id FROM aufgabe WHERE id = $1", [id(req.params.id)]);
    if (!a || !darf(req.ctx, "aufgabe.bearbeiten", { besitzerId: a.besitzer_id })) fehler(404, "Aufgabe nicht gefunden.");
    await q("DELETE FROM aufgabe WHERE id = $1", [req.params.id]); // Prüfungen behalten ihre Kopie
    return { ok: true };
  }));
  app.post("/api/pruefungen/:id/aus-bank", geschuetzt(async (req, res, q) => {
    const p = offenFuerAenderung(await pruefungLaden(q, req.ctx, req.params.id));
    const ids = (Array.isArray(req.body && req.body.aufgabe_ids) ? req.body.aufgabe_ids : []).map(id).slice(0, 100);
    const neu = [];
    for (const aid of ids) {
      const [a] = await q("SELECT * FROM aufgabe WHERE id = $1", [aid]);
      if (!a || !darf(req.ctx, "aufgabe.lesen", { besitzerId: a.besitzer_id, geteilt: a.geteilt, fachId: a.fach_id })) fehler(404, "Aufgabe nicht gefunden.");
      neu.push(await teilEinfuegen(q, p.id, a, null, a.id));
    }
    await beruehrt(q, p.id);
    return { ok: true, anzahl: neu.length };
  }));

  /* ---------- Umwandlung aus Word oder PDF ---------- */
  app.post("/api/pruefungen/:id/umwandlung", geschuetzt(async (req, res, q) => {
    const p = offenFuerAenderung(await pruefungLaden(q, req.ctx, req.params.id));
    if (!req.isMultipart()) fehler(400, "Bitte eine Datei wählen.");
    let datei = null, felder = {};
    for await (const part of req.parts({ limits: { fileSize: MAX_GROESSE, files: 1 } })) {
      if (part.type === "file") { const buf = await part.toBuffer(); if (part.file.truncated) fehler(413, "Die Datei ist grösser als 50 MB."); datei = { buf, name: sauberName(part.filename) }; }
      else felder[part.fieldname] = part.value;
    }
    if (!datei) fehler(400, "Bitte eine Datei wählen.");
    const a = dateiart(datei.name);
    if (!a || !["pdf", "docx", "txt", "md"].includes(a.ext)) fehler(415, "Bitte eine Word-Datei (.docx) oder ein PDF hochladen. Ältere .doc-Dateien zuerst in Word als .docx speichern.");
    if (!inhaltPasst(a.ext, datei.buf)) fehler(415, "Der Inhalt passt nicht zur Dateiendung.");
    let ex;
    try { ex = await textAusDatei(a.ext, datei.buf); } catch (e) { fehler(422, e.status === 415 ? e.message : "Die Datei liess sich nicht lesen. Ist sie geschützt oder beschädigt?"); }
    if (ex.text.replace(/\s/g, "").length < 20) fehler(422, "In der Datei wurde kaum Text gefunden. Ist es ein eingescanntes Dokument? Texterkennung für Scans folgt später.");
    const [s] = await q("SELECT einstellungen FROM schule");
    let ergebnis, verfahren = "regeln", hinweis = null;
    if (felder.ki !== "nein" && kiVerfuegbar(s.einstellungen)) {
      try { ergebnis = await mitKi(ex.text); verfahren = "ki"; }
      catch (e) { req.log && req.log.warn(e); hinweis = "Die KI war nicht erreichbar, darum wurde die Erkennung nach Regeln verwendet."; }
    }
    if (!ergebnis) ergebnis = mitRegeln(ex.text);
    if (!ergebnis.teile.length) hinweis = "Es wurden keine nummerierten Aufgaben erkannt. Sie können die Aufgaben rechts von Hand anlegen.";
    const vorschlag = ergebnis.teile.map((t) => { let f = null, teil = t; try { const r = teilEntwurf(t); teil = { ...r.teil, hinweis: t.hinweis || null, original: t.original || "" }; f = r.fehler; } catch (e) { f = e.message; } return { ...teil, fehler: f, schluessel: crypto.randomUUID() }; });
    const key = neuerKey(req.sitzung.schule_id);
    await speicher.ablegen(key, datei.buf, a.mime);
    const [u] = await q(`INSERT INTO umwandlung (pruefung_id, dateiname, mime, datei_key, original_html, vorschlag, verfahren, hinweis, erstellt_von) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [p.id, datei.name, a.mime, key, ex.html, JSON.stringify(vorschlag), verfahren, hinweis, req.ctx.personId]);
    await protokolliere(q, req, "pruefung.umwandlung", "pruefung", p.id, null, { datei: datei.name, verfahren, teile: vorschlag.length });
    return { id: u.id, titel: ergebnis.titel, verfahren, hinweis, anzahl: vorschlag.length };
  }));
  const umwandlungLaden = async (q, ctx, uid) => {
    const [u] = await q("SELECT * FROM umwandlung WHERE id = $1", [id(uid)]);
    if (!u) fehler(404, "Umwandlung nicht gefunden.");
    await pruefungLaden(q, ctx, u.pruefung_id);
    return u;
  };
  app.get("/api/umwandlungen/:id", geschuetzt(async (req, res, q) => {
    const u = await umwandlungLaden(q, req.ctx, req.params.id);
    const { datei_key, ...rest } = u;
    return rest;
  }));
  app.get("/api/umwandlungen/:id/datei", geschuetzt(async (req, res, q) => {
    const u = await umwandlungLaden(q, req.ctx, req.params.id);
    if (speicher.art === "s3") return res.redirect(await speicher.link(u.datei_key, { dateiname: u.dateiname, mime: u.mime, inline: u.mime === "application/pdf" }), 302);
    res.header("Content-Type", u.mime);
    res.header("Content-Disposition", `${u.mime === "application/pdf" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(u.dateiname)}`);
    res.header("Content-Security-Policy", "frame-ancestors 'self'"); res.header("X-Frame-Options", "SAMEORIGIN"); res.header("Cache-Control", "private, no-store");
    return speicher.lesen(u.datei_key);
  }));
  // Übernehmen: die (von der Lehrperson bearbeiteten) Vorschläge werden als Teile angehängt, auch unvollständige
  app.post("/api/umwandlungen/:id/uebernehmen", geschuetzt(async (req, res, q) => {
    const u = await umwandlungLaden(q, req.ctx, req.params.id);
    offenFuerAenderung(await pruefungLaden(q, req.ctx, u.pruefung_id));
    if (u.status !== "offen") fehler(409, "Diese Umwandlung wurde schon übernommen.");
    const teile = (Array.isArray(req.body && req.body.teile) ? req.body.teile : u.vorschlag).slice(0, 300);
    let n = 0, offen = 0;
    for (const roh of teile) { const { teil, fehler: f } = teilEntwurf(roh); await teilEinfuegen(q, u.pruefung_id, teil); n++; if (f) offen++; }
    await q("UPDATE umwandlung SET status = 'uebernommen' WHERE id = $1", [u.id]);
    if (req.body && req.body.titel) await q("UPDATE pruefung SET titel = $1 WHERE id = $2 AND quelle = 'umwandlung'", [text(req.body.titel, 160), u.pruefung_id]);
    await statusPruefen(q, u.pruefung_id); await beruehrt(q, u.pruefung_id);
    return { ok: true, anzahl: n, unvollstaendig: offen };
  }));
}
