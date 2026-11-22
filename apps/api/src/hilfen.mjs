// Gemeinsame Hilfen der Schulbetriebs-Module (Aufträge, Klassenraum, Formulare, Kalender, Absenzen, Ablage, Zeugnisse):
// Eingaben prüfen, Unterricht und Klasse laden, Mitteilungen verschicken, Dateien annehmen und ausliefern.
import crypto from "node:crypto";
import { fehler } from "./fehler.mjs";
import { speicher, neuerKey } from "./material/speicher.mjs";
import { dateiart, sauberName, inhaltPasst, MAX_GROESSE, INLINE } from "./material/dateien.mjs";

export const id = (x) => (/^[0-9a-f-]{36}$/.test(String(x || "")) ? String(x) : fehler(400, "Ungültige Kennung."));
export const optId = (x) => (x ? id(x) : null);
export const text = (x, max) => (x == null ? "" : String(x).trim().slice(0, max));
export const pflicht = (x, max, meldung, feld) => text(x, max) || fehler(400, meldung, feld);
export const datum = (x, feld = "datum") => (/^\d{4}-\d{2}-\d{2}$/.test(String(x || "")) && !isNaN(new Date(x)) ? String(x) : fehler(400, "Bitte ein gültiges Datum wählen.", feld));
export const optDatum = (x, feld) => (x ? datum(x, feld) : null);
export const zeitpunkt = (x, feld = "zeit") => { const d = new Date(x); return x && !isNaN(d) ? d.toISOString() : fehler(400, "Bitte Datum und Zeit angeben.", feld); };
export const optZeitpunkt = (x, feld) => (x ? zeitpunkt(x, feld) : null);
export function zahl(x, min, max, feld) {
  if (x === null || x === undefined || x === "") return null;
  const n = Number(String(x).replace(",", "."));
  if (!Number.isFinite(n) || n < min || n > max) fehler(400, `Wert ausserhalb ${min} bis ${max}.`, feld);
  return Math.round(n * 100) / 100;
}
export const heute = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Zurich" });

export async function unterrichtLaden(q, uid) {
  const [u] = await q(`SELECT u.id, u.gruppe, u.klasse_id, u.raum_schueler_schreiben, k.name AS klasse, k.schuljahr_id, k.klassenlehrperson_id,
      f.id AS fach_id, f.name AS fach, f.kuerzel, f.farbe
    FROM unterricht u JOIN klasse k ON k.id = u.klasse_id JOIN fach f ON f.id = u.fach_id WHERE u.id = $1`, [id(uid)]);
  if (!u) fehler(404, "Unterricht nicht gefunden.");
  return u;
}
/** Schülerinnen und Schüler eines Unterrichts (ganze Klasse oder Gruppe) */
export const schuelerVon = (q, u) => q(u.gruppe
  ? `SELECT p.id, p.vorname, p.nachname FROM unterricht_schueler us JOIN person p ON p.id = us.person_id WHERE us.unterricht_id = $1 AND p.status = 'aktiv' ORDER BY p.nachname, p.vorname`
  : `SELECT p.id, p.vorname, p.nachname FROM klasse_schueler ks JOIN person p ON p.id = ks.person_id WHERE ks.klasse_id = $1 AND p.status = 'aktiv' AND (ks.bis IS NULL OR ks.bis >= current_date) ORDER BY p.nachname, p.vorname`,
  [u.gruppe ? u.id : u.klasse_id]);
export const schuelerDerKlasse = (q, kid) => q(`SELECT p.id, p.vorname, p.nachname, p.geburtsdatum FROM klasse_schueler ks JOIN person p ON p.id = ks.person_id
  WHERE ks.klasse_id = $1 AND p.status = 'aktiv' AND (ks.bis IS NULL OR ks.bis >= current_date) ORDER BY p.nachname, p.vorname`, [kid]);
export const lehrpersonenVon = (q, uid) => q(`SELECT p.id, p.vorname, p.nachname, p.kuerzel FROM unterricht_lp ul JOIN person p ON p.id = ul.person_id
  WHERE ul.unterricht_id = $1 AND (ul.bis IS NULL OR ul.bis >= current_date) ORDER BY ul.art, p.nachname`, [uid]);
/** Klasse einer Schülerin, eines Schülers im aktiven Schuljahr */
export async function klasseVon(q, pid) {
  const [k] = await q(`SELECT k.id, k.name, k.klassenlehrperson_id, k.stufe FROM klasse_schueler ks JOIN klasse k ON k.id = ks.klasse_id JOIN schuljahr j ON j.id = k.schuljahr_id
    WHERE ks.person_id = $1 AND j.aktiv AND (ks.bis IS NULL OR ks.bis >= current_date) LIMIT 1`, [pid]);
  return k || null;
}
export const name = (p) => (p ? `${p.vorname} ${p.nachname}` : "");

/**
 * Mitteilung an Personen (Glocke). schluessel verhindert Doppelte (z. B. dieselbe Erinnerung zweimal am selben Tag).
 * link: Pfad innerhalb der Schule, z. B. «/auftraege/…»
 */
