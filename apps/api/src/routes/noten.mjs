// Notenbuch: Bewertungen, Noten (mit Punkten oder direkt), Freigabe, mündliche Beobachtungen, Zeugnisnoten, «Meine Noten»
import { geschuetzt } from "../sitzung.mjs";
import { fehler } from "../fehler.mjs";
import { protokolliere } from "../protokoll.mjs";
import { fuerWen } from "../hilfen.mjs";
import { pruefe, darf, punkteZuNote, schnitt, zeugnisVorschlag, muendlichVorschlag, runden } from "@schule/shared";

const id = (x) => (/^[0-9a-f-]{36}$/.test(String(x || "")) ? x : fehler(400, "Ungültige Kennung."));
const zahl = (x, min, max) => { if (x === null || x === undefined || x === "") return null; const n = Number(String(x).replace(",", ".")); if (!Number.isFinite(n) || n < min || n > max) fehler(400, `Wert ausserhalb ${min} bis ${max}.`); return Math.round(n * 100) / 100; };
const text = (x, max) => (x == null ? null : String(x).trim().slice(0, max) || null);
const KENNZ = ["abwesend", "nachholen", "dispensiert"];

async function unterrichtLaden(q, uid) {
  const [u] = await q(`SELECT u.id, u.gruppe, u.klasse_id, k.name AS klasse, k.schuljahr_id, f.name AS fach, f.kuerzel, f.farbe
    FROM unterricht u JOIN klasse k ON k.id = u.klasse_id JOIN fach f ON f.id = u.fach_id WHERE u.id = $1`, [uid]);
  if (!u) fehler(404, "Unterricht nicht gefunden.");
  return u;
}
// Schülerinnen und Schüler eines Unterrichts (ganze Klasse oder Gruppe)
const schuelerVon = (q, u) => q(u.gruppe
  ? `SELECT p.id, p.vorname, p.nachname FROM unterricht_schueler us JOIN person p ON p.id = us.person_id WHERE us.unterricht_id = $1 AND p.status = 'aktiv' ORDER BY p.nachname, p.vorname`
  : `SELECT p.id, p.vorname, p.nachname FROM klasse_schueler ks JOIN person p ON p.id = ks.person_id WHERE ks.klasse_id = $1 AND p.status = 'aktiv' AND (ks.bis IS NULL OR ks.bis >= current_date) ORDER BY p.nachname, p.vorname`,
  [u.gruppe ? u.id : u.klasse_id]);

async function semesterWahl(q, u, sid) {
  const liste = await q("SELECT id, nr, von, bis FROM semester WHERE schuljahr_id = $1 ORDER BY nr", [u.schuljahr_id]);
  if (!liste.length) fehler(400, "Für dieses Schuljahr sind keine Semester erfasst.");
  const heute = new Date().toISOString().slice(0, 10);
  const s = (sid && liste.find((x) => x.id === sid)) || liste.find((x) => x.von <= heute && x.bis >= heute) || liste[0];
  return { semester: s, liste };
}
async function schuleEinstellungen(q) { const [s] = await q("SELECT einstellungen FROM schule"); return { rundungZeugnis: Number(s.einstellungen.rundung_zeugnis) || 0.5 }; }

