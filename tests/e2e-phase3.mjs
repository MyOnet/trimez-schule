// Durchlauf Phase 3 im Browser: Material (Ablage, Suche, Hochladen, Freigabe, Klassenansicht, Schülersicht). Macht Bildschirmfotos.
//   node tests/e2e-phase3.mjs [ordner]
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import { beispielPdf } from "../packages/db/beispiel-pdf.mjs";
const require = createRequire(import.meta.url);
const { chromium } = createRequire(process.env.PW_FROM || "/tmp/claude-0/st/redesign/gl.mjs")("playwright");
const { authenticator } = require("../apps/api/node_modules/otplib");

const B = process.env.BASIS || "http://localhost:5180";
const OUT = process.argv[2] || "/tmp/claude-0/schule-shots3";
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

// Lehrperson: Ablage
const l = await sitzung("martin.keller@seeufer.test", "lp");
await l.getByRole("link", { name: "Material" }).click();
await l.waitForSelector(".mliste"); await foto(l, "40-ablage", false);
await l.locator(".ordner-kachel", { hasText: "Deutsch 3. Klasse" }).click();
await l.waitForSelector(".ordner-kachel >> text=Novelle"); await foto(l, "41-ordner", false);

// Suche im Inhalt eines PDF
await l.getByLabel("Material suchen").fill("Strapinski");
await l.waitForSelector(".mzeile .auszug mark"); await foto(l, "42-suche", false);
pruefe((await l.locator(".mzeile").count()) >= 2, "Suche nach Strapinski findet zu wenig");
await l.getByLabel("Material suchen").fill("");
await l.locator(".ablage-link", { hasText: "Meine Ablage" }).click(); await l.waitForTimeout(400);

// Hochladen über die Dateiauswahl (zwei Dateien)
await l.locator('input[type=file][multiple]').first().setInputFiles([
  { name: "Gedichtanalyse_Mondnacht.pdf", mimeType: "application/pdf", buffer: beispielPdf("Gedichtanalyse Mondnacht", ["Joseph von Eichendorff: Mondnacht. Untersuchen Sie Reimschema, Metrum und die Bildsprache des Gedichts."]) },
  { name: "Wortliste.txt", mimeType: "text/plain", buffer: Buffer.from("Metrum, Jambus, Trochäus, Kreuzreim, Paarreim") }]);
await l.waitForSelector(".meldung >> text=2 Dateien hochgeladen"); await l.waitForSelector(".mzeile >> text=Gedichtanalyse Mondnacht");
await foto(l, "43-hochgeladen", false);

// Schublade: Merkblatt mit Vorschau und Freigaben
await l.locator(".ablage-link", { hasText: "Meine Ablage" }).click();
await l.locator(".ordner-kachel", { hasText: "Deutsch 3. Klasse" }).click();
await l.locator(".mzeile", { hasText: "Merkblatt Erörterung" }).click();
await l.waitForSelector("dialog.schublade[open] >> text=14 von 20 geöffnet"); await foto(l, "44-schublade", false);
await l.keyboard.press("Escape"); await l.waitForTimeout(300);

// Neues Material freigeben für 3a, ab sofort
await l.locator(".ablage-link", { hasText: "Meine Ablage" }).click();
await l.locator(".mzeile", { hasText: "Gedichtanalyse Mondnacht" }).click({ timeout: 6000 }).catch(async (e) => { await foto(l, "x-fehler", false); console.log(fehler.join("\n")); throw e; });
await l.waitForSelector("dialog.schublade[open]");
await l.locator("dialog.schublade").getByRole("button", { name: "Freigeben" }).click();
await l.locator("dialog.schublade .wahl-chips label", { hasText: "3a Deutsch" }).click();
await l.locator("dialog.schublade").getByLabel("Hinweis für die Klasse").fill("Für die Lektion am Donnerstag");
await foto(l, "45-freigeben", false);
await l.locator("dialog.schublade .karte").getByRole("button", { name: "Freigeben" }).click();
await l.waitForSelector("dialog.schublade >> text=0 von 20 geöffnet");
await l.keyboard.press("Escape"); await l.waitForTimeout(300);

// Ziehen in einen Ordner (Ablage-Navigation)
await l.locator(".mzeile", { hasText: "Wortliste" }).dragTo(l.locator(".ablage-link", { hasText: "Deutsch 3. Klasse" }));
await l.waitForTimeout(600);
pruefe(!(await l.locator(".mzeile", { hasText: "Wortliste" }).count()), "Ziehen in den Ordner hat nicht verschoben");

