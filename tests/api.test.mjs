// API: Anmeldung, Zwei-Faktor-Pflicht, Rechte pro Rolle (mit der Testschule «seeufer»)
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { authenticator } from "../apps/api/node_modules/otplib/index.js";
import { bauen } from "../apps/api/src/server.mjs";

let app;
const PW = "Seeufer-Test-2026!";
beforeAll(async () => { execSync("node packages/db/seed.mjs", { cwd: new URL("..", import.meta.url).pathname }); app = await bauen(); });
afterAll(async () => { await app.close(); });

const H = { "x-schule": "1" };
async function anmelden(email, mit2fa = true) {
  const r = await app.inject({ method: "POST", url: "/api/s/seeufer/anmelden", headers: H, payload: { email, passwort: PW } });
  expect(r.statusCode).toBe(200);
  const cookie = r.headers["set-cookie"].split(";")[0];
  if (mit2fa) {
    const s = (await app.inject({ method: "POST", url: "/api/konto/2fa/start", headers: { ...H, cookie } })).json();
    if (s.geheim) expect((await app.inject({ method: "POST", url: "/api/konto/2fa/bestaetigen", headers: { ...H, cookie }, payload: { code: authenticator.generate(s.geheim) } })).statusCode).toBe(200);
  }
  return cookie;
}
const get = (url, cookie) => app.inject({ method: "GET", url, headers: { cookie } });

describe("Anmeldung", () => {
  it("falsches Passwort → 401 mit deutscher Meldung", async () => {
    const r = await app.inject({ method: "POST", url: "/api/s/seeufer/anmelden", headers: H, payload: { email: "admin@seeufer.test", passwort: "falsch" } });
    expect(r.statusCode).toBe(401); expect(r.json().fehler).toMatch(/stimmt nicht/);
  });
  it("unbekannte Schule → 404", async () => { expect((await app.inject({ method: "GET", url: "/api/schule/gibtsnicht" })).statusCode).toBe(404); });
  it("schreibende Aufrufe ohne Schutz-Header werden abgelehnt", async () => {
    const r = await app.inject({ method: "POST", url: "/api/s/seeufer/anmelden", payload: { email: "admin@seeufer.test", passwort: PW } });
    expect(r.statusCode).toBe(403);
  });
  it("ohne Zwei-Faktor sind nur Konto-Seiten erlaubt", async () => {
    const c = await anmelden("sandra.frei@seeufer.test", false);
    expect((await get("/api/ich", c)).statusCode).toBe(200);
    expect((await get("/api/ich", c)).json().zweiterFaktor.einrichtenPflicht).toBe(true);
    const r = await get("/api/klassen", c);
    expect(r.statusCode).toBe(403); expect(r.json().feld).toBe("zweiter_faktor");
  });
  it("nach Abmelden ist die Sitzung ungültig", async () => {
    const c = await anmelden("reto.wyss@seeufer.test");
    await app.inject({ method: "POST", url: "/api/abmelden", headers: { ...H, cookie: c } });
    expect((await get("/api/ich", c)).statusCode).toBe(401);
  });
});

describe("Rechte über die API", () => {
  let admin, lp, schueler;
  beforeAll(async () => { admin = await anmelden("admin@seeufer.test"); lp = await anmelden("martin.keller@seeufer.test"); schueler = await anmelden("lea.ammann.26001@schueler.seeufer.test", false); });
  it("Admin sieht alle 3 Klassen", async () => { expect((await get("/api/klassen", admin)).json()).toHaveLength(3); });
  it("Lehrperson sieht nur Klassen, in denen sie unterrichtet", async () => {
    const r = (await get("/api/klassen", lp)).json();
    expect(r.map((k) => k.name).sort()).toEqual(["3a", "3b", "5c"]); // Martin Keller unterrichtet Deutsch in allen drei
  });
  it("Lehrperson darf keine Personenliste und nichts verwalten", async () => {
    expect((await get("/api/personen", lp)).statusCode).toBe(403);
    const r = await app.inject({ method: "POST", url: "/api/faecher", headers: { ...H, cookie: lp }, payload: { name: "Hack", kuerzel: "H" } });
    expect(r.statusCode).toBe(403);
  });
  it("Schüler/in sieht nur die eigene Klasse, ohne E-Mail-Adressen der anderen", async () => {
    const liste = (await get("/api/klassen", schueler)).json();
    expect(liste.map((k) => k.name)).toEqual(["3a"]);
    const andere = (await get("/api/klassen", admin)).json().find((k) => k.name === "3b");
    expect((await get(`/api/klassen/${andere.id}`, schueler)).statusCode).toBe(403);
    const eigene = (await get(`/api/klassen/${liste[0].id}`, schueler)).json();
    expect(eigene.schueler.every((p) => p.email === null)).toBe(true);
  });
  it("Admin kann sich die Administration nicht selbst wegnehmen", async () => {
    const ich = (await get("/api/ich", admin)).json();
    const r = await app.inject({ method: "PUT", url: `/api/personen/${ich.person.id}`, headers: { ...H, cookie: admin }, payload: { vorname: "Ruth", nachname: "Bachmann", email: "admin@seeufer.test", rollen: ["schulleitung"] } });
    expect(r.statusCode).toBe(400);
  });
  it("Änderungen landen im Protokoll", async () => {
    await app.inject({ method: "POST", url: "/api/faecher", headers: { ...H, cookie: admin }, payload: { name: "Philosophie", kuerzel: "PH" } });
    const p = (await get("/api/protokoll", admin)).json();
    expect(p.some((x) => x.aktion === "fach.erstellt")).toBe(true);
    expect((await get("/api/protokoll", lp)).statusCode).toBe(403);
  });
});

describe("Anmeldung einer ganzen Klasse", () => {
  it("viele verschiedene Konten von derselben Adresse werden nicht gesperrt, wiederholte Versuche auf ein Konto schon", async () => {
    const a = await bauen();
    const H = { "x-schule": "1" };
    for (let k = 0; k < 15; k++) {
      const r = await a.inject({ method: "POST", url: "/api/s/seeufer/anmelden", headers: H, payload: { email: `niemand${k}@schueler.seeufer.test`, passwort: "falsch" } });
      expect(r.statusCode).not.toBe(429);
    }
    let gesperrt = false;
    for (let k = 0; k < 12; k++) { const r = await a.inject({ method: "POST", url: "/api/s/seeufer/anmelden", headers: H, payload: { email: "gleich@schueler.seeufer.test", passwort: "falsch" } }); if (r.statusCode === 429) gesperrt = true; }
    expect(gesperrt).toBe(true);
    await a.close();
  });
});
