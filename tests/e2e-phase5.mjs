// Durchlauf Phase 5 im Browser: Prüfung starten, drei Schülerinnen und Schüler schreiben (eine offline), Aufsicht, Abgabe, Korrektur, Notenbuch, Rückgabe.
//   node tests/e2e-phase5.mjs [ordner]
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import { beispielPdf } from "../packages/db/beispiel-pdf.mjs";
const require = createRequire(import.meta.url);
const { chromium } = createRequire(process.env.PW_FROM || "/tmp/claude-0/st/redesign/gl.mjs")("playwright");
const { authenticator } = require("../apps/api/node_modules/otplib");

const B = process.env.BASIS || "http://localhost:5180";
const OUT = process.argv[2] || "/tmp/claude-0/schule-shots5";
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

// Lehrperson startet
const l = await sitzung("martin.keller@seeufer.test", "lp");
await l.goto(`${B}/s/seeufer/pruefungen`); await l.locator(".pzeile", { hasText: "Kleider machen Leute" }).click();
await l.getByRole("button", { name: "Prüfung starten" }).click();
await l.waitForURL(/aufsicht$/); await l.waitForSelector(".code-tafel b");
const code = (await l.locator(".code-tafel b").textContent()).replace(/\s/g, "");
pruefe(/^[A-Z2-9]{6}$/.test(code), "Kein gültiger Code: " + code);
await foto(l, "80-aufsicht-start", false);

// Lea: Übersicht mit Code-Feld, dann schreiben
const lea = await sitzung("lea.ammann.26001@schueler.seeufer.test", "lea");
await lea.waitForSelector(".pruefung-jetzt"); await lea.getByLabel("Code von der Tafel").fill(code.toLowerCase());
await foto(lea, "81-schueler-code", false);
await lea.getByRole("button", { name: "Beginnen" }).click();
await lea.waitForSelector(".pm-leiste .pm-zeit"); await lea.waitForSelector(".blatt");
pruefe(!(await lea.content()).includes("Seldwyla"), "Lösung im Prüfungsmodus sichtbar");
const bl = lea.locator(".blatt");
await bl.locator(".wahl-option", { hasText: "Gottfried Keller" }).click();
await bl.locator(".blatt-aufgabe").nth(1).locator("input").fill("Strapinski");
await bl.locator(".wahl-option", { hasText: "herrschaftlichen Kutsche" }).click();
await bl.locator(".wahl-option", { hasText: "Mantel" }).click();
const lu = bl.locator(".luecke"); await lu.nth(0).fill("unerhörte"); await lu.nth(1).fill("Wendepunkt"); await lu.nth(2).fill("Seldwyla");
await bl.locator("textarea.freitext").fill("Strapinski schämt sich und hat Hunger. Beim Essen im Gasthaus verpasst er die Gelegenheit, und bei Nettchen will er sie nicht enttäuschen.");
await lea.waitForSelector(".pm-status >> text=Gespeichert", { timeout: 10000 });
await lea.evaluate(() => window.dispatchEvent(new Event("blur")));
await lea.waitForSelector(".pm-warnung");
await foto(lea, "82-pruefungsmodus", false);

// Elias: schreibt, verliert die Verbindung, Antworten bleiben erhalten
const el = await sitzung("elias.luthi.26002@schueler.seeufer.test", "elias");
await el.getByLabel("Code von der Tafel").fill(code); await el.getByRole("button", { name: "Beginnen" }).click();
await el.waitForSelector(".blatt");
await el.locator(".blatt .wahl-option", { hasText: "Jeremias Gotthelf" }).click();
await el.context().setOffline(true);
await el.locator(".blatt .blatt-aufgabe").nth(1).locator("input").fill("Wenzel");
await el.waitForSelector(".pm-status .offline", { timeout: 10000 }); await foto(el, "83-offline", false);
await el.context().setOffline(false);
await el.evaluate(() => window.dispatchEvent(new Event("online")));
await el.waitForSelector(".pm-status >> text=Gespeichert", { timeout: 10000 });

// Alina auf dem Handy: gibt früh ab
const al = await sitzung("alina.sutter.26003@schueler.seeufer.test", "alina", { width: 390, height: 844 });
await al.getByLabel("Code von der Tafel").fill(code); await al.getByRole("button", { name: "Beginnen" }).click();
await al.waitForSelector(".blatt"); await al.locator(".blatt .wahl-option", { hasText: "Gottfried Keller" }).click();
await foto(al, "84-handy-pruefung", false);
await al.getByRole("button", { name: "Abgeben" }).click(); await al.waitForSelector("dialog[open] >> text=Noch ohne Antwort");
await al.getByRole("button", { name: "Jetzt abgeben" }).click(); await al.waitForSelector(".quittung");
pruefe(/\w{4} \w{4} \w{4} \w{4}/.test(await al.locator(".quittung-hash").textContent()), "Quittung ohne Prüfnummer");
await foto(al, "85-quittung", false);

