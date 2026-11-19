// Prüfungen durchführen (im Browser) und korrigieren.
//   Lehrperson: starten (Code), Aufsicht, Zuschlag, beenden, korrigieren, ins Notenbuch übernehmen, zurückgeben.
//   Schüler/in: mit Code beitreten, Antworten laufend speichern (auch nach Verbindungsunterbruch), abgeben mit Quittung,
//               Ergebnis ansehen, sobald die Lehrperson die Korrektur zurückgibt.
// Lösungen verlassen den Server nie, solange die Prüfung läuft.
import crypto from "node:crypto";
import { geschuetzt } from "../sitzung.mjs";
import { fehler } from "../fehler.mjs";
import { protokolliere } from "../protokoll.mjs";
import { darf, fuerSchueler, bewerten, punkteZuNote, auswerten } from "@schule/shared";
import { konfigWert, DOWNLOAD } from "../lernumgebung.mjs";

const id = (x) => (/^[0-9a-f-]{36}$/.test(String(x || "")) ? x : fehler(400, "Ungültige Kennung."));
const KULANZ_MS = 60_000; // nach Ablauf der Zeit werden Antworten noch eine Minute angenommen (Netz, Uhr)
const r2 = (x) => Math.round(x * 100) / 100;

// Code ohne leicht verwechselbare Zeichen (0/O, 1/I/L)
function neuerCode() { const z = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; let s = ""; for (const b of crypto.randomBytes(6)) s += z[b % z.length]; return s; }

async function pruefungFuerLp(q, ctx, pid) {
  const [p] = await q(`SELECT p.*, k.name AS klasse, k.id AS klasse_id, f.name AS fach, f.farbe, u.gruppe FROM pruefung p
    JOIN unterricht u ON u.id = p.unterricht_id JOIN klasse k ON k.id = u.klasse_id JOIN fach f ON f.id = u.fach_id WHERE p.id = $1`, [id(pid)]);
  if (!p || !darf(ctx, "pruefung.verwalten", { unterrichtId: p.unterricht_id })) fehler(404, "Prüfung nicht gefunden.");
  return p;
}
const teileVon = (q, pid) => q("SELECT id, nr, typ, inhalt, loesung, punkte FROM pruefung_teil WHERE pruefung_id = $1 ORDER BY nr", [pid]);
export const schuelerVon = (q, uid) => q(`SELECT p.id, p.vorname, p.nachname FROM person p WHERE p.status = 'aktiv' AND p.id IN (
    SELECT us.person_id FROM unterricht_schueler us WHERE us.unterricht_id = $1
    UNION SELECT ks.person_id FROM klasse_schueler ks JOIN unterricht u ON u.klasse_id = ks.klasse_id AND u.gruppe = '' WHERE u.id = $1 AND (ks.bis IS NULL OR ks.bis >= current_date))
  ORDER BY p.nachname, p.vorname`, [uid]);
const endetAm = (p, v) => (p.dauer_min && p.gestartet_am ? new Date(new Date(p.gestartet_am).getTime() + (p.dauer_min + (v ? v.zuschlag_min : 0)) * 60000) : null);
const beantwortet = (v) => Object.values(v.antworten || {}).filter((w) => w !== "" && w != null && !(Array.isArray(w) && !w.some((x) => x !== "" && x != null)) && !(typeof w === "object" && !Array.isArray(w) && !Object.values(w).some(Boolean))).length;

function abgabeHash(v, abgegebenAm) {
  const sortiert = Object.keys(v.antworten || {}).sort().map((k) => [k, v.antworten[k]]);
  return crypto.createHash("sha256").update(JSON.stringify({ versuch: v.id, abgegeben_am: abgegebenAm, antworten: sortiert })).digest("hex");
}
async function abgeben(q, v, art) {
  const jetzt = new Date().toISOString();
  const h = abgabeHash(v, jetzt);
  const [n] = await q("UPDATE versuch SET status = 'abgegeben', abgegeben_am = $1, abgabe_art = $2, abgabe_hash = $3 WHERE id = $4 AND status = 'laeuft' RETURNING *", [jetzt, art, h, v.id]);
  return n || v;
}
// Zeit abgelaufen? Dann automatisch abgeben
async function zeitPruefen(q, p, v) {
  const e = endetAm(p, v);
  if (v.status === "laeuft" && (p.status !== "laeuft" || (e && Date.now() > e.getTime() + KULANZ_MS))) return abgeben(q, v, p.status !== "laeuft" ? "lehrperson" : "zeit");
  return v;
}

