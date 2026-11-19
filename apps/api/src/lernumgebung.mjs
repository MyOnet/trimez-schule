// Nachweis der trimez. Lernumgebung (die App für Prüfungen auf den Laptops).
//
// Die App schickt bei jeder Anfrage Kopfzeilen mit und unterschreibt sie mit dem Schlüssel ihrer Version (HMAC-SHA256):
//   X-LU-Version   z. B. 1.0.0
//   X-LU-Plattform windows | macos
//   X-LU-Geraet    zufällige Kennung des Geräts (bleibt auf dem Gerät gespeichert)
//   X-LU-Zeit      Unix-Zeit in Millisekunden
//   X-LU-Sperre    z. B. «aktiv;desktop,tastatur,aufnahme» oder «aus»
//   X-LU-Konfig    SHA-256 der Prüfungs-Konfiguration, die die App durchsetzt («-» wenn keine)
//   X-LU-Signatur  base64url(HMAC(schluessel, METHODE \n PFAD \n ZEIT \n GERAET \n SPERRE \n KONFIG \n SHA256(KÖRPER)))
//
// Ehrliche Grenze: Der Schlüssel steckt in der App. Wer die App zerlegt, kann ihn finden. Darum: Schlüssel pro Version,
// alte Versionen werden abgeschaltet (LERNUMGEBUNG_MIN_VERSION), Wiederholungen werden abgewiesen, und die App meldet
// Auffälliges. Das entspricht dem Ansatz des «Browser Exam Key» von Safe Exam Browser.
import crypto from "node:crypto";

const DEV_SCHLUESSEL = "1.0.0=" + crypto.createHash("sha256").update("trimez-lernumgebung-entwicklung").digest("base64url");
function schluesselLesen() {
  const roh = process.env.LERNUMGEBUNG_SCHLUESSEL || (process.env.NODE_ENV === "production" ? "" : DEV_SCHLUESSEL);
  const m = new Map();
  for (const t of roh.split(";").map((x) => x.trim()).filter(Boolean)) { const [v, k] = t.split("="); if (v && k) m.set(v.trim(), Buffer.from(k.trim(), "base64url")); }
  return m;
}
const SCHLUESSEL = schluesselLesen();
const vergleich = (a, b) => { const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; };
const ZEITFENSTER_MS = 2 * 60 * 1000;
const gesehen = new Map(); // Signatur → Zeit (gegen Wiederholung; bei mehreren Servern über Redis)

export const sha256 = (s) => crypto.createHash("sha256").update(s ?? "").digest("hex");
export function signieren(schluessel, { methode, pfad, zeit, geraet, sperre, konfig, koerper }) {
  return crypto.createHmac("sha256", schluessel).update([methode.toUpperCase(), pfad, zeit, geraet, sperre, konfig, sha256(koerper || "")].join("\n")).digest("base64url");
}
/** Prüfwert einer Konfiguration: dieselbe Berechnung in der App (sortierte Schlüssel, ohne Leerzeichen) */
export function konfigWert(k) {
  const sortiert = (x) => Array.isArray(x) ? x.map(sortiert) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map((s) => [s, sortiert(x[s])])) : x;
  return sha256(JSON.stringify(sortiert(k)));
}

/** Prüft die Kopfzeilen einer Anfrage. Ergebnis: null (keine App) oder { gueltig, grund?, version, plattform, geraet, gesperrt, sperren, konfig } */
export function nachweisPruefen(req) {
  const h = req.headers;
  if (!h["x-lu-signatur"]) return null;
  const lu = { gueltig: false, version: String(h["x-lu-version"] || ""), plattform: String(h["x-lu-plattform"] || ""), geraet: String(h["x-lu-geraet"] || "").slice(0, 64),
    sperre: String(h["x-lu-sperre"] || "aus"), konfig: String(h["x-lu-konfig"] || "-") };
  lu.gesperrt = lu.sperre.startsWith("aktiv");
  lu.sperren = lu.gesperrt ? (lu.sperre.split(";")[1] || "").split(",").filter(Boolean) : [];
  const k = SCHLUESSEL.get(lu.version);
  if (!k) return { ...lu, grund: "unbekannte Version" };
  if (process.env.LERNUMGEBUNG_MIN_VERSION && vergleich(lu.version, process.env.LERNUMGEBUNG_MIN_VERSION) < 0) return { ...lu, grund: "veraltete Version" };
  if (!["windows", "macos"].includes(lu.plattform) || !/^[A-Za-z0-9_-]{8,64}$/.test(lu.geraet)) return { ...lu, grund: "ungültige Angaben" };
  const zeit = Number(h["x-lu-zeit"]);
  if (!Number.isFinite(zeit) || Math.abs(Date.now() - zeit) > ZEITFENSTER_MS) return { ...lu, grund: "Uhrzeit des Geräts stimmt nicht" };
  const erwartet = signieren(k, { methode: req.method, pfad: req.url, zeit: String(h["x-lu-zeit"]), geraet: lu.geraet, sperre: lu.sperre, konfig: lu.konfig, koerper: req.rawBody || "" });
  const sig = String(h["x-lu-signatur"]);
  if (sig.length !== erwartet.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(erwartet))) return { ...lu, grund: "Signatur ungültig" };
  if (gesehen.has(sig)) return { ...lu, grund: "Anfrage wiederholt" };
  gesehen.set(sig, Date.now());
  if (gesehen.size > 50000) { const grenze = Date.now() - ZEITFENSTER_MS; for (const [s, t] of gesehen) if (t < grenze) gesehen.delete(s); }
  return { ...lu, gueltig: true };
}

/** Fastify: JSON-Körper roh behalten (für die Signatur) und req.lu setzen */
export function einrichten(app) {
  app.addContentTypeParser("application/json", { parseAs: "string", bodyLimit: 2 * 1024 * 1024 }, (req, body, done) => {
    req.rawBody = body;
    if (!body) return done(null, {});
    try { done(null, JSON.parse(body)); } catch { const e = new Error("Ungültige Anfrage."); e.statusCode = 400; done(e); }
  });
  app.addHook("preHandler", async (req) => { if (req.url.startsWith("/api/")) req.lu = nachweisPruefen(req); });
}

export const DOWNLOAD = { windows: process.env.LERNUMGEBUNG_WINDOWS_URL || null, macos: process.env.LERNUMGEBUNG_MACOS_URL || null };
