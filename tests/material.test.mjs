// Material über die API: Hochladen, Suche im Inhalt, Teilen, Freigabe mit Zeitfenster, Versionen, Papierkorb, Schutz
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { authenticator } from "../apps/api/node_modules/otplib/index.js";
import { bauen } from "../apps/api/src/server.mjs";
import { beispielPdf } from "../packages/db/beispiel-pdf.mjs";

let app, lp, kunz, frei, schueler, schueler3b, admin, uid3a, uid3b;
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
  schueler = await anmelden("lea.ammann.26001@schueler.seeufer.test", false); // 3a
  const ueb = (await call("GET", "/api/uebersicht", lp)).json();
  uid3a = ueb.meinUnterricht.find((u) => u.klasse === "3a").id;
  uid3b = ueb.meinUnterricht.find((u) => u.klasse === "3b").id;
});
afterAll(() => app.close());

describe("Material", () => {
  let pdfId, textId;
  it("Lehrperson lädt ein PDF hoch; Titel, Fach und Seitenzahl werden übernommen", async () => {
    const r = await hochladen("/api/material", lp, "Arbeitsblatt_Romantik.pdf", beispielPdf("Arbeitsblatt Romantik", ["Die Epoche der Romantik und das Motiv der blauen Blume bei Novalis."]));
    expect(r.statusCode).toBe(200);
    const m = r.json(); pdfId = m.id;
    expect(m.titel).toBe("Arbeitsblatt Romantik");
    expect(m.fach).toBe("Deutsch");
    expect(m.art).toBe("pdf");
    expect(m.seiten).toBe(1);
  });
  it("die Suche findet Wörter im Inhalt der Datei, auch angefangene", async () => {
    const d = (await call("GET", "/api/material?bereich=alle&suche=blaue%20Blu", lp)).json();
    const t = d.eintraege.find((e) => e.id === pdfId);
    expect(t).toBeTruthy();
    expect(t.auszug).toContain("«");
  });
  it("Programme und falsch benannte Dateien werden abgelehnt", async () => {
    expect((await hochladen("/api/material", lp, "spiel.exe", Buffer.from("MZ\x90\x00"))).statusCode).toBe(415);
    expect((await hochladen("/api/material", lp, "harmlos.pdf", Buffer.from("MZ\x90\x00nicht pdf"))).statusCode).toBe(415);
    expect((await hochladen("/api/material", lp, "seite.html", Buffer.from("<script>alert(1)</script>"))).statusCode).toBe(415);
  });
  it("privates Material sehen andere nicht, auch nicht die Administration", async () => {
    expect((await call("GET", `/api/material/${pdfId}`, kunz)).statusCode).toBe(404);
    expect((await call("GET", `/api/material/${pdfId}`, admin)).statusCode).toBe(404);
    expect((await call("GET", `/api/material/${pdfId}/datei`, schueler)).statusCode).toBe(404);
  });
  it("mit der Fachgruppe geteilt: Deutsch-Kollegin sieht es, Französisch-Kollegin nicht", async () => {
    expect((await call("PUT", `/api/material/${pdfId}`, lp, { sichtbarkeit: "fachgruppe" })).statusCode).toBe(200);
    expect((await call("GET", `/api/material/${pdfId}`, kunz)).statusCode).toBe(200);
    expect((await call("GET", `/api/material/${pdfId}`, frei)).statusCode).toBe(404);
    const fg = (await call("GET", "/api/material?bereich=fachgruppe", kunz)).json();
    expect(fg.eintraege.some((e) => e.id === pdfId)).toBe(true);
    // ändern darf nur die Besitzerin
    expect((await call("PUT", `/api/material/${pdfId}`, kunz, { titel: "Übernommen" })).statusCode).toBe(403);
  });
  it("Freigabe für 3a: Schülerin sieht und öffnet es, die Lehrperson sieht «geöffnet»", async () => {
    expect((await call("POST", `/api/material/${pdfId}/freigaben`, lp, { unterricht_ids: [uid3a] })).statusCode).toBe(200);
    const mm = (await call("GET", "/api/mein-material", schueler)).json();
    const e = mm.faecher.flatMap((f) => f.eintraege).find((x) => x.id === pdfId);
    expect(e && e.neu).toBe(true);
    expect(e.besitzer_id).toBeUndefined();
    const dl = await call("GET", `/api/material/${pdfId}/datei?ansicht=1`, schueler);
    expect(dl.statusCode).toBe(200);
    expect(dl.headers["content-type"]).toBe("application/pdf");
    expect(dl.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
    const k = (await call("GET", `/api/unterricht/${uid3a}/material`, lp)).json();
    expect(k.eintraege.find((x) => x.id === pdfId).geoeffnet).toBe(1);
    const mm2 = (await call("GET", "/api/mein-material", schueler)).json();
    expect(mm2.faecher.flatMap((f) => f.eintraege).find((x) => x.id === pdfId).neu).toBe(false);
  });
  it("freigeben geht nur für eigenen Unterricht", async () => {
    expect((await call("POST", `/api/material/${pdfId}/freigaben`, kunz, { unterricht_ids: [uid3a] })).statusCode).toBe(403);
    expect((await call("POST", `/api/material/${pdfId}/freigaben`, schueler, { unterricht_ids: [uid3a] })).statusCode).toBe(403);
  });
  it("Freigabe in der Zukunft: noch unsichtbar für die Klasse, sichtbar für die Lehrperson", async () => {
    const d = (await call("GET", "/api/material?bereich=alle&suche=L%C3%B6sungshinweise", lp)).json();
    const loes = d.eintraege[0];
    expect(loes.titel).toContain("Lösungshinweise");
    expect((await call("GET", `/api/material/${loes.id}`, schueler)).statusCode).toBe(404);
    const k = (await call("GET", `/api/unterricht/${uid3a}/material`, lp)).json();
    expect(k.eintraege.find((x) => x.id === loes.id).aktiv).toBe(false);
    const s = (await call("GET", `/api/unterricht/${uid3a}/material`, schueler)).json();
    expect(s.eintraege.some((x) => x.id === loes.id)).toBe(false);
  });
  it("neue Version: die Freigabe bleibt, die Klasse bekommt die neue Datei", async () => {
    const r = await hochladen(`/api/material/${pdfId}/versionen`, lp, "Arbeitsblatt_Romantik_v2.pdf", beispielPdf("Arbeitsblatt Romantik", ["Neu mit Eichendorff: Mondnacht."]));
    expect(r.json().nr).toBe(2);
    const dl = await call("GET", `/api/material/${pdfId}/datei`, schueler);
    expect(dl.headers["content-disposition"]).toContain("Arbeitsblatt_Romantik_v2.pdf");
    const d = (await call("GET", `/api/material/${pdfId}`, lp)).json();
    expect(d.versionen).toHaveLength(2);
    expect(d.freigaben[0].klasse).toBe("3a");
    // Suche nach dem neuen Inhalt
    expect((await call("GET", "/api/material?bereich=alle&suche=Eichendorff", lp)).json().eintraege.some((e) => e.id === pdfId)).toBe(true);
    // ältere Version: nur Lehrpersonen
    expect((await call("GET", `/api/material/${pdfId}/datei?v=${d.versionen[1].id}`, schueler)).statusCode).toBe(404);
    expect((await call("GET", `/api/material/${pdfId}/datei?v=${d.versionen[1].id}`, lp)).statusCode).toBe(200);
  });
  it("Text und Link anlegen; Link öffnet über den Server (wird gezählt)", async () => {
    const t = (await call("POST", "/api/material", lp, { typ: "text", titel: "Hausaufgabe", inhalt: "Gedicht auswendig lernen", freigeben_fuer: uid3a })).json();
    textId = t.id;
    expect((await call("GET", `/api/material/${textId}`, schueler)).json().inhalt).toBe("Gedicht auswendig lernen");
    expect((await call("POST", "/api/material", lp, { typ: "link", titel: "Böse", url: "javascript:alert(1)" })).statusCode).toBe(400);
    const l = (await call("POST", "/api/material", lp, { typ: "link", url: "https://www.duden.de/rechtschreibung/Romantik" })).json();
    await call("POST", `/api/material/${l.id}/freigaben`, lp, { unterricht_ids: [uid3a] });
    const r = await call("GET", `/api/material/${l.id}/oeffnen`, schueler);
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe("https://www.duden.de/rechtschreibung/Romantik");
  });
  it("Ordner: anlegen, Material hineinlegen, Ordner löschen verschiebt den Inhalt nach oben", async () => {
    const o = (await call("POST", "/api/ordner", lp, { name: "Romantik" })).json();
    await call("PUT", `/api/material/${pdfId}`, lp, { ordner_id: o.id });
    expect((await call("GET", `/api/material?ordner=${o.id}`, lp)).json().eintraege.map((e) => e.id)).toEqual([pdfId]);
    expect((await call("PUT", `/api/material/${pdfId}`, kunz, { ordner_id: o.id })).statusCode).toBe(403);
    await call("DELETE", `/api/ordner/${o.id}`, lp);
    expect((await call("GET", "/api/material", lp)).json().eintraege.some((e) => e.id === pdfId)).toBe(true);
  });
  it("Papierkorb: gelöschtes Material verschwindet bei der Klasse, lässt sich wiederherstellen und endgültig löschen", async () => {
    await call("DELETE", `/api/material/${textId}`, lp);
    expect((await call("GET", `/api/material/${textId}`, schueler)).statusCode).toBe(404);
    expect((await call("GET", "/api/material?bereich=papierkorb", lp)).json().eintraege.some((e) => e.id === textId)).toBe(true);
    await call("POST", `/api/material/${textId}/wiederherstellen`, lp);
    expect((await call("GET", `/api/material/${textId}`, schueler)).statusCode).toBe(200);
    expect((await call("DELETE", `/api/material/${textId}/endgueltig`, lp)).statusCode).toBe(400);
    await call("DELETE", `/api/material/${textId}`, lp);
    expect((await call("DELETE", `/api/material/${textId}/endgueltig`, lp)).statusCode).toBe(200);
    expect((await call("GET", `/api/material/${textId}`, lp)).statusCode).toBe(404);
  });
  it("Schülerinnen und Schüler haben keine Ablage und können nichts hochladen", async () => {
    expect((await call("GET", "/api/material", schueler)).statusCode).toBe(403);
    expect((await hochladen("/api/material", schueler, "x.pdf", beispielPdf("x", ["y"]))).statusCode).toBe(403);
  });
});
