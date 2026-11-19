// Durchlauf Phase 1 im Browser: Anmelden, Zwei-Faktor einrichten, Verwaltung, Import, Lehrperson-Sicht. Macht Bildschirmfotos.
//   node tests/e2e-phase1.mjs [ordner]
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = createRequire(process.env.PW_FROM || "/tmp/claude-0/st/redesign/gl.mjs")("playwright");
const { authenticator } = require("../apps/api/node_modules/otplib");

const B = process.env.BASIS || "http://localhost:5180";
const OUT = process.argv[2] || "/tmp/claude-0/schule-shots";
fs.mkdirSync(OUT, { recursive: true });
const PW = "Seeufer-Test-2026!";
import { execSync } from "node:child_process";
execSync("node packages/db/seed.mjs", { cwd: new URL("..", import.meta.url).pathname }); // frische Testschule
const fehler = [];
const GEHEIM = {};
const b = await chromium.launch();

async function sitzung(email, name, groesse = { width: 1360, height: 860 }) {
  const ctx = await b.newContext({ viewport: groesse, locale: "de-CH" });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => fehler.push(`${name}: ${e.message}`));
  p.on("console", (m) => { if (m.type() === "error" && !/403/.test(m.text())) fehler.push(`${name} console: ${m.text()}`); });
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

// Anmeldeseite
{ const ctx = await b.newContext({ viewport: { width: 1360, height: 860 } }); const p = await ctx.newPage(); await p.goto(`${B}/s/seeufer/anmelden`); await foto(p, "01-anmelden", false);
  await p.getByLabel("E-Mail").fill("admin@seeufer.test"); await p.getByLabel("Passwort").fill("falsch-falsch"); await p.getByRole("button", { name: "Anmelden" }).click(); await p.waitForSelector("[role=alert]"); await foto(p, "02-anmelden-falsch", false); await ctx.close(); }

// Admin
const a = await sitzung("admin@seeufer.test", "admin");
await foto(a, "03-admin-uebersicht");
for (const [pfad, name] of [["klassen", "04-klassen"], ["personen", "05-personen"], ["faecher", "06-faecher"], ["schuljahre", "07-schuljahre"], ["unterricht", "08-unterricht"]]) {
  await a.goto(`${B}/s/seeufer/${pfad}`); await a.waitForLoadState("networkidle"); await foto(a, name);
}
await a.goto(`${B}/s/seeufer/klassen`); await a.getByRole("link", { name: /^3a/ }).click(); await a.waitForLoadState("networkidle"); await foto(a, "09-klasse-3a");
// Neue Person mit Dialog
await a.goto(`${B}/s/seeufer/personen`); await a.getByRole("button", { name: "Neue Person" }).click();
await a.getByLabel("Vorname").fill("Petra"); await a.getByLabel("Nachname").fill("Zollinger"); await a.getByLabel(/^E-Mail/).fill("petra.zollinger@seeufer.test");
await a.getByRole("checkbox", { name: "Lehrperson", exact: true }).check(); await a.getByRole("checkbox", { name: "Schüler/in", exact: true }).uncheck(); await foto(a, "10-person-dialog", false);
await a.getByRole("button", { name: "Speichern" }).click(); await a.waitForTimeout(500);
// Import
await a.goto(`${B}/s/seeufer/import`);
await a.setInputFiles("input[type=file]", path.join(path.dirname(new URL(import.meta.url).pathname), "beispiel-import.csv"));
await a.waitForSelector("text=Vorschau prüfen"); await foto(a, "11-import-vorschau");
await a.getByRole("button", { name: /Personen importieren/ }).click(); await a.waitForSelector("text=Fertig:"); await foto(a, "12-import-fertig", false);
await a.goto(`${B}/s/seeufer/protokoll`); await a.waitForLoadState("networkidle"); await foto(a, "13-protokoll");

// Lehrperson
const l = await sitzung("martin.keller@seeufer.test", "lehrperson");
await foto(l, "14-lp-uebersicht");
await l.goto(`${B}/s/seeufer/klassen`); await l.waitForLoadState("networkidle"); await foto(l, "15-lp-klassen");
// Lehrperson darf keine Personenliste
const r = await l.evaluate(async () => (await fetch("/api/personen")).status);
if (r !== 403) fehler.push(`Lehrperson /api/personen: ${r} statt 403`);

// Handy
const m = await sitzung("martin.keller@seeufer.test", "handy", { width: 390, height: 844 });
await foto(m, "16-handy-uebersicht", false);
await m.getByRole("button", { name: "Menü öffnen" }).click(); await foto(m, "17-handy-menue", false);

await b.close();
console.log(fehler.length ? "FEHLER:\n" + fehler.join("\n") : "Durchlauf ohne Fehler.");
process.exit(fehler.length ? 1 : 0);
