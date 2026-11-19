// Unterrichtsmodus: Lektion starten, Rechte, Puls, Anstoss (Material und Seite), anhalten, Konfiguration für die Lernumgebung, beenden
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import { authenticator } from "../apps/api/node_modules/otplib/index.js";
import { bauen } from "../apps/api/src/server.mjs";
import { signieren, konfigWert } from "../apps/api/src/lernumgebung.mjs";

let app, lp, frei, brunner, lea, elias, uid3a, uid3b;
const PW = "Seeufer-Test-2026!", H = { "x-schule": "1" };
async function anmelden(email, mit2fa = true) {
  const r = await app.inject({ method: "POST", url: "/api/s/seeufer/anmelden", headers: H, payload: { email, passwort: PW } });
  const cookie = r.headers["set-cookie"].split(";")[0];
  if (mit2fa) { const s = (await app.inject({ method: "POST", url: "/api/konto/2fa/start", headers: { ...H, cookie } })).json(); await app.inject({ method: "POST", url: "/api/konto/2fa/bestaetigen", headers: { ...H, cookie }, payload: { code: authenticator.generate(s.geheim) } }); }
  return cookie;
}
const call = (method, url, cookie, payload) => app.inject({ method, url, headers: { ...H, cookie }, payload });
const KEY = Buffer.from(crypto.createHash("sha256").update("trimez-lernumgebung-entwicklung").digest("base64url"), "base64url");
function inApp(cookie, konfig = "-") {
  return (method, url, payload) => {
    const koerper = payload === undefined ? "" : JSON.stringify(payload), zeit = String(Date.now()), geraet = "geraet-elias-01", sperre = "aktiv;desktop,tastatur";
    const h = { ...H, cookie, "x-lu-version": "1.0.0", "x-lu-plattform": "macos", "x-lu-geraet": geraet, "x-lu-zeit": zeit, "x-lu-sperre": sperre, "x-lu-konfig": konfig,
      "x-lu-signatur": signieren(KEY, { methode: method, pfad: url, zeit, geraet, sperre, konfig, koerper }) };
    if (koerper) h["content-type"] = "application/json";
    return app.inject({ method, url, headers: h, payload: koerper || undefined });
  };
}

beforeAll(async () => {
  execSync("node packages/db/seed.mjs", { cwd: new URL("..", import.meta.url).pathname });
  app = await bauen();
  lp = await anmelden("martin.keller@seeufer.test");
  frei = await anmelden("sandra.frei@seeufer.test");
  brunner = await anmelden("thomas.brunner@seeufer.test");
  lea = await anmelden("lea.ammann.26001@schueler.seeufer.test", false);
  elias = await anmelden("elias.luthi.26002@schueler.seeufer.test", false);
  const ueb = (await call("GET", "/api/uebersicht", lp)).json();
  uid3a = ueb.meinUnterricht.find((u) => u.klasse === "3a").id;
  uid3b = ueb.meinUnterricht.find((u) => u.klasse === "3b").id;
});
afterAll(() => app.close());

