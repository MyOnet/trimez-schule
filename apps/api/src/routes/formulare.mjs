// Formulare: Quiz zur Selbstkontrolle, Umfragen (z. B. Kursrückmeldung), Anmeldungen (z. B. Elternabend mit Plätzen).
// Teilnahme angemeldet (Unterricht) oder über einen öffentlichen Link (ohne Anmeldung, z. B. für Eltern).
import { geschuetzt } from "../sitzung.mjs";
import { sql, mitSchule } from "../db.mjs";
import { fehler } from "../fehler.mjs";
import { protokolliere } from "../protokoll.mjs";
import { pruefe, darf, fragenLesen, fuerTeilnehmer, antwortenLesen, formularAuswerten, loesungAnzeige, FORMULAR_ARTEN } from "@schule/shared";
import { id, optId, text, pflicht, optZeitpunkt, unterrichtLaden, schuelerVon, mitteilen } from "../hilfen.mjs";

const offen = (f) => f.status === "offen" && (!f.schliesst_am || new Date(f.schliesst_am) > new Date());

/** Belegte Plätze pro Zeitfenster */
async function belegung(q, f) {
  const t = f.fragen.find((x) => x.typ === "termin");
  if (!t) return {};
  const rows = await q("SELECT antworten->>$2 AS o, count(*)::int AS n FROM formular_antwort WHERE formular_id = $1 AND antworten ? $2 GROUP BY 1", [f.id, t.id]);
  return Object.fromEntries(rows.map((r) => [r.o, r.n]));
}

async function formularLaden(q, fid) {
  const [f] = await q("SELECT * FROM formular WHERE id = $1", [id(fid)]);
  if (!f) fehler(404, "Formular nicht gefunden.");
  return f;
}
/** Wer verwaltet: wer es erstellt hat; bei Unterricht auch die anderen Lehrpersonen des Unterrichts */
const verwaltet = (ctx, f) => f.erstellt_von === ctx.personId || (f.unterricht_id && darf(ctx, "formular.verwalten", { unterrichtId: f.unterricht_id }));
/** Wer angemeldet teilnehmen darf: Unterricht → Schüler/innen des Unterrichts; ohne Unterricht → nur über den Link */
const teilnehmen = (ctx, f) => !!f.unterricht_id && ctx.rollen.has("schueler") && ctx.unterricht.has(f.unterricht_id);

/** Antwort speichern (für beide Wege). Zeitfenster: Plätze werden unter Sperre gezählt. */
async function antwortSpeichern(q, f, { personId = null, name = null, email = null, roh }) {
  if (!offen(f)) fehler(409, f.status === "entwurf" ? "Dieses Formular ist noch nicht offen." : "Dieses Formular ist geschlossen.");
  await q("SELECT id FROM formular WHERE id = $1 FOR UPDATE", [f.id]); // Plätze und Mehrfach-Antworten ohne Wettlauf zählen
  if (personId) {
    const [t] = await q("SELECT anzahl FROM formular_teilnahme WHERE formular_id = $1 AND person_id = $2", [f.id, personId]);
    if (t && !f.einstellungen.mehrfach) fehler(409, "Sie haben dieses Formular schon ausgefüllt.");
  }
  const r = antwortenLesen(f.fragen, roh);
  const termin = f.fragen.find((x) => x.typ === "termin");
  if (termin && r.antworten[termin.id]) {
    const o = termin.inhalt.optionen.find((x) => x.id === r.antworten[termin.id]);
    const belegt = (await belegung(q, f))[o.id] || 0;
    if (o.plaetze && belegt >= o.plaetze) fehler(409, `«${o.text}» ist leider schon voll. Bitte ein anderes Zeitfenster wählen.`, termin.id);
  }
  const anonym = !!f.einstellungen.anonym && f.art === "umfrage";
  const quiz = f.art === "quiz";
  const [a] = await q(`INSERT INTO formular_antwort (formular_id, person_id, name, email, antworten, punkte, max_punkte) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, erstellt_am`,
    [f.id, anonym ? null : personId, name, email, r.antworten, quiz ? r.punkte : null, quiz ? r.max : null]);
  if (personId) await q("INSERT INTO formular_teilnahme (formular_id, person_id) VALUES ($1,$2) ON CONFLICT (formular_id, person_id) DO UPDATE SET anzahl = formular_teilnahme.anzahl + 1", [f.id, personId]);
  // Quiz: sofort Rückmeldung (mit Lösungen, wenn eingestellt)
  if (quiz) return { ok: true, punkte: r.punkte, max: r.max, ergebnisse: Object.fromEntries(f.fragen.map((x) => [x.id, { ...(r.ergebnisse[x.id] || { punkte: 0, max: Number(x.punkte) || 0, richtig: false }), loesung: f.einstellungen.loesungen !== false ? loesungAnzeige(x) : null }])) };
  return { ok: true, id: a.id };
}
const oeffentlichSicht = (f, belegt) => ({ id: f.id, art: f.art, anonym: f.art === "umfrage" && !!f.einstellungen.anonym, titel: f.titel, beschreibung: f.beschreibung, schliesst_am: f.schliesst_am, offen: offen(f), fragen: fuerTeilnehmer(f.fragen, f.id, belegt) });

