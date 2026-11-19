// Lernumgebung: Prüfung nur mit gültiger, gesperrter App; Signatur, Zeit, Wiederholung, Gerät, Konfiguration, Meldungen der App
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { authenticator } from "../apps/api/node_modules/otplib/index.js";
import { bauen } from "../apps/api/src/server.mjs";
import crypto from "node:crypto";
import { signieren, konfigWert } from "../apps/api/src/lernumgebung.mjs";
import { beispielPdf } from "../packages/db/beispiel-pdf.mjs";

let app, lp, kunz, frei, schueler, schueler3b, admin, uid3a, uid3b, brunner, elias, alina;
const PW = "Seeufer-Test-2026!", H = { "x-schule": "1" };
async function anmelden(email, mit2fa = true) {
  const r = await app.inject({ method: "POST", url: "/api/s/seeufer/anmelden", headers: H, payload: { email, passwort: PW } });
  const cookie = r.headers["set-cookie"].split(";")[0];
  if (mit2fa) { const s = (await app.inject({ method: "POST", url: "/api/konto/2fa/start", headers: { ...H, cookie } })).json(); await app.inject({ method: "POST", url: "/api/konto/2fa/bestaetigen", headers: { ...H, cookie }, payload: { code: authenticator.generate(s.geheim) } }); }
  return cookie;
}
const call = (method, url, cookie, payload) => app.inject({ method, url, headers: { ...H, cookie }, payload });
// multipart von Hand (ohne zusätzliche Pakete)
function hochladen(url, cookie, dateiname, inhalt, felder = {}) {
  const grenze = "----grenze" + Math.random().toString(16).slice(2);
  const teile = [];
  for (const [k, v] of Object.entries(felder)) teile.push(Buffer.from(`--${grenze}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  teile.push(Buffer.from(`--${grenze}\r\nContent-Disposition: form-data; name="datei"; filename="${dateiname}"\r\nContent-Type: application/octet-stream\r\n\r\n`), Buffer.from(inhalt), Buffer.from(`\r\n--${grenze}--\r\n`));
  return app.inject({ method: "POST", url, headers: { ...H, cookie, "content-type": `multipart/form-data; boundary=${grenze}` }, payload: Buffer.concat(teile) });
}

beforeAll(async () => {
  execSync("node packages/db/seed.mjs", { cwd: new URL("..", import.meta.url).pathname });
  app = await bauen();
  lp = await anmelden("martin.keller@seeufer.test");      // Deutsch 3a, 3b, 5c
  kunz = await anmelden("barbara.kunz@seeufer.test");     // Fachgruppe Deutsch, ohne Unterricht hier
  frei = await anmelden("sandra.frei@seeufer.test");      // Französisch
  admin = await anmelden("admin@seeufer.test");
  brunner = await anmelden("thomas.brunner@seeufer.test"); // Mathematik
  elias = await anmelden("elias.luthi.26002@schueler.seeufer.test", false);
  alina = await anmelden("alina.sutter.26003@schueler.seeufer.test", false);
  schueler = await anmelden("lea.ammann.26001@schueler.seeufer.test", false); // 3a
  const ueb = (await call("GET", "/api/uebersicht", lp)).json();
  uid3a = ueb.meinUnterricht.find((u) => u.klasse === "3a").id;
  uid3b = ueb.meinUnterricht.find((u) => u.klasse === "3b").id;
});
afterAll(() => app.close());

// Nachgebildete App: unterschreibt wie die echte Lernumgebung (Schlüssel der Entwicklungsversion)
const KEY = Buffer.from(crypto.createHash("sha256").update("trimez-lernumgebung-entwicklung").digest("base64url"), "base64url");
let KONFIG = "-";
function app_(cookie, { geraet = "geraet-lea-0001", sperre = "aktiv;desktop,tastatur,aufnahme", version = "1.0.0", key = KEY, zeit = Date.now(), konfig } = {}) {
  return async (method, url, payload) => {
    const koerper = payload === undefined ? "" : JSON.stringify(payload);
    const k = konfig ?? KONFIG;
    const h = { ...H, cookie, "x-lu-version": version, "x-lu-plattform": "windows", "x-lu-geraet": geraet, "x-lu-zeit": String(zeit), "x-lu-sperre": sperre, "x-lu-konfig": k,
      "x-lu-signatur": signieren(key, { methode: method, pfad: url, zeit: String(zeit), geraet, sperre, konfig: k, koerper }) };
    if (koerper) h["content-type"] = "application/json";
    return app.inject({ method, url, headers: h, payload: koerper || undefined });
  };
}

describe("Lernumgebung", () => {
  let pid, code, vid, la;
  it("Lehrperson verlangt die Lernumgebung, erlaubt eine Seite und den Taschenrechner", async () => {
    const d = (await call("GET", "/api/pruefungen", lp)).json();
    pid = d.pruefungen.find((x) => x.titel === "Kleider machen Leute").id;
    expect((await call("PUT", `/api/pruefungen/${pid}`, lp, { einstellungen: { modus: "lernumgebung", rechner: true, seiten: [{ url: "http://evil.example" }] } })).statusCode).toBe(400);
    const r = await call("PUT", `/api/pruefungen/${pid}`, lp, { einstellungen: { modus: "lernumgebung", rechner: true, seiten: [{ titel: "Duden", url: "https://www.duden.de/" }] } });
    expect(r.statusCode).toBe(200);
    code = (await call("POST", `/api/pruefungen/${pid}/starten`, lp)).json().startcode;
  });
  it("im normalen Browser: kein Zutritt, mit Hinweis auf die App", async () => {
    const r = await call("POST", "/api/pruefungen/beitreten", schueler, { code });
    expect(r.statusCode).toBe(403); expect(r.json().feld).toBe("lernumgebung");
  });
  it("falsche Signatur, alte Zeit, unbekannte Version, nicht gesperrt: abgewiesen", async () => {
    expect((await app_(schueler, { key: crypto.randomBytes(32) })("POST", "/api/pruefungen/beitreten", { code })).json().fehler).toMatch(/Signatur ungültig/);
    expect((await app_(schueler, { zeit: Date.now() - 10 * 60000 })("POST", "/api/pruefungen/beitreten", { code })).json().fehler).toMatch(/Uhrzeit/);
    expect((await app_(schueler, { version: "0.9.0" })("POST", "/api/pruefungen/beitreten", { code })).json().fehler).toMatch(/unbekannte Version/);
    expect((await app_(schueler, { sperre: "aus" })("POST", "/api/pruefungen/beitreten", { code })).json().fehler).toMatch(/nicht gesperrt/);
    // Windows ohne eigenen Desktop: abgewiesen
    expect((await app_(schueler, { sperre: "aktiv;tastatur,aufnahme" })("POST", "/api/pruefungen/beitreten", { code })).json().fehler).toMatch(/keinen eigenen Desktop/);
    // Signatur verlangt (Schulen mit signierten Versionen): ohne «signiert» abgewiesen
    process.env.LERNUMGEBUNG_SIGNATUR = "pflicht";
    try { expect((await app_(schueler)("POST", "/api/pruefungen/beitreten", { code })).json().fehler).toMatch(/nicht original signiert/); }
    finally { delete process.env.LERNUMGEBUNG_SIGNATUR; }
  });
  it("mit gültiger, gesperrter App: Zutritt; Konfiguration kommt mit", async () => {
    la = app_(schueler);
    const r = await la("POST", "/api/pruefungen/beitreten", { code });
    expect(r.statusCode).toBe(200); vid = r.json().versuch_id;
    const v = (await la("GET", `/api/versuche/${vid}`)).json();
    expect(v.lernumgebung.pflicht).toBe(true);
    expect(v.lernumgebung.konfig).toMatchObject({ seiten: ["https://www.duden.de"], rechner: true });
    expect(v.lernumgebung.konfig_wert).toBe(konfigWert(v.lernumgebung.konfig));
    expect(v.pruefung.einstellungen.rechner).toBe(true);
    KONFIG = v.lernumgebung.konfig_wert;
  });
  it("dieselbe Anfrage zweimal wird abgewiesen (Wiederholung)", async () => {
    const zeit = Date.now(), a = app_(schueler, { zeit });
    expect((await a("GET", `/api/versuche/${vid}`)).statusCode).toBe(200);
    expect((await a("GET", `/api/versuche/${vid}`)).json().fehler).toMatch(/wiederholt/);
  });
  it("Speichern nur aus der App, mit aktueller Konfiguration und vom selben Gerät", async () => {
    const v = (await app_(schueler)("GET", `/api/versuche/${vid}`)).json();
    const t = v.teile.find((x) => x.typ === "kurz");
    expect((await app_(schueler)("POST", `/api/versuche/${vid}/antworten`, { eintraege: [{ seq: 1, teil_id: t.id, wert: "Strapinski" }] })).json().seq).toBe(1);
    expect((await call("POST", `/api/versuche/${vid}/antworten`, schueler, { eintraege: [{ seq: 2, teil_id: t.id, wert: "x" }] })).statusCode).toBe(403);
    expect((await app_(schueler, { konfig: "alt" })("POST", `/api/versuche/${vid}/antworten`, { eintraege: [{ seq: 2, teil_id: t.id, wert: "x" }] })).json().konfig_neu).toBe(true);
    const ag = (await app_(schueler, { geraet: "anderes-geraet-02" })("POST", `/api/versuche/${vid}/antworten`, { eintraege: [{ seq: 2, teil_id: t.id, wert: "x" }] })).json();
    expect(ag.fehler).toMatch(/anderen Gerät/);
    // Lehrperson gibt ein anderes Gerät frei
    const a = (await call("GET", `/api/pruefungen/${pid}/aufsicht`, lp)).json();
    const lea = a.schueler.find((s) => s.versuch && s.versuch.id === vid);
    expect(lea.versuch.modus).toBe("gesperrt"); expect(lea.versuch.plattform).toBe("windows");
    expect(lea.versuch.warnungen).toBeGreaterThanOrEqual(2); // Browser-Versuch und anderes Gerät
    await call("POST", `/api/versuche/${vid}/geraet-freigeben`, lp);
    expect((await app_(schueler, { geraet: "anderes-geraet-02" })("POST", `/api/versuche/${vid}/antworten`, { eintraege: [{ seq: 3, teil_id: t.id, wert: "Wenzel Strapinski" }] })).statusCode).toBe(200);
    expect((await app_(schueler)("POST", `/api/versuche/${vid}/antworten`, { eintraege: [{ seq: 4, teil_id: t.id, wert: "y" }] })).statusCode).toBe(403);
  });
  it("Meldungen der App werden angenommen, aus dem Browser nicht", async () => {
    const g = app_(schueler, { geraet: "anderes-geraet-02" });
    expect((await g("POST", `/api/versuche/${vid}/warnung`, { art: "fremder_code", detail: "Nicht signierte Programmbibliothek geladen: C:\\x\\hook.dll" })).statusCode).toBe(200);
    expect((await g("POST", `/api/versuche/${vid}/warnung`, { art: "prozess", detail: "AnyDesk.exe beendet" })).statusCode).toBe(200);
    expect((await call("POST", `/api/versuche/${vid}/warnung`, schueler, { art: "vm" })).statusCode).toBe(400);
    const a = (await call("GET", `/api/pruefungen/${pid}/aufsicht`, lp)).json();
    expect(a.schueler.find((s) => s.versuch && s.versuch.id === vid).versuch.warnung_art).toBe("prozess");
  });
  it("Abgabe aus der App", async () => {
    const r = await app_(schueler, { geraet: "anderes-geraet-02" })("POST", `/api/versuche/${vid}/abgeben`);
    expect(r.statusCode).toBe(200); expect(r.json().hash).toMatch(/^[0-9a-f]{64}$/);
  });
  it("Auffälligkeiten: Gerätewechsel erscheint als Hinweis, nur für die Lehrperson", async () => {
    expect((await call("GET", `/api/pruefungen/${pid}/auffaelligkeiten`, schueler)).statusCode).toBe(404);
    const d = (await call("GET", `/api/pruefungen/${pid}/auffaelligkeiten`, lp)).json();
    expect(d.hinweis).toMatch(/keine Beweise/);
    const lea = d.versuche.find((x) => x.id === vid);
    expect(lea.auffaelligkeiten.map((x) => x.art)).toContain("geraet");
  });
});
