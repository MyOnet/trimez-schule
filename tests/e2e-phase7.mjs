// Durchlauf Phase 7 im Browser: Unterrichtsmodus. Lehrperson startet eine Lektion, Lea im Browser, Elias in einer nachgebildeten
// Lernumgebung; An alle senden (Material, Seite), Bildschirme anhalten, beenden.
//   node tests/e2e-phase7.mjs [ordner]
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { signieren } from "../apps/api/src/lernumgebung.mjs";
const require = createRequire(import.meta.url);
const { chromium } = createRequire(process.env.PW_FROM || "/tmp/claude-0/st/redesign/gl.mjs")("playwright");
const { authenticator } = require("../apps/api/node_modules/otplib");

const B = process.env.BASIS || "http://localhost:5180";
const OUT = process.argv[2] || "/tmp/claude-0/schule-shots7";
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
  p.on("response", async (r) => { if (/\/api\/(versuche|lektionen)\/[0-9a-f-]{36}(\?|$)/.test(r.url()) && r.status() === 200) { try { const j = await r.json(); if (j.lernumgebung) konfig = j.lernumgebung.konfig_wert || "-"; } catch {} } });
  await p.route("**/api/**", (route) => {
    const req = route.request(), u = new URL(req.url()), zeit = String(Date.now());
    const sig = signieren(KEY, { methode: req.method(), pfad: u.pathname + u.search, zeit, geraet, sperre, konfig, koerper: req.postData() || "" });
    route.continue({ headers: { ...req.headers(), "x-lu-version": "1.0.0", "x-lu-plattform": "macos", "x-lu-geraet": geraet, "x-lu-zeit": zeit, "x-lu-sperre": sperre, "x-lu-konfig": konfig, "x-lu-signatur": sig } });
  });
  // Nachbildung der App inklusive Tabs (die echte App zeigt die Seite in einer eigenen Webansicht unter der Leiste)
  await p.addInitScript(() => {
    const st = { tabs: [], aktiv: null }; let n = 0;
    const kopie = () => ({ tabs: st.tabs.map((t) => ({ ...t })), aktiv: st.aktiv });
    window.trimezLernumgebung = Object.freeze({ version: "1.0.0", plattform: "windows", status: async (a) => { window.__luStatus = a; },
      seiteOeffnen: async (u) => { window.__luGeoeffnet = u; let t = st.tabs.find((x) => x.url === u); if (!t) { t = { id: "seite-" + (++n), url: u }; st.tabs.push(t); } st.aktiv = t.id; window.dispatchEvent(new Event("trimez-tabs")); return kopie(); },
      tabs: async () => kopie(), tabZeigen: async (id) => { st.aktiv = id || null; return kopie(); },
      tabSchliessen: async (id) => { st.tabs = st.tabs.filter((t) => t.id !== id); if (st.aktiv === id) st.aktiv = null; return kopie(); },
      beenden: async () => {}, hilfsmittelSchliessen: async () => { window.__luHilfeZu = (window.__luHilfeZu || 0) + 1; st.aktiv = null; } });
  });
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

// Lehrperson: Lektion in Deutsch 3a starten, Duden und Taschenrechner erlauben, Lernumgebung verlangen
const l = await sitzung("martin.keller@seeufer.test", "lp");
await l.goto(`${B}/s/seeufer/`); await l.locator(".ukarte", { hasText: "3a" }).first().click();
await l.getByRole("link", { name: "Lektion" }).click(); await l.waitForSelector(".lk-start");
await l.getByLabel("Adresse").fill("www.duden.de"); await l.getByLabel("Name der Seite").fill("Duden"); await l.getByRole("button", { name: "Erlauben" }).click();
await l.getByLabel(/Taschenrechner/).check(); await l.getByLabel(/Lernumgebung verlangen/).check();
await foto(l, "110-lektion-starten", false);
await l.getByRole("button", { name: "Lektion starten" }).click(); await l.waitForSelector(".lk-leiste");

