// Prüfungen über die API: Rechte, Teile, Bereit-Prüfung, Reihenfolge, Kopie, Aufgabenbank, Umwandlung
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { authenticator } from "../apps/api/node_modules/otplib/index.js";
import { bauen } from "../apps/api/src/server.mjs";
import { beispielPdf } from "../packages/db/beispiel-pdf.mjs";

let app, lp, kunz, frei, schueler, schueler3b, admin, uid3a, uid3b, brunner;
const PW = "Seeufer-Test-2026!", H = { "x-schule": "1" };
async function anmelden(email, mit2fa = true) {
  const r = await app.inject({ method: "POST", url: "/api/s/seeufer/anmelden", headers: H, payload: { email, passwort: PW } });
  const cookie = r.headers["set-cookie"].split(";")[0];
  if (mit2fa) { const s = (await app.inject({ method: "POST", url: "/api/konto/2fa/start", headers: { ...H, cookie } })).json(); await app.inject({ method: "POST", url: "/api/konto/2fa/bestaetigen", headers: { ...H, cookie }, payload: { code: authenticator.generate(s.geheim) } }); }
  return cookie;
}
const call = (method, url, cookie, payload) => app.inject({ method, url, headers: { ...H, cookie }, payload });
// multipart von Hand (ohne zusätzliche Pakete)
function hochladen(url, cookie, dateiname, inhalt, felder = {}) {
  const grenze = "----grenze" + Math.random().toString(16).slice(2);
  const teile = [];
  for (const [k, v] of Object.entries(felder)) teile.push(Buffer.from(`--${grenze}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  teile.push(Buffer.from(`--${grenze}\r\nContent-Disposition: form-data; name="datei"; filename="${dateiname}"\r\nContent-Type: application/octet-stream\r\n\r\n`), Buffer.from(inhalt), Buffer.from(`\r\n--${grenze}--\r\n`));
  return app.inject({ method: "POST", url, headers: { ...H, cookie, "content-type": `multipart/form-data; boundary=${grenze}` }, payload: Buffer.concat(teile) });
}

beforeAll(async () => {
  execSync("node packages/db/seed.mjs", { cwd: new URL("..", import.meta.url).pathname });
  app = await bauen();
  lp = await anmelden("martin.keller@seeufer.test");      // Deutsch 3a, 3b, 5c
  kunz = await anmelden("barbara.kunz@seeufer.test");     // Fachgruppe Deutsch, ohne Unterricht hier
  frei = await anmelden("sandra.frei@seeufer.test");      // Französisch
  admin = await anmelden("admin@seeufer.test");
  brunner = await anmelden("thomas.brunner@seeufer.test"); // Mathematik
  schueler = await anmelden("lea.ammann.26001@schueler.seeufer.test", false); // 3a
  const ueb = (await call("GET", "/api/uebersicht", lp)).json();
  uid3a = ueb.meinUnterricht.find((u) => u.klasse === "3a").id;
  uid3b = ueb.meinUnterricht.find((u) => u.klasse === "3b").id;
});
afterAll(() => app.close());

describe("Prüfungen", () => {
  let pid, teile;
  it("Lehrperson sieht ihre Prüfungen, Schüler/innen und andere Lehrpersonen nicht", async () => {
    const d = (await call("GET", "/api/pruefungen", lp)).json();
    const p = d.pruefungen.find((x) => x.titel === "Kleider machen Leute");
    expect(p.status).toBe("bereit"); expect(p.punkte).toBe(18); expect(p.aufgaben).toBe(7);
    expect((await call("GET", `/api/pruefungen/${p.id}`, brunner)).statusCode).toBe(404);
    expect((await call("GET", `/api/pruefungen/${p.id}`, admin)).statusCode).toBe(404);
    expect((await call("GET", "/api/pruefungen", schueler)).statusCode).toBe(403);
    expect((await call("GET", `/api/pruefungen/${p.id}`, schueler)).statusCode).toBe(404);
  });
  it("neue Prüfung nur für eigenen Unterricht", async () => {
    expect((await call("POST", "/api/pruefungen", brunner, { unterricht_id: uid3a, titel: "x" })).statusCode).toBe(403);
    const r = await call("POST", "/api/pruefungen", lp, { unterricht_id: uid3a, titel: "Romantik", datum: "2026-12-10", dauer_min: 30 });
    expect(r.statusCode).toBe(200); pid = r.json().id;
  });
  it("unvollständige Aufgaben dürfen gespeichert werden, blockieren aber «bereit»", async () => {
    const a = (await call("POST", `/api/pruefungen/${pid}/teile`, lp, { teil: { typ: "einfach", punkte: 1, inhalt: { frage: "Wer schrieb «Mondnacht»?", optionen: [{ id: "a", text: "Eichendorff" }, { id: "b", text: "Novalis" }] }, loesung: {} } })).json();
    expect(a.fehler).toMatch(/richtige Antwort/);
    const r = await call("PUT", `/api/pruefungen/${pid}`, lp, { status: "bereit" });
    expect(r.statusCode).toBe(400); expect(r.json().fehler).toMatch(/unvollständig/);
    const b = (await call("PUT", `/api/teile/${a.id}`, lp, { teil: { ...a, loesung: { richtig: "a" } } })).json();
    expect(b.fehler).toBe(null);
    await call("POST", `/api/pruefungen/${pid}/teile`, lp, { teil: { typ: "freitext", punkte: 4, inhalt: { frage: "Deuten Sie die letzte Strophe." } } });
    await call("POST", `/api/pruefungen/${pid}/teile`, lp, { teil: { typ: "abschnitt", inhalt: { titel: "Teil A" } }, nach_nr: 0 });
    expect((await call("PUT", `/api/pruefungen/${pid}`, lp, { status: "bereit" })).json().status).toBe("bereit");
    const d = (await call("GET", `/api/pruefungen/${pid}`, lp)).json();
    teile = d.teile;
    expect(teile.map((t) => t.typ)).toEqual(["abschnitt", "einfach", "freitext"]);
    expect(d.punkte).toBe(5);
  });
  it("eine unvollständige Änderung setzt die Prüfung zurück auf Entwurf", async () => {
    await call("PUT", `/api/teile/${teile[1].id}`, lp, { teil: { ...teile[1], loesung: {} } });
    expect((await call("GET", `/api/pruefungen/${pid}`, lp)).json().status).toBe("entwurf");
    await call("PUT", `/api/teile/${teile[1].id}`, lp, { teil: teile[1] });
  });
  it("Reihenfolge ändern und Teil löschen nummeriert neu", async () => {
    await call("POST", `/api/pruefungen/${pid}/reihenfolge`, lp, { ids: [teile[2].id, teile[0].id, teile[1].id] });
    let d = (await call("GET", `/api/pruefungen/${pid}`, lp)).json();
    expect(d.teile.map((t) => t.typ)).toEqual(["freitext", "abschnitt", "einfach"]);
    expect((await call("POST", `/api/pruefungen/${pid}/reihenfolge`, lp, { ids: [teile[0].id] })).statusCode).toBe(400);
    await call("DELETE", `/api/teile/${teile[0].id}`, lp);
    d = (await call("GET", `/api/pruefungen/${pid}`, lp)).json();
    expect(d.teile.map((t) => t.nr)).toEqual([1, 2]);
  });
  it("Kopie für die Parallelklasse, nicht für fremden Unterricht", async () => {
    const k = (await call("POST", `/api/pruefungen/${pid}/kopieren`, lp, { unterricht_id: uid3b })).json();
    const d = (await call("GET", `/api/pruefungen/${k.id}`, lp)).json();
    expect(d.klasse).toBe("3b"); expect(d.teile).toHaveLength(2);
    const m3a = (await call("GET", "/api/pruefungen", brunner)).json().meinUnterricht.find((u) => u.klasse === "3a");
    expect((await call("POST", `/api/pruefungen/${pid}/kopieren`, lp, { unterricht_id: m3a.id })).statusCode).toBe(403);
  });
  it("Aufgabenbank: speichern, finden, in Prüfung einfügen; Kollegin der Fachgruppe sieht Geteiltes", async () => {
    const d = (await call("GET", `/api/pruefungen/${pid}`, lp)).json();
    const ein = d.teile.find((t) => t.typ === "einfach");
    const a = (await call("POST", "/api/aufgaben", lp, { teil: ein, teil_id: ein.id, geteilt: "privat", schlagworte: "lyrik, romantik" })).json();
    expect((await call("GET", "/api/aufgaben?suche=Mondnacht", lp)).json().some((x) => x.id === a.id)).toBe(true);
    expect((await call("GET", "/api/aufgaben?suche=Mondnacht", kunz)).statusCode).toBe(403); // ohne eigenen Unterricht keine Prüfungen
    expect((await call("GET", "/api/aufgaben?suche=Komma", brunner)).json().length).toBe(0); // Fachgruppe Deutsch
    expect((await call("POST", "/api/aufgaben", lp, { teil: { typ: "einfach", inhalt: { frage: "x" } } })).statusCode).toBe(400);
    const bank = (await call("GET", "/api/aufgaben?suche=Komma", lp)).json();
    await call("POST", `/api/pruefungen/${pid}/aus-bank`, lp, { aufgabe_ids: [bank[0].id] });
    expect((await call("GET", `/api/pruefungen/${pid}`, lp)).json().teile.at(-1).typ).toBe("luecken");
    expect((await call("DELETE", `/api/aufgaben/${a.id}`, brunner)).statusCode).toBe(404);
  });
  it("Umwandlung einer Word-ähnlichen Textdatei: Vorschlag, dann übernehmen", async () => {
    const txt = "Probe Romantik\nName: ____\n1. Wer schrieb «Mondnacht»? (1 P.)\na) Eichendorff\nb) Goethe\n2. Erklären Sie das Motiv der Sehnsucht. (4 P.)\n__________\n__________";
    const r = await hochladen(`/api/pruefungen/${pid}/umwandlung`, lp, "probe.txt", Buffer.from(txt));
    expect(r.statusCode).toBe(200);
    const { id: uid, verfahren, titel, anzahl } = r.json();
    expect(verfahren).toBe("regeln"); expect(titel).toBe("Probe Romantik"); expect(anzahl).toBe(2);
    const u = (await call("GET", `/api/umwandlungen/${uid}`, lp)).json();
    expect(u.vorschlag[0].typ).toBe("einfach"); expect(u.vorschlag[0].fehler).toMatch(/richtige Antwort/);
    expect(u.vorschlag[1].typ).toBe("freitext"); expect(u.vorschlag[1].punkte).toBe(4);
    expect(u.datei_key).toBeUndefined();
    expect((await call("GET", `/api/umwandlungen/${uid}`, brunner)).statusCode).toBe(404);
    const vorher = (await call("GET", `/api/pruefungen/${pid}`, lp)).json().teile.length;
    const ue = (await call("POST", `/api/umwandlungen/${uid}/uebernehmen`, lp, { teile: u.vorschlag })).json();
    expect(ue).toMatchObject({ anzahl: 2, unvollstaendig: 1 });
    expect((await call("GET", `/api/pruefungen/${pid}`, lp)).json().teile.length).toBe(vorher + 2);
    expect((await call("POST", `/api/umwandlungen/${uid}/uebernehmen`, lp, {})).statusCode).toBe(409);
  });
  it("Umwandlung lehnt Bilder und leere Dateien ab", async () => {
    expect((await hochladen(`/api/pruefungen/${pid}/umwandlung`, lp, "bild.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0]))).statusCode).toBe(415);
    expect((await hochladen(`/api/pruefungen/${pid}/umwandlung`, lp, "leer.txt", Buffer.from("  "))).statusCode).toBe(422);
  });
  it("löschen", async () => {
    expect((await call("DELETE", `/api/pruefungen/${pid}`, brunner)).statusCode).toBe(404);
    expect((await call("DELETE", `/api/pruefungen/${pid}`, lp)).statusCode).toBe(200);
    expect((await call("GET", `/api/pruefungen/${pid}`, lp)).statusCode).toBe(404);
  });
});
