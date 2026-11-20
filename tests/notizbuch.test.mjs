// Kursnotizbuch: Bereiche und Rechte, eigener Bereich, Sperren (dauerhaft, Lektion, Prüfung), Seiten, Verteilen, Dateien, Papierkorb
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { authenticator } from "../apps/api/node_modules/otplib/index.js";
import { bauen } from "../apps/api/src/server.mjs";

let app, lp, brunner, admin, lea, elias, uid3a, uid3b;
const PW = "Seeufer-Test-2026!", H = { "x-schule": "1" };
async function anmelden(email, mit2fa = true) {
  const r = await app.inject({ method: "POST", url: "/api/s/seeufer/anmelden", headers: H, payload: { email, passwort: PW } });
  const cookie = r.headers["set-cookie"].split(";")[0];
  if (mit2fa) { const s = (await app.inject({ method: "POST", url: "/api/konto/2fa/start", headers: { ...H, cookie } })).json(); await app.inject({ method: "POST", url: "/api/konto/2fa/bestaetigen", headers: { ...H, cookie }, payload: { code: authenticator.generate(s.geheim) } }); }
  return cookie;
}
const call = (method, url, cookie, payload) => app.inject({ method, url, headers: { ...H, cookie }, payload });
const j = async (...a) => (await call(...a)).json();

beforeAll(async () => {
  execSync("node packages/db/seed.mjs", { cwd: new URL("..", import.meta.url).pathname });
  app = await bauen();
  lp = await anmelden("martin.keller@seeufer.test");
  brunner = await anmelden("thomas.brunner@seeufer.test");
  admin = await anmelden("admin@seeufer.test");
  lea = await anmelden("lea.ammann.26001@schueler.seeufer.test", false);
  elias = await anmelden("elias.luthi.26002@schueler.seeufer.test", false);
  const ueb = (await call("GET", "/api/uebersicht", lp)).json();
  uid3a = ueb.meinUnterricht.find((u) => u.klasse === "3a").id;
  uid3b = ueb.meinUnterricht.find((u) => u.klasse === "3b").id;
});
afterAll(() => app.close());

