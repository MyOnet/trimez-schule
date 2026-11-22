// Schulbetrieb: Aufträge, Klassenraum, Mitteilungen, Formulare, Kalender, Absenzen, Ablage, Zeugnisse, Maturaarbeit, Elternzugang
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { authenticator } from "../apps/api/node_modules/otplib/index.js";
import { bauen } from "../apps/api/src/server.mjs";

let app, admin, lp, frei, brunner, huber, steiner, lea, elias, mama, maturand;
let uD3a, uM3a, uE3a, uD3b, k3a, leaId, eliasId;
const PW = "Seeufer-Test-2026!", H = { "x-schule": "1" };
async function anmelden(email, mit2fa = true) {
  const r = await app.inject({ method: "POST", url: "/api/s/seeufer/anmelden", headers: H, payload: { email, passwort: PW } });
  expect(r.statusCode, email).toBe(200);
  const cookie = r.headers["set-cookie"].split(";")[0];
  if (mit2fa) { const s = (await app.inject({ method: "POST", url: "/api/konto/2fa/start", headers: { ...H, cookie } })).json(); await app.inject({ method: "POST", url: "/api/konto/2fa/bestaetigen", headers: { ...H, cookie }, payload: { code: authenticator.generate(s.geheim) } }); }
  return cookie;
}
const call = (method, url, cookie, payload) => app.inject({ method, url, headers: { ...H, cookie }, payload });
const ok = async (method, url, cookie, payload) => { const r = await call(method, url, cookie, payload); if (r.statusCode !== 200) throw new Error(`${method} ${url} → ${r.statusCode} ${r.body}`); return r.json(); };
function hochladen(url, cookie, name, inhalt, mime = "application/pdf", felder = {}) {
  const grenze = "----rescool" + Math.random().toString(16).slice(2);
  const teile = Object.entries(felder).map(([k, v]) => `--${grenze}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`).join("");
  const body = Buffer.concat([Buffer.from(teile + `--${grenze}\r\nContent-Disposition: form-data; name="datei"; filename="${name}"\r\nContent-Type: ${mime}\r\n\r\n`), Buffer.from(inhalt), Buffer.from(`\r\n--${grenze}--\r\n`)]);
  return app.inject({ method: "POST", url, headers: { ...H, cookie, "content-type": `multipart/form-data; boundary=${grenze}` }, payload: body });
}
const PDF = "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n";
const zuerich = (n = 0) => new Date(Date.now() + n * 864e5).toLocaleDateString("sv-SE", { timeZone: "Europe/Zurich" });

beforeAll(async () => {
  execSync("node packages/db/seed.mjs", { cwd: new URL("..", import.meta.url).pathname });
  app = await bauen();
  admin = await anmelden("admin@seeufer.test");
  lp = await anmelden("martin.keller@seeufer.test");
  frei = await anmelden("sandra.frei@seeufer.test");
  brunner = await anmelden("thomas.brunner@seeufer.test");
  huber = await anmelden("nadine.huber@seeufer.test");
  steiner = await anmelden("claudia.steiner@seeufer.test");
  lea = await anmelden("lea.ammann.26001@schueler.seeufer.test", false);
  elias = await anmelden("elias.luthi.26002@schueler.seeufer.test", false);
  mama = await anmelden("daniela.ammann@eltern.seeufer.test", false);
  const ueb = (await call("GET", "/api/uebersicht", lp)).json();
  uD3a = ueb.meinUnterricht.find((u) => u.klasse === "3a").id;
  uD3b = ueb.meinUnterricht.find((u) => u.klasse === "3b").id;
  uM3a = (await call("GET", "/api/uebersicht", brunner)).json().meinUnterricht.find((u) => u.klasse === "3a").id;
  uE3a = (await call("GET", "/api/uebersicht", huber)).json().meinUnterricht.find((u) => u.klasse === "3a").id;
  leaId = (await ok("GET", "/api/ich", lea)).person.id;
  eliasId = (await ok("GET", "/api/ich", elias)).person.id;
});
afterAll(() => app && app.close());

