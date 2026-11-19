// Notenbuch über die API: Rechte, Punkte → Note, Freigabe, Grund-Pflicht, Protokoll, Schüleransicht
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { authenticator } from "../apps/api/node_modules/otplib/index.js";
import { bauen } from "../apps/api/src/server.mjs";

let app, lp, lpFremd, schueler, sl, uid, schuelerId;
const PW = "Seeufer-Test-2026!", H = { "x-schule": "1" };
async function anmelden(email, mit2fa = true) {
  const r = await app.inject({ method: "POST", url: "/api/s/seeufer/anmelden", headers: H, payload: { email, passwort: PW } });
  const cookie = r.headers["set-cookie"].split(";")[0];
  if (mit2fa) { const s = (await app.inject({ method: "POST", url: "/api/konto/2fa/start", headers: { ...H, cookie } })).json(); await app.inject({ method: "POST", url: "/api/konto/2fa/bestaetigen", headers: { ...H, cookie }, payload: { code: authenticator.generate(s.geheim) } }); }
  return cookie;
}
const call = (method, url, cookie, payload) => app.inject({ method, url, headers: { ...H, cookie }, payload });

beforeAll(async () => {
  execSync("node packages/db/seed.mjs", { cwd: new URL("..", import.meta.url).pathname });
  app = await bauen();
  lp = await anmelden("martin.keller@seeufer.test");          // Deutsch in 3a
  lpFremd = await anmelden("sandra.frei@seeufer.test");       // Französisch, nicht Deutsch
  sl = await anmelden("admin@seeufer.test");                  // Administration und Schulleitung
  schueler = await anmelden("lea.ammann.26001@schueler.seeufer.test", false);
  const ueb = (await call("GET", "/api/uebersicht", lp)).json();
  uid = ueb.meinUnterricht.find((u) => u.klasse === "3a" && u.fach === "Deutsch").id;
});
afterAll(() => app.close());

describe("Notenbuch", () => {
  it("die Lehrperson sieht ihr Notenbuch mit Schnitten", async () => {
    const d = (await call("GET", `/api/notenbuch/${uid}`, lp)).json();
    expect(d.zeilen).toHaveLength(20);
    expect(d.bewertungen.length).toBe(3);
    expect(d.zeilen.every((z) => z.schnitt == null || (z.schnitt >= 1 && z.schnitt <= 6))).toBe(true);
    expect(d.darfSchreiben).toBe(true);
    schuelerId = d.zeilen.find((z) => z.nachname === "Ammann" && z.vorname === "Lea").id;
  });
  it("eine andere Lehrperson und Schüler/innen haben keinen Zugriff", async () => {
    expect((await call("GET", `/api/notenbuch/${uid}`, lpFremd)).statusCode).toBe(403);
    expect((await call("GET", `/api/notenbuch/${uid}`, schueler)).statusCode).toBe(403);
  });
  it("Einsicht der Schulleitung wird protokolliert", async () => {
    expect((await call("GET", `/api/notenbuch/${uid}`, sl)).statusCode).toBe(200);
    const p = (await call("GET", "/api/protokoll", sl)).json();
    expect(p.some((x) => x.aktion === "noten.eingesehen")).toBe(true);
  });
  let bid;
  it("neue Bewertung mit Punkten: Note wird mit dem Schlüssel berechnet", async () => {
    const b = (await call("POST", `/api/notenbuch/${uid}/bewertungen`, lp, { titel: "Testprüfung", datum: "2026-11-20", gewicht: 1, max_punkte: 40 })).json();
    bid = b.id;
    const r = (await call("PUT", `/api/bewertungen/${bid}/leistungen`, lp, { eintraege: [{ schueler_id: schuelerId, punkte: 30 }] })).json();
    expect(r.leistungen[0].note).toBe(4.8); // 1 + 5 × 30/40 = 4.75 → auf Zehntel 4.8
  });
  it("Punkte über dem Maximum werden abgelehnt", async () => {
    expect((await call("PUT", `/api/bewertungen/${bid}/leistungen`, lp, { eintraege: [{ schueler_id: schuelerId, punkte: 41 }] })).statusCode).toBe(400);
  });
  it("Entwürfe sind für Schüler/innen unsichtbar, nach Freigabe sichtbar", async () => {
    const vorher = (await call("GET", "/api/meine-noten", schueler)).json();
    expect(vorher.faecher.flatMap((f) => f.noten).some((n) => n.titel === "Testprüfung")).toBe(false);
    expect((await call("POST", `/api/bewertungen/${bid}/freigeben`, lp, {})).statusCode).toBe(200);
    const nachher = (await call("GET", "/api/meine-noten", schueler)).json();
    const n = nachher.faecher.flatMap((f) => f.noten).find((x) => x.titel === "Testprüfung");
    expect(n.note).toBe(4.8);
  });
  it("freigegebene Note ändern braucht einen Grund und wird mit alt/neu protokolliert", async () => {
    const ohne = await call("PUT", `/api/bewertungen/${bid}/leistungen`, lp, { eintraege: [{ schueler_id: schuelerId, punkte: 32 }] });
    expect(ohne.statusCode).toBe(409); expect(ohne.json().feld).toBe("grund");
    // ohne Grund wurde nichts gespeichert
    expect((await call("GET", `/api/notenbuch/${uid}`, lp)).json().leistungen.find((l) => l.bewertung_id === bid).punkte).toBe(30);
    const mit = await call("PUT", `/api/bewertungen/${bid}/leistungen`, lp, { eintraege: [{ schueler_id: schuelerId, punkte: 32 }], grund: "Korrekturfehler bei Aufgabe 3" });
    expect(mit.statusCode).toBe(200);
    const p = (await call("GET", "/api/protokoll", sl)).json();
    expect(p.some((x) => x.aktion === "note.geaendert" && x.grund === "Korrekturfehler bei Aufgabe 3")).toBe(true);
  });
  it("Kennzeichen «dispensiert» zählt nicht im Schnitt", async () => {
    await call("PUT", `/api/bewertungen/${bid}/leistungen`, lp, { eintraege: [{ schueler_id: schuelerId, kennzeichen: "dispensiert" }], grund: "Arztzeugnis" });
    const d = (await call("GET", `/api/notenbuch/${uid}`, lp)).json();
    expect(d.leistungen.find((l) => l.bewertung_id === bid && l.schueler_id === schuelerId)).toMatchObject({ note: null, kennzeichen: "dispensiert" });
  });
  it("fremde Personen können nicht eingetragen werden", async () => {
    const fremd = (await call("GET", "/api/personen?rolle=schueler&q=26050", sl)).json()[0];
    expect((await call("PUT", `/api/bewertungen/${bid}/leistungen`, lp, { eintraege: [{ schueler_id: fremd.id, note: 6 }], grund: "x" })).statusCode).toBe(400);
  });
  it("mündliche Beobachtungen ergeben eine Bewertung im Entwurf", async () => {
    const r = (await call("POST", `/api/notenbuch/${uid}/muendlich-uebernehmen`, lp, {})).json();
    expect(r.anzahl).toBeGreaterThan(10);
    expect(r.bewertung.status).toBe("entwurf");
  });
  it("Zeugnisnote nur in halben Noten", async () => {
    expect((await call("PUT", `/api/notenbuch/${uid}/zeugnis`, lp, { schueler_id: schuelerId, gesetzt: 4.75 })).statusCode).toBe(400);
    expect((await call("PUT", `/api/notenbuch/${uid}/zeugnis`, lp, { schueler_id: schuelerId, gesetzt: 5 })).statusCode).toBe(200);
  });
});
