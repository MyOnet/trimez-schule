// Durchlauf Phase 6 im Browser: Prüfung nur in der Lernumgebung. Lea im normalen Browser (abgewiesen), Elias in einer
// nachgebildeten Lernumgebung (unterschreibt jede Anfrage wie die echte App), Taschenrechner, erlaubte Seite, Aufsicht.
//   node tests/e2e-phase6.mjs [ordner]
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { signieren } from "../apps/api/src/lernumgebung.mjs";
import { beispielPdf } from "../packages/db/beispiel-pdf.mjs";
const require = createRequire(import.meta.url);
const { chromium } = createRequire(process.env.PW_FROM || "/tmp/claude-0/st/redesign/gl.mjs")("playwright");
const { authenticator } = require("../apps/api/node_modules/otplib");

const B = process.env.BASIS || "http://localhost:5180";
const OUT = process.argv[2] || "/tmp/claude-0/schule-shots6";
fs.mkdirSync(OUT, { recursive: true });
const PW = "Seeufer-Test-2026!";
import { execSync } from "node:child_process";
execSync("node packages/db/seed.mjs", { cwd: new URL("..", import.meta.url).pathname }); // frische Testschule
const fehler = [];
const GEHEIM = {};
const b = await chromium.launch();

// Nachgebildete Lernumgebung: dieselben Kopfzeilen und Unterschrift wie die Rust-App (apps/lernumgebung/app/src/proxy.rs)
const KEY = Buffer.from(crypto.createHash("sha256").update("trimez-lernumgebung-entwicklung").digest("base64url"), "base64url");
async function alsApp(p) {
  let konfig = "-"; const geraet = "e2e-geraet-elias-01", sperre = "aktiv;desktop,tastatur,aufnahme,vordergrund";
  p.on("response", async (r) => { if (/\/api\/versuche\/[0-9a-f-]{36}$/.test(r.url()) && r.status() === 200) { try { const j = await r.json(); if (j.lernumgebung) konfig = j.lernumgebung.konfig_wert; } catch {} } });
  await p.route("**/api/**", (route) => {
    const req = route.request(), u = new URL(req.url()), zeit = String(Date.now());
    const sig = signieren(KEY, { methode: req.method(), pfad: u.pathname + u.search, zeit, geraet, sperre, konfig, koerper: req.postData() || "" });
    route.continue({ headers: { ...req.headers(), "x-lu-version": "1.0.0", "x-lu-plattform": "windows", "x-lu-geraet": geraet, "x-lu-zeit": zeit, "x-lu-sperre": sperre, "x-lu-konfig": konfig, "x-lu-signatur": sig } });
  });
  await p.addInitScript(() => { window.trimezLernumgebung = Object.freeze({ version: "1.0.0", plattform: "windows", status: async (a) => { window.__luStatus = a; }, seiteOeffnen: async (u) => { window.__luGeoeffnet = u; }, beenden: async () => {} }); });
}

async function sitzung(email, name, groesse = { width: 1360, height: 860 }, app = false) {
  const ctx = await b.newContext({ viewport: groesse, locale: "de-CH" });
  const p = await ctx.newPage();
  if (app) await alsApp(p);
  p.on("dialog", (d) => d.accept(d.type() === "prompt" ? "10" : undefined));
  p.on("pageerror", (e) => fehler.push(`${name}: ${e.message}`));
  p.on("console", (m) => { if (m.type() === "error" && !/40[39]|ERR_INTERNET_DISCONNECTED/.test(m.text())) fehler.push(`${name} console: ${m.text()}`); });
  await p.goto(`${B}/s/seeufer/anmelden`);
  await p.getByLabel("E-Mail").fill(email);
  await p.getByLabel("Passwort").fill(PW);
  await p.getByRole("button", { name: "Anmelden" }).click();
  if (GEHEIM[email]) { await p.getByLabel(/Code aus der Authenticator/).fill(authenticator.generate(GEHEIM[email])); await p.getByRole("button", { name: "Bestätigen" }).click(); }
  await p.waitForURL((u) => !String(u).includes("/anmelden"));
  await p.waitForSelector("#inhalt h1");
  if (p.url().includes("zweiter-faktor")) {
    await p.getByRole("button", { name: "QR-Code anzeigen" }).click();
    const geheim = (await p.locator(".code").textContent()).trim();
    GEHEIM[email] = geheim;
    await p.screenshot({ path: path.join(OUT, `${name}-2fa.png`) });
    await p.getByLabel(/6-stelliger Code/).fill(authenticator.generate(geheim));
    await p.getByRole("button", { name: "Bestätigen" }).click();
    await p.waitForURL(/\/s\/seeufer\/$/);
    await p.waitForSelector("#inhalt h1");
  }
  return p;
}
const foto = async (p, name, voll = true) => { await p.waitForTimeout(400); await p.screenshot({ path: path.join(OUT, name + ".png"), fullPage: voll }); };