describe("Aufträge", () => {
  let aid;
  it("Lehrperson erstellt und veröffentlicht; andere Lehrpersonen und Schüler/innen nicht", async () => {
    expect((await call("POST", `/api/unterricht/${uD3a}/auftraege`, frei, { titel: "x" })).statusCode).toBe(403);
    expect((await call("POST", `/api/unterricht/${uD3a}/auftraege`, lea, { titel: "x" })).statusCode).toBe(403);
    const a = await ok("POST", `/api/unterricht/${uD3a}/auftraege`, lp, { titel: "Kurzgeschichte", anleitung: "Eine Seite.", faellig_am: new Date(Date.now() + 2 * 864e5).toISOString(), punkte_max: 10,
      raster: [{ id: "inhalt", kriterium: "Inhalt", punkte: 6 }, { id: "sprache", kriterium: "Sprache", punkte: 4 }], abgabe: { text: true, datei: true, notizbuch: false } });
    aid = a.id;
    // Entwürfe sehen Schüler/innen nicht
    expect((await ok("GET", "/api/meine-auftraege", lea)).liste?.some?.((x) => x.id === aid) ?? false).toBe(false);
    await ok("POST", `/api/auftraege/${aid}/veroeffentlichen`, lp);
    const m = await ok("GET", "/api/meine-auftraege", lea);
    expect(JSON.stringify(m)).toContain(aid);
  });
  it("Schülerin gibt Text und Datei ab; Abgabe sperrt das Bearbeiten", async () => {
    await ok("PUT", `/api/auftraege/${aid}/meine-abgabe`, lea, { text: "Es war einmal …" });
    const f = await hochladen(`/api/auftraege/${aid}/meine-abgabe/dateien`, lea, "geschichte.pdf", PDF);
    expect(f.statusCode, f.body).toBe(200);
    await ok("POST", `/api/auftraege/${aid}/abgeben`, lea);
    expect((await call("PUT", `/api/auftraege/${aid}/meine-abgabe`, lea, { text: "neu" })).statusCode).toBe(409);
  });
  it("Lehrperson sieht, wer fehlt, erinnert (nur einmal am Tag) und bewertet mit Raster", async () => {
    const d = await ok("GET", `/api/auftraege/${aid}`, lp);
    const fehlt = d.liste.filter((s) => s.stand === "fehlt" || s.stand === "offen");
    expect(fehlt.length).toBeGreaterThan(10);
    const e1 = await ok("POST", `/api/auftraege/${aid}/erinnern`, lp);
    const e2 = await ok("POST", `/api/auftraege/${aid}/erinnern`, lp);
    expect(e1.erinnert).toBeGreaterThan(10);
    expect(e2.erinnert).toBe(0);
    expect((await call("PUT", `/api/auftraege/${aid}/abgaben/${leaId}`, lp, { raster_punkte: { inhalt: 9, sprache: 3 } })).statusCode).toBe(400);
    await ok("PUT", `/api/auftraege/${aid}/abgaben/${leaId}`, lp, { raster_punkte: { inhalt: 5, sprache: 3 }, rueckmeldung: "Gute Idee, Schluss ausbauen." });
    await ok("POST", `/api/auftraege/${aid}/abgaben/${leaId}/zurueckgeben`, lp, { art: "ueberarbeiten" });
    const meine = await ok("GET", `/api/auftraege/${aid}`, lea);
    expect(meine.abgabe.status).toBe("ueberarbeiten");
    expect(meine.abgabe.rueckmeldung).toMatch(/Schluss/);
    await ok("PUT", `/api/auftraege/${aid}/meine-abgabe`, lea, { text: "Es war einmal … (überarbeitet)" });
    await ok("POST", `/api/auftraege/${aid}/abgeben`, lea);
    expect((await ok("GET", `/api/auftraege/${aid}`, lea)).abgabe.version).toBe(2);
    await ok("POST", `/api/auftraege/${aid}/abgaben/${leaId}/zurueckgeben`, lp, { art: "bewertet" });
  });
  it("Punkte gehen als Entwurf ins Notenbuch (nochmals übertragen aktualisiert den Entwurf)", async () => {
    const r = await ok("POST", `/api/auftraege/${aid}/ins-notenbuch`, lp, { gewicht: 0.5 });
    expect(r.bewertung_id).toBeTruthy();
    // Nochmals übertragen aktualisiert denselben Entwurf
    expect((await ok("POST", `/api/auftraege/${aid}/ins-notenbuch`, lp, { gewicht: 0.5 })).bewertung_id).toBe(r.bewertung_id);
    expect((await call("POST", `/api/auftraege/${aid}/ins-notenbuch`, frei, {})).statusCode).toBe(404);
  });
});

