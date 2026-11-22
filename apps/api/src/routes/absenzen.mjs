// Absenzen: pro Lektion erfassen, online entschuldigen (Schüler/in oder Eltern), Entscheid der Klassenlehrperson,
// Frist (offen → unentschuldigt) und Mitteilung an die Klassenlehrperson ab einer Schwelle unentschuldigter Lektionen.
import { geschuetzt } from "../sitzung.mjs";
import { fehler } from "../fehler.mjs";
import { protokolliere } from "../protokoll.mjs";
import { pruefe, darf, plusTage, wochentag } from "@schule/shared";
import { id, text, datum, unterrichtLaden, schuelerVon, schuelerDerKlasse, klasseVon, mitteilen, dateiLesen, dateiSpeichern, dateienVon, dateiLaden, dateiSenden, heute, name } from "../hilfen.mjs";

const GRUENDE = { krankheit: "Krankheit", unfall: "Unfall", arzt: "Arzt- oder Zahnarztbesuch", familie: "Familiäre Gründe", religion: "Religiöser Feiertag", sport_kultur: "Sport oder Kultur", andere: "Anderer Grund" };
const STANDARD = { frist_tage: 14, schwellen: [3, 6, 10] };

async function regeln(q) {
  const [s] = await q("SELECT einstellungen FROM schule");
  const a = (s.einstellungen && s.einstellungen.absenzen) || {};
  return { frist_tage: Number(a.frist_tage) || STANDARD.frist_tage, schwellen: Array.isArray(a.schwellen) && a.schwellen.length ? a.schwellen.map(Number).sort((x, y) => x - y) : STANDARD.schwellen };
}
/** Offene Absenzen nach Ablauf der Frist gelten als unentschuldigt (läuft bei jedem Lesen, braucht keinen Zeitplan) */
async function fristenAnwenden(q, schuelerIds = null) {
  const { frist_tage } = await regeln(q);
  const rows = await q(`UPDATE absenz SET status = 'unentschuldigt' WHERE status = 'offen' AND datum < $1::date AND ($2::uuid[] IS NULL OR schueler_id = ANY($2))
    AND NOT EXISTS (SELECT 1 FROM entschuldigung e WHERE e.schueler_id = absenz.schueler_id AND e.status = 'eingereicht' AND absenz.datum BETWEEN e.von AND e.bis)
    RETURNING schueler_id`, [plusTage(heute(), -frist_tage), schuelerIds]);
  for (const sid of new Set(rows.map((r) => r.schueler_id))) await schwellePruefen(q, sid);
}
/** Unentschuldigte Lektionen im aktiven Schuljahr; beim Überschreiten einer Schwelle eine Mitteilung an die Klassenlehrperson */
async function schwellePruefen(q, sid) {
  const k = await klasseVon(q, sid);
  if (!k || !k.klassenlehrperson_id) return;
  const [{ n }] = await q(`SELECT count(*)::int AS n FROM absenz a JOIN schuljahr j ON j.aktiv AND a.datum BETWEEN j.von AND j.bis WHERE a.schueler_id = $1 AND a.status = 'unentschuldigt' AND a.art = 'abwesend'`, [sid]);
  const { schwellen } = await regeln(q);
  const erreicht = schwellen.filter((s) => n >= s).pop();
  if (!erreicht) return;
  const [p] = await q("SELECT vorname, nachname FROM person WHERE id = $1", [sid]);
  await mitteilen(q, [k.klassenlehrperson_id], { art: "absenz", titel: `${name(p)} (${k.name}): ${n} unentschuldigte Lektionen`, text: `Die Schwelle von ${erreicht} Lektionen ist erreicht.`, link: `/absenzen/schueler/${sid}`, schluessel: `absenz:${sid}:${erreicht}` });
}
/** Angenommene Gesuche/Entschuldigungen gelten auch für später erfasste Absenzen */
async function entschuldigungAnwenden(q, sid, d) {
  const [e] = await q("SELECT id FROM entschuldigung WHERE schueler_id = $1 AND status = 'angenommen' AND $2::date BETWEEN von AND bis ORDER BY eingereicht_am DESC LIMIT 1", [sid, d]);
  if (e) await q("UPDATE absenz SET status = 'entschuldigt', entschuldigung_id = $1 WHERE schueler_id = $2 AND datum = $3 AND status <> 'entschuldigt'", [e.id, sid, d]);
}

