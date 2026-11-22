// Durchlauf Schulbetrieb im Browser: alle neuen Seiten als Lehrperson, Schülerin, Mutter und Schulleitung; Fehler in der Konsole zählen.
//   node tests/e2e-schulbetrieb.mjs [ordner]   (Server muss laufen: BASIS, Standard http://localhost:5180)
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_FROM || "playwright");
const { authenticator } = require("../apps/api/node_modules/otplib");

const B = process.env.BASIS || "http://localhost:5180";
const OUT = process.argv[2] || "/tmp/claude-0/schule-shots-betrieb";
fs.mkdirSync(OUT, { recursive: true });
const PW = "Seeufer-Test-2026!";
execSync("node packages/db/seed.mjs", { cwd: new URL("..", import.meta.url).pathname });
const fehler = [], GEHEIM = {};
const b = await chromium.launch();

async function sitzung(email, name, groesse = { width: 1360, height: 860 }) {
  const ctx = await b.newContext({ viewport: groesse, locale: "de-CH", timezoneId: "Europe/Zurich" });
  const p = await ctx.newPage();
  p.on("dialog", (d) => d.accept(d.type() === "prompt" ? "Unterlagen" : undefined));
  p.on("pageerror", (e) => fehler.push(`${name}: ${e.message}`));
  p.on("console", (m) => { if (m.type() === "error" && !/40[349]/.test(m.text())) fehler.push(`${name} console: ${m.text()}`); });
  await p.goto(`${B}/s/seeufer/anmelden`);
  await p.getByLabel("E-Mail").fill(email);
  await p.getByLabel("Passwort").fill(PW);
  await p.getByRole("button", { name: "Anmelden" }).click();
  await p.waitForURL((u) => !String(u).includes("/anmelden"));
  await p.waitForSelector("#inhalt h1, #inhalt .leer");
  if (p.url().includes("zweiter-faktor")) {
    await p.getByRole("button", { name: "QR-Code anzeigen" }).click();
    const geheim = (await p.locator(".code").textContent()).trim();
    GEHEIM[email] = geheim;
    await p.getByLabel(/6-stelliger Code/).fill(authenticator.generate(geheim));
    await p.getByRole("button", { name: "Bestätigen" }).click();
    await p.waitForURL(/\/s\/seeufer\/$/);
  }
  return p;
}
const foto = async (p, name) => { await p.waitForTimeout(500); await p.screenshot({ path: path.join(OUT, name + ".png"), fullPage: true }); };
const besuche = async (p, wer, pfad, name) => {
  await p.goto(`${B}/s/seeufer${pfad}`);
  await p.waitForLoadState("networkidle");
  await p.waitForTimeout(300);
  const fehl = await p.locator("#inhalt .hinweis.fehler").count();
  if (fehl) fehler.push(`${wer} ${pfad}: ${await p.locator("#inhalt .hinweis.fehler").first().textContent()}`);
  await foto(p, `${wer}-${name}`);
};

// Lehrperson Martin Keller (Deutsch, Klassenlehrperson 3a)
const lp = await sitzung("martin.keller@seeufer.test", "lp");
for (const [pf, n] of [["/kalender", "kalender"], ["/auftraege", "auftraege"], ["/raum", "raeume"], ["/formulare", "formulare"], ["/ablage", "ablage"], ["/absenzen", "absenzen"], ["/zeugnisse", "zeugnisse"], ["/mitteilungen", "mitteilungen"]]) await besuche(lp, "lp", pf, n);
// Auftrag öffnen
await lp.goto(`${B}/s/seeufer/auftraege`); await lp.waitForLoadState("networkidle");
await lp.getByRole("link", { name: "Charakterisierung Nettchen" }).click(); await lp.waitForLoadState("networkidle");
await lp.getByRole("button", { name: /Bühler|Baumann|Ammann/ }).first().click();
await foto(lp, "lp-auftrag-detail");
// Neuer Auftrag über das Formular
await lp.goto(`${B}/s/seeufer/auftraege`); await lp.waitForLoadState("networkidle");
await lp.getByRole("button", { name: "Neuer Auftrag" }).click();
await lp.getByLabel("Titel").fill("Leserbrief");
await lp.getByRole("button", { name: "Kriterium" }).click();
await lp.getByLabel("Kriterium 1").fill("Argumente");
await foto(lp, "lp-auftrag-neu");
await lp.getByRole("button", { name: "Speichern" }).click();
await lp.waitForURL(/auftraege\/[0-9a-f-]{36}/);
await lp.getByRole("button", { name: "Veröffentlichen" }).click();
await lp.waitForTimeout(500);
// Raum Deutsch 3a
await lp.goto(`${B}/s/seeufer/raum`); await lp.waitForLoadState("networkidle");
await lp.locator("a.karte").first().click(); await lp.waitForLoadState("networkidle");
await foto(lp, "lp-raum");
// Absenzen erfassen
await lp.goto(`${B}/s/seeufer/absenzen`); await lp.waitForLoadState("networkidle");
await foto(lp, "lp-absenzen-erfassen");
await lp.getByRole("button", { name: "Meine Klassen" }).click(); await lp.waitForLoadState("networkidle");
await foto(lp, "lp-absenzen-klasse");
// Prüfung ankündigen (Dialog mit Prüfungsplan)
await lp.goto(`${B}/s/seeufer/kalender`); await lp.waitForLoadState("networkidle");
await lp.getByRole("button", { name: "Prüfung ankündigen" }).click();
await lp.getByLabel("Unterricht").selectOption({ index: 1 });
await lp.getByLabel("Datum").fill("2026-11-27");
await lp.waitForTimeout(600);
await foto(lp, "lp-pruefung-ankuendigen");
await lp.keyboard.press("Escape");
// Quiz-Formular
await lp.goto(`${B}/s/seeufer/formulare`); await lp.waitForLoadState("networkidle");
await lp.getByRole("link", { name: "Kommaregeln: Selbsttest" }).click(); await lp.waitForLoadState("networkidle");
await lp.getByRole("tab", { name: "Fragen" }).click();
await foto(lp, "lp-formular-fragen");

