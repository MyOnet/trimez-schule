// Durchführung und Korrektur über die API: Start mit Code, keine Lösungen an Schüler, Speichern, Zeit, Abgabe, Aufsicht, Korrektur, Notenbuch, Rückgabe
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { authenticator } from "../apps/api/node_modules/otplib/index.js";
import { bauen } from "../apps/api/src/server.mjs";
import { beispielPdf } from "../packages/db/beispiel-pdf.mjs";

let app, lp, kunz, frei, schueler, schueler3b, admin, uid3a, uid3b, brunner, elias, alina;
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
  elias = await anmelden("elias.luthi.26002@schueler.seeufer.test", false);
  alina = await anmelden("alina.sutter.26003@schueler.seeufer.test", false);
  schueler = await anmelden("lea.ammann.26001@schueler.seeufer.test", false); // 3a
  const ueb = (await call("GET", "/api/uebersicht", lp)).json();
  uid3a = ueb.meinUnterricht.find((u) => u.klasse === "3a").id;
  uid3b = ueb.meinUnterricht.find((u) => u.klasse === "3b").id;
});
afterAll(() => app.close());

describe("Durchführung", () => {
  let pid, code, vLea, vElias, teile;
  it("starten nur, wenn bereit; der Code erscheint", async () => {
    const d = (await call("GET", "/api/pruefungen", lp)).json();
    pid = d.pruefungen.find((x) => x.titel === "Kleider machen Leute").id;
    expect((await call("POST", `/api/pruefungen/${pid}/starten`, brunner)).statusCode).toBe(404);
    const r = (await call("POST", `/api/pruefungen/${pid}/starten`, lp)).json();
    code = r.startcode; expect(code).toMatch(/^[A-Z2-9]{6}$/);
    expect((await call("POST", `/api/pruefungen/${pid}/starten`, lp)).statusCode).toBe(409);
    teile = (await call("GET", `/api/pruefungen/${pid}`, lp)).json().teile;
  });
  it("laufende Prüfung lässt sich nicht mehr ändern", async () => {
    expect((await call("PUT", `/api/teile/${teile[1].id}`, lp, { teil: teile[1] })).statusCode).toBe(409);
    expect((await call("DELETE", `/api/pruefungen/${pid}`, lp)).statusCode).toBe(409);
  });
  it("Schüler/innen sehen die laufende Prüfung und treten mit Code bei; falscher Code und fremde Klasse scheitern", async () => {
    expect((await call("GET", "/api/meine-pruefungen", schueler)).json().laufend[0].titel).toBe("Kleider machen Leute");
    expect((await call("POST", "/api/pruefungen/beitreten", schueler, { code: "AAAAAA" })).statusCode).toBe(404);
    expect((await call("POST", "/api/pruefungen/beitreten", lp, { code })).statusCode).toBe(404);
    vLea = (await call("POST", "/api/pruefungen/beitreten", schueler, { code: code.toLowerCase() })).json().versuch_id;
    vElias = (await call("POST", "/api/pruefungen/beitreten", elias, { code })).json().versuch_id;
    expect(vLea).toBeTruthy();
  });
  it("die Schülerfassung enthält keine Lösungen", async () => {
    const d = (await call("GET", `/api/versuche/${vLea}`, schueler)).json();
    const txt = JSON.stringify(d);
    expect(txt).not.toMatch(/"loesung"|"richtig"|Seldwyla|Wendepunkt|erwartung/);
    expect(d.teile.find((t) => t.typ === "zuordnung").inhalt.paare).toBeUndefined();
    expect(d.endet_am).toBeTruthy();
    expect((await call("GET", `/api/versuche/${vLea}`, elias)).statusCode).toBe(404);
  });
  it("Antworten werden gespeichert; doppelt gesendete Einträge werden ignoriert", async () => {
    const d = (await call("GET", `/api/versuche/${vLea}`, schueler)).json();
    const t = (typ) => d.teile.find((x) => x.typ === typ);
    const ein = t("einfach"), keller = ein.inhalt.optionen.find((o) => o.text === "Gottfried Keller").id;
    const z = t("zuordnung"), rechts = (txt) => z.inhalt.rechts.find((r) => r.text === txt).id;
    const zu = { [z.inhalt.links[0].id]: rechts("Schneidergeselle"), [z.inhalt.links[1].id]: rechts("Tochter des Amtsrats"), [z.inhalt.links[2].id]: rechts("Buchhalter und Rivale") };
    let r = (await call("POST", `/api/versuche/${vLea}/antworten`, schueler, { eintraege: [
      { seq: 1, teil_id: ein.id, wert: "x" }, { seq: 2, teil_id: ein.id, wert: keller }, { seq: 3, teil_id: t("kurz").id, wert: "Strapinski" },
      { seq: 4, teil_id: z.id, wert: zu }, { seq: 5, teil_id: t("freitext").id, wert: "Aus Scham und weil er Hunger hat." },
      { seq: 6, teil_id: t("reihenfolge").id, wert: [...teile.find((x) => x.typ === "reihenfolge").inhalt.elemente].reverse().map((e) => e.id) }] })).json();
    expect(r.seq).toBe(6);
    r = (await call("POST", `/api/versuche/${vLea}/antworten`, schueler, { eintraege: [{ seq: 2, teil_id: ein.id, wert: "überschrieben?" }] })).json();
    expect(r.seq).toBe(6);
    const v = (await call("GET", `/api/versuche/${vLea}`, schueler)).json();
    expect(v.antworten[ein.id]).toBe(keller);
    expect((await call("POST", `/api/versuche/${vLea}/antworten`, elias, { eintraege: [] })).statusCode).toBe(404);
  });
  it("Aufsicht zeigt Fortschritt und Warnungen; Zuschlag verlängert die Zeit", async () => {
    await call("POST", `/api/versuche/${vElias}/warnung`, elias, { art: "fokus" });
    const a = (await call("GET", `/api/pruefungen/${pid}/aufsicht`, lp)).json();
    expect(a.startcode).toBe(code);
    const lea = a.schueler.find((s) => s.vorname === "Lea"), el = a.schueler.find((s) => s.versuch && s.versuch.id === vElias);
    expect(lea.versuch.beantwortet).toBe(5);
    expect(el.versuch.warnungen).toBe(1);
    expect(a.schueler.filter((s) => !s.versuch).length).toBe(18);
    const vor = new Date(lea.versuch.endet_am).getTime();
    const z = (await call("POST", `/api/versuche/${vLea}/zuschlag`, lp, { minuten: 10 })).json();
    expect(new Date(z.endet_am).getTime() - vor).toBe(600000);
    expect((await call("GET", `/api/pruefungen/${pid}/aufsicht`, schueler)).statusCode).toBe(404);
  });
  it("Abgabe mit Quittung; danach keine Änderungen mehr, ausser die Lehrperson öffnet wieder", async () => {
    const q = (await call("POST", `/api/versuche/${vLea}/abgeben`, schueler)).json();
    expect(q.hash).toMatch(/^[0-9a-f]{64}$/); expect(q.beantwortet).toBe(5); expect(q.aufgaben).toBe(7);
    expect((await call("POST", `/api/versuche/${vLea}/antworten`, schueler, { eintraege: [{ seq: 9, teil_id: teile[1].id, wert: "a" }] })).statusCode).toBe(409);
    expect((await call("GET", `/api/versuche/${vLea}`, schueler)).json().status).toBe("abgegeben");
    expect((await call("POST", "/api/pruefungen/beitreten", schueler, { code })).statusCode).toBe(409);
    await call("POST", `/api/versuche/${vLea}/wieder-oeffnen`, lp);
    expect((await call("GET", `/api/versuche/${vLea}`, schueler)).json().status).toBe("laeuft");
    await call("POST", `/api/versuche/${vLea}/abgeben`, schueler);
  });
  it("die Zeit läuft ab: Antworten werden abgewiesen und automatisch abgegeben", async () => {
    const pg = (await import("pg")).default;
    const c = new pg.Client({ connectionString: "postgres://schule_owner:dev-owner@localhost/schule" }); await c.connect();
    await c.query("UPDATE pruefung SET gestartet_am = now() - interval '2 hours' WHERE id = $1", [pid]); await c.end();
    const r = await call("POST", `/api/versuche/${vElias}/antworten`, elias, { eintraege: [{ seq: 1, teil_id: teile[1].id, wert: "a" }] });
    expect(r.statusCode).toBe(409); expect(r.json().fehler).toMatch(/Zeit ist abgelaufen/);
  });
  it("nicht verschobene Reihenfolge zählt so, wie sie angezeigt wurde", async () => {
    const pg = (await import("pg")).default;
    const c = new pg.Client({ connectionString: "postgres://schule_owner:dev-owner@localhost/schule" }); await c.connect();
    const { rows } = await c.query("SELECT antworten FROM versuch WHERE id = $1", [vElias]); await c.end();
    expect(rows[0].antworten[teile.find((x) => x.typ === "reihenfolge").id]).toBeUndefined(); // gespeichert wird nichts …
  });
  it("beenden: Prüfung ist zu, Code ungültig", async () => {
    expect((await call("POST", `/api/pruefungen/${pid}/beenden`, lp)).statusCode).toBe(200);
    expect((await call("POST", "/api/pruefungen/beitreten", alina, { code })).statusCode).toBe(404);
    const a = (await call("GET", `/api/pruefungen/${pid}/aufsicht`, lp)).json();
    expect(a.status).toBe("beendet"); expect(a.schueler.find((s) => s.versuch && s.versuch.id === vElias).versuch.abgabe_art).toBe("zeit");
  });

  describe("Korrektur", () => {
    let k, frei;
    it("automatische Punkte; Freitext ist offen", async () => {
      k = (await call("GET", `/api/pruefungen/${pid}/korrektur`, lp)).json();
      const lea = k.schueler.find((s) => s.versuch && s.versuch.id === vLea);
      frei = k.teile.find((t) => t.typ === "freitext");
      expect(lea.teile[frei.id].offen).toBe(true);
      expect(lea.offen).toBe(1);
      expect(lea.punkte).toBe(1 + 1 + 3); // Einfachauswahl, Kurzantwort, Zuordnung (Reihenfolge umgekehrt: 0)
      const el = k.schueler.find((s) => s.versuch && s.versuch.id === vElias);
      const rf = k.teile.find((t) => t.typ === "reihenfolge");
      expect(Array.isArray(el.versuch.antworten[rf.id])).toBe(true); // … bewertet wird die angezeigte Reihenfolge
      expect((await call("GET", `/api/pruefungen/${pid}/korrektur`, brunner)).statusCode).toBe(404);
    });
    it("Notenbuch und Rückgabe erst, wenn alles korrigiert ist", async () => {
      expect((await call("POST", `/api/pruefungen/${pid}/notenbuch`, lp)).statusCode).toBe(409);
      expect((await call("PUT", `/api/versuche/${vLea}/korrektur/${frei.id}`, lp, { punkte: 9 })).statusCode).toBe(400);
      await call("PUT", `/api/versuche/${vLea}/korrektur/${frei.id}`, lp, { punkte: 4.5, kommentar: "Gute Gründe, eine Textstelle fehlt." });
      // Kurzantwort von Hand auf 0 setzen und wieder auf automatisch
      const kurz = k.teile.find((t) => t.typ === "kurz");
      await call("PUT", `/api/versuche/${vLea}/korrektur/${kurz.id}`, lp, { punkte: 0 });
      await call("PUT", `/api/versuche/${vLea}/korrektur/${kurz.id}`, lp, { punkte: null });
      k = (await call("GET", `/api/pruefungen/${pid}/korrektur`, lp)).json();
      const lea = k.schueler.find((s) => s.versuch && s.versuch.id === vLea);
      expect(lea.punkte).toBe(9.5); expect(lea.offen).toBe(0);
      expect(lea.note).toBeGreaterThan(1);
    });
    it("ins Notenbuch: Entwurf mit Punkten und Noten, Abwesende markiert", async () => {
      const r = (await call("POST", `/api/pruefungen/${pid}/notenbuch`, lp)).json();
      const nb = (await call("GET", `/api/notenbuch/${uid3a}`, lp)).json();
      const b = nb.bewertungen.find((x) => x.id === r.bewertung_id);
      expect(b.status).toBe("entwurf"); expect(Number(b.max_punkte)).toBe(19 - 1); // 18 Punkte in der Seed-Prüfung
      const l = nb.leistungen.filter((x) => x.bewertung_id === b.id);
      expect(l.find((x) => x.punkte == 9.5)).toBeTruthy();
      expect(l.filter((x) => x.kennzeichen === "abwesend").length).toBe(18);
      // nochmals übernehmen aktualisiert dieselbe Bewertung
      expect((await call("POST", `/api/pruefungen/${pid}/notenbuch`, lp)).json().bewertung_id).toBe(r.bewertung_id);
    });
    it("Rückgabe: Schülerin sieht ihr Ergebnis mit Kommentar, vorher nicht", async () => {
      expect((await call("GET", `/api/versuche/${vLea}/ergebnis`, schueler)).statusCode).toBe(404);
      await call("POST", `/api/pruefungen/${pid}/zurueckgeben`, lp);
      const e = (await call("GET", `/api/versuche/${vLea}/ergebnis`, schueler)).json();
      expect(e.ergebnis.punkte).toBe(9.5);
      expect(e.ergebnis.teile[frei.id].kommentar).toMatch(/Textstelle/);
      expect((await call("GET", `/api/versuche/${vLea}/ergebnis`, elias)).statusCode).toBe(404);
      expect((await call("GET", "/api/meine-pruefungen", schueler)).json().zurueck[0].versuch_id).toBe(vLea);
    });
  });
});
