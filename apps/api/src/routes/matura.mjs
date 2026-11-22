// Maturaarbeit: Zuteilung, Thema, Meilensteine, Arbeitsjournal, Dateien, Abgabe und Bewertung nach Kriterien
import { geschuetzt } from "../sitzung.mjs";
import { fehler } from "../fehler.mjs";
import { protokolliere } from "../protokoll.mjs";
import { pruefe, darf, kriterienNote, MATURA_KRITERIEN_STANDARD, MATURA_MEILENSTEINE_STANDARD } from "@schule/shared";
import { id, optId, text, pflicht, zahl, datum, optDatum, optZeitpunkt, mitteilen, dateiLesen, dateiSpeichern, dateienVon, dateiLaden, dateiSenden, dateiEntfernen, name } from "../hilfen.mjs";

const STATUS = { thema: "Thema in Abklärung", in_arbeit: "In Arbeit", abgegeben: "Abgegeben", bewertet: "Bewertet" };

async function arbeitLaden(q, ctx, aid) {
  const [a] = await q(`SELECT m.*, s.vorname AS s_vorname, s.nachname AS s_nachname, b.vorname AS b_vorname, b.nachname AS b_nachname, k.vorname AS k_vorname, k.nachname AS k_nachname, f.name AS fach
    FROM maturaarbeit m JOIN person s ON s.id = m.schueler_id JOIN person b ON b.id = m.betreuer_id LEFT JOIN person k ON k.id = m.koreferent_id LEFT JOIN fach f ON f.id = m.fach_id WHERE m.id = $1`, [id(aid)]);
  if (!a) fehler(404, "Maturaarbeit nicht gefunden.");
  const rolle = a.schueler_id === ctx.personId ? "schueler" : a.betreuer_id === ctx.personId ? "betreuer" : a.koreferent_id === ctx.personId ? "koreferent"
    : darf(ctx, "matura.verwalten") ? "leitung" : darf(ctx, "eltern.kind", { personId: a.schueler_id }) ? "eltern" : null;
  if (!rolle) fehler(404, "Maturaarbeit nicht gefunden.");
  return { a, rolle, betreut: rolle === "betreuer" || rolle === "leitung", bewertet: ["betreuer", "koreferent", "leitung"].includes(rolle) };
}