describe("Unterrichtsmodus", () => {
  let lid;
  it("nur die unterrichtende Lehrperson startet; eine zweite Lektion im selben Unterricht geht nicht", async () => {
    expect((await call("POST", `/api/unterricht/${uid3a}/lektion`, brunner, {})).statusCode).toBe(404);
    expect((await call("POST", `/api/unterricht/${uid3a}/lektion`, lea, {})).statusCode).toBe(404);
    expect((await call("POST", `/api/unterricht/${uid3a}/lektion`, lp, { seiten: [{ url: "http://unsicher.example" }] })).statusCode).toBe(400);
    const r = await call("POST", `/api/unterricht/${uid3a}/lektion`, lp, { seiten: [{ titel: "Duden", url: "https://www.duden.de/" }], lernumgebung: true });
    expect(r.statusCode).toBe(200); lid = r.json().lektion_id;
    const zwei = await call("POST", `/api/unterricht/${uid3a}/lektion`, lp, {});
    expect(zwei.statusCode).toBe(409); expect(zwei.json().lektion_id).toBe(lid);
    const d = (await call("GET", `/api/unterricht/${uid3a}/lektion`, lp)).json();
    expect(d.lektion.id).toBe(lid); expect(d.lektion.seiten).toEqual([{ titel: "Duden", url: "https://www.duden.de" }]);
    expect((await call("GET", `/api/unterricht/${uid3b}/lektion`, lp)).json().lektion).toBe(null);
  });
  it("Schüler/innen der Klasse sehen die Lektion, andere nicht", async () => {
    expect((await call("GET", "/api/meine-lektionen", lea)).json().laufend.map((x) => x.id)).toContain(lid);
    // Lektion in der 3b: Lea (3a) sieht sie nicht
    const l3b = (await call("POST", `/api/unterricht/${uid3b}/lektion`, lp, {})).json().lektion_id;
    expect((await call("GET", "/api/meine-lektionen", lea)).json().laufend.map((x) => x.id)).not.toContain(l3b);
    expect((await call("GET", `/api/lektionen/${l3b}`, lea)).statusCode).toBe(404);
    await call("POST", `/api/lektionen/${l3b}/beenden`, lp);
    expect((await call("GET", `/api/lektionen/${lid}/uebersicht`, frei)).statusCode).toBe(404);
    expect((await call("PUT", `/api/lektionen/${lid}`, lea, { angehalten: true })).statusCode).toBe(404);
  });
  it("Puls im Browser und in der Lernumgebung; die Lehrperson sieht, wer womit dabei ist", async () => {
    const b = (await call("GET", `/api/lektionen/${lid}?puls=1&sichtbar=0`, lea)).json();
    expect(b.modus).toBe("browser"); expect(b.lernumgebung.pflicht).toBe(true);
    expect(b.lernumgebung.konfig).toEqual({ pruefung: lid, seiten: ["https://www.duden.de"], rechner: false });
    expect(b.lernumgebung.konfig_wert).toBe(konfigWert(b.lernumgebung.konfig));
    const a = (await inApp(elias)("GET", `/api/lektionen/${lid}?puls=1&sichtbar=1`)).json();
    expect(a.modus).toBe("gesperrt");
    const u = (await call("GET", `/api/lektionen/${lid}/uebersicht`, lp)).json();
    const t = (n) => u.schueler.find((s) => s.vorname === n).teilnahme;
    expect(t("Lea")).toMatchObject({ online: true, modus: "browser", sichtbar: false });
    expect(t("Elias")).toMatchObject({ online: true, modus: "gesperrt", plattform: "macos", sichtbar: true });
    expect(u.schueler.filter((s) => !s.teilnahme).length).toBe(u.schueler.length - 2);
  });
  it("Meldungen kommen nur von einer gültigen App", async () => {
    expect((await call("POST", `/api/lektionen/${lid}/warnung`, lea, { art: "prozess", detail: "x" })).statusCode).toBe(400);
    expect((await inApp(elias)("POST", `/api/lektionen/${lid}/warnung`, { art: "prozess", detail: "Discord wurde beendet" })).statusCode).toBe(200);
    const u = (await call("GET", `/api/lektionen/${lid}/uebersicht`, lp)).json();
    expect(u.schueler.find((s) => s.vorname === "Elias").teilnahme).toMatchObject({ warnungen: 1, warnung_art: "prozess" });
  });
  it("anhalten und Seiten ändern wirken sofort, auch auf die Konfiguration der App", async () => {
    await call("PUT", `/api/lektionen/${lid}`, lp, { angehalten: true, rechner: true, seiten: [{ url: "https://www.geogebra.org/calculator" }] });
    const s = (await call("GET", `/api/lektionen/${lid}`, lea)).json();
    expect(s.angehalten).toBe(true);
    expect(s.lernumgebung.konfig).toEqual({ pruefung: lid, seiten: ["https://www.geogebra.org/calculator"], rechner: true });
  });
  it("An alle senden: Seite wird zugleich erlaubt; Material wird für die Klasse freigegeben", async () => {
    let l = (await call("POST", `/api/lektionen/${lid}/anstoss`, lp, { art: "seite", url: "https://de.wikipedia.org/wiki/Gottfried_Keller", titel: "Keller" })).json();
    expect(l.anstoss).toMatchObject({ nr: 1, art: "seite", url: "https://de.wikipedia.org/wiki/Gottfried_Keller" });
    expect(l.seiten.map((x) => x.url)).toContain("https://de.wikipedia.org/wiki/Gottfried_Keller");
    expect((await call("POST", `/api/lektionen/${lid}/anstoss`, lp, { art: "seite", url: "javascript:alert(1)" })).statusCode).toBe(400);
    // eigenes Material, noch nicht freigegeben
    const m = (await call("POST", "/api/material", lp, { typ: "text", titel: "Arbeitsauftrag", inhalt: "Lest Seite 12." })).json();
    expect((await call("GET", `/api/material/${m.id}`, lea)).statusCode).toBe(404);
    expect((await call("POST", `/api/lektionen/${lid}/anstoss`, brunner, { art: "material", material_id: m.id })).statusCode).toBe(404);
    l = (await call("POST", `/api/lektionen/${lid}/anstoss`, lp, { art: "material", material_id: m.id })).json();
    expect(l.anstoss).toMatchObject({ nr: 2, art: "material", material_id: m.id, titel: "Arbeitsauftrag" });
    expect((await call("GET", `/api/material/${m.id}`, lea)).statusCode).toBe(200);
    // gesehen? Lea meldet Nr. 2, Elias nicht
    await call("GET", `/api/lektionen/${lid}?puls=1&nr=2`, lea);
    await inApp(elias)("GET", `/api/lektionen/${lid}?puls=1&nr=1`);
    const u = (await call("GET", `/api/lektionen/${lid}/uebersicht`, lp)).json();
    expect(u.schueler.find((s) => s.vorname === "Lea").teilnahme.gesehen).toBe(true);
    expect(u.schueler.find((s) => s.vorname === "Elias").teilnahme.gesehen).toBe(false);
    expect((await call("POST", `/api/lektionen/${lid}/anstoss`, lp, { art: "keiner" })).json().anstoss).toBe(null);
  });
  it("beenden: keine Konfiguration mehr, Änderungen gehen nicht, eine neue Lektion kann beginnen", async () => {
    expect((await call("POST", `/api/lektionen/${lid}/beenden`, lp)).statusCode).toBe(200);
    const s = (await call("GET", `/api/lektionen/${lid}?puls=1`, lea)).json();
    expect(s.beendet).toBe(true); expect(s.lernumgebung.konfig).toBe(null);
    expect((await call("PUT", `/api/lektionen/${lid}`, lp, { angehalten: true })).statusCode).toBe(409);
    expect((await call("GET", "/api/meine-lektionen", lea)).json().laufend).toEqual([]);
    const v = (await call("GET", `/api/unterricht/${uid3a}/lektion`, lp)).json();
    expect(v.lektion).toBe(null); expect(v.vorlage.rechner).toBe(true);
    const neu = await call("POST", `/api/unterricht/${uid3a}/lektion`, lp, v.vorlage);
    expect(neu.statusCode).toBe(200);
    await call("POST", `/api/lektionen/${neu.json().lektion_id}/beenden`, lp);
  });
});
