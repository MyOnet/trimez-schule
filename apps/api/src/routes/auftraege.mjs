// Aufträge: verteilen, abgeben, Rückmeldung (mit Bewertungsraster), Überarbeitung, Erinnerung, Übertrag ins Notenbuch
import { geschuetzt } from "../sitzung.mjs";
import { fehler } from "../fehler.mjs";
import { protokolliere } from "../protokoll.mjs";
import { pruefe, darf, punkteZuNote } from "@schule/shared";
import { id, optId, text, pflicht, zahl, optZeitpunkt, unterrichtLaden, schuelerVon, lehrpersonenVon, mitteilen, dateiLesen, dateiSpeichern, dateienVon, dateiLaden, dateiSenden, dateiEntfernen, heute } from "../hilfen.mjs";

const STATUS_SICHTBAR = ["veroeffentlicht", "geschlossen"];

/** Raster prüfen: [{ id, kriterium, beschreibung, punkte }] */
function rasterLesen(r) {
  if (!Array.isArray(r)) return [];
  return r.slice(0, 20).map((k, i) => ({
    id: /^[a-z0-9]{1,12}$/.test(String(k.id || "")) ? String(k.id) : `k${i + 1}`,
    kriterium: pflicht(k.kriterium, 120, `Kriterium ${i + 1}: Bitte einen Namen eingeben.`, `raster.${i}.kriterium`),
    beschreibung: text(k.beschreibung, 600),
    punkte: zahl(k.punkte, 0.5, 1000, `raster.${i}.punkte`) ?? fehler(400, `Kriterium ${i + 1}: Bitte die Punkte angeben.`, `raster.${i}.punkte`),
  }));
}
const abgabeArt = (a) => {
  const x = { text: a && a.text !== false, datei: a && a.datei !== false, notizbuch: !!(a && a.notizbuch) };
  if (!x.text && !x.datei && !x.notizbuch) x.text = true;
  return x;
};

async function auftragLaden(q, ctx, aid) {
  const [a] = await q("SELECT * FROM auftrag WHERE id = $1", [id(aid)]);
  if (!a) fehler(404, "Auftrag nicht gefunden.");
  const lp = darf(ctx, "auftrag.verwalten", { unterrichtId: a.unterricht_id });
  const sch = !lp && darf(ctx, "auftrag.abgeben", { unterrichtId: a.unterricht_id });
  if (!lp && !(sch && STATUS_SICHTBAR.includes(a.status))) fehler(404, "Auftrag nicht gefunden.");
  return { a, lp, sch };
}
const verwalten = async (q, ctx, aid) => { const r = await auftragLaden(q, ctx, aid); if (!r.lp) fehler(403, "Dafür fehlt Ihnen die Berechtigung."); return r.a; };

/** Stand einer Abgabe für die Anzeige: offen, überfällig, abgegeben (spät), zur Überarbeitung, zurückgegeben */
export function abgabeStand(a, ab) {
  const ueberfaellig = a.faellig_am && new Date(a.faellig_am) < new Date();
  if (!ab || ab.status === "entwurf") return ueberfaellig ? "fehlt" : "offen";
  if (ab.status === "abgegeben") return ab.spaet ? "spaet" : "abgegeben";
  return ab.status; // ueberarbeiten, zurueckgegeben
}

async function abgabeVon(q, aid, sid) {
  const [ab] = await q("SELECT * FROM auftrag_abgabe WHERE auftrag_id = $1 AND schueler_id = $2", [aid, sid]);
  return ab || null;
}
async function abgabeSicher(q, aid, sid) {
  await q("INSERT INTO auftrag_abgabe (auftrag_id, schueler_id) VALUES ($1,$2) ON CONFLICT (auftrag_id, schueler_id) DO NOTHING", [aid, sid]);
  return abgabeVon(q, aid, sid);
}
async function seiteFuer(q, sid) {
  if (!sid) return null;
  const [s] = await q("SELECT s.id, s.titel, left(s.text, 6000) AS text, s.geaendert_am, a.unterricht_id FROM notiz_seite s JOIN notiz_abschnitt a ON a.id = s.abschnitt_id WHERE s.id = $1 AND s.geloescht_am IS NULL", [sid]);
  return s || null;
}