describe("Klassenraum und Mitteilungen", () => {
  it("Ankündigung erreicht die Klasse als Mitteilung; Frage geht an die Lehrperson", async () => {
    await ok("POST", `/api/raum/${uD3a}/beitraege`, lp, { art: "ankuendigung", text: "Morgen Lektüre mitbringen." });
    const m = await ok("GET", "/api/mitteilungen", lea);
    expect(m.liste.some((x) => /Ankündigung|Deutsch/.test(x.titel))).toBe(true);
    const f = await ok("POST", `/api/raum/${uD3a}/beitraege`, lea, { art: "frage", text: "Welche Seiten?" });
    expect((await ok("GET", "/api/mitteilungen", lp)).ungelesen).toBeGreaterThan(0);
    await ok("POST", `/api/raum/${uD3a}/beitraege`, lp, { text: "Seiten 40 bis 52.", eltern_id: f.id });
    expect((await call("POST", `/api/raum/${uD3a}/beitraege`, lea, { art: "ankuendigung", text: "x" })).statusCode).toBe(403);
    expect((await call("GET", `/api/raum/${uD3a}`, frei)).statusCode).toBe(403);
    const r = await ok("GET", `/api/raum/${uD3a}`, elias);
    expect(r.beitraege.length).toBeGreaterThan(2);
  });
  it("Lehrperson kann Schüler-Beiträge abschalten", async () => {
    await ok("PUT", `/api/raum/${uD3a}/einstellungen`, lp, { schueler_schreiben: false });
    expect((await call("POST", `/api/raum/${uD3a}/beitraege`, lea, { art: "beitrag", text: "Hallo" })).statusCode).toBe(403);
    await ok("PUT", `/api/raum/${uD3a}/einstellungen`, lp, { schueler_schreiben: true });
  });
  it("Schulmitteilungen: nur die Schulleitung, Zielgruppen werden eingehalten", async () => {
    expect((await call("POST", "/api/schulmitteilungen", lp, { titel: "x", text: "y", zielgruppe: ["schueler"] })).statusCode).toBe(403);
    await ok("POST", "/api/schulmitteilungen", admin, { titel: "Nur für Lehrpersonen", text: "Konvent am Mittwoch.", zielgruppe: ["lehrperson"] });
    const s = await ok("GET", "/api/schulmitteilungen", lea);
    expect(JSON.stringify(s)).not.toContain("Nur für Lehrpersonen");
    expect(JSON.stringify(await ok("GET", "/api/schulmitteilungen", lp))).toContain("Nur für Lehrpersonen");
    expect(JSON.stringify(await ok("GET", "/api/schulmitteilungen", mama))).toContain("Elternabend");
  });
});