export default async function (app) {
  app.get("/api/matura", geschuetzt(async (req, res, q) => {
    const ctx = req.ctx, alle = darf(ctx, "matura.verwalten");
    const liste = await q(`SELECT m.id, m.titel, m.status, m.abgabe_bis, m.abgegeben_am, m.note, m.schueler_id, m.betreuer_id, m.koreferent_id,
        s.vorname || ' ' || s.nachname AS schueler, b.vorname || ' ' || b.nachname AS betreuer, f.name AS fach,
        (SELECT k.name FROM klasse_schueler ks JOIN klasse k ON k.id = ks.klasse_id JOIN schuljahr j ON j.id = k.schuljahr_id AND j.aktiv WHERE ks.person_id = m.schueler_id LIMIT 1) AS klasse,
        (SELECT count(*)::int FROM ma_meilenstein x WHERE x.arbeit_id = m.id) AS meilensteine,
        (SELECT count(*)::int FROM ma_meilenstein x WHERE x.arbeit_id = m.id AND x.bestaetigt_am IS NOT NULL) AS bestaetigt,
        (SELECT count(*)::int FROM ma_meilenstein x WHERE x.arbeit_id = m.id AND x.erledigt_am IS NOT NULL AND x.bestaetigt_am IS NULL) AS zu_bestaetigen,
        (SELECT max(datum) FROM ma_journal j WHERE j.arbeit_id = m.id) AS letzter_eintrag
      FROM maturaarbeit m JOIN person s ON s.id = m.schueler_id JOIN person b ON b.id = m.betreuer_id LEFT JOIN fach f ON f.id = m.fach_id
      WHERE $1 OR m.schueler_id = $2 OR m.betreuer_id = $2 OR m.koreferent_id = $2 OR m.schueler_id = ANY($3)
      ORDER BY m.abgabe_bis NULLS LAST, s.nachname`, [alle, ctx.personId, [...(ctx.kinder || [])]]);
    return { liste, status: STATUS, darfZuteilen: alle || darf(ctx, "matura.betreuen") };
  }));

  /* ---------- Zuteilen (Schulleitung, oder die Lehrperson als Betreuerin) ---------- */
  app.post("/api/matura", geschuetzt(async (req, res, q) => {
    const b = req.body || {};
    const leitung = darf(req.ctx, "matura.verwalten");
    if (!leitung) pruefe(req.ctx, "matura.betreuen");
    const betreuer = leitung ? id(b.betreuer_id) : req.ctx.personId;
    const sid = id(b.schueler_id);
    const [s] = await q("SELECT 1 FROM rolle WHERE person_id = $1 AND art = 'schueler'", [sid]);
    if (!s) fehler(400, "Bitte eine Schülerin oder einen Schüler wählen.", "schueler_id");
    const [l] = await q("SELECT 1 FROM rolle WHERE person_id = $1 AND art = 'lehrperson'", [betreuer]);
    if (!l) fehler(400, "Die Betreuungsperson muss eine Lehrperson sein.", "betreuer_id");
    try {
      const [a] = await q(`INSERT INTO maturaarbeit (schueler_id, betreuer_id, koreferent_id, fach_id, titel, fragestellung, abgabe_bis, bewertung) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [sid, betreuer, optId(b.koreferent_id), optId(b.fach_id), pflicht(b.titel, 200, "Bitte einen (Arbeits-)Titel eingeben.", "titel"), text(b.fragestellung, 4000), optDatum(b.abgabe_bis, "abgabe_bis"),
          { kriterien: MATURA_KRITERIEN_STANDARD.map((k) => ({ ...k, note: null, kommentar: "" })) }]);
      let r = 0;
      for (const t of b.meilensteine === false ? [] : MATURA_MEILENSTEINE_STANDARD) await q("INSERT INTO ma_meilenstein (arbeit_id, titel, reihenfolge) VALUES ($1,$2,$3)", [a.id, t, r++]);
      await mitteilen(q, [sid, betreuer, a.koreferent_id].filter((x) => x && x !== req.ctx.personId), { art: "matura", titel: "Maturaarbeit: Betreuung zugeteilt", text: a.titel, link: `/matura/${a.id}` });
      await protokolliere(q, req, "matura.zugeteilt", "maturaarbeit", a.id, null, { schueler: sid, betreuer });
      return a;
    } catch (e) { if (e.code === "23505") fehler(409, "Für diese Person gibt es schon eine Maturaarbeit.", "schueler_id"); throw e; }
  }));

  app.get("/api/matura/:id", geschuetzt(async (req, res, q) => {
    const { a, rolle, betreut, bewertet } = await arbeitLaden(q, req.ctx, req.params.id);
    const meilensteine = await q("SELECT m.*, p.vorname || ' ' || p.nachname AS bestaetigt_von_name FROM ma_meilenstein m LEFT JOIN person p ON p.id = m.bestaetigt_von WHERE m.arbeit_id = $1 ORDER BY m.reihenfolge, m.faellig NULLS LAST", [a.id]);
    const journal = rolle === "eltern" ? [] : await q("SELECT j.*, j.datum::text AS datum, p.vorname || ' ' || p.nachname AS autor FROM ma_journal j LEFT JOIN person p ON p.id = j.autor_id WHERE j.arbeit_id = $1 ORDER BY j.datum DESC, j.erstellt_am DESC", [a.id]);
    const dateien = rolle === "eltern" ? [] : await dateienVon(q, "matura", [a.id]);
    const stunden = journal.filter((j) => j.art === "eintrag").reduce((s, j) => s + Number(j.stunden || 0), 0);
    // Bewertung sehen Schüler/in und Eltern erst, wenn sie abgeschlossen ist
    const zeigeBewertung = bewertet || a.status === "bewertet";
    return { arbeit: { ...a, bewertung: zeigeBewertung ? a.bewertung : null, note: zeigeBewertung ? a.note : null }, rolle, darf: { betreuen: betreut, bewerten: bewertet, schreiben: rolle === "schueler" || betreut || rolle === "koreferent" },
      meilensteine, journal, dateien, stunden: Math.round(stunden * 10) / 10, status: STATUS };
  }));
  app.put("/api/matura/:id", geschuetzt(async (req, res, q) => {
    const { a, rolle, betreut } = await arbeitLaden(q, req.ctx, req.params.id);
    const b = req.body || {};
    if (rolle === "schueler") {
      if (!["thema", "in_arbeit"].includes(a.status)) fehler(409, "Die Arbeit ist abgegeben.");
      await q("UPDATE maturaarbeit SET titel = $1, fragestellung = $2 WHERE id = $3", [b.titel !== undefined ? pflicht(b.titel, 200, "Bitte einen Titel eingeben.", "titel") : a.titel, b.fragestellung !== undefined ? text(b.fragestellung, 4000) : a.fragestellung, a.id]);
      return { ok: true };
    }
    if (!betreut) fehler(403, "Dafür fehlt Ihnen die Berechtigung.");
    const status = b.status !== undefined ? (STATUS[b.status] ? b.status : fehler(400, "Ungültiger Status.")) : a.status;
    await q(`UPDATE maturaarbeit SET titel = $1, fragestellung = $2, status = $3, abgabe_bis = $4, praesentation_am = $5, koreferent_id = $6, fach_id = $7 WHERE id = $8`,
      [b.titel !== undefined ? pflicht(b.titel, 200, "Bitte einen Titel eingeben.", "titel") : a.titel, b.fragestellung !== undefined ? text(b.fragestellung, 4000) : a.fragestellung, status,
        b.abgabe_bis !== undefined ? optDatum(b.abgabe_bis, "abgabe_bis") : a.abgabe_bis, b.praesentation_am !== undefined ? optZeitpunkt(b.praesentation_am, "praesentation_am") : a.praesentation_am,
        b.koreferent_id !== undefined ? optId(b.koreferent_id) : a.koreferent_id, b.fach_id !== undefined ? optId(b.fach_id) : a.fach_id, a.id]);
    if (status !== a.status && status === "in_arbeit") await mitteilen(q, [a.schueler_id], { art: "matura", titel: "Maturaarbeit: Thema genehmigt", text: a.titel, link: `/matura/${a.id}` });
    return { ok: true };
  }));

  /* ---------- Meilensteine ---------- */
  app.post("/api/matura/:id/meilensteine", geschuetzt(async (req, res, q) => {
    const { a, betreut } = await arbeitLaden(q, req.ctx, req.params.id);
    if (!betreut) fehler(403, "Meilensteine legt die Betreuungsperson fest.");
    const [{ r }] = await q("SELECT coalesce(max(reihenfolge), -1) + 1 AS r FROM ma_meilenstein WHERE arbeit_id = $1", [a.id]);
    const [m] = await q("INSERT INTO ma_meilenstein (arbeit_id, titel, faellig, reihenfolge) VALUES ($1,$2,$3,$4) RETURNING *", [a.id, pflicht(req.body.titel, 160, "Bitte einen Titel eingeben.", "titel"), optDatum(req.body.faellig, "faellig"), r]);
    return m;
  }));
  const meilenstein = async (q, ctx, mid) => {
    const [m] = await q("SELECT * FROM ma_meilenstein WHERE id = $1", [id(mid)]);
    if (!m) fehler(404, "Meilenstein nicht gefunden.");
    return { m, ...(await arbeitLaden(q, ctx, m.arbeit_id)) };
  };
  app.put("/api/ma-meilensteine/:id", geschuetzt(async (req, res, q) => {
    const { m, rolle, betreut, a } = await meilenstein(q, req.ctx, req.params.id);
    const b = req.body || {};
    if (b.erledigt !== undefined) {
      if (rolle !== "schueler" && !betreut) fehler(403, "Dafür fehlt Ihnen die Berechtigung.");
      await q("UPDATE ma_meilenstein SET erledigt_am = $1 WHERE id = $2", [b.erledigt ? new Date() : null, m.id]);
      if (b.erledigt && rolle === "schueler") await mitteilen(q, [a.betreuer_id], { art: "matura", titel: `Maturaarbeit ${name({ vorname: a.s_vorname, nachname: a.s_nachname })}: Meilenstein erreicht`, text: m.titel, link: `/matura/${a.id}` });
    }
    if (b.bestaetigt !== undefined) {
      if (!betreut) fehler(403, "Bestätigen kann die Betreuungsperson.");
      await q("UPDATE ma_meilenstein SET bestaetigt_am = $1, bestaetigt_von = $2, erledigt_am = coalesce(erledigt_am, $1) WHERE id = $3", [b.bestaetigt ? new Date() : null, b.bestaetigt ? req.ctx.personId : null, m.id]);
    }
    if (b.titel !== undefined || b.faellig !== undefined) {
      if (!betreut) fehler(403, "Dafür fehlt Ihnen die Berechtigung.");
      await q("UPDATE ma_meilenstein SET titel = $1, faellig = $2 WHERE id = $3", [b.titel !== undefined ? pflicht(b.titel, 160, "Bitte einen Titel eingeben.", "titel") : m.titel, b.faellig !== undefined ? optDatum(b.faellig, "faellig") : m.faellig, m.id]);
    }
    return { ok: true };
  }));
  app.delete("/api/ma-meilensteine/:id", geschuetzt(async (req, res, q) => {
    const { m, betreut } = await meilenstein(q, req.ctx, req.params.id);
    if (!betreut) fehler(403, "Dafür fehlt Ihnen die Berechtigung.");
    await q("DELETE FROM ma_meilenstein WHERE id = $1", [m.id]);
    return { ok: true };
  }));

  /* ---------- Arbeitsjournal ---------- */
  app.post("/api/matura/:id/journal", geschuetzt(async (req, res, q) => {
    const { a, rolle, betreut } = await arbeitLaden(q, req.ctx, req.params.id);
    if (rolle !== "schueler" && !betreut && rolle !== "koreferent") fehler(403, "Dafür fehlt Ihnen die Berechtigung.");
    const art = rolle === "schueler" ? "eintrag" : "besprechung";
    const [j] = await q("INSERT INTO ma_journal (arbeit_id, autor_id, datum, art, text, stunden) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
      [a.id, req.ctx.personId, req.body.datum ? datum(req.body.datum) : new Date().toISOString().slice(0, 10), art, pflicht(req.body.text, 8000, "Bitte einen Text eingeben.", "text"), art === "eintrag" ? zahl(req.body.stunden, 0.1, 24, "stunden") : null]);
    if (art === "besprechung") await mitteilen(q, [a.schueler_id], { art: "matura", titel: "Maturaarbeit: Notiz zur Besprechung", text: j.text.slice(0, 140), link: `/matura/${a.id}` });
    return j;
  }));
  app.delete("/api/ma-journal/:id", geschuetzt(async (req, res, q) => {
    const [j] = await q("SELECT * FROM ma_journal WHERE id = $1", [id(req.params.id)]);
    if (!j || j.autor_id !== req.ctx.personId) fehler(404, "Eintrag nicht gefunden.");
    if (Date.now() - new Date(j.erstellt_am) > 7 * 864e5) fehler(409, "Einträge lassen sich nur in den ersten sieben Tagen löschen.");
    await q("DELETE FROM ma_journal WHERE id = $1", [j.id]);
    return { ok: true };
  }));

  /* ---------- Dateien und Abgabe ---------- */
  app.post("/api/matura/:id/dateien", geschuetzt(async (req, res, q) => {
    const { a, rolle, betreut } = await arbeitLaden(q, req.ctx, req.params.id);
    if (rolle === "schueler" && ["abgegeben", "bewertet"].includes(a.status)) fehler(409, "Die Arbeit ist abgegeben.");
    if (rolle !== "schueler" && !betreut) fehler(403, "Dafür fehlt Ihnen die Berechtigung.");
    const { datei } = await dateiLesen(req);
    return dateiSpeichern(q, req, { bezugTyp: "matura", bezugId: a.id }, datei);
  }));
  app.get("/api/matura-dateien/:did", geschuetzt(async (req, res, q) => {
    const f = await dateiLaden(q, req.params.did);
    if (f.bezug_typ !== "matura") fehler(404, "Datei nicht gefunden.");
    const { rolle } = await arbeitLaden(q, req.ctx, f.bezug_id);
    if (rolle === "eltern") fehler(404, "Datei nicht gefunden.");
    return dateiSenden(res, f, req.query.ansicht === "1");
  }));
  app.delete("/api/matura-dateien/:did", geschuetzt(async (req, res, q) => {
    const f = await dateiLaden(q, req.params.did);
    if (f.bezug_typ !== "matura") fehler(404, "Datei nicht gefunden.");
    const { a, rolle } = await arbeitLaden(q, req.ctx, f.bezug_id);
    if (f.erstellt_von !== req.ctx.personId) fehler(403, "Nur eigene Dateien lassen sich löschen.");
    if (rolle === "schueler" && ["abgegeben", "bewertet"].includes(a.status)) fehler(409, "Die Arbeit ist abgegeben.");
    await dateiEntfernen(q, f);
    return { ok: true };
  }));
  app.post("/api/matura/:id/abgeben", geschuetzt(async (req, res, q) => {
    const { a, rolle } = await arbeitLaden(q, req.ctx, req.params.id);
    if (rolle !== "schueler") fehler(403, "Abgeben kann nur die Schülerin oder der Schüler.");
    if (a.status !== "in_arbeit") fehler(409, a.status === "thema" ? "Das Thema ist noch nicht genehmigt." : "Die Arbeit ist schon abgegeben.");
    const [{ n }] = await q("SELECT count(*)::int AS n FROM datei WHERE bezug_typ = 'matura' AND bezug_id = $1 AND erstellt_von = $2 AND geloescht_am IS NULL", [a.id, req.ctx.personId]);
    if (!n) fehler(400, "Laden Sie zuerst die Arbeit als Datei hoch (z. B. PDF).");
    await q("UPDATE maturaarbeit SET status = 'abgegeben', abgegeben_am = now() WHERE id = $1", [a.id]);
    await mitteilen(q, [a.betreuer_id, a.koreferent_id], { art: "matura", titel: `Maturaarbeit abgegeben: ${name({ vorname: a.s_vorname, nachname: a.s_nachname })}`, text: a.titel, link: `/matura/${a.id}` });
    await protokolliere(q, req, "matura.abgegeben", "maturaarbeit", a.id, null, { verspaetet: !!(a.abgabe_bis && new Date().toISOString().slice(0, 10) > a.abgabe_bis) });
    return { ok: true };
  }));

  /* ---------- Bewertung ---------- */
  app.put("/api/matura/:id/bewertung", geschuetzt(async (req, res, q) => {
    const { a, bewertet } = await arbeitLaden(q, req.ctx, req.params.id);
    if (!bewertet) fehler(403, "Dafür fehlt Ihnen die Berechtigung.");
    if (a.status === "bewertet" && !req.body.grund) fehler(409, "Die Bewertung ist abgeschlossen. Für eine Änderung bitte einen Grund angeben.", "grund");
    const kriterien = (Array.isArray(req.body.kriterien) ? req.body.kriterien : []).slice(0, 12).map((k, i) => ({
      id: /^[a-z0-9_]{1,20}$/.test(String(k.id || "")) ? k.id : `k${i + 1}`, name: pflicht(k.name, 80, "Bitte jedes Kriterium benennen.", `kriterien.${i}.name`),
      gewicht: zahl(k.gewicht, 1, 100, `kriterien.${i}.gewicht`) ?? fehler(400, "Bitte das Gewicht angeben.", `kriterien.${i}.gewicht`),
      note: zahl(k.note, 1, 6, `kriterien.${i}.note`), kommentar: text(k.kommentar, 2000) }));
    if (!kriterien.length) fehler(400, "Mindestens ein Kriterium.");
    const note = req.body.note != null && req.body.note !== "" ? zahl(req.body.note, 1, 6, "note") : kriterienNote(kriterien);
    if (note != null && Math.round(note * 2) / 2 !== note) fehler(400, "Die Note der Maturaarbeit in halben Noten.", "note");
    const abschliessen = req.body.abschliessen === true;
    if (abschliessen && (note == null || kriterien.some((k) => k.note == null))) fehler(400, "Zum Abschliessen braucht jedes Kriterium eine Note.");
    if (abschliessen && !["abgegeben", "bewertet"].includes(a.status)) fehler(409, "Die Arbeit ist noch nicht abgegeben.");
    await q("UPDATE maturaarbeit SET bewertung = $1, note = $2, status = CASE WHEN $3 THEN 'bewertet' ELSE status END, bewertet_am = CASE WHEN $3 THEN now() ELSE bewertet_am END WHERE id = $4",
      [{ kriterien }, note, abschliessen, a.id]);
    if (abschliessen) {
      await mitteilen(q, [a.schueler_id], { art: "matura", titel: "Maturaarbeit bewertet", text: a.titel, link: `/matura/${a.id}`, schluessel: `matura:bewertet:${a.id}` });
      await protokolliere(q, req, "matura.bewertet", "maturaarbeit", a.id, a.note != null ? { note: a.note } : null, { note }, text(req.body.grund, 300) || null);
    }
    return { ok: true, note };
  }));
  // Personen für die Zuteilung (Schüler/innen und Lehrpersonen)
  app.get("/api/matura-personen", geschuetzt(async (req, res, q) => {
    if (!darf(req.ctx, "matura.verwalten") && !darf(req.ctx, "matura.betreuen")) fehler(403, "Dafür fehlt Ihnen die Berechtigung.");
    const rolle = req.query.rolle === "lehrperson" ? "lehrperson" : "schueler";
    const such = text(req.query.q, 60);
    return q(`SELECT p.id, p.vorname, p.nachname, (SELECT k.name FROM klasse_schueler ks JOIN klasse k ON k.id = ks.klasse_id JOIN schuljahr j ON j.id = k.schuljahr_id AND j.aktiv WHERE ks.person_id = p.id LIMIT 1) AS klasse
      FROM person p JOIN rolle r ON r.person_id = p.id AND r.art = $1 WHERE p.status = 'aktiv' AND ($2 = '' OR (p.vorname || ' ' || p.nachname) ILIKE '%' || $2 || '%')
      ORDER BY p.nachname, p.vorname LIMIT 30`, [rolle, such]);
  }));
}