export async function mitteilen(q, personen, { art, titel, text: t = "", link = null, schluessel = null }) {
  let n = 0;
  for (const pid of new Set(personen.filter(Boolean))) {
    const r = await q(`INSERT INTO mitteilung (person_id, art, titel, text, link, schluessel) VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (person_id, schluessel) WHERE schluessel IS NOT NULL DO NOTHING RETURNING id`, [pid, art, String(titel).slice(0, 200), String(t).slice(0, 1000), link, schluessel]);
    n += r.length;
  }
  return n;
}

/* ---------- Dateien ---------- */
/** Multipart: eine Datei plus Felder */
export async function dateiLesen(req) {
  const felder = {}; let datei = null;
  if (!req.isMultipart || !req.isMultipart()) fehler(400, "Bitte eine Datei wählen.");
  for await (const part of req.parts({ limits: { fileSize: MAX_GROESSE, files: 1 } })) {
    if (part.type === "file") {
      const buf = await part.toBuffer();
      if (part.file.truncated) fehler(413, "Die Datei ist grösser als 50 MB.");
      datei = { buf, name: sauberName(part.filename) };
    } else felder[part.fieldname] = part.value;
  }
  if (!datei) fehler(400, "Bitte eine Datei wählen.");
  return { felder, datei };
}
/** Datei prüfen, verschlüsselt ablegen und in «datei» eintragen */
export async function dateiSpeichern(q, req, { bezugTyp, bezugId, ordnerId = null }, datei) {
  const a = dateiart(datei.name);
  if (!a) fehler(415, "Diese Dateiart ist nicht erlaubt. Erlaubt sind z. B. PDF, Word, PowerPoint, Excel, Bilder, Audio und Video.", "datei");
  if (!datei.buf.length) fehler(400, "Die Datei ist leer.", "datei");
  if (!inhaltPasst(a.ext, datei.buf)) fehler(415, "Der Inhalt passt nicht zur Dateiendung.", "datei");
  const key = neuerKey(req.sitzung.schule_id);
  await speicher.ablegen(key, datei.buf, a.mime);
  const [f] = await q(`INSERT INTO datei (bezug_typ, bezug_id, ordner_id, name, mime, groesse, sha256, speicher_key, erstellt_von)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, name, mime, groesse, erstellt_am, erstellt_von`,
    [bezugTyp, bezugId, ordnerId, datei.name, a.mime, datei.buf.length, crypto.createHash("sha256").update(datei.buf).digest("hex"), key, req.ctx.personId]);
  return f;
}
export const dateienVon = (q, bezugTyp, ids) => (ids.length ? q(`SELECT d.id, d.bezug_id, d.name, d.mime, d.groesse, d.erstellt_am, d.erstellt_von FROM datei d
  WHERE d.bezug_typ = $1 AND d.bezug_id = ANY($2) AND d.geloescht_am IS NULL ORDER BY d.erstellt_am`, [bezugTyp, ids]) : []);
export async function dateiLaden(q, did) {
  const [f] = await q("SELECT * FROM datei WHERE id = $1 AND geloescht_am IS NULL", [id(did)]);
  if (!f) fehler(404, "Datei nicht gefunden.");
  return f;
}
/** Datei ausliefern (Rechte hat der Aufrufer geprüft) */
export async function dateiSenden(res, f, inlineGewuenscht) {
  const inline = inlineGewuenscht && INLINE.has(f.mime);
  if (speicher.art === "s3") return res.redirect(await speicher.link(f.speicher_key, { dateiname: f.name, mime: f.mime, inline }), 302);
  const buf = await speicher.lesen(f.speicher_key);
  res.header("Content-Type", f.mime + (f.mime.startsWith("text/") ? "; charset=utf-8" : ""));
  res.header("Content-Disposition", `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.name)}`);
  res.header("Content-Security-Policy", f.mime === "application/pdf" ? "frame-ancestors 'self'" : "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'");
  res.header("X-Frame-Options", "SAMEORIGIN");
  res.header("Cache-Control", "private, no-store");
  return buf;
}
/** Als gelöscht markieren; der Inhalt wird sofort aus dem Speicher entfernt */
export async function dateiEntfernen(q, f) {
  await q("UPDATE datei SET geloescht_am = now() WHERE id = $1", [f.id]);
  await speicher.loeschen(f.speicher_key).catch(() => {});
}

/** Unterricht, den eine Schülerin, ein Schüler besucht (für die Elternsicht) */
export async function unterrichtVon(q, pid) {
  return new Set((await q(`SELECT us.unterricht_id AS id FROM unterricht_schueler us WHERE us.person_id = $1
    UNION SELECT u.id FROM unterricht u JOIN klasse_schueler ks ON ks.klasse_id = u.klasse_id WHERE ks.person_id = $1 AND u.gruppe = '' AND (ks.bis IS NULL OR ks.bis >= current_date)`, [pid])).map((r) => r.id));
}
/** Für wen gilt die Anfrage? Eigene Person oder (Eltern) ein Kind über ?person= */
export async function fuerWen(q, req, eigeneAktion) {
  const p = req.query.person;
  if (p && p !== req.ctx.personId) {
    if (!req.ctx.kinder || !req.ctx.kinder.has(String(p))) fehler(404, "Nicht gefunden.");
    return { pid: String(p), unterricht: await unterrichtVon(q, String(p)), eltern: true };
  }
  const { pruefe } = await import("@schule/shared");
  pruefe(req.ctx, eigeneAktion);
  return { pid: req.ctx.personId, unterricht: req.ctx.unterricht, eltern: false };
}