async function versuchFuerSchueler(q, ctx, vid) {
  const [v] = await q("SELECT * FROM versuch WHERE id = $1 AND schueler_id = $2", [id(vid), ctx.personId]);
  if (!v) fehler(404, "Prüfung nicht gefunden.");
  const [p] = await q(`SELECT p.*, k.name AS klasse, f.name AS fach FROM pruefung p JOIN unterricht u ON u.id = p.unterricht_id JOIN klasse k ON k.id = u.klasse_id JOIN fach f ON f.id = u.fach_id WHERE p.id = $1`, [v.pruefung_id]);
  return { v: await zeitPruefen(q, p, v), p };
}
/* ---------- Lernumgebung ---------- */
const brauchtLu = (p, v) => p.einstellungen.modus === "lernumgebung" || (v && v.modus === "gesperrt");
// Was die App durchsetzen muss: erlaubte Seiten und Werkzeuge. Der Prüfwert kommt bei jeder Anfrage zurück.
const luKonfig = (p) => ({ pruefung: p.id, seiten: (p.einstellungen.seiten || []).map((x) => x.url).sort(), rechner: !!p.einstellungen.rechner });
// Gibt eine Antwort zurück, wenn die Anfrage nicht aus einer gültigen, gesperrten Lernumgebung kommt (sonst null).
// Die Warnung wird gespeichert (darum kein Fehler, der die Transaktion zurückrollen würde).
async function luSperre(q, req, res, p, v) {
  if (!brauchtLu(p, v)) return null;
  const lu = req.lu;
  let grund = null;
  if (!lu) grund = "Diese Prüfung kann nur in der trimez. Lernumgebung geschrieben werden.";
  else if (!lu.gueltig) grund = `Die Lernumgebung wurde nicht erkannt (${lu.grund}). Bitte die aktuelle Version installieren.`;
  else if (!lu.gesperrt) grund = "Die Lernumgebung ist nicht gesperrt. Bitte neu starten.";
  // Windows: Prüfungen nur auf dem eigenen Desktop der Lernumgebung (wie Safe Exam Browser); abschaltbar für Notfälle
  else if (lu.plattform === "windows" && process.env.LERNUMGEBUNG_WINDOWS_DESKTOP !== "aus" && !lu.sperren.includes("desktop")) grund = "Die Lernumgebung konnte keinen eigenen Desktop öffnen. Bitte die App schliessen und neu starten.";
  // Mit Code-Signatur: nur unveränderte, signierte Apps (einschalten, sobald die Versionen signiert sind)
  else if (process.env.LERNUMGEBUNG_SIGNATUR === "pflicht" && !lu.sperren.includes("signiert")) grund = "Diese Lernumgebung ist nicht original signiert. Bitte die App von der Schule neu herunterladen.";
  else if (v && v.geraet_id && v.geraet_id !== lu.geraet) grund = "Diese Prüfung wurde auf einem anderen Gerät begonnen. Die Lehrperson kann sie freigeben.";
  if (!grund) return null;
  if (v && v.status === "laeuft") await q("INSERT INTO versuch_warnung (versuch_id, art, detail) VALUES ($1, 'ohne_lernumgebung', $2)", [v.id, (lu ? `${lu.plattform} ${lu.version}: ${lu.grund || "nicht gesperrt / anderes Gerät"}` : "Anfrage aus einem normalen Browser").slice(0, 200)]);
  // Achtung: Die Antwort von Fastify ist «thenable»; darum true zurückgeben, nicht die Antwort selbst
  res.status(403).send({ fehler: grund, feld: "lernumgebung", download: DOWNLOAD });
  return true;
}
const metaFuerSchueler = (p) => ({ id: p.id, titel: p.titel, fach: p.fach, klasse: p.klasse, datum: p.datum, dauer_min: p.dauer_min, status: p.status,
  einstellungen: { hinweise: p.einstellungen.hinweise, hilfsmittel: p.einstellungen.hilfsmittel, rueckwaerts: p.einstellungen.rueckwaerts !== false,
    rechner: !!p.einstellungen.rechner, seiten: p.einstellungen.seiten || [], modus: p.einstellungen.modus === "lernumgebung" ? "lernumgebung" : "browser" } });
const quittung = (v, n) => ({ abgegeben_am: v.abgegeben_am, abgabe_art: v.abgabe_art, hash: v.abgabe_hash, beantwortet: beantwortet(v), aufgaben: n });

