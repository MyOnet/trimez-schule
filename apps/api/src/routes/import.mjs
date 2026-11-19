// Import von Klassenlisten (CSV oder Excel). Zwei Schritte: Vorschau (nichts wird geändert), dann Ausführen.
// Erkannte Spalten: Nachname, Vorname, E-Mail, Klasse, Rolle, Nummer (aus der Schulverwaltung), Kürzel.
import Papa from "papaparse";
import ExcelJS from "exceljs";
import { geschuetzt } from "../sitzung.mjs";
import { fehler } from "../fehler.mjs";
import { protokolliere } from "../protokoll.mjs";
import { pruefe } from "@schule/shared";

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "");
const SPALTEN = {
  nachname: ["nachname", "name", "familienname", "nom"],
  vorname: ["vorname", "rufname", "prenom"],
  email: ["email", "mail", "emailadresse", "emailschule", "upn"],
  klasse: ["klasse", "klassenbezeichnung", "classe"],
  rolle: ["rolle", "funktion", "typ"],
  nummer: ["nummer", "id", "schuelernummer", "schulernummer", "personennummer", "extern", "externid", "nr"],
  kuerzel: ["kuerzel", "kurzel", "lehrerkuerzel"],
};
const ROLLE = (x) => { const n = norm(x); return /lehr|lp|teacher/.test(n) ? "lehrperson" : /schulleit/.test(n) ? "schulleitung" : /admin/.test(n) ? "admin" : "schueler"; };
const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

async function lesen(datei, name) {
  if (/\.xlsx$/i.test(name)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(datei);
    const ws = wb.worksheets[0];
    if (!ws) fehler(400, "Die Excel-Datei ist leer.");
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (r) => rows.push(r.values.slice(1).map((v) => (v && typeof v === "object" ? (v.text || v.result || (v.hyperlink ? String(v.text || v.hyperlink).replace(/^mailto:/, "") : "")) : v == null ? "" : String(v)))));
    return rows;
  }
  const text = datei.toString("utf8").replace(/^﻿/, "");
  const r = Papa.parse(text, { skipEmptyLines: true, delimiter: "" }); // erkennt ; , und Tab
  return r.data;
}

function zuordnen(rows) {
  if (rows.length < 2) fehler(400, "In der Datei gibt es keine Zeilen unter der Überschrift.");
  const kopf = rows[0].map(norm);
  const idx = {};
  for (const [feld, namen] of Object.entries(SPALTEN)) { const i = kopf.findIndex((k) => namen.includes(k)); if (i >= 0) idx[feld] = i; }
  if (idx.nachname == null || idx.vorname == null) fehler(400, "Spalten «Nachname» und «Vorname» nicht gefunden. Bitte die erste Zeile als Überschrift verwenden.");
  return { idx, kopf: rows[0], zeilen: rows.slice(1, 2001).map((r, n) => {
    const g = (f) => (idx[f] == null ? "" : String(r[idx[f]] || "").trim());
    const z = { zeile: n + 2, nachname: g("nachname"), vorname: g("vorname"), email: g("email").toLowerCase(), klasse: g("klasse"), rolle: idx.rolle == null ? "schueler" : ROLLE(g("rolle")), nummer: g("nummer"), kuerzel: g("kuerzel") };
    z.fehler = !z.nachname || !z.vorname ? "Name fehlt" : z.email && !EMAIL.test(z.email) ? "E-Mail ungültig" : z.klasse.length > 12 ? "Klassenname zu lang" : null;
    return z;
  }) };
}