// Fachgruppe
await l.getByRole("button", { name: /^Fachgruppe/ }).click(); await l.waitForSelector(".mzeile >> text=Zitieren und Belegen"); await foto(l, "46-fachgruppe", false);

// Klassenansicht 3a
await l.getByRole("link", { name: "3a Deutsch" }).click();
await l.waitForSelector("text=Sichtbar für die Klasse"); await l.waitForSelector("text=Geplant"); await foto(l, "47-klasse", true);
await l.getByRole("button", { name: "Aus der Ablage" }).first().click();
await l.locator("dialog[open]").getByLabel("Suchen").fill("Zitieren");
await l.locator("dialog[open] label.mzeile", { hasText: "Zitieren und Belegen" }).click();
await foto(l, "48-aus-ablage", false);
await l.locator("dialog[open]").getByRole("button", { name: "Freigeben" }).click();
await l.waitForSelector(".mliste >> text=Zitieren und Belegen");
// Reiter zum Notenbuch
await l.getByRole("link", { name: "Notenbuch" }).click(); await l.waitForSelector("table.nb");

// Papierkorb
await l.goto(`${B}/s/seeufer/material`); await l.waitForSelector(".mliste");
await l.locator(".mzeile", { hasText: "Ideen für die Projektwoche" }).click();
await l.locator("dialog.schublade").getByRole("button", { name: "In den Papierkorb" }).click();
await l.getByRole("button", { name: /^Papierkorb/ }).click(); await l.waitForSelector(".mzeile >> text=Ideen für die Projektwoche");

// Schülerin
const s = await sitzung("lea.ammann.26001@schueler.seeufer.test", "schuelerin");
await s.waitForSelector("text=neue Materialien"); await foto(s, "50-schuelerin-start", false);
await s.getByRole("link", { name: "Material", exact: true }).click(); await s.waitForSelector(".mliste");
const t = await s.locator("#inhalt").textContent();
pruefe(t.includes("Gedichtanalyse Mondnacht") && t.includes("Zitieren und Belegen"), "Freigegebenes fehlt bei der Schülerin");
pruefe(!t.includes("Lösungshinweise"), "Geplante Freigabe ist schon sichtbar");
pruefe(!t.includes("Wortliste") && !t.includes("Projektwoche"), "Nicht freigegebenes Material ist sichtbar");
await foto(s, "51-schuelerin-material", true);
await s.getByLabel("Material suchen").fill("Komma"); await s.waitForSelector(".mzeile >> text=Kommaregeln");
await s.locator(".mzeile", { hasText: "Kommaregeln" }).click(); await s.waitForSelector("dialog[open] .textinhalt"); await foto(s, "52-text", false);
// PDF öffnet in neuem Tab
await s.keyboard.press("Escape"); await s.getByLabel("Material suchen").fill("");
const anfragen = []; s.context().on("request", (r) => anfragen.push(r.url()));
const [tab] = await Promise.all([s.context().waitForEvent("page"), s.locator("a.mzeile", { hasText: "Gedichtanalyse Mondnacht" }).first().click()]);
await s.waitForTimeout(1500); pruefe(anfragen.some((u) => /\/api\/material\/[^/]+\/datei\?ansicht=1/.test(u)), "PDF öffnet nicht über die Datei-Adresse"); await tab.close();
const st = await s.evaluate(async () => (await fetch("/api/material")).status); pruefe(st === 403, "Schülerin erreicht die Ablage: " + st);
// Handy
const h = await sitzung("lea.ammann.26001@schueler.seeufer.test", "handy", { width: 390, height: 844 });
await h.goto(`${B}/s/seeufer/material`); await h.waitForSelector(".mliste"); await foto(h, "53-handy-material", false);
// Lehrperson sieht jetzt Öffnungen
await l.goto(`${B}/s/seeufer/material`); await l.locator(".mzeile", { hasText: "Gedichtanalyse Mondnacht" }).click();
await l.waitForSelector("dialog.schublade >> text=1 von 20 geöffnet");
const hl = await sitzung("martin.keller@seeufer.test", "lp-handy", { width: 390, height: 844 });
await hl.goto(`${B}/s/seeufer/material`); await hl.waitForSelector(".mliste"); await foto(hl, "54-handy-ablage", false);

await b.close();
console.log(fehler.length ? "FEHLER:\n" + fehler.join("\n") : "Durchlauf ohne Fehler.");
process.exit(fehler.length ? 1 : 0);