describe("Kursnotizbuch", () => {
  let bib, bibSeite, leaAbschnitt, leaSeite, gemeinsam;
  it("Lehrperson sieht alle Bereiche und jede Schülerin, Schüler/innen nur Bibliothek, Zusammenarbeit und den eigenen Bereich", async () => {
    const l = await j("GET", `/api/notizbuch/${uid3a}`, lp);
    expect(l.rolle).toBe("lp");
    expect(l.bereiche.map((b) => b.bereich).slice(0, 3)).toEqual(["bibliothek", "gemeinsam", "lehrkraefte"]);
    expect(l.bereiche.filter((b) => b.bereich === "schueler").length).toBeGreaterThan(1);
    const s = await j("GET", `/api/notizbuch/${uid3a}`, lea);
    expect(s.bereiche.map((b) => b.name)).toEqual(["Inhaltsbibliothek", "Zusammenarbeit", "Mein Bereich"]);
    expect(s.bereiche.find((b) => b.bereich === "bibliothek").schreiben).toBe(false);
    // fremde Lehrperson, Administration: kein Zugriff
    expect((await call("GET", `/api/notizbuch/${uid3a}`, brunner)).statusCode).toBe(404);
    expect((await call("GET", `/api/notizbuch/${uid3a}`, admin)).statusCode).toBe(404);
    expect((await j("GET", "/api/notizbuecher", lea)).notizbuecher.some((n) => n.id === uid3a)).toBe(true);
  });

  it("Bibliothek: nur die Lehrperson schreibt; die Klasse liest", async () => {
    expect((await call("POST", `/api/notizbuch/${uid3a}/abschnitte`, lea, { bereich: "bibliothek", name: "Hack" })).statusCode).toBe(403);
    bib = await j("POST", `/api/notizbuch/${uid3a}/abschnitte`, lp, { bereich: "bibliothek", name: "Gedichte", farbe: "#E5484D" });
    bibSeite = bib.seiten[0].id;
    const r = await call("PUT", `/api/notizbuch/seiten/${bibSeite}`, lp, { titel: "Erlkönig", inhalt: { items: [{ id: "a", type: "text", x: 48, y: 24, w: 500, html: "<p>Wer reitet so spät</p>" }], strokes: [] }, text: "Wer reitet so spät", version: 1 });
    expect(r.statusCode).toBe(200);
    const s = await j("GET", `/api/notizbuch/seiten/${bibSeite}`, lea);
    expect(s.titel).toBe("Erlkönig"); expect(s.schreiben).toBe(false);
    expect((await call("PUT", `/api/notizbuch/seiten/${bibSeite}`, lea, { titel: "x" })).statusCode).toBe(403);
  });

  it("eigener Bereich: nur die Person selbst und die Lehrperson; Gruppen beliebig tief", async () => {
    const g = await j("POST", `/api/notizbuch/${uid3a}/abschnitte`, lea, { bereich: "schueler", art: "gruppe", name: "Semester 1" });
    const g2 = await j("POST", `/api/notizbuch/${uid3a}/abschnitte`, lea, { bereich: "schueler", art: "gruppe", name: "Woche 1", eltern_id: g.id });
    leaAbschnitt = await j("POST", `/api/notizbuch/${uid3a}/abschnitte`, lea, { bereich: "schueler", name: "Notizen", eltern_id: g2.id });
    leaSeite = leaAbschnitt.seiten[0].id;
    expect((await call("PUT", `/api/notizbuch/seiten/${leaSeite}`, lea, { titel: "Meine Gedanken", inhalt: { items: [], strokes: [] }, text: "geheim", version: 1 })).statusCode).toBe(200);
    // Elias sieht Leas Seite nicht, die Lehrperson schon
    expect((await call("GET", `/api/notizbuch/seiten/${leaSeite}`, elias)).statusCode).toBe(404);
    expect((await j("GET", `/api/notizbuch/seiten/${leaSeite}`, lp)).titel).toBe("Meine Gedanken");
    const s = await j("GET", `/api/notizbuch/${uid3a}`, lea);
    const mein = s.bereiche.find((b) => b.name === "Mein Bereich");
    expect(mein.abschnitte[0].name).toBe("Semester 1");
    expect(mein.abschnitte[0].kinder[0].kinder[0].name).toBe("Notizen");
    // Gruppe nicht in sich selbst
    expect((await call("PUT", `/api/notizbuch/abschnitte/${g.id}`, lea, { eltern_id: g2.id })).statusCode).toBe(400);
    // Schüler/in kann nicht in fremden Bereich schreiben
    const lb = (await j("GET", `/api/notizbuch/${uid3a}`, lp)).bereiche.find((b) => b.bereich === "schueler" && b.besitzer_id && b.name.startsWith("Elias"));
    expect((await call("POST", `/api/notizbuch/${uid3a}/abschnitte`, lea, { bereich: "schueler", besitzer_id: lb.besitzer_id, name: "x" })).json().besitzer_id).not.toBe(lb.besitzer_id);
  });

  it("Versionen schützen vor Überschreiben", async () => {
    gemeinsam = await j("POST", `/api/notizbuch/${uid3a}/abschnitte`, elias, { bereich: "gemeinsam", name: "Gruppenarbeit" });
    const sid = gemeinsam.seiten[0].id;
    expect((await call("PUT", `/api/notizbuch/seiten/${sid}`, lea, { inhalt: { items: [], strokes: [] }, version: 1 })).statusCode).toBe(200);
    const r = await call("PUT", `/api/notizbuch/seiten/${sid}`, elias, { inhalt: { items: [], strokes: [] }, version: 1 });
    expect(r.statusCode).toBe(409); expect(r.json().aktuell.version).toBe(2);
  });

  it("Seite an alle verteilen", async () => {
    const r = await j("POST", `/api/notizbuch/${uid3a}/verteilen`, lp, { seite_id: bibSeite, abschnitt: "Aufträge" });
    expect(r.anzahl).toBeGreaterThan(1);
    const e = await j("GET", `/api/notizbuch/${uid3a}`, elias);
    const auf = e.bereiche.find((b) => b.name === "Mein Bereich").abschnitte.find((a) => a.name === "Aufträge");
    expect(auf.seiten[0].titel).toBe("Erlkönig");
    expect((await call("PUT", `/api/notizbuch/seiten/${auf.seiten[0].id}`, elias, { titel: "Erlkönig, meine Lösung" })).statusCode).toBe(200);
    expect((await j("GET", `/api/notizbuch/seiten/${bibSeite}`, lp)).titel).toBe("Erlkönig");
  });

  it("Dateien: lesbar nur mit Zugriff auf den Abschnitt", async () => {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
    const grenze = "----x";
    const body = Buffer.concat([Buffer.from(`--${grenze}\r\nContent-Disposition: form-data; name="datei"; filename="bild.png"\r\nContent-Type: image/png\r\n\r\n`), png, Buffer.from(`\r\n--${grenze}--\r\n`)]);
    const up = await app.inject({ method: "POST", url: `/api/notizbuch/abschnitte/${leaAbschnitt.id}/dateien`, headers: { ...H, cookie: lea, "content-type": `multipart/form-data; boundary=${grenze}` }, payload: body });
    expect(up.statusCode).toBe(200);
    const fid = up.json().id;
    expect((await call("GET", `/api/notizbuch/dateien/${fid}`, lea)).statusCode).toBe(200);
    expect((await call("GET", `/api/notizbuch/dateien/${fid}`, lp)).statusCode).toBe(200);
    expect((await call("GET", `/api/notizbuch/dateien/${fid}`, elias)).statusCode).toBe(404);
  });

  it("dauerhaft sperren: Schüler/innen sehen nur den Grund, die Lehrperson weiter alles", async () => {
    expect((await call("PUT", `/api/unterricht/${uid3a}/notizbuch`, lea, { erlaubt: false })).statusCode).toBe(404);
    await call("PUT", `/api/unterricht/${uid3a}/notizbuch`, lp, { erlaubt: false });
    const s = await j("GET", `/api/notizbuch/${uid3a}`, lea);
    expect(s.erlaubt).toBe(false); expect(s.grund).toMatch(/gesperrt/); expect(s.bereiche).toEqual([]);
    expect((await call("GET", `/api/notizbuch/seiten/${leaSeite}`, lea)).statusCode).toBe(403);
    expect((await j("GET", `/api/notizbuch/${uid3a}`, lp)).erlaubt).toBe(true);
    await call("PUT", `/api/unterricht/${uid3a}/notizbuch`, lp, { erlaubt: true });
    expect((await j("GET", `/api/notizbuch/${uid3a}`, lea)).erlaubt).toBe(true);
  });

  it("Lektion: gesperrt oder erlaubt; während der Lektion sind andere Notizbücher zu", async () => {
    const lid = (await j("POST", `/api/unterricht/${uid3a}/lektion`, lp, { notizbuch: false })).lektion_id;
    expect((await j("GET", `/api/notizbuch/${uid3a}`, lea)).grund).toMatch(/Lektion/);
    await call("PUT", `/api/lektionen/${lid}`, lp, { notizbuch: true });
    expect((await j("GET", `/api/notizbuch/${uid3a}`, lea)).erlaubt).toBe(true);
    const andere = (await j("GET", "/api/notizbuecher", lea)).notizbuecher.find((n) => n.id !== uid3a);
    if (andere) expect(andere.erlaubt).toBe(false);
    await call("POST", `/api/lektionen/${lid}/beenden`, lp);
    if (andere) expect((await j("GET", "/api/notizbuecher", lea)).notizbuecher.find((n) => n.id === andere.id).erlaubt).toBe(true);
  });

  it("Prüfung: nur wenn erlaubt, ohne Zusammenarbeitsbereich", async () => {
    const d = await j("GET", "/api/pruefungen", lp);
    const p = d.pruefungen.find((x) => x.titel === "Kleider machen Leute");
    const voll = await j("GET", `/api/pruefungen/${p.id}`, lp);
    const put = await call("PUT", `/api/pruefungen/${p.id}`, lp, { ...voll, einstellungen: { ...voll.einstellungen, notizbuch: true } });
    expect(put.statusCode).toBe(200);
    const code = (await j("POST", `/api/pruefungen/${p.id}/starten`, lp)).startcode;
    expect((await call("POST", "/api/pruefungen/beitreten", lea, { code })).statusCode).toBe(200);
    const s = await j("GET", `/api/notizbuch/${p.unterricht_id}`, lea);
    expect(s.erlaubt).toBe(true); expect(s.modus).toBe("pruefung");
    expect(s.bereiche.map((b) => b.bereich)).not.toContain("gemeinsam");
    expect((await call("GET", `/api/notizbuch/seiten/${gemeinsam.seiten[0].id}`, lea)).statusCode).toBe(404);
    const anderes = (await j("GET", "/api/notizbuecher", lea)).notizbuecher.find((n) => n.id !== p.unterricht_id);
    if (anderes) expect(anderes.erlaubt).toBe(false);
    await call("POST", `/api/pruefungen/${p.id}/beenden`, lp);
  });

  it("Papierkorb: löschen und wiederherstellen; Suche", async () => {
    await call("DELETE", `/api/notizbuch/abschnitte/${leaAbschnitt.id}`, lea);
    const pk = await j("GET", `/api/notizbuch/${uid3a}/papierkorb`, lea);
    expect(pk.abschnitte.some((a) => a.id === leaAbschnitt.id)).toBe(true);
    await call("POST", "/api/notizbuch/wiederherstellen", lea, { abschnitt_id: leaAbschnitt.id });
    expect((await call("GET", `/api/notizbuch/seiten/${leaSeite}`, lea)).statusCode).toBe(200);
    const t = await j("GET", `/api/notizbuch/${uid3a}/suche?q=reitet`, elias);
    expect(t.treffer.length).toBeGreaterThan(0);
    expect((await j("GET", `/api/notizbuch/${uid3a}/suche?q=geheim`, elias)).treffer.length).toBe(0);
    expect((await j("GET", `/api/notizbuch/${uid3a}/suche?q=geheim`, lea)).treffer.length).toBe(1);
  });

  it("OneNote-Testdaten über den Server (ohne Microsoft)", async () => {
    const st = await j("GET", "/api/onenote/status", lea);
    expect(st).toHaveProperty("verbunden");
  });

  it("OneNote-Import fortsetzen: Herkunft verhindert Doppeltes, Reihenfolge wie in OneNote, Änderungen kommen nach", async () => {
    const ziel = { bereich: "schueler" };
    const buch = await j("POST", `/api/notizbuch/${uid3a}/abschnitte`, lea, { ...ziel, art: "gruppe", name: "Bio (OneNote)", quelle: "{NB1}" });
    const abs = await j("POST", `/api/notizbuch/${uid3a}/abschnitte`, lea, { ...ziel, name: "Zelle", eltern_id: buch.id, quelle: "{S1}", ohneSeite: true, reihenfolge: 1 });
    // erster Durchgang: die zuletzt bearbeitete Seite (in OneNote an 3. Stelle)
    let r = await j("POST", `/api/notizbuch/abschnitte/${abs.id}/seiten-import`, lea, { seiten: [{ titel: "Drei", reihenfolge: 3, quelle: "{P3}", geaendert_am: "2026-11-01T10:00:00Z", inhalt: { items: [], strokes: [] } }] });
    expect(r.neu).toBe(1);
    // zweiter Durchgang: Gruppe und Abschnitt werden wiederverwendet, P3 nicht doppelt
    const buch2 = await j("POST", `/api/notizbuch/${uid3a}/abschnitte`, lea, { ...ziel, art: "gruppe", name: "Bio (OneNote)", quelle: "{NB1}" });
    expect(buch2.id).toBe(buch.id); expect(buch2.vorhanden).toBe(true);
    const abs2 = await j("POST", `/api/notizbuch/${uid3a}/abschnitte`, lea, { ...ziel, name: "Zelle", eltern_id: buch.id, quelle: "{S1}", ohneSeite: true });
    expect(abs2.id).toBe(abs.id);
    r = await j("POST", `/api/notizbuch/abschnitte/${abs.id}/seiten-import`, lea, { seiten: [
      { titel: "Eins", reihenfolge: 1, quelle: "{P1}", geaendert_am: "2026-10-01T10:00:00Z", inhalt: { items: [], strokes: [] } },
      { titel: "Drei", reihenfolge: 3, quelle: "{P3}", geaendert_am: "2026-11-01T10:00:00Z", inhalt: { items: [], strokes: [] } },
      { titel: "Zwei", reihenfolge: 2, quelle: "{P2}", geaendert_am: "2026-10-02T10:00:00Z", inhalt: { items: [], strokes: [] } }] });
    expect(r).toMatchObject({ neu: 2, uebersprungen: 1 });
    const nb = await j("GET", `/api/notizbuch/${uid3a}`, lea);
    const finde = (l) => { for (const k of l) { if (k.id === abs.id) return k; const x = k.kinder && finde(k.kinder); if (x) return x; } return null; };
    const sec = nb.bereiche.map((b) => finde(b.abschnitte || b.kinder || [])).find(Boolean);
    expect(sec.seiten.map((s) => s.titel)).toEqual(["Eins", "Zwei", "Drei"]);
    // was schon da ist (für den nächsten Durchgang)
    const q = await j("GET", `/api/notizbuch/${uid3a}/quellen?bereich=schueler`, lea);
    expect(Object.keys(q.seiten).sort()).toEqual(["{P1}", "{P2}", "{P3}"]);
    // in OneNote geändert, in RESCOOL nie bearbeitet: neue Fassung; in RESCOOL bearbeitet: bleibt
    const p1 = sec.seiten.find((s) => s.titel === "Eins").id;
    r = await j("POST", `/api/notizbuch/abschnitte/${abs.id}/seiten-import`, lea, { seiten: [{ titel: "Drei neu", reihenfolge: 3, quelle: "{P3}", geaendert_am: "2026-11-05T10:00:00Z", inhalt: { items: [], strokes: [] } }] });
    expect(r.aktualisiert).toBe(1);
    expect((await call("PUT", `/api/notizbuch/seiten/${p1}`, lea, { titel: "Eins (meins)", inhalt: { items: [], strokes: [] }, text: "", version: 1 })).statusCode).toBe(200);
    r = await j("POST", `/api/notizbuch/abschnitte/${abs.id}/seiten-import`, lea, { seiten: [{ titel: "Eins neu", reihenfolge: 1, quelle: "{P1}", geaendert_am: "2026-11-06T10:00:00Z", inhalt: { items: [], strokes: [] } }] });
    expect(r.uebersprungen).toBe(1);
    expect((await j("GET", `/api/notizbuch/seiten/${p1}`, lea)).titel).toBe("Eins (meins)");
    // fremder Bereich: kein Zugriff auf die Herkunft
    expect((await call("GET", `/api/notizbuch/${uid3a}/quellen?bereich=lehrkraefte`, lea)).statusCode).toBe(404);
  });
});