// Schulleitung
const sl = await sitzung("admin@seeufer.test", "sl");
for (const [pf, n] of [["/zeugnisse", "zeugnisse"], ["/matura", "matura"], ["/mitteilungen", "mitteilungen"], ["/kalender", "kalender"], ["/formulare", "formulare"]]) await besuche(sl, "sl", pf, n);
await sl.goto(`${B}/s/seeufer/personen`); await sl.waitForLoadState("networkidle");
await sl.getByRole("row", { name: /Ammann Daniela/ }).getByRole("button", { name: "Bearbeiten" }).click();
await sl.waitForTimeout(500); await foto(sl, "sl-person-eltern");

// Schülerin Lea
const lea = await sitzung("lea.ammann.26001@schueler.seeufer.test", "lea", { width: 1280, height: 820 });
for (const [pf, n] of [["/", "start"], ["/kalender", "kalender"], ["/auftraege", "auftraege"], ["/raum", "raeume"], ["/formulare", "formulare"], ["/ablage", "ablage"], ["/absenzen", "absenzen"], ["/mitteilungen", "mitteilungen"]]) await besuche(lea, "lea", pf, n);
await lea.goto(`${B}/s/seeufer/auftraege`); await lea.waitForLoadState("networkidle");
await lea.getByRole("link", { name: /Charakterisierung Nettchen/ }).click(); await lea.waitForLoadState("networkidle");
await lea.getByLabel("Text").fill("Nettchen ist die Tochter des Amtsrats …");
await foto(lea, "lea-auftrag");
await lea.getByRole("button", { name: "Abgeben" }).click(); await lea.waitForTimeout(500);
await foto(lea, "lea-auftrag-abgegeben");
await lea.goto(`${B}/s/seeufer/formulare`); await lea.waitForLoadState("networkidle");
await lea.getByRole("link", { name: /Kommaregeln/ }).click(); await lea.waitForLoadState("networkidle");
await foto(lea, "lea-quiz");
await lea.goto(`${B}/s/seeufer/raum`); await lea.waitForLoadState("networkidle");
await lea.locator("a.karte").first().click(); await lea.waitForLoadState("networkidle");
await foto(lea, "lea-raum");

// Mutter Daniela (ohne 2FA-Pflicht? sonst richtet sie sie ein)
const mama = await sitzung("daniela.ammann@eltern.seeufer.test", "mama", { width: 390, height: 844 });
await foto(mama, "mama-start-mobil");
await mama.goto(`${B}/s/seeufer/?r=absenzen`); await mama.waitForLoadState("networkidle"); await foto(mama, "mama-absenzen-mobil");
await mama.goto(`${B}/s/seeufer/?r=kalender`); await mama.waitForLoadState("networkidle"); await foto(mama, "mama-kalender-mobil");
await mama.goto(`${B}/s/seeufer/mitteilungen`); await mama.waitForLoadState("networkidle"); await foto(mama, "mama-mitteilungen-mobil");

// Maturand/in 5c
const s5 = (await (await fetch(`${B}/api/health`).catch(() => null))) && null;
void s5;

// Öffentliches Formular (Elternabend)
const gast = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
gast.on("pageerror", (e) => fehler.push(`gast: ${e.message}`));
const slForm = await sl.evaluate(async () => { const l = await (await fetch("/api/formulare")).json(); const a = l.eigene.find((f) => f.art === "anmeldung"); return (await (await fetch(`/api/formulare/${a.id}`)).json()).link; });
await gast.goto(`${B}${slForm}`); await gast.waitForLoadState("networkidle"); await foto(gast, "gast-anmeldung");

await b.close();
console.log(fehler.length ? "FEHLER:\n" + fehler.join("\n") : "Keine Fehler.");
console.log("Bilder in", OUT);