// Lea im Browser: Karte auf der Übersicht, Hinweis auf die Lernumgebung
const lea = await sitzung("lea.ammann.26001@schueler.seeufer.test", "lea");
await lea.waitForSelector(".lektion-jetzt"); await foto(lea, "111-uebersicht-lektion", false);
await lea.getByRole("link", { name: "Zur Lektion" }).click(); await lea.waitForSelector(".lk-warten");
pruefe(await lea.locator("text=Ihre Lehrperson möchte, dass Sie die Lernumgebung verwenden").count() === 1, "Hinweis auf die Lernumgebung fehlt im Browser");

// Elias in der (nachgebildeten) Lernumgebung
const el = await sitzung("elias.luthi.26002@schueler.seeufer.test", "elias", { width: 1360, height: 860 }, true);
// Zuerst nicht zur Lektion, sondern zum Material: Die App erhält die Lektion trotzdem (Leiste oben, Abruf im Hintergrund)
const lektionsAbruf = el.waitForRequest((r) => /\/api\/lektionen\/[0-9a-f-]{36}\?puls=1/.test(r.url()), { timeout: 12000 });
await el.locator("nav").getByRole("link", { name: "Material", exact: true }).click(); await el.waitForSelector(".lektion-leiste");
await lektionsAbruf;
await el.locator(".lektion-leiste").click(); await el.waitForSelector(".lk-erlaubt");
await el.waitForTimeout(300);
pruefe(await el.evaluate(() => window.__luStatus === true), "App wurde nicht über die Lektion informiert");
await el.locator(".lk-seite", { hasText: "Duden" }).click();
pruefe((await el.evaluate(() => window.__luGeoeffnet)) === "https://www.duden.de", "Erlaubte Seite nicht über die App geöffnet");
await el.waitForSelector(".lu-tabs .lu-tab.aktiv >> text=duden.de");
await foto(el, "112a-tabs", false);
await el.getByRole("button", { name: "trimez.", exact: true }).click();
await el.waitForSelector(".lu-tabs button.lu-tab.aktiv");
await foto(el, "112-lektion-app", false);
// Material der Klasse in der App: PDF in der Ansicht über der Seite, Link über das Fenster für erlaubte Seiten
await el.locator(".mzeile", { hasText: "Kleider machen Leute" }).click();
await el.waitForSelector(".datei-ansicht .pdf-seiten canvas", { timeout: 15000 });
pruefe(await el.locator(".datei-ansicht .leer").count() === 0, "PDF liess sich nicht darstellen");
await foto(el, "112b-pdf-in-app", false);
await el.getByRole("button", { name: "Schliessen", exact: true }).click();
await el.locator(".mzeile", { hasText: "Duden online" }).click();
await el.waitForTimeout(400);
pruefe(String(await el.evaluate(() => window.__luGeoeffnet)).startsWith("https://www.duden.de"), "Link nicht über die App geöffnet: " + await el.evaluate(() => window.__luGeoeffnet));

// Lehrperson sieht beide, mit Modus
await l.waitForTimeout(3500);
const kachel = async (n) => (await l.locator(".lk-kachel", { hasText: n }).textContent());
pruefe((await kachel("Elias Lüthi")).includes("Lernumgebung, Mac"), "Kachel Elias: " + await kachel("Elias Lüthi"));
pruefe((await kachel("Lea Ammann")).includes("ohne Lernumgebung"), "Kachel Lea: " + await kachel("Lea Ammann"));
pruefe((await l.locator(".lk-stand b").textContent()).startsWith("2 von"), "Zahl der Anwesenden falsch");
await foto(l, "113-lektion-uebersicht", false);