// Aufsicht: Stand, Warnung, Zuschlag, Beamer
await l.waitForTimeout(4500);
const zeile = (n) => l.locator("tr", { hasText: n });
pruefe((await zeile("Ammann Lea").textContent()).includes("Fenster verlassen"), "Warnung bei Lea fehlt");
pruefe((await zeile("Sutter Alina").textContent()).includes("abgegeben"), "Alina nicht als abgegeben");
await zeile("Lüthi Elias").getByRole("button", { name: "Zuschlag" }).click(); await l.waitForSelector("tr:has-text('Lüthi Elias') >> text=+10 min");
await foto(l, "86-aufsicht", false);
await l.getByRole("button", { name: "Gross anzeigen" }).click(); await l.waitForSelector(".beamer-code"); await foto(l, "87-beamer", false);
await l.locator(".beamer").click();

// Lea gibt ab, die Lehrperson beendet (Elias wird eingezogen)
await lea.getByRole("button", { name: "Abgeben" }).click(); await lea.getByRole("button", { name: "Jetzt abgeben" }).click(); await lea.waitForSelector(".quittung");
await l.getByRole("button", { name: "Prüfung beenden" }).click(); await l.waitForSelector("text=Prüfung beendet");
await el.reload(); await el.waitForSelector(".quittung >> text=eingezogen");

// Korrektur
await l.getByRole("button", { name: "Zur Korrektur" }).click(); await l.waitForSelector(".korr-zahlen");
await foto(l, "88-korrektur-uebersicht", false);
pruefe(!(await l.getByRole("button", { name: "Ins Notenbuch übernehmen" }).isEnabled()), "Notenbuch-Übernahme trotz offener Antworten möglich");
await l.getByRole("navigation", { name: "Ansicht" }).getByRole("link", { name: "Nach Aufgabe" }).click();
await l.waitForSelector(".korr-antwort");
// Die erste offene Aufgabe ist der Freitext (Aufgabe 7) oder Elias' Kurzantwort; alle offenen bewerten
for (let runde = 0; runde < 6; runde++) {
  const offen = l.locator(".aufgaben-chips button.offen");
  if (!(await offen.count())) break;
  await offen.first().click(); await l.waitForTimeout(400);
  const karten = l.locator(".korr-antwort:has(.bewerten.offen)");
  const n = await karten.count();
  for (let k = 0; k < n; k++) {
    const kk = l.locator(".korr-antwort:has(.bewerten.offen)").first();
    await kk.locator("textarea").fill("Nachvollziehbar begründet, eine zweite Textstelle fehlt.");
    await kk.locator("textarea").blur(); await l.waitForTimeout(300);
    await kk.locator(".schnell button").nth(1).click();
    await l.waitForTimeout(500);
  }
  if (runde === 0) await foto(l, "89-korrektur-aufgabe", false);
}
await l.getByRole("navigation", { name: "Ansicht" }).getByRole("link", { name: "Übersicht" }).click();
await l.getByRole("button", { name: "Ins Notenbuch übernehmen" }).click(); await l.waitForSelector("text=Ins Notenbuch übernommen");
await l.getByRole("button", { name: "An die Klasse zurückgeben" }).click(); await l.waitForSelector("text=✓ Zurückgegeben");
await foto(l, "90-korrektur-fertig", false);
await l.getByRole("link", { name: /Im Notenbuch/ }).click(); await l.waitForSelector("table.nb");
pruefe(await l.locator(".nb-kopf", { hasText: "Kleider machen Leute" }).count() === 1, "Prüfung nicht im Notenbuch");
await foto(l, "91-notenbuch", false);

// Lea sieht ihr Ergebnis
await lea.goto(`${B}/s/seeufer/`); await lea.getByRole("link", { name: /Kleider machen Leute/ }).click();
await lea.waitForSelector(".blatt .kommentar-lp"); await foto(lea, "92-ergebnis", true);

await b.close();
console.log(fehler.length ? "FEHLER:\n" + fehler.join("\n") : "Durchlauf ohne Fehler.");
process.exit(fehler.length ? 1 : 0);
