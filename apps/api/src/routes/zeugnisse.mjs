// Zeugnisse und Promotion: Übersicht der Klasse (Zeugnisnoten, Promotionsrechnung, Absenzen), Entscheid, PDF
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { geschuetzt } from "../sitzung.mjs";
import { fehler } from "../fehler.mjs";
import { protokolliere } from "../protokoll.mjs";
import { pruefe, darf, fachnote, promotionPruefen, promotionVorschlag, PROMOTION_STANDARD, ERGEBNIS, fmtNote } from "@schule/shared";
import { id, text, schuelerDerKlasse, klasseVon, mitteilen } from "../hilfen.mjs";

async function regeln(q) { const [s] = await q("SELECT einstellungen FROM schule"); return { ...PROMOTION_STANDARD, ...((s.einstellungen || {}).promotion || {}) }; }
async function semesterWahl(q, schuljahrId, sid) {
  const liste = await q("SELECT id, nr, von::text, bis::text FROM semester WHERE schuljahr_id = $1 ORDER BY nr", [schuljahrId]);
  if (!liste.length) fehler(400, "Für dieses Schuljahr sind keine Semester erfasst.");
  const heute = new Date().toISOString().slice(0, 10);
  return { semester: (sid && liste.find((s) => s.id === sid)) || liste.find((s) => s.von <= heute && s.bis >= heute) || liste[liste.length - 1], liste };
}

/** Alles für die Zeugnisse einer Klasse in einem Semester */
async function zeugnisDaten(q, kid, semId, nurSchueler = null) {
  const [k] = await q(`SELECT k.id, k.name, k.stufe, k.profil, k.schuljahr_id, j.bezeichnung AS schuljahr, p.vorname || ' ' || p.nachname AS klp
    FROM klasse k JOIN schuljahr j ON j.id = k.schuljahr_id LEFT JOIN person p ON p.id = k.klassenlehrperson_id WHERE k.id = $1`, [kid]);
  if (!k) fehler(404, "Klasse nicht gefunden.");
  const { semester, liste } = await semesterWahl(q, k.schuljahr_id, semId);
  let sch = await schuelerDerKlasse(q, kid);
  if (nurSchueler) sch = sch.filter((s) => s.id === nurSchueler);
  const faecher = await q(`SELECT DISTINCT f.id, f.name, f.kuerzel, f.promotionsrelevant FROM unterricht u JOIN fach f ON f.id = u.fach_id WHERE u.klasse_id = $1 ORDER BY f.name`, [kid]);
  const noten = sch.length ? await q(`SELECT z.schueler_id, u.fach_id, z.gesetzt, z.status FROM zeugnisnote z JOIN unterricht u ON u.id = z.unterricht_id
    WHERE u.klasse_id = $1 AND z.semester_id = $2 AND z.schueler_id = ANY($3)`, [kid, semester.id, sch.map((s) => s.id)]) : [];
  // Wer ist in welchem Unterricht (Gruppen): nur Fächer, die die Person besucht
  const besucht = sch.length ? await q(`SELECT ks.person_id AS schueler_id, u.fach_id FROM klasse_schueler ks JOIN unterricht u ON u.klasse_id = ks.klasse_id AND u.gruppe = '' WHERE ks.klasse_id = $1
    UNION SELECT us.person_id, u.fach_id FROM unterricht_schueler us JOIN unterricht u ON u.id = us.unterricht_id WHERE u.klasse_id = $1`, [kid]) : [];
  const abs = sch.length ? await q(`SELECT schueler_id, count(*) FILTER (WHERE art = 'abwesend' AND status = 'entschuldigt')::int AS entschuldigt,
      count(*) FILTER (WHERE art = 'abwesend' AND status = 'unentschuldigt')::int AS unentschuldigt, count(*) FILTER (WHERE art = 'abwesend' AND status = 'offen')::int AS offen,
      count(*) FILTER (WHERE art = 'verspaetet')::int AS verspaetungen
    FROM absenz WHERE schueler_id = ANY($1) AND datum BETWEEN $2 AND $3 GROUP BY schueler_id`, [sch.map((s) => s.id), semester.von, semester.bis]) : [];
  const entscheide = sch.length ? await q(`SELECT p.*, x.vorname || ' ' || x.nachname AS von FROM promotion p LEFT JOIN person x ON x.id = p.entschieden_von WHERE p.semester_id = $1 AND p.schueler_id = ANY($2)`, [semester.id, sch.map((s) => s.id)]) : [];
  const bisher = sch.length ? await q(`SELECT p.schueler_id, p.ergebnis, k.stufe FROM promotion p LEFT JOIN klasse k ON k.id = p.klasse_id JOIN semester s ON s.id = p.semester_id
    WHERE p.schueler_id = ANY($1) AND s.von < $2`, [sch.map((s) => s.id), semester.von]) : [];
  const r = await regeln(q);
  const zeilen = sch.map((s) => {
    const meine = faecher.filter((f) => besucht.some((b) => b.schueler_id === s.id && b.fach_id === f.id));
    const fn = meine.map((f) => {
      const n = noten.filter((x) => x.schueler_id === s.id && x.fach_id === f.id);
      return { fach_id: f.id, fach: f.name, kuerzel: f.kuerzel, relevant: f.promotionsrelevant, note: fachnote(n.map((x) => x.gesetzt)), freigegeben: n.length > 0 && n.every((x) => x.status === "freigegeben") };
    });
    const pr = promotionPruefen(fn, r);
    return { ...s, noten: fn, promotion: pr, vorschlag: promotionVorschlag(pr, bisher.filter((b) => b.schueler_id === s.id), k.stufe),
      absenzen: abs.find((a) => a.schueler_id === s.id) || { entschuldigt: 0, unentschuldigt: 0, offen: 0, verspaetungen: 0 },
      entscheid: entscheide.find((e) => e.schueler_id === s.id) || null };
  });
  const [schule] = await q("SELECT name FROM schule");
  return { klasse: k, semester, semesterListe: liste, faecher, zeilen, regeln: r, schule: schule.name.replace(/ \(Testschule\)$/, "") };
}