// An alle senden: Text-Material der Klasse
await l.getByRole("button", { name: "An alle senden" }).click();
await l.locator("dialog .mzeile", { hasText: "Kommaregeln" }).click();
await l.waitForSelector(".lk-anstoss >> text=Kommaregeln");
await lea.waitForSelector(".lk-gezeigt >> text=Nebensätze werden mit Komma abgetrennt", { timeout: 10000 });
await foto(lea, "114-gezeigt-material", false);
await l.waitForTimeout(4500);
pruefe((await l.locator(".lk-anstoss .oeffnungen").textContent()).startsWith("2 von 2"), "Anstoss nicht bei allen angekommen: " + await l.locator(".lk-anstoss .oeffnungen").textContent());
await foto(l, "115-anstoss", false);

// Seite an alle: wird zugleich erlaubt
await l.getByRole("button", { name: "An alle senden" }).click(); await l.getByRole("tab", { name: "Seite im Internet" }).click();
await l.getByLabel("Adresse").fill("de.wikipedia.org/wiki/Gottfried_Keller"); await l.getByLabel(/^Name/).fill("Gottfried Keller"); await l.getByRole("button", { name: "Senden", exact: true }).click();
await el.waitForSelector(".lk-gezeigt >> text=Gottfried Keller", { timeout: 10000 });
await el.getByRole("button", { name: "Seite öffnen" }).click();
pruefe((await el.evaluate(() => window.__luGeoeffnet)) === "https://de.wikipedia.org/wiki/Gottfried_Keller", "Gesendete Seite nicht in der App geöffnet");
pruefe(await el.locator(".lk-seite", { hasText: "Gottfried Keller" }).count() === 1, "Gesendete Seite nicht unter «Erlaubt»");

// Seiten im laufenden Betrieb: einmal mit «Erlauben», einmal nur eingetippt und gleich «Speichern»
await l.getByRole("button", { name: /^Seiten \(/ }).click();
await l.locator("dialog").getByLabel("Adresse").fill("www.geogebra.org/calculator"); await l.locator("dialog").getByRole("button", { name: "Erlauben" }).click();
await l.locator("dialog").getByLabel("Adresse").fill("www.mathe-online.at");
await l.locator("dialog").getByRole("button", { name: "Speichern" }).click();
await l.waitForTimeout(800);
const seitenKnopf = await l.getByRole("button", { name: /^Seiten \(/ }).textContent();
pruefe(seitenKnopf.includes("(4)"), "Seiten nicht gespeichert: " + seitenKnopf);
await el.waitForSelector(".lk-seite >> text=mathe-online.at", { timeout: 10000 });

// Bildschirme anhalten
await l.getByRole("button", { name: "Bildschirme anhalten" }).click(); await l.waitForSelector(".lk-leiste.angehalten");
await lea.waitForSelector(".lk-halt", { timeout: 10000 }); await el.waitForSelector(".lk-halt", { timeout: 10000 });
pruefe((await el.evaluate(() => window.__luHilfeZu || 0)) > 0, "Hilfsmittel-Fenster beim Anhalten nicht geschlossen");
await foto(lea, "116-angehalten", false); await foto(l, "117-lp-angehalten", false);
await l.getByRole("button", { name: "Bildschirme freigeben" }).click();
await lea.waitForSelector(".lk-halt", { state: "detached", timeout: 10000 });

// Handy-Breite: Lektion für Lea
await lea.setViewportSize({ width: 390, height: 844 }); await foto(lea, "118-lektion-handy", true); await lea.setViewportSize({ width: 1360, height: 860 });

// Beenden: App wieder frei
l.once("dialog", () => {});
await l.getByRole("button", { name: "Beenden" }).click(); await l.waitForSelector(".lk-start");
await el.waitForSelector("text=Die Lektion ist beendet", { timeout: 10000 });
pruefe(await el.evaluate(() => window.__luStatus === false), "App nach der Lektion noch gesperrt");
await foto(el, "119-beendet", false);

await b.close();
console.log(fehler.length ? "FEHLER:\n" + fehler.join("\n") : "Durchlauf ohne Fehler.");
process.exit(fehler.length ? 1 : 0);