/** Zusammenfassung pro Schüler/in */
const ZAHLEN = `count(*) FILTER (WHERE a.art = 'abwesend')::int AS lektionen,
  count(*) FILTER (WHERE a.art = 'abwesend' AND a.status = 'offen')::int AS offen,
  count(*) FILTER (WHERE a.art = 'abwesend' AND a.status = 'entschuldigt')::int AS entschuldigt,
  count(*) FILTER (WHERE a.art = 'abwesend' AND a.status = 'unentschuldigt')::int AS unentschuldigt,
  count(*) FILTER (WHERE a.art = 'verspaetet')::int AS verspaetungen`;

async function schuelerSicht(q, ctx, sid) {
  const k = await klasseVon(q, sid);
  const eigen = sid === ctx.personId;
  if (!eigen && !darf(ctx, "eltern.kind", { personId: sid }) && !(k && darf(ctx, "absenz.klasse", { klasseId: k.id }))) fehler(403, "Dafür fehlt Ihnen die Berechtigung.");
  await fristenAnwenden(q, [sid]);
  const absenzen = await q(`SELECT a.id, a.datum::text AS datum, a.lektion, a.art, a.minuten, a.status, a.bemerkung, a.entschuldigung_id, f.name AS fach, f.farbe
    FROM absenz a LEFT JOIN unterricht u ON u.id = a.unterricht_id LEFT JOIN fach f ON f.id = u.fach_id JOIN schuljahr j ON j.aktiv AND a.datum BETWEEN j.von AND j.bis
    WHERE a.schueler_id = $1 ORDER BY a.datum DESC, a.lektion`, [sid]);
  const entschuldigungen = await q(`SELECT e.*, e.von::text AS von, e.bis::text AS bis, p.vorname || ' ' || p.nachname AS eingereicht_von_name, x.vorname || ' ' || x.nachname AS entschieden_von_name
    FROM entschuldigung e LEFT JOIN person p ON p.id = e.eingereicht_von LEFT JOIN person x ON x.id = e.entschieden_von WHERE e.schueler_id = $1 ORDER BY e.eingereicht_am DESC LIMIT 100`, [sid]);
  const dateien = await dateienVon(q, "entschuldigung", entschuldigungen.map((e) => e.id));
  const [zahlen] = await q(`SELECT ${ZAHLEN} FROM absenz a JOIN schuljahr j ON j.aktiv AND a.datum BETWEEN j.von AND j.bis WHERE a.schueler_id = $1`, [sid]);
  const [p] = await q("SELECT id, vorname, nachname FROM person WHERE id = $1", [sid]);
  const { frist_tage } = await regeln(q);
  return { person: p, klasse: k, absenzen, entschuldigungen: entschuldigungen.map((e) => ({ ...e, dateien: dateien.filter((d) => d.bezug_id === e.id) })), zahlen, frist_tage, gruende: GRUENDE,
    darfEntscheiden: !!(k && darf(ctx, "absenz.klasse", { klasseId: k.id })), darfEinreichen: darf(ctx, "entschuldigung.einreichen", { personId: sid }) };
}