/* ---------- PDF ---------- */
async function zeugnisPdf(d) {
  const doc = await PDFDocument.create();
  doc.setTitle(`Zeugnis ${d.klasse.name} ${d.semester.nr}. Semester ${d.klasse.schuljahr}`); doc.setCreator("RESCOOL"); doc.setProducer("RESCOOL");
  const reg = await doc.embedFont(StandardFonts.Helvetica), fett = await doc.embedFont(StandardFonts.HelveticaBold);
  const blau = rgb(0.17, 0.25, 0.77), grau = rgb(0.42, 0.46, 0.56), linie = rgb(0.85, 0.87, 0.91), rot = rgb(0.7, 0.25, 0.16);
  const sicher = (s) => String(s ?? "").replace(/[^\x20-\x7E -ÿ–—’‘“”„«»…€]/g, "?");
  for (const s of d.zeilen) {
    const p = doc.addPage([595.28, 841.89]); // A4
    const W = 595.28, L = 64, R = W - 64;
    let y = 780;
    const t = (x, str, size = 10.5, f = reg, farbe = rgb(0.08, 0.1, 0.18), yy = y) => p.drawText(sicher(str), { x, y: yy, size, font: f, color: farbe });
    const rechts = (str, size, f, farbe) => p.drawText(sicher(str), { x: R - f.widthOfTextAtSize(sicher(str), size), y, size, font: f, color: farbe || rgb(0.08, 0.1, 0.18) });
    p.drawRectangle({ x: 0, y: 812, width: W, height: 30, color: blau });
    t(L, d.schule, 11, fett, grau); rechts(`Schuljahr ${d.klasse.schuljahr}`, 10, reg, grau);
    y -= 44; t(L, "Zeugnis", 26, fett);
    y -= 22; t(L, `${d.semester.nr}. Semester`, 12, reg, grau);
    y -= 38;
    t(L, "Name", 9, reg, grau); t(L + 230, "Klasse", 9, reg, grau); t(L + 330, "Geburtsdatum", 9, reg, grau);
    y -= 16;
    t(L, `${s.vorname} ${s.nachname}`, 13, fett); t(L + 230, d.klasse.name, 13, fett); if (d.klasse.profil) t(L + 230, d.klasse.profil.slice(0, 40), 9, reg, grau, y - 12);
    t(L + 330, s.geburtsdatum ? new Date(s.geburtsdatum).toLocaleDateString("de-CH") : "–", 13, fett);
    y -= 34;
    p.drawLine({ start: { x: L, y: y + 14 }, end: { x: R, y: y + 14 }, thickness: 1, color: linie });
    t(L, "Fach", 9, fett, grau); rechts("Note", 9, fett, grau);
    y -= 6;
    for (const n of s.noten) {
      y -= 20;
      t(L, n.fach + (n.relevant ? "" : " ¹"), 11);
      rechts(n.note == null ? "–" : fmtNote(n.note), 12, fett, n.note != null && n.note < 4 ? rot : undefined);
      p.drawLine({ start: { x: L, y: y - 7 }, end: { x: R, y: y - 7 }, thickness: 0.5, color: linie });
    }
    y -= 26;
    if (s.noten.some((n) => !n.relevant)) { t(L, "¹ nicht promotionswirksam", 8.5, reg, grau); y -= 18; }
    y -= 10;
    t(L, "Absenzen", 9, fett, grau); y -= 16;
    t(L, `Lektionen: ${s.absenzen.entschuldigt} entschuldigt, ${s.absenzen.unentschuldigt} unentschuldigt${s.absenzen.verspaetungen ? `, ${s.absenzen.verspaetungen} Verspätungen` : ""}`, 11);
    y -= 30;
    t(L, "Promotion", 9, fett, grau); y -= 16;
    const e = s.entscheid;
    t(L, e ? ERGEBNIS[e.ergebnis][0].toUpperCase() + ERGEBNIS[e.ergebnis].slice(1) : "Noch nicht entschieden", 13, fett, e && e.ergebnis !== "promoviert" ? rot : undefined);
    if (e && e.bemerkung) { y -= 16; for (const z of zeilenUmbruch(e.bemerkung, reg, 10, R - L)) { t(L, z, 10, reg, grau); y -= 13; } }
    y = 150;
    p.drawLine({ start: { x: L, y }, end: { x: L + 190, y }, thickness: 0.8, color: grau });
    p.drawLine({ start: { x: R - 190, y }, end: { x: R, y }, thickness: 0.8, color: grau });
    y -= 14; t(L, `Klassenlehrperson${d.klasse.klp ? `: ${d.klasse.klp}` : ""}`, 9, reg, grau); t(R - 190, "Rektorat", 9, reg, grau);
    y = 70; t(L, `${d.schule}, ${new Date().toLocaleDateString("de-CH", { day: "numeric", month: "long", year: "numeric" })}`, 9, reg, grau);
    y = 48; t(L, "Notenskala 6 bis 1; Noten unter 4 sind ungenügend.", 8, reg, grau);
  }
  return Buffer.from(await doc.save());
}
function zeilenUmbruch(s, font, size, breite) {
  const out = []; let z = "";
  for (const w of String(s).replace(/\s+/g, " ").split(" ")) { const v = z ? z + " " + w : w; if (font.widthOfTextAtSize(v.replace(/[^\x20-\xFF]/g, "?"), size) > breite && z) { out.push(z); z = w; } else z = v; }
  if (z) out.push(z);
  return out.slice(0, 6);
}

