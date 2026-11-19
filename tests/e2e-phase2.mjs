// Durchlauf Phase 2 im Browser: Notenbuch, mündliche Beobachtungen, Meine Noten, Druck. Macht Bildschirmfotos.
//   node tests/e2e-phase2.mjs [ordner]
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = createRequire(process.env.PW_FROM || "/tmp/claude-0/st/redesign/gl.mjs")("playwright");
const { authenticator } = require("../apps/api/node_modules/otplib");

const B = process.env.BASIS || "http://localhost:5180";
const OUT = process.argv[2] || "/tmp/claude-0/schule-shots2";
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
  p.on("console", (m) => { if (m.type() === "error" && !/40[39]/.test(m.text())) fehler.push(`${name} console: ${m.text()}`); });
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


const gespeichert = (p) => p.waitForSelector("text=Alles gespeichert", { timeout: 8000 });

// Anmeldeseite im neuen Design
{ const ctx = await b.newContext({ viewport: { width: 1360, height: 860 } }); const p = await ctx.newPage(); await p.goto(`${B}/s/seeufer/anmelden`); await foto(p, "20-anmelden", false); await ctx.close(); }

// Lehrperson: Übersicht und Notenbuch
const l = await sitzung("martin.keller@seeufer.test", "lp");
await l.waitForSelector(".ukarte"); await foto(l, "21-lp-uebersicht");
await l.locator(".ukarte", { hasText: "Deutsch" }).filter({ hasText: "3a" }).first().click();
await l.waitForSelector("table.nb"); await foto(l, "22-notenbuch", false);
const uid = l.url().match(/unterricht\/([^/]+)\/noten/)[1];

// Entwurf «Novelle»: Punkte eintippen, Enter springt weiter, automatisch gespeichert
const nov = l.locator('input[aria-label^="Novelle"]');
await nov.nth(0).fill("33"); await nov.nth(0).press("Enter");
const fokus = await l.evaluate(() => document.activeElement.getAttribute("aria-label"));
if (!fokus || !fokus.startsWith("Novelle")) fehler.push("Enter springt nicht in die nächste Zeile: " + fokus);
await l.keyboard.type("12"); await l.keyboard.press("Enter");
await gespeichert(l);
// Ungültige Eingabe wird markiert
await nov.nth(2).fill("99"); await l.waitForTimeout(200);
if ((await nov.nth(2).getAttribute("aria-invalid")) !== "true") fehler.push("99 Punkte bei 36 max nicht als ungültig markiert");
await nov.nth(2).fill("a"); await l.waitForTimeout(1300);
// Einfügen aus Excel (drei Zeilen)
await nov.nth(3).focus();
await l.evaluate(() => { const dt = new DataTransfer(); dt.setData("text", "30\n28,5\n17\n"); document.activeElement.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); });
await gespeichert(l); await l.waitForTimeout(300);
const w5 = await nov.nth(5).inputValue(); if (w5 !== "17") fehler.push("Einfügen: Zeile 6 hat " + w5);
await foto(l, "23-notenbuch-eingabe", false);

// Freigegebene Note ändern: Grund wird verlangt
const ero = l.locator('input[aria-label^="Erörterung"]');
await ero.nth(0).fill("20"); await ero.nth(0).press("Tab");
await l.waitForSelector("dialog[open] >> text=Grund für die Änderung"); await foto(l, "24-grund-dialog", false);
await l.getByLabel("Grund").fill("Korrekturfehler bei Aufgabe 3"); await l.getByRole("button", { name: "Ändern" }).click();
await gespeichert(l);