// Reihenfolge nicht verändert = die angezeigte (gemischte) Reihenfolge gilt als Antwort, wie auf dem Bildschirm
function mitStandard(teile, v) {
  const a = { ...(v.antworten || {}) };
  for (const t of teile) if (t.typ === "reihenfolge" && !Array.isArray(a[t.id])) a[t.id] = fuerSchueler(t, v.id).inhalt.elemente.map((e) => e.id);
  return a;
}
// Punkte pro Teil: Korrektur der Lehrperson, sonst automatisch
function ergebnisse(teile, v0, korr) {
  const v = { ...v0, antworten: mitStandard(teile, v0) };
  const out = {}; let total = 0, offen = 0;
  for (const t of teile) {
    if (t.typ === "abschnitt") continue;
    const auto = bewerten(t, (v.antworten || {})[t.id]);
    const k = korr.find((x) => x.versuch_id === v.id && x.teil_id === t.id);
    const punkte = k && k.punkte != null ? Number(k.punkte) : auto.punkte;
    const manuell = !!(k && k.punkte != null);
    out[t.id] = { punkte, auto: auto.punkte, automatisch: auto.automatisch, manuell, kommentar: k ? k.kommentar : "", offen: punkte == null || (!auto.automatisch && !manuell) };
    if (out[t.id].offen) offen++;
    if (punkte != null) total += punkte;
  }
  return { teile: out, punkte: r2(total), offen };
}