const pruefe = (bed, text) => { if (!bed) fehler.push(text); };

// Lehrperson: Lernumgebung verlangen, Taschenrechner und Duden erlauben
const l = await sitzung("martin.keller@seeufer.test", "lp");
await l.goto(`${B}/s/seeufer/pruefungen`); await l.locator(".pzeile", { hasText: "Kleider machen Leute" }).click();
await l.getByRole("button", { name: "Hinweise und Einstellungen" }).click();
await l.getByRole("radio", { name: "Nur in der Lernumgebung" }).click();
await l.getByLabel(/Taschenrechner/).check();
await l.getByLabel("Name der Seite").fill("Duden"); await l.getByLabel("Adresse der Seite").fill("www.duden.de"); await l.getByRole("button", { name: "Erlauben" }).click();
await foto(l, "100-einstellungen", false);
await l.getByRole("button", { name: "Speichern" }).click(); await l.waitForSelector("text=Lernumgebung, Rechner, 1 Seiten");
await l.getByRole("button", { name: "Prüfung starten" }).click(); await l.waitForSelector(".code-tafel b");
const code = (await l.locator(".code-tafel b").textContent()).replace(/\s/g, "");

// Lea im normalen Browser: abgewiesen, mit Weg zur App
const lea = await sitzung("lea.ammann.26001@schueler.seeufer.test", "lea");
await lea.getByLabel("Code von der Tafel").fill(code); await lea.getByRole("button", { name: "Beginnen" }).click();
await lea.waitForSelector(".pruefung-jetzt .feld-fehler >> text=Lernumgebung"); await foto(lea, "101-browser-abgewiesen", false);
await lea.getByRole("link", { name: "So geht es" }).click(); await lea.waitForSelector(".lu-raster"); await foto(lea, "102-lernumgebung-seite", false);

// Elias in der (nachgebildeten) Lernumgebung
const el = await sitzung("elias.luthi.26002@schueler.seeufer.test", "elias", { width: 1360, height: 860 }, true);
await el.goto(`${B}/s/seeufer/lernumgebung`); await el.waitForSelector("text=Sie verwenden die Lernumgebung 1.0.0");
await foto(el, "103-erkannt", false);
await el.goto(`${B}/s/seeufer/`); await el.getByLabel("Code von der Tafel").fill(code); await el.getByRole("button", { name: "Beginnen" }).click();
await el.waitForSelector(".pm-lu"); await el.waitForSelector(".blatt");
pruefe(await el.evaluate(() => window.__luStatus === true), "App wurde nicht über die laufende Prüfung informiert");
await el.locator(".blatt .wahl-option", { hasText: "Gottfried Keller" }).click();
await el.getByRole("button", { name: "Taschenrechner" }).click();
await el.getByLabel("Rechnung").fill("10*sin(35)"); await el.getByLabel("Rechnung").press("Enter");
pruefe((await el.getByLabel("Rechnung").inputValue()).startsWith("5.7357"), "Taschenrechner rechnet falsch: " + (await el.getByLabel("Rechnung").inputValue()));
await el.waitForSelector(".pm-status >> text=Gespeichert", { timeout: 10000 });
await foto(el, "104-pruefung-lernumgebung", false);
await el.getByRole("button", { name: "Erlaubte Seiten" }).click(); await el.getByRole("menuitem", { name: /Duden/ }).click();
pruefe((await el.evaluate(() => window.__luGeoeffnet)) === "https://www.duden.de", "Erlaubte Seite nicht über die App geöffnet");

// Aufsicht
await l.waitForTimeout(4500);
const z = await l.locator("tr", { hasText: "Lüthi Elias" }).textContent();
pruefe(z.includes("Windows, gesperrt"), "Aufsicht zeigt die Lernumgebung nicht: " + z);
await foto(l, "105-aufsicht", false);

// Abgabe aus der App, danach darf sie beendet werden
await el.getByRole("button", { name: "Abgeben" }).click(); await el.getByRole("button", { name: "Jetzt abgeben" }).click(); await el.waitForSelector(".quittung");
pruefe(await el.evaluate(() => window.__luStatus === false), "App nach der Abgabe noch gesperrt");

await b.close();
console.log(fehler.length ? "FEHLER:\n" + fehler.join("\n") : "Durchlauf ohne Fehler.");
process.exit(fehler.length ? 1 : 0);