// Neue Bewertung anlegen
await l.getByRole("button", { name: "Neue Bewertung" }).first().click();
await l.getByLabel("Titel").fill("Vortrag Kurzgeschichte"); await foto(l, "25-neue-bewertung", false);
await l.getByRole("button", { name: "Anlegen" }).click();
await l.waitForSelector('input[aria-label^="Vortrag Kurzgeschichte"]', { timeout: 5000 }).catch(async (e) => { await foto(l, "x-fehler", false); console.log(fehler.join("\n")); throw e; });
const vor = l.locator('input[aria-label^="Vortrag Kurzgeschichte"]');
for (const [i, n] of ["5.5", "4.75", "6", "3.5", "5"].entries()) await vor.nth(i).fill(n);
await vor.nth(4).press("Enter"); await gespeichert(l);
// Freigeben
await l.locator(".nb-kopf", { hasText: "Vortrag Kurzgeschichte" }).click();
await l.getByRole("button", { name: "Freigeben" }).click(); await l.waitForTimeout(600);
// Zeugnisnote setzen
await l.locator("select.z").first().selectOption("5"); await l.waitForTimeout(500);
await foto(l, "26-notenbuch-fertig");
// Druckansicht
await l.emulateMedia({ media: "print" }); await foto(l, "27-druck", true); await l.emulateMedia({ media: "screen" });
await l.pdf({ path: path.join(OUT, "notenbuch.pdf"), landscape: true, format: "A4", printBackground: true });

// Handy: mündlich erfassen
const m = await sitzung("martin.keller@seeufer.test", "handy", { width: 390, height: 844 });
await m.goto(`${B}/s/seeufer/unterricht/${uid}/muendlich`); await m.waitForSelector(".m-zeile");
await m.locator(".m-zeile").nth(0).getByRole("button", { name: /^sehr gut/ }).click();
await m.waitForSelector(".meldung >> text=Rückgängig"); await foto(m, "28-handy-muendlich", false);
await m.getByRole("button", { name: "Rückgängig" }).click(); await m.waitForTimeout(400);
await m.goto(`${B}/s/seeufer/unterricht/${uid}/noten`); await m.waitForSelector("table.nb"); await foto(m, "29-handy-notenbuch", false);

// Schülerin: nur freigegebene Noten
const s = await sitzung("lea.ammann.26001@schueler.seeufer.test", "schuelerin");
await foto(s, "30-schuelerin-uebersicht", false);
await s.goto(`${B}/s/seeufer/meine-noten`); await s.waitForSelector(".fach-karte");
const text = await s.locator("#inhalt").textContent();
if (!text.includes("Vortrag Kurzgeschichte")) fehler.push("Freigegebene Bewertung fehlt bei der Schülerin");
if (text.includes("Novelle") || text.includes("Trigonometrie")) fehler.push("Entwurf ist für die Schülerin sichtbar");
await foto(s, "31-meine-noten");
const st = await s.evaluate(async (u) => (await fetch(`/api/notenbuch/${u}`)).status, uid);
if (st !== 403) fehler.push(`Schülerin /api/notenbuch: ${st} statt 403`);

// Admin: Einsicht wird protokolliert
const a = await sitzung("admin@seeufer.test", "admin");
await a.goto(`${B}/s/seeufer/unterricht/${uid}/noten`); await a.waitForSelector("table.nb");
if (!(await a.locator("text=Die Einsicht wird protokolliert").count())) fehler.push("Admin sieht keinen Einsicht-Hinweis");
// Als Schulleitung ändern: Grund wird immer verlangt
await a.locator('input[aria-label^="Grammatik"]').nth(1).fill("4"); await a.locator('input[aria-label^="Grammatik"]').nth(1).press("Tab");
await a.waitForSelector("dialog[open] >> text=Grund für die Änderung"); await a.getByLabel("Grund").fill("Nachkorrektur nach Rekurs"); await a.getByRole("button", { name: "Ändern" }).click(); await gespeichert(a);
await foto(a, "36-schulleitung-notenbuch", false);
await a.goto(`${B}/s/seeufer/protokoll`); await a.waitForLoadState("networkidle"); await foto(a, "32-protokoll");
for (const [pfad, name] of [["klassen", "33-klassen"], ["unterricht", "34-unterricht"], ["personen", "35-personen"]]) { await a.goto(`${B}/s/seeufer/${pfad}`); await a.waitForLoadState("networkidle"); await foto(a, name, false); }

await b.close();
console.log(fehler.length ? "FEHLER:\n" + fehler.join("\n") : "Durchlauf ohne Fehler.");
process.exit(fehler.length ? 1 : 0);
