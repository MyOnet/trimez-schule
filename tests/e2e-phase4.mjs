// Durchlauf Phase 4 im Browser: Prüfungen (Liste, Editor, Vorschau mit Probe-Auswertung, Umwandlung aus Word, Formeln, Druck). Macht Bildschirmfotos.
//   node tests/e2e-phase4.mjs [ordner]
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import { beispielPdf } from "../packages/db/beispiel-pdf.mjs";
const require = createRequire(import.meta.url);
const { chromium } = createRequire(process.env.PW_FROM || "/tmp/claude-0/st/redesign/gl.mjs")("playwright");
const { authenticator } = require("../apps/api/node_modules/otplib");

const B = process.env.BASIS || "http://localhost:5180";
const OUT = process.argv[2] || "/tmp/claude-0/schule-shots4";
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


const pruefe = (bed, text) => { if (!bed) fehler.push(text); };
const gespeichert = (p) => p.waitForSelector("text=Gespeichert", { timeout: 8000 });

const l = await sitzung("martin.keller@seeufer.test", "lp");
await l.getByRole("link", { name: "Prüfungen" }).click();
await l.waitForSelector(".pzeile"); await foto(l, "60-liste", false);
await l.locator(".pzeile", { hasText: "Kleider machen Leute" }).click();
await l.waitForSelector(".teil-karte"); await foto(l, "61-editor", false);
pruefe((await l.locator(".teil-karte").count()) === 9, "Editor zeigt nicht alle 9 Teile");

// Neue Aufgabe: Kurzantwort am Ende
await l.locator(".gl-aktionen").getByRole("button", { name: "Aufgabe", exact: true }).click();
await l.waitForSelector("dialog[open] .typ-kachel"); await foto(l, "62-typen", false);
await l.locator("dialog[open] .typ-kachel", { hasText: "Kurzantwort" }).click();
await l.waitForFunction(() => document.querySelectorAll(".teil-karte").length === 10);
const neu = l.locator(".teil-karte").last();
pruefe((await neu.locator(".teil-fehler").count()) === 1, "Neue leere Aufgabe nicht als unvollständig markiert");
await neu.getByRole("textbox", { name: /^Aufgabe/ }).fill("In welcher Stadt spielt die Novelle?");
await neu.getByLabel(/Richtige Antworten/).fill("Goldach");
await l.waitForTimeout(1200); await gespeichert(l);
pruefe((await neu.locator(".teil-fehler").count()) === 0, "Aufgabe nach dem Ausfüllen noch unvollständig");
await neu.scrollIntoViewIfNeeded(); await foto(l, "63-neue-aufgabe", false);

// Vorschau, probe lösen
await l.getByRole("link", { name: "Vorschau" }).click(); await l.waitForSelector(".blatt");
await foto(l, "64-vorschau", false);
const blatt = l.locator(".blatt");
await blatt.locator(".wahl-option", { hasText: "Gottfried Keller" }).click();
await blatt.locator(".blatt-aufgabe").nth(1).locator("input").fill("Strapinski");
await blatt.locator(".wahl-option", { hasText: "herrschaftlichen Kutsche" }).click();
await blatt.locator(".wahl-option", { hasText: "Mantel" }).click();
const luecken = blatt.locator(".luecke"); await luecken.nth(0).fill("unerhörte"); await luecken.nth(1).fill("Wendepunkt"); await luecken.nth(2).fill("Seldwyla");
await blatt.locator("textarea.freitext").fill("Strapinski schämt sich und hat Hunger. Beim Essen im Gasthaus verpasst er die Gelegenheit.");
await l.getByRole("button", { name: "Probe auswerten" }).click();
await l.waitForSelector(".hinweis >> text=von 19 Punkten");
const t = await l.locator(".hinweis", { hasText: "von 19 Punkten" }).textContent();
pruefe(/^7 von 19 Punkten, Note 3/.test(t.trim()), "Auswertung erwartet 7 von 19 Punkten, Note 3, ist: " + t);
pruefe(/von Hand/.test(t), "Freitext nicht als «von Hand» markiert");
await foto(l, "65-auswertung", true);
await l.getByLabel("Lösungen zeigen").check(); await foto(l, "66-loesungen", false);
await l.emulateMedia({ media: "print" });
await l.pdf({ path: path.join(OUT, "pruefung-druck.pdf"), format: "A4", printBackground: true, preferCSSPageSize: true });
await l.emulateMedia({ media: "screen" });

// Neue Prüfung aus Word
await l.goto(`${B}/s/seeufer/pruefungen`); await l.waitForSelector(".pzeile");
await l.getByRole("button", { name: "Neue Prüfung" }).click();
await l.getByRole("radio", { name: "Aus Word oder PDF" }).click();
await l.locator('dialog[open] input[type=file]').setInputFiles(path.join(new URL(".", import.meta.url).pathname, "dateien/romantik.docx"));
await l.getByRole("button", { name: "Hochladen und erkennen" }).click();
await l.waitForSelector(".umwandlung .original-html"); await l.waitForSelector(".vorschlaege .teil-karte");
await foto(l, "67-umwandlung", false);
const k = l.locator(".vorschlaege .teil-karte");
pruefe((await k.count()) === 7, "Umwandlung: erwartet 7 Teile, gefunden " + (await k.count()));
// Aufgabe 1: richtige Antwort markieren
await k.nth(1).getByLabel("Antwort 1 ist richtig").check();
await l.waitForTimeout(200);
pruefe(await k.nth(1).locator(".chip.gruen").count() === 1, "Nach dem Markieren nicht ok");
await foto(l, "68-umwandlung-bearbeitet", false);
await l.getByRole("button", { name: /Teile übernehmen/ }).click();
await l.waitForSelector(".teil-karte"); await l.waitForSelector("text=noch unvollständig");
await foto(l, "69-nach-umwandlung", false);

// Mathematik: Formeln
const m = await sitzung("thomas.brunner@seeufer.test", "mathe");
await m.goto(`${B}/s/seeufer/pruefungen`); await m.locator(".pzeile", { hasText: "Trigonometrie" }).click();
await m.waitForSelector(".teil-karte .formel-vorschau .katex"); await foto(m, "70-mathe-editor", false);
await m.getByRole("link", { name: "Vorschau" }).click(); await m.waitForSelector(".blatt .katex"); await foto(m, "71-mathe-vorschau", false);
const h = await sitzung("thomas.brunner@seeufer.test", "mathe-handy", { width: 390, height: 844 });
await h.goto(m.url()); await h.waitForSelector(".blatt .katex"); await foto(h, "72-handy-vorschau", false);
pruefe(!(await m.locator("text=Kleider machen Leute").count()), "Mathe-Lehrperson sieht fremde Prüfung");

// Schülerin: keine Prüfungsverwaltung
const s = await sitzung("lea.ammann.26001@schueler.seeufer.test", "schuelerin");
pruefe(!(await s.getByRole("link", { name: "Prüfungen" }).count()), "Schülerin sieht den Menüpunkt Prüfungen");
const st = await s.evaluate(async () => (await fetch("/api/pruefungen")).status); pruefe(st === 403, "Schülerin erreicht /api/pruefungen: " + st);

await b.close();
console.log(fehler.length ? "FEHLER:\n" + fehler.join("\n") : "Durchlauf ohne Fehler.");
process.exit(fehler.length ? 1 : 0);