export default async function (app) {
  /* ---------- Liste pro Unterricht (Lehrperson: mit Zahlen; Schüler/in: eigener Stand) ---------- */
  app.get("/api/unterricht/:uid/auftraege", geschuetzt(async (req, res, q) => {
    const u = await unterrichtLaden(q, req.params.uid);
    const lp = darf(req.ctx, "auftrag.verwalten", { unterrichtId: u.id });
    if (!lp && !darf(req.ctx, "auftrag.abgeben", { unterrichtId: u.id })) fehler(403, "Dafür fehlt Ihnen die Berechtigung.");
    if (lp) {
      const n = (await schuelerVon(q, u)).length;
      const liste = await q(`SELECT a.id, a.titel, a.status, a.faellig_am, a.punkte_max, a.bewertung_id, a.veroeffentlicht_am, a.erstellt_am,
          count(ab.id) FILTER (WHERE ab.status IN ('abgegeben','ueberarbeiten','zurueckgegeben'))::int AS abgegeben,
          count(ab.id) FILTER (WHERE ab.status = 'abgegeben')::int AS zu_bewerten,
          count(ab.id) FILTER (WHERE ab.status = 'zurueckgegeben')::int AS zurueckgegeben
        FROM auftrag a LEFT JOIN auftrag_abgabe ab ON ab.auftrag_id = a.id WHERE a.unterricht_id = $1
        GROUP BY a.id ORDER BY (a.status = 'entwurf') DESC, a.faellig_am DESC NULLS FIRST, a.erstellt_am DESC`, [u.id]);
      return { unterricht: u, lehrperson: true, schueler: n, auftraege: liste };
    }
    const liste = await q(`SELECT a.id, a.titel, a.status, a.faellig_am, a.punkte_max, ab.status AS abgabe_status, ab.spaet, ab.abgegeben_am, ab.punkte, ab.note, ab.zurueckgegeben_am
      FROM auftrag a LEFT JOIN auftrag_abgabe ab ON ab.auftrag_id = a.id AND ab.schueler_id = $2
      WHERE a.unterricht_id = $1 AND a.status IN ('veroeffentlicht','geschlossen') ORDER BY a.faellig_am NULLS LAST`, [u.id, req.ctx.personId]);
    return { unterricht: u, lehrperson: false, auftraege: liste.map((a) => ({ ...a, stand: abgabeStand(a, a.abgabe_status ? { status: a.abgabe_status, spaet: a.spaet } : null) })) };
  }));

  /* ---------- Alle meine Aufträge (Schüler/innen: Startseite und «Aufträge») ---------- */
  app.get("/api/meine-auftraege", geschuetzt(async (req, res, q) => {
    pruefe(req.ctx, "noten.eigene");
    const liste = req.ctx.unterricht.size ? await q(`SELECT a.id, a.titel, a.status, a.faellig_am, a.punkte_max, a.unterricht_id, f.name AS fach, f.farbe,
        ab.status AS abgabe_status, ab.spaet, ab.abgegeben_am, ab.punkte, ab.note, ab.zurueckgegeben_am
      FROM auftrag a JOIN unterricht u ON u.id = a.unterricht_id JOIN fach f ON f.id = u.fach_id
      LEFT JOIN auftrag_abgabe ab ON ab.auftrag_id = a.id AND ab.schueler_id = $2
      WHERE a.unterricht_id = ANY($1) AND a.status IN ('veroeffentlicht','geschlossen')
      ORDER BY a.faellig_am NULLS LAST LIMIT 300`, [[...req.ctx.unterricht], req.ctx.personId]) : [];
    return liste.map((a) => ({ ...a, stand: abgabeStand(a, a.abgabe_status ? { status: a.abgabe_status, spaet: a.spaet } : null) }));
  }));

  /* ---------- Erstellen und bearbeiten ---------- */
  const daten = (b, alt = {}) => {
    const raster = b.raster !== undefined ? rasterLesen(b.raster) : alt.raster || [];
    const summe = raster.reduce((s, k) => s + Number(k.punkte), 0);
    return {
      titel: b.titel !== undefined ? pflicht(b.titel, 160, "Bitte einen Titel eingeben.", "titel") : alt.titel,
      anleitung: b.anleitung !== undefined ? text(b.anleitung, 20000) : alt.anleitung || "",
      faellig_am: b.faellig_am !== undefined ? optZeitpunkt(b.faellig_am, "faellig_am") : alt.faellig_am || null,
      raster,
      // Mit Raster ergibt sich das Maximum aus den Kriterien
      punkte_max: raster.length ? Math.round(summe * 100) / 100 : (b.punkte_max !== undefined ? zahl(b.punkte_max, 0.5, 10000, "punkte_max") : alt.punkte_max ?? null),
      abgabe: b.abgabe !== undefined ? abgabeArt(b.abgabe) : alt.abgabe || abgabeArt(null),
      spaet_erlaubt: b.spaet_erlaubt !== undefined ? b.spaet_erlaubt !== false : alt.spaet_erlaubt ?? true,
      notenschluessel_id: b.notenschluessel_id !== undefined ? optId(b.notenschluessel_id) : alt.notenschluessel_id || null,
    };
  };
  app.post("/api/unterricht/:uid/auftraege", geschuetzt(async (req, res, q) => {
    const u = await unterrichtLaden(q, req.params.uid);
    pruefe(req.ctx, "auftrag.verwalten", { unterrichtId: u.id });
    const d = daten(req.body || {});
    const [a] = await q(`INSERT INTO auftrag (unterricht_id, erstellt_von, titel, anleitung, faellig_am, punkte_max, raster, abgabe, spaet_erlaubt, notenschluessel_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [u.id, req.ctx.personId, d.titel, d.anleitung, d.faellig_am, d.punkte_max, JSON.stringify(d.raster), d.abgabe, d.spaet_erlaubt, d.notenschluessel_id]);
    await protokolliere(q, req, "auftrag.erstellt", "auftrag", a.id, null, { titel: a.titel });
    return a;
  }));
  app.put("/api/auftraege/:id", geschuetzt(async (req, res, q) => {
    const a0 = await verwalten(q, req.ctx, req.params.id);
    const d = daten(req.body || {}, a0);
    if (a0.bewertung_id && Number(d.punkte_max || 0) !== Number(a0.punkte_max || 0)) fehler(409, "Die Noten sind schon im Notenbuch. Ändern Sie das Punktemaximum dort.", "punkte_max");
    const [a] = await q(`UPDATE auftrag SET titel=$1, anleitung=$2, faellig_am=$3, punkte_max=$4, raster=$5, abgabe=$6, spaet_erlaubt=$7, notenschluessel_id=$8 WHERE id=$9 RETURNING *`,
      [d.titel, d.anleitung, d.faellig_am, d.punkte_max, JSON.stringify(d.raster), d.abgabe, d.spaet_erlaubt, d.notenschluessel_id, a0.id]);
    return a;
  }));
  app.delete("/api/auftraege/:id", geschuetzt(async (req, res, q) => {
    const a = await verwalten(q, req.ctx, req.params.id);
    const [{ n }] = await q("SELECT count(*)::int AS n FROM auftrag_abgabe WHERE auftrag_id = $1 AND status <> 'entwurf'", [a.id]);
    if (n && req.body?.bestaetigt !== true) fehler(409, `${n === 1 ? "Eine Abgabe ist" : `${n} Abgaben sind`} schon eingegangen. Wirklich löschen?`, "bestaetigt");
    const dateien = await q("SELECT d.* FROM datei d WHERE (d.bezug_typ = 'auftrag' AND d.bezug_id = $1) OR (d.bezug_typ = 'abgabe' AND d.bezug_id IN (SELECT id FROM auftrag_abgabe WHERE auftrag_id = $1))", [a.id]);
    for (const f of dateien) await dateiEntfernen(q, f);
    await q("DELETE FROM auftrag WHERE id = $1", [a.id]);
    await protokolliere(q, req, "auftrag.geloescht", "auftrag", a.id, { titel: a.titel, abgaben: n });
    return { ok: true };
  }));
  // Veröffentlichen: ab jetzt für die Klasse sichtbar, alle erhalten eine Mitteilung
  app.post("/api/auftraege/:id/veroeffentlichen", geschuetzt(async (req, res, q) => {
    const a = await verwalten(q, req.ctx, req.params.id);
    if (a.status !== "entwurf") fehler(409, "Der Auftrag ist schon veröffentlicht.");
    if (a.faellig_am && new Date(a.faellig_am) < new Date()) fehler(400, "Der Abgabetermin liegt in der Vergangenheit.", "faellig_am");
    await q("UPDATE auftrag SET status = 'veroeffentlicht', veroeffentlicht_am = now() WHERE id = $1", [a.id]);
    const u = await unterrichtLaden(q, a.unterricht_id);
    const sch = await schuelerVon(q, u);
    const bis = a.faellig_am ? `Abgabe bis ${new Date(a.faellig_am).toLocaleString("de-CH", { timeZone: "Europe/Zurich", dateStyle: "short", timeStyle: "short" })}` : "Ohne Abgabetermin";
    await mitteilen(q, sch.map((s) => s.id), { art: "auftrag", titel: `Neuer Auftrag in ${u.fach}: ${a.titel}`, text: bis, link: `/auftraege/${a.id}`, schluessel: `auftrag:${a.id}` });
    await protokolliere(q, req, "auftrag.veroeffentlicht", "auftrag", a.id);
    return { ok: true, empfaenger: sch.length };
  }));
  app.post("/api/auftraege/:id/schliessen", geschuetzt(async (req, res, q) => {
    const a = await verwalten(q, req.ctx, req.params.id);
    if (a.status === "entwurf") fehler(409, "Der Auftrag ist noch nicht veröffentlicht.");
    const auf = req.body && req.body.oeffnen === true;
    await q("UPDATE auftrag SET status = $1 WHERE id = $2", [auf ? "veroeffentlicht" : "geschlossen", a.id]);
    return { ok: true };
  }));

  /* ---------- Ansicht eines Auftrags ---------- */
  app.get("/api/auftraege/:id", geschuetzt(async (req, res, q) => {
    const { a, lp } = await auftragLaden(q, req.ctx, req.params.id);
    const u = await unterrichtLaden(q, a.unterricht_id);
    const anhaenge = await dateienVon(q, "auftrag", [a.id]);
    if (lp) {
      const sch = await schuelerVon(q, u);
      const abgaben = await q("SELECT * FROM auftrag_abgabe WHERE auftrag_id = $1", [a.id]);
      const dateien = await dateienVon(q, "abgabe", abgaben.map((x) => x.id));
      const seiten = new Map();
      for (const ab of abgaben) if (ab.notiz_seite_id) seiten.set(ab.id, await seiteFuer(q, ab.notiz_seite_id));
      const [schl] = a.notenschluessel_id ? await q("SELECT art, parameter, rundung FROM notenschluessel WHERE id = $1", [a.notenschluessel_id]) : [null];
      const liste = sch.map((s) => {
        const ab = abgaben.find((x) => x.schueler_id === s.id) || null;
        const vorschlag = ab && ab.punkte != null && a.punkte_max ? punkteZuNote(ab.punkte, a.punkte_max, schl || undefined) : null;
        return { schueler: s, stand: abgabeStand(a, ab), abgabe: ab ? { ...ab, dateien: dateien.filter((d) => d.bezug_id === ab.id), seite: seiten.get(ab.id) || null } : null, notenvorschlag: vorschlag };
      });
      const schluessel = await q("SELECT id, name FROM notenschluessel WHERE besitzer_id IS NULL OR besitzer_id = $1 OR geteilt = 'schule' ORDER BY name", [req.ctx.personId]);
      const arten = await q("SELECT id, name, kategorie, gewicht_standard FROM bewertungsart ORDER BY reihenfolge, name");
      return { auftrag: a, unterricht: u, lehrperson: true, anhaenge, liste, schluessel, arten };
    }
    // Schüler/in: eigene Abgabe; Punkte und Rückmeldung erst nach dem Zurückgeben
    const ab = await abgabeVon(q, a.id, req.ctx.personId);
    const dateien = ab ? await dateienVon(q, "abgabe", [ab.id]) : [];
    const zurueck = ab && ["zurueckgegeben", "ueberarbeiten"].includes(ab.status);
    const eigene = ab ? {
      status: ab.status, text: ab.text, version: ab.version, abgegeben_am: ab.abgegeben_am, spaet: ab.spaet, dateien,
      seite: ab.notiz_seite_id ? await seiteFuer(q, ab.notiz_seite_id) : null,
      rueckmeldung: zurueck ? ab.rueckmeldung : "", raster_punkte: zurueck ? ab.raster_punkte : {},
      punkte: ab.status === "zurueckgegeben" ? ab.punkte : null, note: ab.status === "zurueckgegeben" ? ab.note : null, zurueckgegeben_am: ab.zurueckgegeben_am,
    } : null;
    // Eigene Seiten im Notizbuch dieses Unterrichts (zum Abgeben)
    const seiten = a.abgabe.notizbuch ? await q(`SELECT s.id, s.titel, a.name AS abschnitt FROM notiz_seite s JOIN notiz_abschnitt a ON a.id = s.abschnitt_id
      WHERE a.unterricht_id = $1 AND a.bereich = 'schueler' AND a.besitzer_id = $2 AND s.geloescht_am IS NULL AND a.geloescht_am IS NULL ORDER BY a.reihenfolge, s.reihenfolge`, [a.unterricht_id, req.ctx.personId]) : [];
    const lps = await lehrpersonenVon(q, a.unterricht_id);
    return { auftrag: { ...a, erstellt_von: undefined }, unterricht: u, lehrperson: false, anhaenge, abgabe: eigene, stand: abgabeStand(a, ab), meineSeiten: seiten, lehrpersonen: lps };
  }));

  /* ---------- Dateien (Anhänge der Lehrperson, Dateien der Abgabe) ---------- */
  app.post("/api/auftraege/:id/dateien", geschuetzt(async (req, res, q) => {
    const a = await verwalten(q, req.ctx, req.params.id);
    const { datei } = await dateiLesen(req);
    return dateiSpeichern(q, req, { bezugTyp: "auftrag", bezugId: a.id }, datei);
  }));
  app.get("/api/auftrag-dateien/:did", geschuetzt(async (req, res, q) => {
    const f = await dateiLaden(q, req.params.did);
    if (f.bezug_typ === "auftrag") await auftragLaden(q, req.ctx, f.bezug_id);
    else if (f.bezug_typ === "abgabe") {
      const [ab] = await q("SELECT auftrag_id, schueler_id FROM auftrag_abgabe WHERE id = $1", [f.bezug_id]);
      if (!ab) fehler(404, "Datei nicht gefunden.");
      const { lp } = await auftragLaden(q, req.ctx, ab.auftrag_id);
      if (!lp && ab.schueler_id !== req.ctx.personId) fehler(404, "Datei nicht gefunden.");
    } else fehler(404, "Datei nicht gefunden.");
    return dateiSenden(res, f, req.query.ansicht === "1");
  }));
  app.delete("/api/auftrag-dateien/:did", geschuetzt(async (req, res, q) => {
    const f = await dateiLaden(q, req.params.did);
    if (f.bezug_typ === "auftrag") await verwalten(q, req.ctx, f.bezug_id);
    else if (f.bezug_typ === "abgabe") {
      const [ab] = await q("SELECT * FROM auftrag_abgabe WHERE id = $1", [f.bezug_id]);
      if (!ab || ab.schueler_id !== req.ctx.personId) fehler(404, "Datei nicht gefunden.");
      if (["abgegeben", "zurueckgegeben"].includes(ab.status)) fehler(409, "Die Arbeit ist abgegeben. Ziehen Sie die Abgabe zuerst zurück.");
    } else fehler(404, "Datei nicht gefunden.");
    await dateiEntfernen(q, f);
    return { ok: true };
  }));

  /* ---------- Abgeben (Schüler/innen) ---------- */
  const eigeneAbgabe = async (q, ctx, aid, { aendern = true } = {}) => {
    const { a, sch } = await auftragLaden(q, ctx, aid);
    if (!sch) fehler(403, "Nur Schülerinnen und Schüler dieses Unterrichts geben ab.");
    const ab = await abgabeSicher(q, a.id, ctx.personId);
    if (aendern && ["abgegeben", "zurueckgegeben"].includes(ab.status)) fehler(409, ab.status === "abgegeben" ? "Die Arbeit ist abgegeben. Ziehen Sie die Abgabe zurück, um etwas zu ändern." : "Die Arbeit ist schon bewertet.");
    if (aendern && a.status === "geschlossen") fehler(409, "Die Lehrperson hat die Abgabe geschlossen.");
    return { a, ab };
  };
  app.put("/api/auftraege/:id/meine-abgabe", geschuetzt(async (req, res, q) => {
    const { a, ab } = await eigeneAbgabe(q, req.ctx, req.params.id);
    let seite = null;
    if (req.body.notiz_seite_id) {
      if (!a.abgabe.notizbuch) fehler(400, "Bei diesem Auftrag wird keine Notizbuchseite abgegeben.");
      const s = await seiteFuer(q, id(req.body.notiz_seite_id));
      const [mein] = s ? await q("SELECT 1 FROM notiz_seite s JOIN notiz_abschnitt x ON x.id = s.abschnitt_id WHERE s.id = $1 AND x.bereich = 'schueler' AND x.besitzer_id = $2 AND x.unterricht_id = $3", [s.id, req.ctx.personId, a.unterricht_id]) : [];
      if (!mein) fehler(400, "Wählen Sie eine Seite aus Ihrem eigenen Bereich im Notizbuch dieses Fachs.", "notiz_seite_id");
      seite = s.id;
    }
    await q("UPDATE auftrag_abgabe SET text = $1, notiz_seite_id = $2, geaendert_am = now() WHERE id = $3",
      [req.body.text !== undefined ? text(req.body.text, 50000) : ab.text, req.body.notiz_seite_id !== undefined ? seite : ab.notiz_seite_id, ab.id]);
    return { ok: true };
  }));
  app.post("/api/auftraege/:id/meine-abgabe/dateien", geschuetzt(async (req, res, q) => {
    const { a, ab } = await eigeneAbgabe(q, req.ctx, req.params.id);
    if (!a.abgabe.datei) fehler(400, "Bei diesem Auftrag werden keine Dateien abgegeben.");
    const [{ n }] = await q("SELECT count(*)::int AS n FROM datei WHERE bezug_typ = 'abgabe' AND bezug_id = $1 AND geloescht_am IS NULL", [ab.id]);
    if (n >= 10) fehler(400, "Höchstens 10 Dateien pro Abgabe.");
    const { datei } = await dateiLesen(req);
    return dateiSpeichern(q, req, { bezugTyp: "abgabe", bezugId: ab.id }, datei);
  }));
  app.post("/api/auftraege/:id/abgeben", geschuetzt(async (req, res, q) => {
    const { a, ab } = await eigeneAbgabe(q, req.ctx, req.params.id);
    const [{ n }] = await q("SELECT count(*)::int AS n FROM datei WHERE bezug_typ = 'abgabe' AND bezug_id = $1 AND geloescht_am IS NULL", [ab.id]);
    if (!ab.text.trim() && !n && !ab.notiz_seite_id) fehler(400, "Die Abgabe ist leer. Schreiben Sie einen Text, laden Sie eine Datei hoch oder wählen Sie eine Notizbuchseite.");
    const spaet = !!(a.faellig_am && new Date(a.faellig_am) < new Date());
    if (spaet && !a.spaet_erlaubt) fehler(409, "Der Abgabetermin ist vorbei. Späte Abgaben sind bei diesem Auftrag nicht möglich.");
    await q("UPDATE auftrag_abgabe SET status = 'abgegeben', abgegeben_am = now(), spaet = $1, version = version + 1, geaendert_am = now() WHERE id = $2", [spaet, ab.id]);
    await protokolliere(q, req, "auftrag.abgegeben", "auftrag_abgabe", ab.id, null, { spaet, version: ab.version + 1 });
    return { ok: true, spaet };
  }));
  app.post("/api/auftraege/:id/zurueckziehen", geschuetzt(async (req, res, q) => {
    const { a, ab } = await eigeneAbgabe(q, req.ctx, req.params.id, { aendern: false });
    if (ab.status !== "abgegeben") fehler(409, ab.status === "zurueckgegeben" ? "Die Arbeit ist schon bewertet." : "Die Arbeit ist nicht abgegeben.");
    if (a.status === "geschlossen") fehler(409, "Die Lehrperson hat die Abgabe geschlossen.");
    // Nach einer Überarbeitungsrunde geht es zurück in «überarbeiten», sonst in den Entwurf
    await q("UPDATE auftrag_abgabe SET status = CASE WHEN zurueckgegeben_am IS NOT NULL THEN 'ueberarbeiten' ELSE 'entwurf' END, geaendert_am = now() WHERE id = $1", [ab.id]);
    return { ok: true };
  }));

  /* ---------- Rückmeldung und Bewertung (Lehrperson) ---------- */
  const abgabeDerKlasse = async (q, ctx, aid, sid) => {
    const a = await verwalten(q, ctx, aid);
    const u = await unterrichtLaden(q, a.unterricht_id);
    const s = id(sid);
    if (!(await schuelerVon(q, u)).some((x) => x.id === s)) fehler(400, "Diese Person gehört nicht zu diesem Unterricht.");
    return { a, u, ab: await abgabeSicher(q, a.id, s), sid: s };
  };
  app.put("/api/auftraege/:id/abgaben/:sid", geschuetzt(async (req, res, q) => {
    const { a, ab } = await abgabeDerKlasse(q, req.ctx, req.params.id, req.params.sid);
    const b = req.body || {};
    let raster = ab.raster_punkte, punkte = ab.punkte;
    if (b.raster_punkte !== undefined) {
      raster = {};
      for (const k of a.raster) {
        const v = zahl(b.raster_punkte[k.id], 0, Number(k.punkte), `raster.${k.id}`);
        if (v != null) raster[k.id] = v;
      }
      punkte = Object.keys(raster).length ? Math.round(Object.values(raster).reduce((s, x) => s + x, 0) * 100) / 100 : null;
    } else if (b.punkte !== undefined) punkte = a.punkte_max ? zahl(b.punkte, 0, Number(a.punkte_max), "punkte") : null;
    let note = b.note !== undefined ? zahl(b.note, 1, 6, "note") : ab.note;
    if (b.note === undefined && punkte != null && a.punkte_max) {
      const [schl] = a.notenschluessel_id ? await q("SELECT art, parameter, rundung FROM notenschluessel WHERE id = $1", [a.notenschluessel_id]) : [null];
      note = punkteZuNote(punkte, a.punkte_max, schl || undefined);
    }
    await q("UPDATE auftrag_abgabe SET rueckmeldung = $1, raster_punkte = $2, punkte = $3, note = $4, bewertet_von = $5, geaendert_am = now() WHERE id = $6",
      [b.rueckmeldung !== undefined ? text(b.rueckmeldung, 10000) : ab.rueckmeldung, raster, punkte, note, req.ctx.personId, ab.id]);
    return { ok: true, punkte, note };
  }));
  // art: «bewertet» (fertig, Rückmeldung und Punkte sichtbar) oder «ueberarbeiten» (zurück zur Überarbeitung)
  app.post("/api/auftraege/:id/abgaben/:sid/zurueckgeben", geschuetzt(async (req, res, q) => {
    const { a, u, ab, sid } = await abgabeDerKlasse(q, req.ctx, req.params.id, req.params.sid);
    const ueberarbeiten = req.body && req.body.art === "ueberarbeiten";
    if (ueberarbeiten && !ab.rueckmeldung.trim()) fehler(400, "Schreiben Sie eine Rückmeldung, was überarbeitet werden soll.", "rueckmeldung");
    await q("UPDATE auftrag_abgabe SET status = $1, zurueckgegeben_am = now(), geaendert_am = now() WHERE id = $2", [ueberarbeiten ? "ueberarbeiten" : "zurueckgegeben", ab.id]);
    await mitteilen(q, [sid], { art: "auftrag", titel: ueberarbeiten ? `Bitte überarbeiten: ${a.titel}` : `Rückmeldung zu ${a.titel}`, text: `${u.fach}`, link: `/auftraege/${a.id}` });
    await protokolliere(q, req, ueberarbeiten ? "auftrag.zur_ueberarbeitung" : "auftrag.zurueckgegeben", "auftrag_abgabe", ab.id, null, { punkte: ab.punkte, note: ab.note });
    return { ok: true };
  }));
  // Alle bewerteten, abgegebenen Arbeiten auf einmal zurückgeben
  app.post("/api/auftraege/:id/alle-zurueckgeben", geschuetzt(async (req, res, q) => {
    const a = await verwalten(q, req.ctx, req.params.id);
    const u = await unterrichtLaden(q, a.unterricht_id);
    const rows = await q(`UPDATE auftrag_abgabe SET status = 'zurueckgegeben', zurueckgegeben_am = now(), geaendert_am = now()
      WHERE auftrag_id = $1 AND status = 'abgegeben' AND (punkte IS NOT NULL OR note IS NOT NULL OR rueckmeldung <> '') RETURNING schueler_id`, [a.id]);
    await mitteilen(q, rows.map((r) => r.schueler_id), { art: "auftrag", titel: `Rückmeldung zu ${a.titel}`, text: u.fach, link: `/auftraege/${a.id}` });
    return { ok: true, anzahl: rows.length };
  }));

  /* ---------- Erinnerung an alle, die noch nicht abgegeben haben ---------- */
  app.post("/api/auftraege/:id/erinnern", geschuetzt(async (req, res, q) => {
    const a = await verwalten(q, req.ctx, req.params.id);
    if (a.status !== "veroeffentlicht") fehler(409, "Erinnern geht nur bei veröffentlichten, offenen Aufträgen.");
    const u = await unterrichtLaden(q, a.unterricht_id);
    const ab = await q("SELECT schueler_id, status FROM auftrag_abgabe WHERE auftrag_id = $1", [a.id]);
    const fertig = new Set(ab.filter((x) => ["abgegeben", "zurueckgegeben"].includes(x.status)).map((x) => x.schueler_id));
    const nur = Array.isArray(req.body?.schueler) ? new Set(req.body.schueler.map(id)) : null;
    const ziel = (await schuelerVon(q, u)).filter((s) => !fertig.has(s.id) && (!nur || nur.has(s.id)));
    const wann = a.faellig_am ? `fällig ${new Date(a.faellig_am).toLocaleString("de-CH", { timeZone: "Europe/Zurich", dateStyle: "short", timeStyle: "short" })}` : "noch nicht abgegeben";
    const n = await mitteilen(q, ziel.map((s) => s.id), { art: "erinnerung", titel: `Erinnerung: ${a.titel}`, text: `${u.fach}, ${wann}`, link: `/auftraege/${a.id}`, schluessel: `erinnerung:${a.id}:${heute()}` });
    if (ziel.length) await q("UPDATE auftrag_abgabe SET erinnert_am = now() WHERE auftrag_id = $1 AND schueler_id = ANY($2)", [a.id, ziel.map((s) => s.id)]);
    return { ok: true, erinnert: n, schonHeute: ziel.length - n };
  }));

  /* ---------- Ins Notenbuch übertragen (als Entwurf, die Freigabe macht die Lehrperson im Notenbuch) ---------- */
  app.post("/api/auftraege/:id/ins-notenbuch", geschuetzt(async (req, res, q) => {
    const a = await verwalten(q, req.ctx, req.params.id);
    pruefe(req.ctx, "noten.schreiben", { unterrichtId: a.unterricht_id });
    const u = await unterrichtLaden(q, a.unterricht_id);
    const abgaben = (await q("SELECT schueler_id, punkte, note FROM auftrag_abgabe WHERE auftrag_id = $1 AND (note IS NOT NULL OR punkte IS NOT NULL)", [a.id]));
    if (!abgaben.length) fehler(400, "Es gibt noch keine bewerteten Abgaben.");
    let bid = a.bewertung_id;
    let [b] = bid ? await q("SELECT * FROM bewertung WHERE id = $1", [bid]) : [];
    if (b && b.status === "freigegeben") fehler(409, "Die Noten sind im Notenbuch schon freigegeben. Änderungen bitte dort eintragen (mit Grund).");
    if (!b) {
      const sem = await q("SELECT id FROM semester WHERE schuljahr_id = $1 ORDER BY (von <= current_date AND bis >= current_date) DESC, nr LIMIT 1", [u.schuljahr_id]);
      if (!sem.length) fehler(400, "Für dieses Schuljahr sind keine Semester erfasst.");
      const artId = optId(req.body?.bewertungsart_id);
      [b] = await q(`INSERT INTO bewertung (unterricht_id, semester_id, bewertungsart_id, kategorie, titel, datum, gewicht, max_punkte, notenschluessel_id, erstellt_von)
        VALUES ($1,$2,$3,'schriftlich',$4,$5,$6,$7,$8,$9) RETURNING *`,
        [u.id, sem[0].id, artId, a.titel.slice(0, 80), (a.faellig_am ? new Date(a.faellig_am) : new Date()).toLocaleDateString("sv-SE", { timeZone: "Europe/Zurich" }),
          zahl(req.body?.gewicht ?? 1, 0.01, 100, "gewicht"), a.punkte_max, a.notenschluessel_id, req.ctx.personId]);
      await q("UPDATE auftrag SET bewertung_id = $1 WHERE id = $2", [b.id, a.id]);
    }
    for (const x of abgaben)
      await q(`INSERT INTO leistung (bewertung_id, schueler_id, punkte, note, geaendert_von) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (bewertung_id, schueler_id) DO UPDATE SET punkte = EXCLUDED.punkte, note = EXCLUDED.note, geaendert_von = EXCLUDED.geaendert_von, geaendert_am = now()`,
        [b.id, x.schueler_id, b.max_punkte ? x.punkte : null, x.note, req.ctx.personId]);
    await protokolliere(q, req, "auftrag.ins_notenbuch", "bewertung", b.id, null, { auftrag: a.id, anzahl: abgaben.length });
    return { ok: true, bewertung_id: b.id, anzahl: abgaben.length };
  }));
}