describe("Formulare", () => {
  let fid, token;
  it("Quiz bewertet sich selbst", async () => {
    const l = await ok("GET", "/api/formulare", lea);
    const quiz = l.fuerMich.find((f) => f.art === "quiz");
    const r = await ok("POST", `/api/formulare/${quiz.id}/antworten`, lea, { antworten: { f1: "a", f2: ["a", "c"] } });
    expect(r.punkte).toBe(3); expect(r.max).toBe(3);
  });
  it("Umfrage mit öffentlichem Link, CSV-Export ohne Formel-Einschleusung", async () => {
    const f = await ok("POST", "/api/formulare", lp, { art: "umfrage", titel: "Lektüre-Wunsch", fragen: [
      { id: "b", typ: "auswahl", inhalt: { frage: "Welches Buch?", optionen: [{ id: "a", text: "Der Besuch der alten Dame" }, { id: "b", text: "Andorra" }] } },
      { id: "t", typ: "text", pflicht: false, inhalt: { frage: "Begründung" } }], einstellungen: { oeffentlich: true } });
    fid = f.id;
    await ok("POST", `/api/formulare/${fid}/status`, lp, { status: "offen" });
    token = (await ok("GET", `/api/formulare/${fid}`, lp)).link.split("/").pop();
    expect((await app.inject({ method: "GET", url: `/api/f/${token}` })).statusCode).toBe(200);
    const p = await app.inject({ method: "POST", url: `/api/f/${token}`, headers: H, payload: { name: "Gast", antworten: { b: "b", t: "=HYPERLINK(\"x\")" } } });
    expect(p.statusCode, p.body).toBe(200);
    const csv = (await call("GET", `/api/formulare/${fid}/csv`, lp)).body;
    expect(csv).toContain("'=HYPERLINK");
    const d = await ok("GET", `/api/formulare/${fid}`, lp);
    expect(d.antworten.length).toBe(1);
  });
  it("Anmeldung: Zeitfenster füllen sich", async () => {
    const l = await ok("GET", "/api/formulare", admin);
    const anm = l.eigene.find((f) => f.art === "anmeldung");
    const d = await ok("GET", `/api/formulare/${anm.id}`, admin);
    const tk = d.link.split("/").pop();
    for (let n = 0; n < 3; n++) expect((await app.inject({ method: "POST", url: `/api/f/${tk}`, headers: H, payload: { name: `Eltern ${n}`, email: `e${n}@beispiel.ch`, antworten: { zeit: "t1", personen: "p1" } } })).statusCode).toBe(200);
    const voll = await app.inject({ method: "POST", url: `/api/f/${tk}`, headers: H, payload: { name: "Eltern 4", email: "e4@beispiel.ch", antworten: { zeit: "t1", personen: "p2" } } });
    expect(voll.statusCode).toBe(409);
  });
});

describe("Kalender und Prüfungslimit", () => {
  it("persönlicher Stundenplan mit Ausfall", async () => {
    const k = await ok("GET", `/api/kalender?von=${zuerich(0)}&bis=${zuerich(13)}`, lea);
    const lekt = k.eintraege.filter((e) => e.typ === "lektion");
    expect(lekt.length).toBeGreaterThan(20);
    expect(lekt.some((e) => e.aenderung && e.aenderung.art === "ausfall")).toBe(true);
  });
  it("Untis-Import: Vorschau ändert nichts, Import ersetzt nur Untis-Einträge", async () => {
    const gpu = ['1,"3a","KEM","D","A12",1,1', '2,"3a","BRT","M","B04",1,3', '3,"3a","XXX","XY","A12",2,1'].join("\r\n");
    const v = await hochladen("/api/stundenplan/untis", admin, "GPU001.TXT", gpu, "text/plain", { vorschau: "1" });
    expect(v.statusCode, v.body).toBe(200);
    expect(v.json().zugeordnet).toBe(2);
    expect(v.json().anzahlOffen).toBe(1); // Fach XY gibt es nicht
    expect((await hochladen("/api/stundenplan/untis", lp, "GPU001.TXT", gpu, "text/plain")).statusCode).toBe(403);
  });
  it("dritte Prüfung in einer Woche wird blockiert, die Schulleitung kann begründet bewilligen", async () => {
    const t = (u, datum, c, extra = {}) => call("POST", "/api/termine", c, { art: "pruefung", unterricht_id: u, titel: "Test", ganztag: true, datum, ...extra });
    expect((await t(uD3a, "2027-03-08", lp)).statusCode).toBe(200);
    const gleicherTag = await t(uM3a, "2027-03-08", brunner);
    expect(gleicherTag.statusCode).toBe(409);
    expect((await t(uM3a, "2027-03-10", brunner)).statusCode).toBe(200);
    const dritte = await t(uE3a, "2027-03-12", huber);
    expect(dritte.statusCode).toBe(409);
    expect(dritte.json().feld).toBe("limit");
    // andere Klasse betrifft das Limit nicht
    expect((await t(uD3b, "2027-03-12", lp)).statusCode).toBe(200);
    expect((await call("POST", "/api/termine", admin, { art: "pruefung", unterricht_id: uE3a, titel: "Nachprüfung", ganztag: true, datum: "2027-03-12", ausnahme_grund: "Verschiebung wegen Skilager" })).statusCode).toBe(200);
  });
  it("Kalender-Abo als iCal", async () => {
    const a = await ok("POST", "/api/kalender/abo", lea);
    const r = await app.inject({ method: "GET", url: a.pfad });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain("BEGIN:VCALENDAR");
    expect((await app.inject({ method: "GET", url: "/api/ical/falsch.ics" })).statusCode).toBe(404);
  });
});