export default async function (app) {
  app.get("/api/zeugnisse/klassen", geschuetzt(async (req, res, q) => {
    const alle = req.ctx.rollen.has("admin") || req.ctx.rollen.has("schulleitung");
    if (!alle && !req.ctx.klp.size) fehler(403, "Dafür fehlt Ihnen die Berechtigung.");
    return q(`SELECT k.id, k.name, k.stufe, (SELECT count(*)::int FROM klasse_schueler ks WHERE ks.klasse_id = k.id) AS schueler FROM klasse k JOIN schuljahr j ON j.id = k.schuljahr_id AND j.aktiv
      WHERE $1 OR k.id = ANY($2) ORDER BY k.name`, [alle, [...req.ctx.klp]]);
  }));
  app.get("/api/klassen/:kid/zeugnisse", geschuetzt(async (req, res, q) => {
    const kid = id(req.params.kid);
    pruefe(req.ctx, "zeugnis.erstellen", { klasseId: kid });
    const d = await zeugnisDaten(q, kid, req.query.semester ? id(req.query.semester) : null);
    return { ...d, darfEntscheiden: darf(req.ctx, "promotion.entscheiden") };
  }));
  app.post("/api/klassen/:kid/promotion", geschuetzt(async (req, res, q) => {
    const kid = id(req.params.kid);
    pruefe(req.ctx, "promotion.entscheiden");
    const sid = id(req.body.schueler_id);
    const d = await zeugnisDaten(q, kid, id(req.body.semester_id), sid);
    const z = d.zeilen[0] || fehler(400, "Diese Person ist nicht in der Klasse.");
    const ergebnis = ERGEBNIS[req.body.ergebnis] ? req.body.ergebnis : fehler(400, "Bitte das Ergebnis wählen.", "ergebnis");
    if (!z.promotion.vollstaendig && req.body.ergebnis !== "promoviert") fehler(400, `Es fehlen Zeugnisnoten (${z.promotion.fehlend.join(", ")}).`);
    const abweichung = z.vorschlag != null && ergebnis !== z.vorschlag;
    const bemerkung = text(req.body.bemerkung, 1000);
    if ((abweichung || !z.promotion.vollstaendig) && !bemerkung) fehler(400, "Der Entscheid weicht von der Berechnung ab. Bitte begründen (Klassenkonvent, § 13).", "bemerkung");
    const [alt] = await q("SELECT ergebnis FROM promotion WHERE schueler_id = $1 AND semester_id = $2", [sid, d.semester.id]);
    await q(`INSERT INTO promotion (schueler_id, semester_id, klasse_id, ergebnis, berechnung, abweichung, bemerkung, entschieden_von) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (schueler_id, semester_id) DO UPDATE SET ergebnis = EXCLUDED.ergebnis, berechnung = EXCLUDED.berechnung, abweichung = EXCLUDED.abweichung, bemerkung = EXCLUDED.bemerkung, entschieden_von = EXCLUDED.entschieden_von, entschieden_am = now()`,
      [sid, d.semester.id, kid, ergebnis, { ...z.promotion, noten: z.noten.map((n) => ({ fach: n.fach, note: n.note, relevant: n.relevant })), vorschlag: z.vorschlag }, abweichung, bemerkung, req.ctx.personId]);
    await protokolliere(q, req, "promotion.entschieden", "promotion", `${sid}:${d.semester.id}`, alt || null, { ergebnis, abweichung }, bemerkung || null);
    return { ok: true, abweichung };
  }));
  app.get("/api/klassen/:kid/zeugnisse.pdf", geschuetzt(async (req, res, q) => {
    const kid = id(req.params.kid);
    pruefe(req.ctx, "zeugnis.erstellen", { klasseId: kid });
    const d = await zeugnisDaten(q, kid, req.query.semester ? id(req.query.semester) : null, req.query.schueler ? id(req.query.schueler) : null);
    if (!d.zeilen.length) fehler(404, "Keine Schülerinnen und Schüler gefunden.");
    await protokolliere(q, req, "zeugnis.erstellt", "klasse", kid, null, { semester: d.semester.id, anzahl: d.zeilen.length });
    res.header("Content-Type", "application/pdf");
    res.header("Content-Disposition", `${req.query.ansicht === "1" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(`Zeugnisse ${d.klasse.name} ${d.semester.nr}. Semester.pdf`)}`);
    return zeugnisPdf(d);
  }));
  // Schüler/innen und Eltern: das eigene Zeugnis, sobald die Promotion entschieden ist
  app.get("/api/mein-zeugnis.pdf", geschuetzt(async (req, res, q) => {
    const sid = req.query.person ? id(req.query.person) : req.ctx.personId;
    if (sid !== req.ctx.personId) pruefe(req.ctx, "eltern.kind", { personId: sid });
    else pruefe(req.ctx, "noten.eigene");
    const k = await klasseVon(q, sid) || fehler(404, "Keine Klasse gefunden.");
    const d = await zeugnisDaten(q, k.id, req.query.semester ? id(req.query.semester) : null, sid);
    if (!d.zeilen[0] || !d.zeilen[0].entscheid) fehler(404, "Das Zeugnis für dieses Semester ist noch nicht fertig.");
    res.header("Content-Type", "application/pdf");
    res.header("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(`Zeugnis ${d.semester.nr}. Semester.pdf`)}`);
    return zeugnisPdf(d);
  }));
  // Welche Zeugnisse sind fertig? (für «Meine Noten» und Eltern)
  app.get("/api/meine-zeugnisse", geschuetzt(async (req, res, q) => {
    const sid = req.query.person ? id(req.query.person) : req.ctx.personId;
    if (sid !== req.ctx.personId) pruefe(req.ctx, "eltern.kind", { personId: sid });
    return q(`SELECT s.id AS semester_id, s.nr, j.bezeichnung AS schuljahr, p.ergebnis FROM promotion p JOIN semester s ON s.id = p.semester_id JOIN schuljahr j ON j.id = s.schuljahr_id
      WHERE p.schueler_id = $1 ORDER BY s.von DESC`, [sid]);
  }));
  // Benachrichtigen: alle Entscheide der Klasse sind gefallen
  app.post("/api/klassen/:kid/zeugnisse/bereit", geschuetzt(async (req, res, q) => {
    const kid = id(req.params.kid);
    pruefe(req.ctx, "promotion.entscheiden");
    const d = await zeugnisDaten(q, kid, id(req.body.semester_id));
    const fertig = d.zeilen.filter((z) => z.entscheid);
    const eltern = fertig.length ? (await q("SELECT eltern_id FROM eltern_kind WHERE kind_id = ANY($1)", [fertig.map((z) => z.id)])).map((x) => x.eltern_id) : [];
    const n = await mitteilen(q, [...fertig.map((z) => z.id), ...eltern], { art: "zeugnis", titel: `Zeugnis ${d.semester.nr}. Semester ${d.klasse.schuljahr}`, text: "Das Zeugnis steht bereit.", link: "/meine-noten", schluessel: `zeugnis:${d.semester.id}` });
    return { ok: true, empfaenger: n, offen: d.zeilen.length - fertig.length };
  }));
}