/** Alles für die Notenbuch-Tabelle eines Unterrichts in einem Semester */
async function notenbuch(q, ctx, uid, sid) {
  const u = await unterrichtLaden(q, uid);
  const { semester, liste: semesterListe } = await semesterWahl(q, u, sid);
  const schueler = await schuelerVon(q, u);
  const bewertungen = await q(`SELECT b.*, a.name AS art FROM bewertung b LEFT JOIN bewertungsart a ON a.id = b.bewertungsart_id
    WHERE b.unterricht_id = $1 AND b.semester_id = $2 ORDER BY b.datum, b.erstellt_am`, [uid, semester.id]);
  const leistungen = bewertungen.length ? await q("SELECT bewertung_id, schueler_id, punkte, note, kennzeichen, kommentar FROM leistung WHERE bewertung_id = ANY($1)", [bewertungen.map((b) => b.id)]) : [];
  const beob = await q(`SELECT schueler_id, wert FROM beobachtung WHERE unterricht_id = $1 AND datum BETWEEN $2 AND $3`, [uid, semester.von, semester.bis]);
  const zeugnis = await q("SELECT schueler_id, gesetzt, begruendung, status FROM zeugnisnote WHERE unterricht_id = $1 AND semester_id = $2", [uid, semester.id]);
  const { rundungZeugnis } = await schuleEinstellungen(q);
  const gew = new Map(bewertungen.map((b) => [b.id, b.gewicht]));
  const zeilen = schueler.map((s) => {
    const meine = leistungen.filter((l) => l.schueler_id === s.id);
    const sn = schnitt(meine.map((l) => ({ note: l.note, gewicht: gew.get(l.bewertung_id), kennzeichen: l.kennzeichen })));
    const z = zeugnis.find((x) => x.schueler_id === s.id);
    return { ...s, schnitt: sn.schnitt, anzahl: sn.anzahl, vorschlag: zeugnisVorschlag(sn.schnitt, rundungZeugnis),
      muendlich: muendlichVorschlag(beob.filter((b) => b.schueler_id === s.id).map((b) => b.wert)),
      beobachtungen: beob.filter((b) => b.schueler_id === s.id).length,
      zeugnis: z ? { gesetzt: z.gesetzt, begruendung: z.begruendung, status: z.status } : null };
  });
  const arten = await q("SELECT id, name, kategorie, gewicht_standard FROM bewertungsart ORDER BY reihenfolge, name");
  const schluessel = await q("SELECT id, name, art, parameter, rundung FROM notenschluessel WHERE besitzer_id IS NULL OR besitzer_id = $1 OR geteilt = 'schule' ORDER BY name", [ctx.personId]);
  const klassenschnitt = schnitt(zeilen.filter((z) => z.schnitt != null).map((z) => ({ note: z.schnitt, gewicht: 1 }))).schnitt;
  return { unterricht: u, semester, semesterListe, bewertungen, leistungen, zeilen, arten, schluessel, rundungZeugnis, klassenschnitt,
    darfSchreiben: darf(ctx, "noten.schreiben", { unterrichtId: uid }), mussBegruenden: !ctx.lehrt.has(uid) };
}

async function bewertungMitRecht(q, ctx, bid) {
  const [b] = await q("SELECT * FROM bewertung WHERE id = $1", [id(bid)]);
  if (!b) fehler(404, "Bewertung nicht gefunden.");
  pruefe(ctx, "noten.schreiben", { unterrichtId: b.unterricht_id });
  return b;
}