describe("Absenzen", () => {
  it("Lehrperson erfasst, Eltern entschuldigen, Klassenlehrperson entscheidet", async () => {
    const gestern = zuerich(-1);
    expect((await call("PUT", `/api/absenzen/erfassen/${uD3a}`, frei, { datum: gestern, lektion: 2, eintraege: [{ schueler_id: leaId, art: "abwesend" }] })).statusCode).toBe(403);
    expect((await call("PUT", `/api/absenzen/erfassen/${uD3a}`, lp, { datum: zuerich(2), lektion: 2, eintraege: [{ schueler_id: leaId, art: "abwesend" }] })).statusCode).toBe(400);
    await ok("PUT", `/api/absenzen/erfassen/${uD3a}`, lp, { datum: gestern, lektion: 2, eintraege: [{ schueler_id: leaId, art: "abwesend" }] });
    const meine = await ok("GET", `/api/meine-absenzen?person=${leaId}`, mama);
    expect(meine.absenzen.some((a) => a.datum === gestern && a.status === "offen")).toBe(true);
    const e = await ok("POST", "/api/entschuldigungen", mama, { person_id: leaId, art: "entschuldigung", von: gestern, bis: gestern, grund: "krankheit", text: "Fieber." });
    // fremdes Kind: nein
    expect((await call("POST", "/api/entschuldigungen", mama, { person_id: eliasId, art: "entschuldigung", von: gestern, bis: gestern, grund: "krankheit" })).statusCode).toBe(403);
    expect((await call("POST", `/api/entschuldigungen/${e.id}/entscheiden`, frei, { status: "angenommen" })).statusCode).toBe(403);
    await ok("POST", `/api/entschuldigungen/${e.id}/entscheiden`, lp, { status: "angenommen" });
    const nachher = await ok("GET", `/api/meine-absenzen`, lea);
    expect(nachher.absenzen.find((a) => a.datum === gestern && a.lektion === 2).status).toBe("entschuldigt");
  });
  it("nach Ablauf der Frist werden Absenzen unentschuldigt; bei der Schwelle erhält die Klassenlehrperson eine Meldung", async () => {
    const alt = zuerich(-20);
    await ok("PUT", `/api/absenzen/erfassen/${uD3a}`, lp, { datum: alt, lektion: 1, eintraege: [{ schueler_id: eliasId, art: "abwesend" }] });
    await ok("PUT", `/api/absenzen/erfassen/${uD3a}`, lp, { datum: alt, lektion: 2, eintraege: [{ schueler_id: eliasId, art: "abwesend" }] });
    await ok("PUT", `/api/absenzen/erfassen/${uD3a}`, lp, { datum: alt, lektion: 3, eintraege: [{ schueler_id: eliasId, art: "abwesend" }] });
    const e = await ok("GET", "/api/meine-absenzen", elias);
    expect(e.absenzen.filter((a) => a.datum === alt && a.status === "unentschuldigt").length).toBe(3);
    const m = await ok("GET", "/api/mitteilungen", lp);
    expect(m.liste.some((x) => /unentschuldigt/i.test(x.titel + x.text))).toBe(true);
  });
  it("Klassenübersicht nur für Klassenlehrperson und Schulleitung", async () => {
    const kl = await ok("GET", "/api/absenzen/klassen", lp);
    const kid = (kl.klassen || kl).find((k) => k.name === "3a").id;
    expect((await call("GET", `/api/klassen/${kid}/absenzen`, frei)).statusCode).toBe(403);
    const d = await ok("GET", `/api/klassen/${kid}/absenzen`, lp);
    expect(JSON.stringify(d)).toContain("unentschuldigt");
  });
});