export default async function (app) {
  /* ========== Lehrperson: Durchführung ========== */
  app.post("/api/pruefungen/:id/starten", geschuetzt(async (req, res, q) => {
    const p = await pruefungFuerLp(q, req.ctx, req.params.id);
    if (p.status !== "bereit") fehler(409, p.status === "entwurf" ? "Markieren Sie die Prüfung zuerst als bereit." : "Diese Prüfung wurde schon gestartet.");
    let code; for (let k = 0; k < 10; k++) { code = neuerCode(); const [x] = await q("SELECT 1 FROM pruefung WHERE startcode = $1 AND status = 'laeuft'", [code]); if (!x) break; }
    await q("UPDATE pruefung SET status = 'laeuft', startcode = $1, gestartet_am = now() WHERE id = $2", [code, p.id]);
    await protokolliere(q, req, "pruefung.gestartet", "pruefung", p.id);
    return { ok: true, startcode: code };
  }));
  app.post("/api/pruefungen/:id/code-neu", geschuetzt(async (req, res, q) => {
    const p = await pruefungFuerLp(q, req.ctx, req.params.id);
    if (p.status !== "laeuft") fehler(409, "Die Prüfung läuft nicht.");
    const code = neuerCode(); await q("UPDATE pruefung SET startcode = $1 WHERE id = $2", [code, p.id]);
    return { startcode: code };
  }));
  app.get("/api/pruefungen/:id/aufsicht", geschuetzt(async (req, res, q) => {
    const p = await pruefungFuerLp(q, req.ctx, req.params.id);
    const teile = await teileVon(q, p.id); const aufgaben = teile.filter((t) => t.typ !== "abschnitt").length;
    let versuche = await q("SELECT * FROM versuch WHERE pruefung_id = $1", [p.id]);
    versuche = await Promise.all(versuche.map((v) => zeitPruefen(q, p, v)));
    const warn = await q(`SELECT w.versuch_id, count(*)::int AS n, max(w.zeit) AS zuletzt, (array_agg(w.art ORDER BY w.zeit DESC))[1] AS art
      FROM versuch_warnung w JOIN versuch v ON v.id = w.versuch_id WHERE v.pruefung_id = $1 GROUP BY w.versuch_id`, [p.id]);
    const schueler = (await schuelerVon(q, p.unterricht_id)).map((s) => {
      const v = versuche.find((x) => x.schueler_id === s.id), w = v && warn.find((x) => x.versuch_id === v.id);
      return { ...s, versuch: v ? { id: v.id, status: v.status, modus: v.modus, plattform: v.plattform, app_version: v.app_version, gestartet_am: v.gestartet_am, abgegeben_am: v.abgegeben_am, abgabe_art: v.abgabe_art, zuschlag_min: v.zuschlag_min,
        beantwortet: beantwortet(v), letzte_aktivitaet: v.letzte_aktivitaet, endet_am: endetAm(p, v), warnungen: w ? w.n : 0, warnung_art: w ? w.art : null, warnung_zuletzt: w ? w.zuletzt : null } : null };
    });
    return { id: p.id, titel: p.titel, fach: p.fach, klasse: p.klasse, status: p.status, lernumgebung: p.einstellungen.modus === "lernumgebung", startcode: p.status === "laeuft" ? p.startcode : null,
      gestartet_am: p.gestartet_am, beendet_am: p.beendet_am, dauer_min: p.dauer_min, endet_am: endetAm(p, null), jetzt: new Date(), aufgaben, schueler };
  }));
  // Auffälligkeiten: Hinweise für die Aufsicht (keine Beweise), aus Eingaben, Zeiten, Warnungen und dem Vergleich der Antworten
  app.get("/api/pruefungen/:id/auffaelligkeiten", geschuetzt(async (req, res, q) => {
    const p = await pruefungFuerLp(q, req.ctx, req.params.id);
    const aufgaben = (await teileVon(q, p.id)).filter((t) => t.typ !== "abschnitt");
    const versuche = await q(`SELECT v.id, v.gestartet_am, v.abgegeben_am, v.zuschlag_min, v.antworten, s.vorname || ' ' || s.nachname AS name
      FROM versuch v JOIN person s ON s.id = v.schueler_id WHERE v.pruefung_id = $1`, [p.id]);
    // Zeit des Geräts nur, wenn sie zur Zeit des Servers passt (offline gesammelte Eingaben); sonst die des Servers
    const ev = await q(`SELECT e.versuch_id, e.teil_id, e.wert, CASE WHEN e.zeit_geraet BETWEEN e.zeit_server - interval '10 minutes' AND e.zeit_server + interval '5 seconds' THEN e.zeit_geraet ELSE e.zeit_server END AS zeit FROM versuch_ereignis e
      JOIN versuch v ON v.id = e.versuch_id WHERE v.pruefung_id = $1 ORDER BY e.versuch_id, e.seq`, [p.id]);
    const wa = await q("SELECT w.versuch_id, w.art, w.detail, w.zeit FROM versuch_warnung w JOIN versuch v ON v.id = w.versuch_id WHERE v.pruefung_id = $1", [p.id]);
    for (const v of versuche) { v.ereignisse = ev.filter((e) => e.versuch_id === v.id); v.warnungen = wa.filter((w) => w.versuch_id === v.id); }
    const m = auswerten(p, aufgaben, versuche);
    return { hinweis: "Hinweise, keine Beweise. Jede Auffälligkeit kann eine harmlose Erklärung haben.",
      versuche: versuche.map((v) => ({ id: v.id, name: v.name, auffaelligkeiten: m.get(v.id) })).filter((v) => v.auffaelligkeiten.length).sort((a, b) => b.auffaelligkeiten.length - a.auffaelligkeiten.length) };
  }));
  const versuchFuerLp = async (q, ctx, vid) => {
    const [v] = await q("SELECT * FROM versuch WHERE id = $1", [id(vid)]);
    if (!v) fehler(404, "Nicht gefunden.");
    return { v, p: await pruefungFuerLp(q, ctx, v.pruefung_id) };
  };
  app.post("/api/versuche/:id/zuschlag", geschuetzt(async (req, res, q) => {
    const { v, p } = await versuchFuerLp(q, req.ctx, req.params.id);
    const m = Math.round(Number(req.body && req.body.minuten));
    if (!(m >= 0 && m <= 600)) fehler(400, "Zuschlag zwischen 0 und 600 Minuten.");
    await q("UPDATE versuch SET zuschlag_min = $1 WHERE id = $2", [m, v.id]);
    await protokolliere(q, req, "versuch.zuschlag", "versuch", v.id, { minuten: v.zuschlag_min }, { minuten: m });
    return { ok: true, endet_am: endetAm(p, { ...v, zuschlag_min: m }) };
  }));
  app.post("/api/versuche/:id/wieder-oeffnen", geschuetzt(async (req, res, q) => {
    const { v, p } = await versuchFuerLp(q, req.ctx, req.params.id);
    if (p.status !== "laeuft") fehler(409, "Die Prüfung ist beendet.");
    await q("UPDATE versuch SET status = 'laeuft', abgegeben_am = NULL, abgabe_art = NULL, abgabe_hash = NULL WHERE id = $1", [v.id]);
    await protokolliere(q, req, "versuch.wieder_geoeffnet", "versuch", v.id);
    return { ok: true };
  }));
  // Anderes Gerät erlauben (z. B. Akku leer): die nächste gültige Lernumgebung übernimmt den Versuch
  app.post("/api/versuche/:id/geraet-freigeben", geschuetzt(async (req, res, q) => {
    const { v } = await versuchFuerLp(q, req.ctx, req.params.id);
    await q("UPDATE versuch SET geraet_id = NULL WHERE id = $1", [v.id]);
    await protokolliere(q, req, "versuch.geraet_freigegeben", "versuch", v.id);
    return { ok: true };
  }));
  app.post("/api/versuche/:id/einziehen", geschuetzt(async (req, res, q) => {
    const { v } = await versuchFuerLp(q, req.ctx, req.params.id);
    await abgeben(q, v, "lehrperson");
    await protokolliere(q, req, "versuch.eingezogen", "versuch", v.id);
    return { ok: true };
  }));
  app.post("/api/pruefungen/:id/beenden", geschuetzt(async (req, res, q) => {
    const p = await pruefungFuerLp(q, req.ctx, req.params.id);
    if (p.status !== "laeuft") fehler(409, "Die Prüfung läuft nicht.");
    for (const v of await q("SELECT * FROM versuch WHERE pruefung_id = $1 AND status = 'laeuft'", [p.id])) await abgeben(q, v, "lehrperson");
    await q("UPDATE pruefung SET status = 'beendet', beendet_am = now(), startcode = NULL WHERE id = $1", [p.id]);
    await protokolliere(q, req, "pruefung.beendet", "pruefung", p.id);
    return { ok: true };
  }));

  /* ========== Lernumgebung: Info und Download ========== */
  app.get("/api/lernumgebung", geschuetzt(async (req) => ({
    download: DOWNLOAD,
    erkannt: req.lu ? { gueltig: req.lu.gueltig, grund: req.lu.grund || null, version: req.lu.version, plattform: req.lu.plattform, gesperrt: req.lu.gesperrt, sperren: req.lu.sperren } : null,
  }), { konto: true }));

  /* ========== Schüler/in ========== */
  app.get("/api/meine-pruefungen", geschuetzt(async (req, res, q) => {
    const uids = [...req.ctx.unterricht];
    const laufend = await q(`SELECT p.id, p.titel, p.dauer_min, p.gestartet_am, f.name AS fach, f.farbe, v.id AS versuch_id, v.status AS versuch_status
      FROM pruefung p JOIN unterricht u ON u.id = p.unterricht_id JOIN fach f ON f.id = u.fach_id
      LEFT JOIN versuch v ON v.pruefung_id = p.id AND v.schueler_id = $2
      WHERE p.unterricht_id = ANY($1) AND p.status = 'laeuft'`, [uids, req.ctx.personId]);
    const zurueck = await q(`SELECT p.id, p.titel, p.datum, p.zurueckgegeben_am, f.name AS fach, f.farbe, v.id AS versuch_id
      FROM versuch v JOIN pruefung p ON p.id = v.pruefung_id JOIN unterricht u ON u.id = p.unterricht_id JOIN fach f ON f.id = u.fach_id
      WHERE v.schueler_id = $1 AND p.status = 'zurueckgegeben' ORDER BY p.zurueckgegeben_am DESC LIMIT 30`, [req.ctx.personId]);
    return { laufend: req.ctx.rollen.has("schueler") ? laufend : [], zurueck };
  }));
  app.post("/api/pruefungen/beitreten", geschuetzt(async (req, res, q) => {
    const code = String((req.body && req.body.code) || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    if (code.length !== 6) fehler(400, "Der Code hat 6 Zeichen.", "code");
    const [p] = await q("SELECT * FROM pruefung WHERE startcode = $1 AND status = 'laeuft'", [code]);
    if (!p || !req.ctx.rollen.has("schueler") || !req.ctx.unterricht.has(p.unterricht_id)) fehler(404, "Zu diesem Code gibt es keine laufende Prüfung für Sie. Bitte den Code prüfen.", "code");
    let [v] = await q("SELECT * FROM versuch WHERE pruefung_id = $1 AND schueler_id = $2", [p.id, req.ctx.personId]);
    if (v && v.status === "abgegeben") fehler(409, "Sie haben diese Prüfung schon abgegeben. Wenn das ein Versehen war, kann die Lehrperson sie wieder öffnen.");
    const gesperrt = await luSperre(q, req, res, p, v); if (gesperrt) return res;
    const lu = req.lu && req.lu.gueltig ? req.lu : null;
    if (v) await q("INSERT INTO versuch_warnung (versuch_id, art, detail) VALUES ($1, 'neu_geladen', 'erneut mit Code begonnen')", [v.id]);
    else [v] = await q("INSERT INTO versuch (pruefung_id, schueler_id, modus, geraet_id, plattform, app_version) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
      [p.id, req.ctx.personId, lu && lu.gesperrt ? "gesperrt" : "browser", lu ? lu.geraet : null, lu ? lu.plattform : null, lu ? lu.version : null]);
    await protokolliere(q, req, "versuch.begonnen", "versuch", v.id);
    return { versuch_id: v.id };
  }));
  app.get("/api/versuche/:id", geschuetzt(async (req, res, q) => {
    const { v, p } = await versuchFuerSchueler(q, req.ctx, req.params.id);
    const teile = await teileVon(q, p.id);
    if (v.status === "abgegeben") return { status: "abgegeben", pruefung: metaFuerSchueler(p), quittung: quittung(v, teile.filter((t) => t.typ !== "abschnitt").length) };
    const gesperrt = await luSperre(q, req, res, p, v); if (gesperrt) return res;
    const k = luKonfig(p);
    return { status: v.status, pruefung: metaFuerSchueler(p), teile: teile.map((t) => fuerSchueler(t, v.id, { optionenMischen: !!p.einstellungen.mischen })),
      antworten: v.antworten, seq: v.seq, position: v.position, endet_am: endetAm(p, v), jetzt: new Date(), lernumgebung: { pflicht: brauchtLu(p, v), konfig: k, konfig_wert: konfigWert(k) } };
  }));
  app.post("/api/versuche/:id/antworten", geschuetzt(async (req, res, q) => {
    const { v, p } = await versuchFuerSchueler(q, req.ctx, req.params.id);
    if (v.status !== "laeuft") return res.status(409).send({ fehler: v.abgabe_art === "zeit" ? "Die Zeit ist abgelaufen. Ihre Antworten wurden abgegeben." : "Die Prüfung wurde abgegeben.", abgegeben: true });
    const gesperrt = await luSperre(q, req, res, p, v); if (gesperrt) return res;
    // Die App muss die aktuelle Konfiguration durchsetzen (z. B. nachdem die Lehrperson eine Seite erlaubt hat)
    if (brauchtLu(p, v) && req.lu.konfig !== konfigWert(luKonfig(p))) return res.status(409).send({ fehler: "Die Einstellungen der Prüfung haben sich geändert.", feld: "konfig", konfig_neu: true });
    const teile = await teileVon(q, p.id); const aufgaben = teile.filter((t) => t.typ !== "abschnitt");
    const eintraege = (Array.isArray(req.body && req.body.eintraege) ? req.body.eintraege : []).slice(0, 200).sort((a, b) => a.seq - b.seq);
    let seq = v.seq; const antworten = { ...v.antworten };
    for (const e of eintraege) {
      const s = Number(e.seq); if (!Number.isInteger(s) || s <= seq) continue; // schon gespeichert (z. B. erneut gesendet)
      const t = aufgaben.find((x) => x.id === e.teil_id); if (!t) continue;
      if (p.einstellungen.rueckwaerts === false && aufgaben.indexOf(t) < v.position) continue;
      const json = JSON.stringify(e.wert ?? null); if (json.length > 60000) fehler(413, "Diese Antwort ist zu lang.");
      const zeit = e.zeit && !isNaN(new Date(e.zeit)) ? new Date(e.zeit).toISOString() : null;
      await q("INSERT INTO versuch_ereignis (versuch_id, seq, teil_id, wert, zeit_geraet) VALUES ($1,$2,$3,$4,$5)", [v.id, s, t.id, json, zeit]);
      antworten[t.id] = e.wert ?? null; seq = s;
    }
    await q("UPDATE versuch SET antworten = $1, seq = $2, letzte_aktivitaet = now(), geraet_id = coalesce(geraet_id, $4) WHERE id = $3", [antworten, seq, v.id, req.lu && req.lu.gueltig && v.modus === "gesperrt" ? req.lu.geraet : null]);
    return { seq, gespeichert_am: new Date(), endet_am: endetAm(p, v), jetzt: new Date(), status: p.status };
  }));
  app.post("/api/versuche/:id/weiter", geschuetzt(async (req, res, q) => {
    const { v, p } = await versuchFuerSchueler(q, req.ctx, req.params.id);
    const gesperrt = await luSperre(q, req, res, p, v); if (gesperrt) return res;
    const pos = Math.max(v.position, Math.min(500, Number(req.body && req.body.position) | 0));
    await q("UPDATE versuch SET position = $1, letzte_aktivitaet = now() WHERE id = $2 AND status = 'laeuft'", [pos, v.id]);
    return { position: pos };
  }));
  app.post("/api/versuche/:id/warnung", geschuetzt(async (req, res, q) => {
    const { v } = await versuchFuerSchueler(q, req.ctx, req.params.id);
    // Meldungen der App (Programme, virtuelle Maschine, Aufnahme …) nur mit gültigem Nachweis
    const APP = ["prozess", "vm", "debugger", "aufnahme", "bildschirm", "sperre", "geraet", "fremder_code"];
    const roh = req.body && req.body.art;
    const art = ["fokus", "vollbild", "offline"].includes(roh) || (APP.includes(roh) && req.lu && req.lu.gueltig) ? roh : fehler(400, "Unbekannt.");
    if (v.status === "laeuft") await q("INSERT INTO versuch_warnung (versuch_id, art, detail) VALUES ($1,$2,$3)", [v.id, art, String(req.body.detail || "").slice(0, 200)]);
    return { ok: true };
  }));
  app.post("/api/versuche/:id/abgeben", geschuetzt(async (req, res, q) => {
    const { v: v0, p } = await versuchFuerSchueler(q, req.ctx, req.params.id);
    if (v0.status === "laeuft") { const gesperrt = await luSperre(q, req, res, p, v0); if (gesperrt) return res; }
    const v = v0.status === "laeuft" ? await abgeben(q, v0, "selbst") : v0;
    await protokolliere(q, req, "versuch.abgegeben", "versuch", v.id, null, { hash: v.abgabe_hash });
    const n = (await teileVon(q, p.id)).filter((t) => t.typ !== "abschnitt").length;
    return quittung(v, n);
  }));
  // Ergebnis: erst, wenn die Lehrperson die Korrektur zurückgegeben hat
  app.get("/api/versuche/:id/ergebnis", geschuetzt(async (req, res, q) => {
    const { v, p } = await versuchFuerSchueler(q, req.ctx, req.params.id);
    if (p.status !== "zurueckgegeben") fehler(404, "Die Korrektur ist noch nicht zurückgegeben.");
    const teile = await teileVon(q, p.id);
    const korr = await q("SELECT * FROM korrektur WHERE versuch_id = $1", [v.id]);
    const e = ergebnisse(teile, v, korr);
    const total = r2(teile.reduce((a, t) => a + Number(t.punkte), 0));
    const [s] = p.notenschluessel_id ? await q("SELECT art, parameter, rundung FROM notenschluessel WHERE id = $1", [p.notenschluessel_id]) : [null];
    return { pruefung: { ...metaFuerSchueler(p), einstellungen: p.einstellungen }, teile, antworten: mitStandard(teile, v), ergebnis: e, total,
      note: s && total ? punkteZuNote(e.punkte, total, s) : null, quittung: quittung(v, teile.filter((t) => t.typ !== "abschnitt").length) };
  }));

  /* ========== Korrektur ========== */
  async function korrekturDaten(q, p) {
    const teile = await teileVon(q, p.id);
    const versuche = await q("SELECT * FROM versuch WHERE pruefung_id = $1", [p.id]);
    const korr = versuche.length ? await q("SELECT * FROM korrektur WHERE versuch_id = ANY($1)", [versuche.map((v) => v.id)]) : [];
    const total = r2(teile.reduce((a, t) => a + Number(t.punkte), 0));
    const [s] = p.notenschluessel_id ? await q("SELECT id, name, art, parameter, rundung FROM notenschluessel WHERE id = $1", [p.notenschluessel_id]) : [null];
    const schueler = (await schuelerVon(q, p.unterricht_id)).map((x) => {
      const v = versuche.find((y) => y.schueler_id === x.id);
      if (!v) return { ...x, versuch: null };
      const e = ergebnisse(teile, v, korr);
      return { ...x, versuch: { id: v.id, status: v.status, abgegeben_am: v.abgegeben_am, abgabe_art: v.abgabe_art, antworten: mitStandard(teile, v), hash: v.abgabe_hash }, ...e,
        note: s && total ? punkteZuNote(e.punkte, total, s) : null };
    });
    return { teile, schueler, total, schluessel: s };
  }
  app.get("/api/pruefungen/:id/korrektur", geschuetzt(async (req, res, q) => {
    const p = await pruefungFuerLp(q, req.ctx, req.params.id);
    if (!["beendet", "zurueckgegeben", "laeuft"].includes(p.status)) fehler(409, "Die Prüfung wurde noch nicht durchgeführt.");
    const d = await korrekturDaten(q, p);
    let bewertung = null;
    if (p.bewertung_id) [bewertung] = await q("SELECT id, status, titel FROM bewertung WHERE id = $1", [p.bewertung_id]);
    return { pruefung: { id: p.id, titel: p.titel, fach: p.fach, klasse: p.klasse, status: p.status, datum: p.datum, unterricht_id: p.unterricht_id, notenschluessel_id: p.notenschluessel_id }, bewertung, ...d };
  }));
  app.put("/api/versuche/:id/korrektur/:tid", geschuetzt(async (req, res, q) => {
    const { v, p } = await versuchFuerLp(q, req.ctx, req.params.id);
    if (p.status === "laeuft" && v.status === "laeuft") fehler(409, "Diese Prüfung wird noch geschrieben.");
    const [t] = await q("SELECT id, punkte FROM pruefung_teil WHERE id = $1 AND pruefung_id = $2", [id(req.params.tid), p.id]);
    if (!t) fehler(404, "Aufgabe nicht gefunden.");
    const b = req.body || {};
    let punkte = b.punkte === null || b.punkte === "" || b.punkte === undefined ? null : Math.round(Number(String(b.punkte).replace(",", ".")) * 100) / 100;
    if (punkte !== null && !(punkte >= 0 && punkte <= Number(t.punkte))) fehler(400, `Punkte zwischen 0 und ${Number(t.punkte)}.`, "punkte");
    const kommentar = String(b.kommentar ?? "").slice(0, 4000);
    await q(`INSERT INTO korrektur (versuch_id, teil_id, punkte, kommentar, von) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (versuch_id, teil_id) DO UPDATE SET punkte = EXCLUDED.punkte, kommentar = EXCLUDED.kommentar, von = EXCLUDED.von, geaendert_am = now()`, [v.id, t.id, punkte, kommentar, req.ctx.personId]);
    return { ok: true };
  }));
  app.post("/api/pruefungen/:id/notenbuch", geschuetzt(async (req, res, q) => {
    const p = await pruefungFuerLp(q, req.ctx, req.params.id);
    if (!["beendet", "zurueckgegeben"].includes(p.status)) fehler(409, "Beenden Sie die Prüfung zuerst.");
    const d = await korrekturDaten(q, p);
    const offen = d.schueler.filter((s) => s.versuch && s.offen).length;
    if (offen) fehler(409, `Bei ${offen === 1 ? "einer Person" : offen + " Personen"} sind noch Aufgaben nicht korrigiert.`);
    let bid = p.bewertung_id;
    if (bid) {
      const [b] = await q("SELECT status FROM bewertung WHERE id = $1", [bid]);
      if (b && b.status === "freigegeben") fehler(409, "Die Noten sind im Notenbuch schon freigegeben. Ändern Sie sie dort (mit Begründung).");
      if (!b) bid = null;
    }
    const datum = p.datum || new Date().toISOString().slice(0, 10);
    if (!bid) {
      const [sem] = await q(`SELECT s.id FROM semester s JOIN klasse k ON k.schuljahr_id = s.schuljahr_id JOIN unterricht u ON u.klasse_id = k.id
        WHERE u.id = $1 ORDER BY ($2::date BETWEEN s.von AND s.bis) DESC, s.nr LIMIT 1`, [p.unterricht_id, datum]);
      if (!sem) fehler(400, "Für dieses Schuljahr sind keine Semester erfasst.");
      const [art] = await q("SELECT id FROM bewertungsart WHERE name = 'Prüfung' LIMIT 1");
      [{ id: bid }] = await q(`INSERT INTO bewertung (unterricht_id, semester_id, bewertungsart_id, kategorie, titel, datum, gewicht, max_punkte, notenschluessel_id, status, erstellt_von)
        VALUES ($1,$2,$3,'schriftlich',$4,$5,1,$6,$7,'entwurf',$8) RETURNING id`, [p.unterricht_id, sem.id, art ? art.id : null, p.titel.slice(0, 80), datum, d.total, p.notenschluessel_id, req.ctx.personId]);
      await q("UPDATE pruefung SET bewertung_id = $1 WHERE id = $2", [bid, p.id]);
    } else await q("UPDATE bewertung SET max_punkte = $1, notenschluessel_id = $2 WHERE id = $3", [d.total, p.notenschluessel_id, bid]);
    for (const s of d.schueler) {
      const werte = s.versuch ? [s.punkte, s.note, null] : [null, null, "abwesend"];
      await q(`INSERT INTO leistung (bewertung_id, schueler_id, punkte, note, kennzeichen, geaendert_von) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (bewertung_id, schueler_id) DO UPDATE SET punkte = EXCLUDED.punkte, note = EXCLUDED.note, kennzeichen = EXCLUDED.kennzeichen, geaendert_von = EXCLUDED.geaendert_von, geaendert_am = now()`,
        [bid, s.id, ...werte, req.ctx.personId]);
    }
    await protokolliere(q, req, "pruefung.ins_notenbuch", "pruefung", p.id, null, { bewertung_id: bid });
    return { ok: true, bewertung_id: bid };
  }));
  app.post("/api/pruefungen/:id/zurueckgeben", geschuetzt(async (req, res, q) => {
    const p = await pruefungFuerLp(q, req.ctx, req.params.id);
    if (p.status !== "beendet" && !(p.status === "zurueckgegeben" && req.body && req.body.zurueckziehen)) fehler(409, "Nur beendete Prüfungen können zurückgegeben werden.");
    if (req.body && req.body.zurueckziehen) { await q("UPDATE pruefung SET status = 'beendet', zurueckgegeben_am = NULL WHERE id = $1", [p.id]); return { ok: true }; }
    const d = await korrekturDaten(q, p);
    const offen = d.schueler.filter((s) => s.versuch && s.offen).length;
    if (offen) fehler(409, `Bei ${offen === 1 ? "einer Person" : offen + " Personen"} sind noch Aufgaben nicht korrigiert.`);
    await q("UPDATE pruefung SET status = 'zurueckgegeben', zurueckgegeben_am = now() WHERE id = $1", [p.id]);
    await protokolliere(q, req, "pruefung.zurueckgegeben", "pruefung", p.id);
    return { ok: true };
  }));
}