export default async function (app) {
  app.post("/api/import/vorschau", geschuetzt(async (req, res, q) => {
    pruefe(req.ctx, "import.ausfuehren");
    const f = await req.file({ limits: { fileSize: 5 * 1024 * 1024 } });
    if (!f || !/\.(csv|txt|xlsx)$/i.test(f.filename)) fehler(400, "Bitte eine CSV- oder Excel-Datei (.xlsx) wählen.");
    const { idx, zeilen } = zuordnen(await lesen(await f.toBuffer(), f.filename));
    // Abgleich mit vorhandenen Personen (Nummer, sonst E-Mail)
    const vorhanden = await q("SELECT id, email, extern_id FROM person WHERE status = 'aktiv'");
    const nachNr = new Map(vorhanden.filter((p) => p.extern_id).map((p) => [p.extern_id, p.id]));
    const nachMail = new Map(vorhanden.filter((p) => p.email).map((p) => [p.email, p.id]));
    for (const z of zeilen) z.aktion = z.fehler ? "fehler" : (z.nummer && nachNr.has(z.nummer)) || (z.email && nachMail.has(z.email)) ? "aktualisieren" : "neu";
    const klassen = [...new Set(zeilen.filter((z) => !z.fehler && z.klasse).map((z) => z.klasse))].sort();
    return { spalten: Object.keys(idx), zeilen, klassen, zusammenfassung: { neu: zeilen.filter((z) => z.aktion === "neu").length, aktualisieren: zeilen.filter((z) => z.aktion === "aktualisieren").length, fehler: zeilen.filter((z) => z.fehler).length } };
  }));

  app.post("/api/import/ausfuehren", geschuetzt(async (req, res, q) => {
    pruefe(req.ctx, "import.ausfuehren");
    const jahr = String(req.body && req.body.schuljahr_id || "");
    const [j] = await q("SELECT id FROM schuljahr WHERE id = $1", [/^[0-9a-f-]{36}$/.test(jahr) ? jahr : null]);
    if (!j) fehler(400, "Bitte ein Schuljahr wählen.");
    const zeilen = (Array.isArray(req.body.zeilen) ? req.body.zeilen : []).slice(0, 2000).filter((z) => z && !z.fehler);
    const klassenId = new Map((await q("SELECT id, name FROM klasse WHERE schuljahr_id = $1", [j.id])).map((k) => [k.name, k.id]));
    let neu = 0, aktualisiert = 0, neueKlassen = 0;
    for (const z of zeilen) {
      const s = (v, n) => String(v || "").trim().slice(0, n) || null;
      const email = s(z.email, 200) && EMAIL.test(z.email) ? z.email.toLowerCase() : null;
      const [p0] = await q("SELECT id FROM person WHERE status = 'aktiv' AND ((extern_id IS NOT NULL AND extern_id = $1) OR (email IS NOT NULL AND email = $2)) LIMIT 1", [s(z.nummer, 40), email]);
      let pid;
      if (p0) { await q("UPDATE person SET vorname=$1, nachname=$2, email=coalesce($3,email), extern_id=coalesce($4,extern_id), kuerzel=coalesce($5,kuerzel) WHERE id=$6", [s(z.vorname, 60), s(z.nachname, 60), email, s(z.nummer, 40), s(z.kuerzel, 6), p0.id]); pid = p0.id; aktualisiert++; }
      else { pid = (await q("INSERT INTO person (vorname, nachname, email, extern_id, kuerzel) VALUES ($1,$2,$3,$4,$5) RETURNING id", [s(z.vorname, 60), s(z.nachname, 60), email, s(z.nummer, 40), s(z.kuerzel, 6)]))[0].id; neu++; }
      const rolle = ["schueler", "lehrperson", "schulleitung", "admin"].includes(z.rolle) ? z.rolle : "schueler";
      await q("INSERT INTO rolle (person_id, art) VALUES ($1,$2) ON CONFLICT DO NOTHING", [pid, rolle]);
      const kname = s(z.klasse, 12);
      if (kname && rolle === "schueler") {
        if (!klassenId.has(kname)) { const st = Number((kname.match(/^\d/) || [])[0]) || null; klassenId.set(kname, (await q("INSERT INTO klasse (schuljahr_id, name, stufe) VALUES ($1,$2,$3) RETURNING id", [j.id, kname, st >= 1 && st <= 6 ? st : null]))[0].id); neueKlassen++; }
        await q("INSERT INTO klasse_schueler (klasse_id, person_id, von) VALUES ($1,$2,current_date) ON CONFLICT DO NOTHING", [klassenId.get(kname), pid]);
      }
    }
    await protokolliere(q, req, "import.ausgefuehrt", "schuljahr", j.id, null, { neu, aktualisiert, neueKlassen });
    return { neu, aktualisiert, neueKlassen };
  }));
}