describe("Ablage", () => {
  it("persönliches Laufwerk ist privat; Klassenordner für Schüler/innen nur lesbar", async () => {
    const a = await ok("GET", "/api/ablage", lea);
    const mein = a.laufwerke.find((l) => l.art === "person");
    const o = await ok("POST", `/api/ablage/${mein.id}/ordner`, lea, { name: "Deutsch" });
    const f = await hochladen(`/api/ablage/${mein.id}/dateien`, lea, "notizen.pdf", PDF, "application/pdf", { ordner_id: o.id });
    expect(f.statusCode, f.body).toBe(200);
    const f2 = await hochladen(`/api/ablage/${mein.id}/dateien`, lea, "notizen.pdf", PDF, "application/pdf", { ordner_id: o.id });
    expect(f2.json().name).toBe("notizen (2).pdf");
    expect((await call("GET", `/api/ablage/${mein.id}`, elias)).statusCode).toBe(404);
    expect((await call("GET", `/api/ablage-dateien/${f.json().id}`, elias)).statusCode).toBe(404);
    const kurs = (await ok("GET", "/api/ablage", lp)).laufwerke.find((l) => l.art === "unterricht" && l.unterricht_id === uD3a);
    expect((await hochladen(`/api/ablage/${kurs.id}/dateien`, lp, "blatt.pdf", PDF)).statusCode).toBe(200);
    expect((await hochladen(`/api/ablage/${kurs.id}/dateien`, lea, "x.pdf", PDF)).statusCode).toBe(403);
    expect((await ok("GET", `/api/ablage/${kurs.id}`, lea)).dateien.length).toBe(1);
  });
  it("Gruppenlaufwerk mit Mitgliedern", async () => {
    const g = await ok("POST", "/api/ablage/gruppen", lp, { name: "Projektwoche", mitglieder: [leaId, eliasId] });
    expect((await call("GET", `/api/ablage/${g.id}`, elias)).statusCode).toBe(200);
    expect((await call("GET", `/api/ablage/${g.id}`, frei)).statusCode).toBe(404);
  });
});