export default async function (app) {
  /* ---------- Erfassen in einer Lektion ---------- */
  app.get("/api/absenzen/erfassen/:uid", geschuetzt(async (req, res, q) => {
    const u = await unterrichtLaden(q, req.params.uid);
    pruefe(req.ctx, "absenz.erfassen", { unterrichtId: u.id, klasseId: u.klasse_id });
    const d = req.query.datum ? datum(req.query.datum) : heute();
    const schueler = await schuelerVon(q, u);
    const plan = await q("SELECT lektion FROM stundenplan WHERE unterricht_id = $1 AND wochentag = $2 ORDER BY lektion", [u.id, wochentag(d)]);
    const lektion = req.query.lektion ? Number(req.query.lektion) : plan.length ? plan[0].lektion : null;
    const vorhanden = await q(`SELECT a.id, a.schueler_id, a.art, a.minuten, a.status, a.bemerkung, a.lektion FROM absenz a WHERE a.datum = $1 AND a.schueler_id = ANY($2)
      AND (a.unterricht_id = $3 OR a.unterricht_id IS NULL) AND ($4::smallint IS NULL OR a.lektion = $4 OR a.lektion IS NULL)`, [d, schueler.map((s) => s.id), u.id, lektion]);
    // Ganztags gemeldete Abwesenheit (z. B. am Morgen von der Klassenlehrperson) und angenommene Gesuche
    const gesuche = await q("SELECT schueler_id, grund FROM entschuldigung WHERE status = 'angenommen' AND art = 'gesuch' AND $1::date BETWEEN von AND bis AND schueler_id = ANY($2)", [d, schueler.map((s) => s.id)]);
    return { unterricht: u, datum: d, lektion, plan: plan.map((p) => p.lektion), schueler: schueler.map((s) => ({ ...s, absenz: vorhanden.find((a) => a.schueler_id === s.id && a.lektion === lektion) || null, ganztag: vorhanden.find((a) => a.schueler_id === s.id && a.lektion == null) || null, gesuch: gesuche.find((g) => g.schueler_id === s.id) || null })) };
  }));
  app.put("/api/absenzen/erfassen/:uid", geschuetzt(async (req, res, q) => {
    const u = await unterrichtLaden(q, req.params.uid);
    pruefe(req.ctx, "absenz.erfassen", { unterrichtId: u.id, klasseId: u.klasse_id });
    const d = datum(req.body.datum);
    if (d > heute()) fehler(400, "Absenzen für die Zukunft gehen nicht. Für Urlaub gibt es Gesuche.", "datum");
    const l = Number(req.body.lektion);
    if (!(l >= 1 && l <= 16)) fehler(400, "Bitte die Lektion wählen.", "lektion");
    const erlaubt = new Set((await schuelerVon(q, u)).map((s) => s.id));
    let neu = 0, entfernt = 0;
    for (const e of (Array.isArray(req.body.eintraege) ? req.body.eintraege : []).slice(0, 60)) {
      const sid = id(e.schueler_id);
      if (!erlaubt.has(sid)) fehler(400, "Diese Person gehört nicht zu diesem Unterricht.");
      const [alt] = await q("SELECT * FROM absenz WHERE schueler_id = $1 AND datum = $2 AND lektion = $3 AND unterricht_id = $4", [sid, d, l, u.id]);
      if (!e.art) {
        if (alt) { if (alt.status !== "offen" && !darf(req.ctx, "absenz.klasse", { klasseId: u.klasse_id })) fehler(409, "Diese Absenz ist schon entschieden. Änderungen macht die Klassenlehrperson."); await q("DELETE FROM absenz WHERE id = $1", [alt.id]); entfernt++; }
        continue;
      }
      const art = e.art === "verspaetet" ? "verspaetet" : "abwesend";
      const min = art === "verspaetet" ? Math.max(1, Math.min(120, Number(e.minuten) || 5)) : null;
      if (alt) await q("UPDATE absenz SET art = $1, minuten = $2, bemerkung = $3 WHERE id = $4", [art, min, text(e.bemerkung, 300), alt.id]);
      else { await q("INSERT INTO absenz (schueler_id, datum, lektion, unterricht_id, art, minuten, bemerkung, erfasst_von) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [sid, d, l, u.id, art, min, text(e.bemerkung, 300), req.ctx.personId]); neu++; }
      await entschuldigungAnwenden(q, sid, d);
    }
    if (neu || entfernt) await protokolliere(q, req, "absenzen.erfasst", "unterricht", u.id, null, { datum: d, lektion: l, neu, entfernt });
    return { ok: true, neu, entfernt };
  }));

  /* ---------- Eigene Absenzen (Schüler/in) und die der Kinder (Eltern) ---------- */
  app.get("/api/meine-absenzen", geschuetzt(async (req, res, q) => {
    pruefe(req.ctx, "absenz.eigene");
    const sid = req.query.person ? id(req.query.person) : req.ctx.rollen.has("schueler") ? req.ctx.personId : [...req.ctx.kinder][0] || fehler(404, "Es ist kein Kind mit Ihrem Konto verknüpft.");
    return schuelerSicht(q, req.ctx, sid);
  }));
  app.get("/api/absenzen/schueler/:sid", geschuetzt(async (req, res, q) => schuelerSicht(q, req.ctx, id(req.params.sid))));

  /* ---------- Entschuldigungen und Gesuche ---------- */
  app.post("/api/entschuldigungen", geschuetzt(async (req, res, q) => {
    const b = req.body || {};
    const sid = b.person_id ? id(b.person_id) : req.ctx.personId;
    pruefe(req.ctx, "entschuldigung.einreichen", { personId: sid });
    const art = b.art === "gesuch" ? "gesuch" : "entschuldigung";
    const von = datum(b.von, "von"), bis = b.bis ? datum(b.bis, "bis") : von;
    if (bis < von) fehler(400, "Das Ende liegt vor dem Beginn.", "bis");
    if (art === "gesuch" && von < heute()) fehler(400, "Ein Gesuch stellen Sie vor der Abwesenheit. Für vergangene Tage: Entschuldigung.", "von");
    if (art === "entschuldigung" && von > heute()) fehler(400, "Für künftige Abwesenheiten stellen Sie ein Gesuch.", "von");
    if (!GRUENDE[b.grund]) fehler(400, "Bitte einen Grund wählen.", "grund");
    const [e] = await q(`INSERT INTO entschuldigung (schueler_id, art, von, bis, grund, text, eingereicht_von) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [sid, art, von, bis, b.grund, text(b.text, 2000), req.ctx.personId]);
    const k = await klasseVon(q, sid);
    const [p] = await q("SELECT vorname, nachname FROM person WHERE id = $1", [sid]);
    if (k && k.klassenlehrperson_id) await mitteilen(q, [k.klassenlehrperson_id], { art: "absenz", titel: `${art === "gesuch" ? "Gesuch" : "Entschuldigung"}: ${name(p)} (${k.name})`, text: `${GRUENDE[b.grund]}, ${new Date(von).toLocaleDateString("de-CH")}${bis !== von ? " bis " + new Date(bis).toLocaleDateString("de-CH") : ""}`, link: `/absenzen/schueler/${sid}` });
    return e;
  }));
  app.post("/api/entschuldigungen/:id/datei", geschuetzt(async (req, res, q) => {
    const [e] = await q("SELECT * FROM entschuldigung WHERE id = $1", [id(req.params.id)]);
    if (!e) fehler(404, "Entschuldigung nicht gefunden.");
    if (e.eingereicht_von !== req.ctx.personId) fehler(403, "Dateien nur zur eigenen Eingabe.");
    if (e.status !== "eingereicht") fehler(409, "Die Entschuldigung ist schon entschieden.");
    const { datei } = await dateiLesen(req);
    return dateiSpeichern(q, req, { bezugTyp: "entschuldigung", bezugId: e.id }, datei);
  }));
  app.get("/api/entschuldigung-dateien/:did", geschuetzt(async (req, res, q) => {
    const f = await dateiLaden(q, req.params.did);
    if (f.bezug_typ !== "entschuldigung") fehler(404, "Datei nicht gefunden.");
    const [e] = await q("SELECT schueler_id FROM entschuldigung WHERE id = $1", [f.bezug_id]);
    await schuelerSicht(q, req.ctx, e.schueler_id); // prüft die Rechte
    return dateiSenden(res, f, req.query.ansicht === "1");
  }));
  app.post("/api/entschuldigungen/:id/entscheiden", geschuetzt(async (req, res, q) => {
    const [e] = await q("SELECT * FROM entschuldigung WHERE id = $1", [id(req.params.id)]);
    if (!e) fehler(404, "Entschuldigung nicht gefunden.");
    const k = await klasseVon(q, e.schueler_id);
    if (!k || !darf(req.ctx, "absenz.klasse", { klasseId: k.id })) fehler(403, "Dafür fehlt Ihnen die Berechtigung.");
    const status = ["angenommen", "abgelehnt"].includes(req.body.status) ? req.body.status : fehler(400, "Bitte annehmen oder ablehnen.");
    if (status === "abgelehnt" && !text(req.body.bemerkung, 1000)) fehler(400, "Bitte begründen Sie die Ablehnung.", "bemerkung");
    await q("UPDATE entschuldigung SET status = $1, bemerkung = $2, entschieden_von = $3, entschieden_am = now() WHERE id = $4", [status, text(req.body.bemerkung, 1000), req.ctx.personId, e.id]);
    const r = await q(`UPDATE absenz SET status = $1, entschuldigung_id = $2 WHERE schueler_id = $3 AND datum BETWEEN $4 AND $5 AND art = 'abwesend' AND (status <> 'entschuldigt' OR $1 = 'entschuldigt') RETURNING id`,
      [status === "angenommen" ? "entschuldigt" : "unentschuldigt", e.id, e.schueler_id, e.von, e.bis]);
    if (status === "abgelehnt") await schwellePruefen(q, e.schueler_id);
    const eltern = (await q("SELECT eltern_id FROM eltern_kind WHERE kind_id = $1", [e.schueler_id])).map((x) => x.eltern_id);
    await mitteilen(q, [e.schueler_id, e.eingereicht_von, ...eltern], { art: "absenz", titel: `${e.art === "gesuch" ? "Gesuch" : "Entschuldigung"} ${status}`, text: `${new Date(e.von).toLocaleDateString("de-CH")}${e.bis !== e.von ? " bis " + new Date(e.bis).toLocaleDateString("de-CH") : ""}${req.body.bemerkung ? ": " + text(req.body.bemerkung, 200) : ""}`, link: "/absenzen" });
    await protokolliere(q, req, "entschuldigung." + status, "entschuldigung", e.id, null, { lektionen: r.length }, text(req.body.bemerkung, 300) || null);
    return { ok: true, lektionen: r.length };
  }));
  // Einzelne Absenz von Hand entscheiden (Klassenlehrperson)
  app.put("/api/absenzen/:id", geschuetzt(async (req, res, q) => {
    const [a] = await q("SELECT * FROM absenz WHERE id = $1", [id(req.params.id)]);
    if (!a) fehler(404, "Absenz nicht gefunden.");
    const k = await klasseVon(q, a.schueler_id);
    if (!k || !darf(req.ctx, "absenz.klasse", { klasseId: k.id })) fehler(403, "Dafür fehlt Ihnen die Berechtigung.");
    const status = ["offen", "entschuldigt", "unentschuldigt"].includes(req.body.status) ? req.body.status : fehler(400, "Ungültiger Status.");
    await q("UPDATE absenz SET status = $1, bemerkung = coalesce($2, bemerkung) WHERE id = $3", [status, req.body.bemerkung !== undefined ? text(req.body.bemerkung, 300) : null, a.id]);
    await protokolliere(q, req, "absenz.status", "absenz", a.id, { status: a.status }, { status });
    if (status === "unentschuldigt") await schwellePruefen(q, a.schueler_id);
    return { ok: true };
  }));
  app.delete("/api/absenzen/:id", geschuetzt(async (req, res, q) => {
    const [a] = await q("SELECT * FROM absenz WHERE id = $1", [id(req.params.id)]);
    if (!a) fehler(404, "Absenz nicht gefunden.");
    const k = await klasseVon(q, a.schueler_id);
    if (!k || !darf(req.ctx, "absenz.klasse", { klasseId: k.id })) fehler(403, "Dafür fehlt Ihnen die Berechtigung.");
    await q("DELETE FROM absenz WHERE id = $1", [a.id]);
    await protokolliere(q, req, "absenz.geloescht", "absenz", a.id, { datum: a.datum, lektion: a.lektion, status: a.status });
    return { ok: true };
  }));

  /* ---------- Übersicht einer Klasse (Klassenlehrperson, Schulleitung) ---------- */
  app.get("/api/klassen/:kid/absenzen", geschuetzt(async (req, res, q) => {
    const kid = id(req.params.kid);
    pruefe(req.ctx, "absenz.klasse", { klasseId: kid });
    const [k] = await q("SELECT id, name, klassenlehrperson_id FROM klasse WHERE id = $1", [kid]);
    if (!k) fehler(404, "Klasse nicht gefunden.");
    const sch = await schuelerDerKlasse(q, kid);
    await fristenAnwenden(q, sch.map((s) => s.id));
    const zahlen = sch.length ? await q(`SELECT a.schueler_id, ${ZAHLEN} FROM absenz a JOIN schuljahr j ON j.aktiv AND a.datum BETWEEN j.von AND j.bis WHERE a.schueler_id = ANY($1) GROUP BY a.schueler_id`, [sch.map((s) => s.id)]) : [];
    const offen = sch.length ? await q(`SELECT e.*, e.von::text AS von, e.bis::text AS bis, p.vorname, p.nachname, x.vorname || ' ' || x.nachname AS eingereicht_von_name
      FROM entschuldigung e JOIN person p ON p.id = e.schueler_id LEFT JOIN person x ON x.id = e.eingereicht_von WHERE e.schueler_id = ANY($1) AND e.status = 'eingereicht' ORDER BY e.eingereicht_am`, [sch.map((s) => s.id)]) : [];
    const dateien = await dateienVon(q, "entschuldigung", offen.map((e) => e.id));
    const { schwellen, frist_tage } = await regeln(q);
    const leer = { lektionen: 0, offen: 0, entschuldigt: 0, unentschuldigt: 0, verspaetungen: 0 };
    return { klasse: k, schwellen, frist_tage, gruende: GRUENDE,
      schueler: sch.map((s) => ({ ...s, ...leer, ...(zahlen.find((z) => z.schueler_id === s.id) || {}), schueler_id: undefined })),
      offen: offen.map((e) => ({ ...e, dateien: dateien.filter((d) => d.bezug_id === e.id) })) };
  }));
  // Klassen, deren Absenzen die Person verwalten darf
  app.get("/api/absenzen/klassen", geschuetzt(async (req, res, q) => {
    const alle = req.ctx.rollen.has("admin") || req.ctx.rollen.has("schulleitung");
    if (!alle && !req.ctx.klp.size) fehler(403, "Dafür fehlt Ihnen die Berechtigung.");
    return q(`SELECT k.id, k.name, (SELECT count(*)::int FROM entschuldigung e JOIN klasse_schueler ks ON ks.person_id = e.schueler_id AND ks.klasse_id = k.id WHERE e.status = 'eingereicht') AS offen
      FROM klasse k JOIN schuljahr j ON j.id = k.schuljahr_id AND j.aktiv WHERE $1 OR k.id = ANY($2) ORDER BY k.name`, [alle, [...req.ctx.klp]]);
  }));
}