export default async function (app) {
  app.get("/api/notenbuch/:uid", geschuetzt(async (req, res, q) => {
    const uid = id(req.params.uid);
    pruefe(req.ctx, "noten.lesen", { unterrichtId: uid });
    const d = await notenbuch(q, req.ctx, uid, req.query.semester ? id(req.query.semester) : null);
    // Einsicht durch Schulleitung oder Administration wird protokolliert
    if (!req.ctx.lehrt.has(uid)) await protokolliere(q, req, "noten.eingesehen", "unterricht", uid);
    return d;
  }));

  /* ---------- Bewertungen ---------- */
  const bewertungDaten = async (q, body, b0) => {
    const d = {
      titel: text(body.titel, 80) || fehler(400, "Bitte einen Titel eingeben.", "titel"),
      datum: /^\d{4}-\d{2}-\d{2}$/.test(String(body.datum || "")) ? body.datum : fehler(400, "Bitte ein Datum wählen.", "datum"),
      gewicht: zahl(body.gewicht ?? 1, 0.01, 100),
      max_punkte: zahl(body.max_punkte, 0.01, 10000),
      kategorie: ["schriftlich", "muendlich"].includes(body.kategorie) ? body.kategorie : "schriftlich",
      bewertungsart_id: body.bewertungsart_id ? id(body.bewertungsart_id) : null,
      notenschluessel_id: body.notenschluessel_id ? id(body.notenschluessel_id) : null,
    };
    if (b0 && b0.status === "freigegeben" && (Number(b0.gewicht) !== d.gewicht || Number(b0.max_punkte || 0) !== Number(d.max_punkte || 0)) && !text(body.grund, 300))
      fehler(409, "Die Bewertung ist schon freigegeben. Bitte geben Sie einen Grund für die Änderung an.", "grund");
    return d;
  };
  app.post("/api/notenbuch/:uid/bewertungen", geschuetzt(async (req, res, q) => {
    const uid = id(req.params.uid);
    pruefe(req.ctx, "noten.schreiben", { unterrichtId: uid });
    const u = await unterrichtLaden(q, uid);
    const { semester } = await semesterWahl(q, u, req.body.semester_id ? id(req.body.semester_id) : null);
    const d = await bewertungDaten(q, req.body || {});
    const [b] = await q(`INSERT INTO bewertung (unterricht_id, semester_id, bewertungsart_id, kategorie, titel, datum, gewicht, max_punkte, notenschluessel_id, erstellt_von)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [uid, semester.id, d.bewertungsart_id, d.kategorie, d.titel, d.datum, d.gewicht, d.max_punkte, d.notenschluessel_id, req.ctx.personId]);
    await protokolliere(q, req, "bewertung.erstellt", "bewertung", b.id, null, d);
    return b;
  }));
  app.put("/api/bewertungen/:id", geschuetzt(async (req, res, q) => {
    const b0 = await bewertungMitRecht(q, req.ctx, req.params.id);
    const d = await bewertungDaten(q, req.body || {}, b0);
    const [b] = await q(`UPDATE bewertung SET titel=$1, datum=$2, gewicht=$3, max_punkte=$4, kategorie=$5, bewertungsart_id=$6, notenschluessel_id=$7 WHERE id=$8 RETURNING *`,
      [d.titel, d.datum, d.gewicht, d.max_punkte, d.kategorie, d.bewertungsart_id, d.notenschluessel_id, b0.id]);
    // Punkte neu umrechnen, falls Maximum oder Schlüssel geändert
    if (d.max_punkte) await umrechnen(q, b, req.ctx.personId);
    await protokolliere(q, req, "bewertung.geaendert", "bewertung", b.id, { titel: b0.titel, gewicht: b0.gewicht, max_punkte: b0.max_punkte }, d, text(req.body.grund, 300));
    return b;
  }));
  app.delete("/api/bewertungen/:id", geschuetzt(async (req, res, q) => {
    const b = await bewertungMitRecht(q, req.ctx, req.params.id);
    if (b.status === "freigegeben" && !text(req.body && req.body.grund, 300)) fehler(409, "Die Bewertung ist schon freigegeben. Bitte geben Sie einen Grund für das Löschen an.", "grund");
    const noten = await q("SELECT schueler_id, punkte, note, kennzeichen FROM leistung WHERE bewertung_id = $1", [b.id]);
    await q("DELETE FROM bewertung WHERE id = $1", [b.id]);
    await protokolliere(q, req, "bewertung.geloescht", "bewertung", b.id, { titel: b.titel, status: b.status, noten }, null, text(req.body && req.body.grund, 300));
    return { ok: true };
  }));
  app.post("/api/bewertungen/:id/freigeben", geschuetzt(async (req, res, q) => {
    const b = await bewertungMitRecht(q, req.ctx, req.params.id);
    const zurueck = req.body && req.body.zurueck === true;
    if (zurueck && !text(req.body.grund, 300)) fehler(409, "Bitte geben Sie einen Grund an, warum die Noten wieder verborgen werden.", "grund");
    await q("UPDATE bewertung SET status = $1, freigegeben_am = $2, freigegeben_von = $3 WHERE id = $4", zurueck ? ["entwurf", null, null, b.id] : ["freigegeben", new Date(), req.ctx.personId, b.id]);
    await protokolliere(q, req, zurueck ? "bewertung.verborgen" : "bewertung.freigegeben", "bewertung", b.id, null, null, text(req.body && req.body.grund, 300));
    return { ok: true };
  }));

  async function umrechnen(q, b, von) {
    if (!b.max_punkte) return;
    const [s] = b.notenschluessel_id ? await q("SELECT art, parameter, rundung FROM notenschluessel WHERE id = $1", [b.notenschluessel_id]) : [null];
    for (const l of await q("SELECT id, punkte FROM leistung WHERE bewertung_id = $1 AND punkte IS NOT NULL", [b.id]))
      await q("UPDATE leistung SET note = $1, geaendert_von = $2, geaendert_am = now() WHERE id = $3", [punkteZuNote(l.punkte, b.max_punkte, s || undefined), von, l.id]);
  }

  /* ---------- Noten eintragen (mehrere auf einmal) ---------- */
  // eintraege: [{ schueler_id, punkte?, note?, kennzeichen?, kommentar? }]; bei freigegebenen Noten ist «grund» Pflicht
  app.put("/api/bewertungen/:id/leistungen", geschuetzt(async (req, res, q) => {
    const b = await bewertungMitRecht(q, req.ctx, req.params.id);
    const u = await unterrichtLaden(q, b.unterricht_id);
    const erlaubt = new Set((await schuelerVon(q, u)).map((s) => s.id));
    const [s] = b.notenschluessel_id ? await q("SELECT art, parameter, rundung FROM notenschluessel WHERE id = $1", [b.notenschluessel_id]) : [null];
    const grund = text(req.body && req.body.grund, 300);
    const mussGrund = b.status === "freigegeben" || !req.ctx.lehrt.has(b.unterricht_id);
    const eintraege = (Array.isArray(req.body && req.body.eintraege) ? req.body.eintraege : []).slice(0, 200);
    const vorher = new Map((await q("SELECT * FROM leistung WHERE bewertung_id = $1", [b.id])).map((l) => [l.schueler_id, l]));
    const aenderungen = [];
    for (const e of eintraege) {
      const sid = id(e.schueler_id);
      if (!erlaubt.has(sid)) fehler(400, "Diese Person gehört nicht zu diesem Unterricht.");
      const kennzeichen = KENNZ.includes(e.kennzeichen) ? e.kennzeichen : null;
      let punkte = b.max_punkte ? zahl(e.punkte, 0, Number(b.max_punkte)) : null;
      let note = b.max_punkte && punkte != null ? punkteZuNote(punkte, b.max_punkte, s || undefined) : zahl(e.note, 1, 6);
      if (kennzeichen) { punkte = null; note = null; }
      const kommentar = e.kommentar === undefined ? (vorher.get(sid) || {}).kommentar ?? null : text(e.kommentar, 500);
      const alt = vorher.get(sid);
      const gleich = alt && Number(alt.note ?? -1) === Number(note ?? -1) && Number(alt.punkte ?? -1) === Number(punkte ?? -1) && (alt.kennzeichen || null) === kennzeichen && (alt.kommentar || null) === (kommentar || null);
      if (gleich || (!alt && note == null && punkte == null && !kennzeichen && !kommentar)) continue;
      aenderungen.push({ sid, alt: alt ? { note: alt.note, punkte: alt.punkte, kennzeichen: alt.kennzeichen } : null, neu: { note, punkte, kennzeichen } });
      if (note == null && punkte == null && !kennzeichen && !kommentar) await q("DELETE FROM leistung WHERE bewertung_id = $1 AND schueler_id = $2", [b.id, sid]);
      else await q(`INSERT INTO leistung (bewertung_id, schueler_id, punkte, note, kennzeichen, kommentar, geaendert_von) VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (bewertung_id, schueler_id) DO UPDATE SET punkte = EXCLUDED.punkte, note = EXCLUDED.note, kennzeichen = EXCLUDED.kennzeichen, kommentar = EXCLUDED.kommentar, geaendert_von = EXCLUDED.geaendert_von, geaendert_am = now()`,
        [b.id, sid, punkte, note, kennzeichen, kommentar, req.ctx.personId]);
    }
    if (aenderungen.length && mussGrund && !grund) fehler(409, b.status === "freigegeben" ? "Diese Noten sind schon freigegeben. Bitte geben Sie einen Grund für die Änderung an." : "Bitte geben Sie einen Grund für die Änderung an.", "grund");
    // Protokoll: bei Entwürfen eine Sammelzeile, bei freigegebenen Noten jede Änderung einzeln mit altem und neuem Wert
    if (aenderungen.length) {
      if (b.status === "freigegeben" || mussGrund) for (const a of aenderungen) await protokolliere(q, req, "note.geaendert", "leistung", `${b.id}:${a.sid}`, a.alt, a.neu, grund);
      else await protokolliere(q, req, "noten.erfasst", "bewertung", b.id, null, { anzahl: aenderungen.length });
    }
    const neu = await q("SELECT schueler_id, punkte, note, kennzeichen, kommentar FROM leistung WHERE bewertung_id = $1", [b.id]);
    return { leistungen: neu, geaendert: aenderungen.length };
  }));

  /* ---------- Mündliche Beobachtungen ---------- */
  app.get("/api/notenbuch/:uid/beobachtungen", geschuetzt(async (req, res, q) => {
    const uid = id(req.params.uid);
    pruefe(req.ctx, "noten.lesen", { unterrichtId: uid });
    const u = await unterrichtLaden(q, uid);
    const { semester } = await semesterWahl(q, u, req.query.semester ? id(req.query.semester) : null);
    const schueler = await schuelerVon(q, u);
    const liste = await q(`SELECT id, schueler_id, datum, wert, text FROM beobachtung WHERE unterricht_id = $1 AND datum BETWEEN $2 AND $3 ORDER BY datum DESC, erstellt_am DESC`, [uid, semester.von, semester.bis]);
    return { unterricht: u, semester, schueler: schueler.map((s) => ({ ...s, beobachtungen: liste.filter((b) => b.schueler_id === s.id), vorschlag: muendlichVorschlag(liste.filter((b) => b.schueler_id === s.id).map((b) => b.wert)) })) };
  }));
  app.post("/api/notenbuch/:uid/beobachtungen", geschuetzt(async (req, res, q) => {
    const uid = id(req.params.uid);
    pruefe(req.ctx, "noten.schreiben", { unterrichtId: uid });
    const u = await unterrichtLaden(q, uid);
    const sid = id(req.body.schueler_id);
    if (!(await schuelerVon(q, u)).some((s) => s.id === sid)) fehler(400, "Diese Person gehört nicht zu diesem Unterricht.");
    const wert = Number(req.body.wert);
    if (![-2, -1, 0, 1, 2].includes(wert)) fehler(400, "Ungültige Beobachtung.");
    const [b] = await q("INSERT INTO beobachtung (unterricht_id, schueler_id, wert, text, erfasst_von) VALUES ($1,$2,$3,$4,$5) RETURNING id, schueler_id, datum, wert, text", [uid, sid, wert, text(req.body.text, 300), req.ctx.personId]);
    return b;
  }));
  app.delete("/api/beobachtungen/:id", geschuetzt(async (req, res, q) => {
    const [b] = await q("SELECT unterricht_id FROM beobachtung WHERE id = $1", [id(req.params.id)]);
    if (!b) fehler(404, "Beobachtung nicht gefunden.");
    pruefe(req.ctx, "noten.schreiben", { unterrichtId: b.unterricht_id });
    await q("DELETE FROM beobachtung WHERE id = $1", [req.params.id]);
    return { ok: true };
  }));
  // Vorschläge aus den Beobachtungen als mündliche Bewertung (Entwurf) übernehmen
  app.post("/api/notenbuch/:uid/muendlich-uebernehmen", geschuetzt(async (req, res, q) => {
    const uid = id(req.params.uid);
    pruefe(req.ctx, "noten.schreiben", { unterrichtId: uid });
    const u = await unterrichtLaden(q, uid);
    const { semester } = await semesterWahl(q, u, req.body.semester_id ? id(req.body.semester_id) : null);
    const beob = await q("SELECT schueler_id, wert FROM beobachtung WHERE unterricht_id = $1 AND datum BETWEEN $2 AND $3", [uid, semester.von, semester.bis]);
    const [art] = await q("SELECT id, gewicht_standard FROM bewertungsart WHERE kategorie = 'muendlich' ORDER BY (name = 'Mündlich') DESC LIMIT 1");
    const [b] = await q(`INSERT INTO bewertung (unterricht_id, semester_id, bewertungsart_id, kategorie, titel, datum, gewicht, erstellt_von) VALUES ($1,$2,$3,'muendlich',$4,current_date,$5,$6) RETURNING *`,
      [uid, semester.id, art ? art.id : null, `Mündlich ${semester.nr}. Semester`, Number(req.body.gewicht) > 0 ? zahl(req.body.gewicht, 0.01, 100) : (art ? art.gewicht_standard : 1), req.ctx.personId]);
    let n = 0;
    for (const s of await schuelerVon(q, u)) {
      const v = muendlichVorschlag(beob.filter((x) => x.schueler_id === s.id).map((x) => x.wert));
      if (v.note == null) continue;
      await q("INSERT INTO leistung (bewertung_id, schueler_id, note, kommentar, geaendert_von) VALUES ($1,$2,$3,$4,$5)", [b.id, s.id, v.note, `Aus ${v.anzahl} Beobachtungen`, req.ctx.personId]); n++;
    }
    await protokolliere(q, req, "bewertung.muendlich_uebernommen", "bewertung", b.id, null, { anzahl: n });
    return { bewertung: b, anzahl: n };
  }));

  /* ---------- Zeugnisnote setzen ---------- */
  app.put("/api/notenbuch/:uid/zeugnis", geschuetzt(async (req, res, q) => {
    const uid = id(req.params.uid);
    pruefe(req.ctx, "noten.schreiben", { unterrichtId: uid });
    const u = await unterrichtLaden(q, uid);
    const { semester } = await semesterWahl(q, u, req.body.semester_id ? id(req.body.semester_id) : null);
    const sid = id(req.body.schueler_id);
    const { rundungZeugnis } = await schuleEinstellungen(q);
    const gesetzt = req.body.gesetzt == null || req.body.gesetzt === "" ? null : zahl(req.body.gesetzt, 1, 6);
    if (gesetzt != null && runden(gesetzt, rundungZeugnis) !== gesetzt) fehler(400, `Zeugnisnoten in Schritten von ${String(rundungZeugnis).replace(".", ",")}.`);
    const [alt] = await q("SELECT gesetzt, status FROM zeugnisnote WHERE unterricht_id = $1 AND schueler_id = $2 AND semester_id = $3", [uid, sid, semester.id]);
    if (alt && alt.status === "freigegeben" && !text(req.body.grund, 300)) fehler(409, "Die Zeugnisnote ist schon freigegeben. Bitte geben Sie einen Grund an.", "grund");
    await q(`INSERT INTO zeugnisnote (unterricht_id, schueler_id, semester_id, gesetzt, begruendung, geaendert_von) VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (unterricht_id, schueler_id, semester_id) DO UPDATE SET gesetzt = EXCLUDED.gesetzt, begruendung = EXCLUDED.begruendung, geaendert_von = EXCLUDED.geaendert_von, geaendert_am = now()`,
      [uid, sid, semester.id, gesetzt, text(req.body.begruendung, 300), req.ctx.personId]);
    await protokolliere(q, req, "zeugnisnote.gesetzt", "zeugnisnote", `${uid}:${sid}:${semester.id}`, alt ? { gesetzt: alt.gesetzt } : null, { gesetzt }, text(req.body.grund, 300));
    return { ok: true };
  }));

  /* ---------- Meine Noten (Schülerinnen und Schüler) ---------- */
  app.get("/api/meine-noten", geschuetzt(async (req, res, q) => {
    const { pid, unterricht } = await fuerWen(q, req, "noten.eigene");
    const [jahr] = await q("SELECT id FROM schuljahr WHERE aktiv LIMIT 1");
    if (!jahr) return { faecher: [] };
    const sem = await q("SELECT id, nr, von, bis FROM semester WHERE schuljahr_id = $1 ORDER BY nr", [jahr.id]);
    const heute = new Date().toISOString().slice(0, 10);
    const s = (req.query.semester && sem.find((x) => x.id === req.query.semester)) || sem.find((x) => x.von <= heute && x.bis >= heute) || sem[0];
    if (!s) return { faecher: [], semesterListe: [] };
    // Nur freigegebene Bewertungen; Entwürfe der Lehrperson bleiben unsichtbar
    const rows = await q(`SELECT u.id AS unterricht_id, f.name AS fach, f.farbe, b.id, b.titel, b.datum, b.gewicht, b.kategorie, b.max_punkte, l.note, l.punkte, l.kennzeichen, l.kommentar
      FROM unterricht u JOIN fach f ON f.id = u.fach_id JOIN bewertung b ON b.unterricht_id = u.id AND b.semester_id = $2 AND b.status = 'freigegeben'
      LEFT JOIN leistung l ON l.bewertung_id = b.id AND l.schueler_id = $3
      WHERE u.id = ANY($1) ORDER BY f.name, b.datum`, [[...unterricht], s.id, pid]);
    const faecher = new Map();
    for (const r of rows) {
      if (!faecher.has(r.unterricht_id)) faecher.set(r.unterricht_id, { fach: r.fach, farbe: r.farbe, noten: [] });
      faecher.get(r.unterricht_id).noten.push({ titel: r.titel, datum: r.datum, gewicht: r.gewicht, kategorie: r.kategorie, note: r.note, punkte: r.punkte, max_punkte: r.max_punkte, kennzeichen: r.kennzeichen, kommentar: r.kommentar });
    }
    const zeugnis = await q("SELECT unterricht_id, gesetzt FROM zeugnisnote WHERE schueler_id = $1 AND semester_id = $2 AND status = 'freigegeben'", [pid, s.id]);
    return { semester: s, semesterListe: sem, faecher: [...faecher.entries()].map(([uid, f]) => ({ ...f, unterricht_id: uid, schnitt: schnitt(f.noten).schnitt, zeugnis: (zeugnis.find((z) => z.unterricht_id === uid) || {}).gesetzt ?? null })) };
  }));
}