export default async function (app) {
  /* ---------- Liste ---------- */
  app.get("/api/formulare", geschuetzt(async (req, res, q) => {
    const ctx = req.ctx;
    const verw = darf(ctx, "formular.verwalten");
    const eigene = verw ? await q(`SELECT f.id, f.art, f.titel, f.status, f.unterricht_id, f.schliesst_am, f.erstellt_am, f.einstellungen, k.name AS klasse, fa.name AS fach,
        (SELECT count(*)::int FROM formular_antwort a WHERE a.formular_id = f.id) AS antworten
      FROM formular f LEFT JOIN unterricht u ON u.id = f.unterricht_id LEFT JOIN klasse k ON k.id = u.klasse_id LEFT JOIN fach fa ON fa.id = u.fach_id
      WHERE f.erstellt_von = $1 OR f.unterricht_id = ANY($2) ORDER BY f.erstellt_am DESC LIMIT 200`, [ctx.personId, [...(ctx.lehrt || [])]]) : [];
    // Für Schüler/innen: offene Formulare ihres Unterrichts
    const fuerMich = ctx.rollen.has("schueler") && ctx.unterricht.size ? await q(`SELECT f.id, f.art, f.titel, f.schliesst_am, fa.name AS fach, fa.farbe,
        EXISTS (SELECT 1 FROM formular_teilnahme t WHERE t.formular_id = f.id AND t.person_id = $2) AS erledigt, (f.einstellungen->>'mehrfach')::boolean AS mehrfach
      FROM formular f JOIN unterricht u ON u.id = f.unterricht_id JOIN fach fa ON fa.id = u.fach_id
      WHERE f.unterricht_id = ANY($1) AND f.status = 'offen' AND (f.schliesst_am IS NULL OR f.schliesst_am > now()) ORDER BY f.erstellt_am DESC`, [[...ctx.unterricht], ctx.personId]) : [];
    return { eigene, fuerMich, darfErstellen: verw, arten: FORMULAR_ARTEN };
  }));

  /* ---------- Erstellen, bearbeiten, öffnen, schliessen ---------- */
  const daten = (b, alt = {}) => {
    const art = alt.art || (FORMULAR_ARTEN[b.art] ? b.art : fehler(400, "Bitte die Art wählen.", "art"));
    const e = b.einstellungen || alt.einstellungen || {};
    return {
      art, titel: b.titel !== undefined ? pflicht(b.titel, 160, "Bitte einen Titel eingeben.", "titel") : alt.titel,
      beschreibung: b.beschreibung !== undefined ? text(b.beschreibung, 4000) : alt.beschreibung || "",
      fragen: b.fragen !== undefined ? fragenLesen(b.fragen, art) : alt.fragen || [],
      einstellungen: { anonym: art === "umfrage" && !!e.anonym, mehrfach: art === "quiz" ? e.mehrfach !== false : !!e.mehrfach, loesungen: e.loesungen !== false, oeffentlich: art !== "quiz" && !!e.oeffentlich },
      schliesst_am: b.schliesst_am !== undefined ? optZeitpunkt(b.schliesst_am, "schliesst_am") : alt.schliesst_am || null,
    };
  };
  app.post("/api/formulare", geschuetzt(async (req, res, q) => {
    const uid = optId(req.body.unterricht_id);
    pruefe(req.ctx, "formular.verwalten", { unterrichtId: uid });
    const d = daten(req.body || {});
    if (d.art === "quiz" && !uid) fehler(400, "Ein Quiz gehört zu einem Unterricht.", "unterricht_id");
    const [f] = await q(`INSERT INTO formular (erstellt_von, unterricht_id, art, titel, beschreibung, fragen, einstellungen, schliesst_am) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.ctx.personId, uid, d.art, d.titel, d.beschreibung, JSON.stringify(d.fragen), d.einstellungen, d.schliesst_am]);
    return f;
  }));
  app.put("/api/formulare/:id", geschuetzt(async (req, res, q) => {
    const f0 = await formularLaden(q, req.params.id);
    if (!verwaltet(req.ctx, f0)) fehler(403, "Dafür fehlt Ihnen die Berechtigung.");
    const d = daten(req.body || {}, f0);
    const [{ n }] = await q("SELECT count(*)::int AS n FROM formular_antwort WHERE formular_id = $1", [f0.id]);
    // Mit Antworten dürfen Fragen nicht mehr wegfallen oder den Typ wechseln (sonst passt die Auswertung nicht mehr)
    if (n && req.body.fragen !== undefined) for (const alt of f0.fragen) { const neu = d.fragen.find((x) => x.id === alt.id); if (!neu || neu.typ !== alt.typ) fehler(409, "Es gibt schon Antworten. Fragen lassen sich nicht mehr entfernen oder in einen anderen Typ ändern.", "fragen"); }
    const [f] = await q("UPDATE formular SET titel=$1, beschreibung=$2, fragen=$3, einstellungen=$4, schliesst_am=$5 WHERE id=$6 RETURNING *",
      [d.titel, d.beschreibung, JSON.stringify(d.fragen), d.einstellungen, d.schliesst_am, f0.id]);
    return f;
  }));
  app.post("/api/formulare/:id/status", geschuetzt(async (req, res, q) => {
    const f = await formularLaden(q, req.params.id);
    if (!verwaltet(req.ctx, f)) fehler(403, "Dafür fehlt Ihnen die Berechtigung.");
    const s = ["offen", "geschlossen"].includes(req.body.status) ? req.body.status : fehler(400, "Ungültiger Status.");
    if (s === "offen" && !f.fragen.length) fehler(400, "Das Formular hat noch keine Fragen.");
    if (s === "offen" && f.schliesst_am && new Date(f.schliesst_am) < new Date()) fehler(400, "Das Schlussdatum liegt in der Vergangenheit.", "schliesst_am");
    await q("UPDATE formular SET status = $1 WHERE id = $2", [s, f.id]);
    // Beim ersten Öffnen: die Klasse erhält eine Mitteilung
    if (s === "offen" && f.status === "entwurf" && f.unterricht_id) {
      const u = await unterrichtLaden(q, f.unterricht_id);
      await mitteilen(q, (await schuelerVon(q, u)).map((x) => x.id), { art: "formular", titel: `${FORMULAR_ARTEN[f.art]} in ${u.fach}: ${f.titel}`, link: `/formulare/${f.id}`, schluessel: `formular:${f.id}` });
    }
    return { ok: true };
  }));
  app.delete("/api/formulare/:id", geschuetzt(async (req, res, q) => {
    const f = await formularLaden(q, req.params.id);
    if (!verwaltet(req.ctx, f)) fehler(403, "Dafür fehlt Ihnen die Berechtigung.");
    await q("DELETE FROM formular WHERE id = $1", [f.id]);
    await protokolliere(q, req, "formular.geloescht", "formular", f.id, { titel: f.titel });
    return { ok: true };
  }));

  /* ---------- Ansicht: Verwaltung (mit Auswertung) oder Teilnahme ---------- */
  app.get("/api/formulare/:id", geschuetzt(async (req, res, q) => {
    const f = await formularLaden(q, req.params.id);
    if (verwaltet(req.ctx, f)) {
      const antworten = await q(`SELECT a.id, a.person_id, a.name, a.email, a.antworten, a.punkte, a.max_punkte, a.erstellt_am, p.vorname, p.nachname
        FROM formular_antwort a LEFT JOIN person p ON p.id = a.person_id WHERE a.formular_id = $1 ORDER BY a.erstellt_am`, [f.id]);
      let fehlen = [];
      if (f.unterricht_id && f.status !== "entwurf") {
        const u = await unterrichtLaden(q, f.unterricht_id);
        const t = new Set((await q("SELECT person_id FROM formular_teilnahme WHERE formular_id = $1", [f.id])).map((r) => r.person_id));
        fehlen = (await schuelerVon(q, u)).filter((s) => !t.has(s.id));
      }
      const anonym = f.einstellungen.anonym;
      return { formular: f, verwalten: true, auswertung: formularAuswerten(f.fragen, antworten), belegt: await belegung(q, f),
        antworten: anonym ? [] : antworten.map((a) => ({ ...a, wer: a.vorname ? `${a.vorname} ${a.nachname}` : a.name || "ohne Namen" })),
        anzahl: antworten.length, fehlen: anonym ? fehlen.length : fehlen, link: `/f/${f.token}` };
    }
    if (!teilnehmen(req.ctx, f) || f.status === "entwurf") fehler(404, "Formular nicht gefunden.");
    const [t] = await q("SELECT anzahl FROM formular_teilnahme WHERE formular_id = $1 AND person_id = $2", [f.id, req.ctx.personId]);
    // Bisherige Quiz-Versuche (eigene)
    const versuche = f.art === "quiz" ? await q("SELECT punkte, max_punkte, erstellt_am FROM formular_antwort WHERE formular_id = $1 AND person_id = $2 ORDER BY erstellt_am DESC LIMIT 10", [f.id, req.ctx.personId]) : [];
    return { formular: oeffentlichSicht(f, await belegung(q, f)), verwalten: false, erledigt: !!t, mehrfach: !!f.einstellungen.mehrfach, anonym: !!f.einstellungen.anonym, versuche };
  }));
  app.post("/api/formulare/:id/antworten", geschuetzt(async (req, res, q) => {
    const f = await formularLaden(q, req.params.id);
    if (!teilnehmen(req.ctx, f)) fehler(403, "Dieses Formular ist nicht für Sie.");
    return antwortSpeichern(q, f, { personId: req.ctx.personId, roh: req.body && req.body.antworten });
  }));
  app.delete("/api/formular-antworten/:id", geschuetzt(async (req, res, q) => {
    const [a] = await q("SELECT a.id, a.formular_id FROM formular_antwort a WHERE a.id = $1", [id(req.params.id)]);
    if (!a) fehler(404, "Antwort nicht gefunden.");
    const f = await formularLaden(q, a.formular_id);
    if (!verwaltet(req.ctx, f)) fehler(403, "Dafür fehlt Ihnen die Berechtigung.");
    await q("DELETE FROM formular_antwort WHERE id = $1", [a.id]);
    return { ok: true };
  }));
  // Antworten als CSV (Excel öffnet sie mit Semikolon und BOM richtig)
  app.get("/api/formulare/:id/csv", geschuetzt(async (req, res, q) => {
    const f = await formularLaden(q, req.params.id);
    if (!verwaltet(req.ctx, f)) fehler(403, "Dafür fehlt Ihnen die Berechtigung.");
    const rows = await q("SELECT a.*, p.vorname, p.nachname FROM formular_antwort a LEFT JOIN person p ON p.id = a.person_id WHERE a.formular_id = $1 ORDER BY a.erstellt_am", [f.id]);
    const zelle = (v) => { const s = Array.isArray(v) ? v.join(", ") : v && typeof v === "object" ? JSON.stringify(v) : String(v ?? ""); return /[;"\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : s; };
    const optText = (fr, v) => (fr.inhalt.optionen ? (Array.isArray(v) ? v : [v]).map((x) => (fr.inhalt.optionen.find((o) => o.id === x) || {}).text || x) : v);
    const kopf = ["Zeit", "Name", "E-Mail", ...(f.art === "quiz" ? ["Punkte"] : []), ...f.fragen.map((x) => x.inhalt.frage || x.id)];
    const zeilen = rows.map((r) => [new Date(r.erstellt_am).toLocaleString("de-CH", { timeZone: "Europe/Zurich" }), f.einstellungen.anonym ? "" : r.vorname ? `${r.vorname} ${r.nachname}` : r.name || "", f.einstellungen.anonym ? "" : r.email || "",
      ...(f.art === "quiz" ? [r.punkte] : []), ...f.fragen.map((x) => optText(x, r.antworten[x.id]))]);
    res.header("Content-Type", "text/csv; charset=utf-8");
    res.header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(f.titel.replace(/[^\p{L}\p{N} _-]/gu, "") + ".csv")}`);
    return "﻿" + [kopf, ...zeilen].map((z) => z.map(zelle).join(";")).join("\r\n");
  }));

  /* ---------- Öffentlicher Link (ohne Anmeldung) ---------- */
  const viaLink = async (token, fn) => {
    if (!/^[0-9a-f]{24}$/.test(String(token || ""))) fehler(404, "Dieses Formular gibt es nicht.");
    const { rows } = await sql("SELECT * FROM formular_oeffentlich($1)", [token]);
    if (!rows[0]) fehler(404, "Dieses Formular gibt es nicht.");
    return mitSchule(rows[0].schule_id, async (q) => {
      const [f] = await q("SELECT * FROM formular WHERE id = $1", [rows[0].formular_id]);
      const [s] = await q("SELECT name FROM schule");
      return fn(q, f, s);
    });
  };
  app.get("/api/f/:token", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) =>
    viaLink(req.params.token, async (q, f, s) => {
      if (f.status === "entwurf") fehler(404, "Dieses Formular gibt es nicht.");
      return { schule: s.name, formular: oeffentlichSicht(f, await belegung(q, f)) };
    }));
  app.post("/api/f/:token", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) =>
    viaLink(req.params.token, async (q, f) => {
      const b = req.body || {};
      const anonym = f.art === "umfrage" && f.einstellungen.anonym;
      const nameV = anonym ? null : pflicht(b.name, 120, "Bitte Ihren Namen angeben.", "name");
      const email = anonym || !b.email ? null : (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(b.email).trim()) ? String(b.email).trim().slice(0, 200) : fehler(400, "Die E-Mail-Adresse stimmt nicht.", "email"));
      if (f.art === "quiz") fehler(403, "Ein Quiz füllen Sie nach der Anmeldung aus.");
      // Doppelte Anmeldung unter derselben E-Mail verhindern (ausser mehrfach erlaubt)
      if (email && !f.einstellungen.mehrfach) { const [d] = await q("SELECT 1 FROM formular_antwort WHERE formular_id = $1 AND lower(email) = lower($2)", [f.id, email]); if (d) fehler(409, "Unter dieser E-Mail-Adresse gibt es schon eine Antwort.", "email"); }
      return antwortSpeichern(q, f, { name: nameV, email, roh: b.antworten });
    }));
}