describe("Zeugnisse und Promotion", () => {
  let kid, semId;
  it("Klassenlehrperson sieht die Promotionsrechnung; Entscheid nur durch die Schulleitung", async () => {
    const kl = await ok("GET", "/api/zeugnisse/klassen", lp);
    kid = (kl.klassen || kl).find((k) => k.name === "3a").id;
    expect((await call("GET", `/api/klassen/${kid}/zeugnisse`, frei)).statusCode).toBe(403);
    const z = await ok("GET", `/api/klassen/${kid}/zeugnisse`, lp);
    semId = z.semester.id;
    expect(z.zeilen.length).toBe(20);
    expect(z.darfEntscheiden).toBe(false);
    const zeile = z.zeilen.find((s) => s.id === leaId);
    expect((await call("POST", `/api/klassen/${kid}/promotion`, lp, { schueler_id: leaId, semester_id: semId, ergebnis: "promoviert" })).statusCode).toBe(403);
    // Abweichung vom Vorschlag braucht eine Begründung
    const anders = zeile.vorschlag === "promoviert" ? "provisorisch" : "promoviert";
    expect((await call("POST", `/api/klassen/${kid}/promotion`, admin, { schueler_id: leaId, semester_id: semId, ergebnis: anders })).statusCode).toBe(400);
  });
  it("Zeugnis als PDF", async () => {
    const r = await call("GET", `/api/klassen/${kid}/zeugnisse.pdf?semester=${semId}&schueler=${leaId}`, lp);
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toMatch(/pdf/);
    expect(r.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
    // Schüler/in sieht das eigene Zeugnis erst nach dem Entscheid
    expect((await call("GET", `/api/mein-zeugnis.pdf?semester=${semId}`, lea)).statusCode).toBe(404);
  });
});

describe("Maturaarbeit", () => {
  let mid;
  it("Betreuerin sieht ihre Arbeit, andere Lehrpersonen nicht", async () => {
    const l = await ok("GET", "/api/matura", steiner);
    expect(l.liste.length).toBe(1);
    mid = l.liste[0].id;
    expect((await ok("GET", "/api/matura", lp)).liste.length).toBe(0);
    expect((await call("GET", `/api/matura/${mid}`, lp)).statusCode).toBe(404);
    const d = await ok("GET", `/api/matura/${mid}`, steiner);
    expect(d.meilensteine.length).toBe(6);
    expect(d.stunden).toBe(9);
  });
  it("Bewertung nach Kriterien, Note aus Gewichten", async () => {
    const d = await ok("GET", `/api/matura/${mid}`, steiner);
    const k = d.arbeit.bewertung.kriterien.map((x, i) => ({ ...x, note: [5, 5.5, 4.5][i] }));
    const r = await ok("PUT", `/api/matura/${mid}/bewertung`, steiner, { kriterien: k });
    expect(r.note).toBe(5); // 5*25 + 5.5*50 + 4.5*25 = 512.5 / 100 = 5.125 → 5
    expect((await call("PUT", `/api/matura/${mid}/bewertung`, steiner, { kriterien: k, abschliessen: true })).statusCode).toBe(409); // noch nicht abgegeben
  });
  it("Schulleitung teilt eine neue Arbeit mit Standard-Meilensteinen zu", async () => {
    const s = await ok("GET", "/api/matura-personen?q=Ammann", admin);
    const a = await ok("POST", "/api/matura", admin, { schueler_id: s[0].id, betreuer_id: (await ok("GET", "/api/matura-personen?rolle=lehrperson&q=Keller", admin))[0].id, titel: "Mundart im Rap" });
    expect((await ok("GET", `/api/matura/${a.id}`, lp)).meilensteine.length).toBe(6);
    expect((await call("POST", "/api/matura", admin, { schueler_id: s[0].id, betreuer_id: a.betreuer_id, titel: "Zweite" })).statusCode).toBe(409);
  });
});

describe("Elternzugang", () => {
  it("Mutter sieht ihr Kind, Noten und Absenzen; nichts von anderen", async () => {
    const k = await ok("GET", "/api/eltern/kinder", mama);
    expect(k.kinder.length).toBe(1);
    expect(k.kinder[0].klasse).toBe("3a");
    const n = await ok("GET", `/api/meine-noten?person=${leaId}`, mama);
    expect(n.faecher.length).toBeGreaterThan(0);
    expect((await call("GET", `/api/meine-noten?person=${eliasId}`, mama)).statusCode).toBe(404);
    expect((await call("GET", `/api/meine-absenzen?person=${eliasId}`, mama)).statusCode).toBe(403);
    expect((await call("GET", `/api/kalender?person=${leaId}&von=${zuerich(0)}&bis=${zuerich(6)}`, mama)).statusCode).toBe(200);
  });
  it("nur lesen: Eltern können keine Aufträge abgeben oder im Klassenraum schreiben", async () => {
    expect((await call("GET", `/api/raum/${uD3a}`, mama)).statusCode).toBe(403);
    expect((await call("PUT", `/api/absenzen/erfassen/${uD3a}`, mama, { datum: zuerich(-1), lektion: 1, eintraege: [] })).statusCode).toBe(403);
  });
  it("Administration verknüpft und trennt", async () => {
    const p = (await ok("GET", "/api/personen?rolle=eltern", admin));
    const marco = (p.liste || p).find((x) => x.nachname === "Lüthi");
    expect((await call("POST", `/api/personen/${marco.id}/kinder`, lp, { kind_id: leaId })).statusCode).toBe(403);
    await ok("POST", `/api/personen/${marco.id}/kinder`, admin, { kind_id: leaId, beziehung: "andere" });
    expect((await ok("GET", `/api/personen/${marco.id}/kinder`, admin)).kinder.length).toBe(2);
    await ok("DELETE", `/api/personen/${marco.id}/kinder/${leaId}`, admin);
  });
  it("Freigabe für Volljährige gibt es erst ab 18", async () => {
    expect((await call("PUT", "/api/mein-konto/eltern", lea, { freigabe: true })).statusCode).toBe(409);
  });
});
