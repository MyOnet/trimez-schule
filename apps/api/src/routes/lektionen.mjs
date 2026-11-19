// Unterrichtsmodus: Lektionen mit freigegebenen Seiten, «An alle senden» und «Bildschirme anhalten».
//   Lehrperson: Lektion starten, Seiten und Werkzeuge ändern, anhalten, etwas an alle schicken, beenden, sehen wer dabei ist.
//   Schüler/in: Lektion öffnen (Puls alle paar Sekunden), Anstoss sehen, freigegebene Seiten öffnen.
// In der Lernumgebung setzt die App die freigegebenen Seiten durch (Konfiguration wie bei Prüfungen).
// Im normalen Browser lässt sich nichts durchsetzen: Die Lehrperson sieht nur, wer im Browser ist und ob die Seite im Vordergrund ist.
import { geschuetzt } from "../sitzung.mjs";
import { fehler } from "../fehler.mjs";
import { protokolliere } from "../protokoll.mjs";
import { darf } from "@schule/shared";
import { konfigWert } from "../lernumgebung.mjs";
import { schuelerVon } from "./durchfuehrung.mjs";
import { seitenLesen } from "./pruefungen.mjs";

const id = (x) => (/^[0-9a-f-]{36}$/.test(String(x || "")) ? x : fehler(400, "Ungültige Kennung."));
// Vergessene Lektionen enden von selbst nach 6 Stunden
const LAUFEND = "l.beendet_am IS NULL AND l.gestartet_am > now() - interval '6 hours'";
const ONLINE_S = 20; // so lange gilt jemand nach dem letzten Puls als dabei
const APP_WARNUNGEN = ["prozess", "vm", "debugger", "aufnahme", "bildschirm", "sperre", "fremder_code"];

const luKonfig = (l) => ({ pruefung: l.id, seiten: (l.seiten || []).map((x) => x.url).sort(), rechner: !!l.rechner });
const laeuft = (l) => !l.beendet_am && new Date(l.gestartet_am).getTime() > Date.now() - 6 * 3600_000;

async function unterrichtLaden(q, uid) {
  const [u] = await q(`SELECT u.id, u.gruppe, u.notizbuch, k.id AS klasse_id, k.name AS klasse, f.name AS fach, f.farbe FROM unterricht u
    JOIN klasse k ON k.id = u.klasse_id JOIN fach f ON f.id = u.fach_id WHERE u.id = $1`, [uid]);
  if (!u) fehler(404, "Unterricht nicht gefunden.");
  return u;
}
async function lektionLaden(q, lid) {
  const [l] = await q(`SELECT l.*, k.name AS klasse, f.name AS fach, f.farbe, u.gruppe, p.vorname AS lp_vorname, p.nachname AS lp_nachname
    FROM lektion l JOIN unterricht u ON u.id = l.unterricht_id JOIN klasse k ON k.id = u.klasse_id JOIN fach f ON f.id = u.fach_id
    LEFT JOIN person p ON p.id = l.gestartet_von WHERE l.id = $1`, [id(lid)]);
  if (!l) fehler(404, "Lektion nicht gefunden.");
  return l;
}
async function lektionFuerLp(q, ctx, lid) {
  const l = await lektionLaden(q, lid);
  if (!darf(ctx, "lektion.leiten", { unterrichtId: l.unterricht_id })) fehler(404, "Lektion nicht gefunden.");
  return l;
}
const offen = (l) => { if (!laeuft(l)) fehler(409, "Diese Lektion ist beendet."); return l; };

const fuerLp = (l) => ({ id: l.id, unterricht_id: l.unterricht_id, fach: l.fach, farbe: l.farbe, klasse: l.klasse, gruppe: l.gruppe,
  gestartet_am: l.gestartet_am, beendet_am: l.beendet_am, laeuft: laeuft(l), lernumgebung: l.lernumgebung, rechner: l.rechner,
  seiten: l.seiten, angehalten: l.angehalten, anstoss: l.anstoss, notizbuch: l.notizbuch });

function einstellungenLesen(b, l = {}) {
  const e = {};
  e.seiten = b.seiten !== undefined ? seitenLesen(b.seiten) : l.seiten || [];
  e.rechner = b.rechner !== undefined ? !!b.rechner : !!l.rechner;
  e.lernumgebung = b.lernumgebung !== undefined ? !!b.lernumgebung : !!l.lernumgebung;
  e.notizbuch = b.notizbuch !== undefined ? !!b.notizbuch : l.notizbuch !== undefined ? !!l.notizbuch : true;
  return e;
}

export default async function (app) {
  /* ========== Lehrperson ========== */
  // Laufende Lektion des Unterrichts (oder null) und Vorlage aus der letzten Lektion
  app.get("/api/unterricht/:uid/lektion", geschuetzt(async (req, res, q) => {
    const uid = id(req.params.uid);
    if (!darf(req.ctx, "lektion.leiten", { unterrichtId: uid })) fehler(404, "Unterricht nicht gefunden.");
    const u = await unterrichtLaden(q, uid);
    const [l] = await q(`SELECT l.id FROM lektion l WHERE l.unterricht_id = $1 AND ${LAUFEND}`, [uid]);
    const [letzte] = await q("SELECT seiten, rechner, lernumgebung, notizbuch, gestartet_am FROM lektion WHERE unterricht_id = $1 ORDER BY gestartet_am DESC LIMIT 1", [uid]);
    return { unterricht: u, lektion: l ? fuerLp(await lektionLaden(q, l.id)) : null,
      vorlage: letzte ? { seiten: letzte.seiten, rechner: letzte.rechner, lernumgebung: letzte.lernumgebung, notizbuch: letzte.notizbuch } : { seiten: [], rechner: false, lernumgebung: false, notizbuch: !!u.notizbuch } };
  }));

  app.post("/api/unterricht/:uid/lektion", geschuetzt(async (req, res, q) => {
    const uid = id(req.params.uid);
    if (!darf(req.ctx, "lektion.leiten", { unterrichtId: uid })) fehler(404, "Unterricht nicht gefunden.");
    await unterrichtLaden(q, uid);
    // Vergessene Lektion abschliessen, damit eine neue beginnen kann
    await q("UPDATE lektion l SET beendet_am = l.gestartet_am + interval '6 hours' WHERE l.unterricht_id = $1 AND l.beendet_am IS NULL AND NOT (" + LAUFEND + ")", [uid]);
    const [schon] = await q(`SELECT l.id FROM lektion l WHERE l.unterricht_id = $1 AND ${LAUFEND}`, [uid]);
    if (schon) return res.status(409).send({ fehler: "In diesem Unterricht läuft schon eine Lektion.", lektion_id: schon.id });
    const e = einstellungenLesen(req.body || {});
    const [l] = await q("INSERT INTO lektion (unterricht_id, gestartet_von, seiten, rechner, lernumgebung, notizbuch) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
      [uid, req.ctx.personId, JSON.stringify(e.seiten), e.rechner, e.lernumgebung, e.notizbuch]);
    await protokolliere(q, req, "lektion.gestartet", "lektion", l.id);
    return { lektion_id: l.id };
  }));

  app.put("/api/lektionen/:id", geschuetzt(async (req, res, q) => {
    const l = offen(await lektionFuerLp(q, req.ctx, req.params.id));
    const b = req.body || {};
    const e = einstellungenLesen(b, l);
    const angehalten = b.angehalten !== undefined ? !!b.angehalten : l.angehalten;
    await q("UPDATE lektion SET seiten = $1, rechner = $2, lernumgebung = $3, angehalten = $4, notizbuch = $5 WHERE id = $6", [JSON.stringify(e.seiten), e.rechner, e.lernumgebung, angehalten, e.notizbuch, l.id]);
    return fuerLp(await lektionLaden(q, l.id));
  }));

  // Allen etwas zeigen: ein Material des Unterrichts oder eine Seite. «keiner» nimmt den Anstoss zurück.
  app.post("/api/lektionen/:id/anstoss", geschuetzt(async (req, res, q) => {
    const l = offen(await lektionFuerLp(q, req.ctx, req.params.id));
    const b = req.body || {};
    const nr = l.anstoss_nr + 1;
    let anstoss = null, seiten = l.seiten;
    if (b.art === "material") {
      const [m] = await q("SELECT id, titel, typ, url, besitzer_id, sichtbarkeit, fach_id, geloescht_am FROM material WHERE id = $1", [id(b.material_id)]);
      const objekt = m && { besitzerId: m.besitzer_id, sichtbarkeit: m.sichtbarkeit, fachId: m.fach_id, geloescht: !!m.geloescht_am, freigegebenFuer: [], unterrichtId: l.unterricht_id };
      if (!m || !darf(req.ctx, "material.freigeben", objekt)) fehler(404, "Material nicht gefunden.", "material_id");
      // Damit alle es öffnen können: für den Unterricht freigeben (ab sofort), falls es das noch nicht ist
      await q(`INSERT INTO freigabe (material_id, unterricht_id, ab, erstellt_von) VALUES ($1,$2,now(),$3)
        ON CONFLICT (material_id, unterricht_id) DO UPDATE SET ab = LEAST(freigabe.ab, now()), bis = CASE WHEN freigabe.bis IS NOT NULL AND freigabe.bis <= now() THEN NULL ELSE freigabe.bis END`,
        [m.id, l.unterricht_id, req.ctx.personId]);
      anstoss = { nr, art: "material", material_id: m.id, typ: m.typ, titel: m.titel, zeit: new Date().toISOString() };
      // Ein Link öffnet eine fremde Seite: die muss in der Lernumgebung erlaubt sein
      if (m.typ === "link" && m.url) seiten = [...seiten, ...seitenLesen([{ url: m.url, titel: m.titel }]).filter((s) => !seiten.some((x) => x.url === s.url))];
    } else if (b.art === "seite") {
      const [s] = seitenLesen([{ url: b.url, titel: b.titel }]);
      if (!s) fehler(400, "Bitte eine Adresse angeben.", "url");
      if (!seiten.some((x) => x.url === s.url)) seiten = [...seiten, s];
      anstoss = { nr, art: "seite", url: s.url, titel: s.titel, zeit: new Date().toISOString() };
    } else if (b.art !== "keiner") fehler(400, "Unbekannte Art.", "art");
    if (seiten.length > 20) fehler(400, "Höchstens 20 erlaubte Seiten.", "seiten");
    await q("UPDATE lektion SET anstoss = $1, anstoss_nr = $2, seiten = $3 WHERE id = $4", [anstoss && JSON.stringify(anstoss), nr, JSON.stringify(seiten), l.id]);
    return fuerLp(await lektionLaden(q, l.id));
  }));

  app.post("/api/lektionen/:id/beenden", geschuetzt(async (req, res, q) => {
    const l = await lektionFuerLp(q, req.ctx, req.params.id);
    if (!l.beendet_am) await q("UPDATE lektion SET beendet_am = now(), angehalten = false WHERE id = $1", [l.id]);
    await protokolliere(q, req, "lektion.beendet", "lektion", l.id);
    return { ok: true };
  }));

  // Live-Übersicht: wer ist dabei, womit, ist die Seite im Vordergrund, hat sie den Anstoss gesehen
  app.get("/api/lektionen/:id/uebersicht", geschuetzt(async (req, res, q) => {
    const l = await lektionFuerLp(q, req.ctx, req.params.id);
    const schueler = await schuelerVon(q, l.unterricht_id);
    const t = await q(`SELECT *, extract(epoch FROM now() - letzte_aktivitaet)::int AS still_s FROM lektion_teilnahme WHERE lektion_id = $1`, [l.id]);
    const m = new Map(t.map((x) => [x.schueler_id, x]));
    return { lektion: fuerLp(l), jetzt: new Date(), schueler: schueler.map((s) => {
      const x = m.get(s.id);
      return { ...s, teilnahme: x ? { online: x.still_s <= ONLINE_S, modus: x.modus, plattform: x.plattform, app_version: x.app_version, sichtbar: x.sichtbar,
        gesehen: !l.anstoss || x.gesehen_nr >= l.anstoss.nr, letzte_aktivitaet: x.letzte_aktivitaet, warnungen: x.warnungen, warnung_art: x.warnung_art, warnung_zuletzt: x.warnung_zuletzt } : null };
    }) };
  }));

  /* ========== Schüler/in ========== */
  app.get("/api/meine-lektionen", geschuetzt(async (req, res, q) => {
    if (!req.ctx.rollen.has("schueler")) return { laufend: [] };
    const laufend = await q(`SELECT l.id, l.gestartet_am, l.lernumgebung, k.name AS klasse, f.name AS fach, f.farbe, p.vorname AS lp_vorname, p.nachname AS lp_nachname
      FROM lektion l JOIN unterricht u ON u.id = l.unterricht_id JOIN klasse k ON k.id = u.klasse_id JOIN fach f ON f.id = u.fach_id
      LEFT JOIN person p ON p.id = l.gestartet_von WHERE l.unterricht_id = ANY($1) AND ${LAUFEND} ORDER BY l.gestartet_am DESC`, [[...req.ctx.unterricht]]);
    return { laufend };
  }));

  // Stand der Lektion. Mit ?puls=1 zählt der Aufruf als «dabei» (sichtbar=0|1: Seite im Vordergrund, nr: zuletzt gesehener Anstoss).
  app.get("/api/lektionen/:id", geschuetzt(async (req, res, q) => {
    const l = await lektionLaden(q, req.params.id);
    if (!darf(req.ctx, "lektion.teilnehmen", { unterrichtId: l.unterricht_id })) fehler(404, "Lektion nicht gefunden.");
    const kopf = { id: l.id, unterricht_id: l.unterricht_id, fach: l.fach, farbe: l.farbe, klasse: l.klasse, lehrperson: [l.lp_vorname, l.lp_nachname].filter(Boolean).join(" "), gestartet_am: l.gestartet_am };
    if (!laeuft(l)) return { ...kopf, beendet: true, lernumgebung: { pflicht: false, konfig: null } };
    const lu = req.lu && req.lu.gueltig ? req.lu : null;
    const modus = lu && lu.gesperrt ? "gesperrt" : "browser";
    if (req.query.puls === "1") {
      const nr = Math.max(0, Math.min(Number(req.query.nr) || 0, l.anstoss_nr));
      await q(`INSERT INTO lektion_teilnahme (lektion_id, schueler_id, modus, plattform, app_version, sichtbar, gesehen_nr) VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (lektion_id, schueler_id) DO UPDATE SET letzte_aktivitaet = now(), modus = EXCLUDED.modus, plattform = EXCLUDED.plattform,
          app_version = EXCLUDED.app_version, sichtbar = EXCLUDED.sichtbar, gesehen_nr = GREATEST(lektion_teilnahme.gesehen_nr, EXCLUDED.gesehen_nr)`,
        [l.id, req.ctx.personId, modus, lu ? lu.plattform : null, lu ? lu.version : null, req.query.sichtbar !== "0", nr]);
    }
    const k = luKonfig(l);
    return { ...kopf, beendet: false, seiten: l.seiten, rechner: l.rechner, notizbuch: l.notizbuch, angehalten: l.angehalten, anstoss: l.anstoss, modus,
      lernumgebung: { pflicht: l.lernumgebung, konfig: k, konfig_wert: konfigWert(k) }, jetzt: new Date() };
  }));

  // Meldungen der Lernumgebung während der Lektion (z. B. verbotenes Programm beendet)
  app.post("/api/lektionen/:id/warnung", geschuetzt(async (req, res, q) => {
    const l = await lektionLaden(q, req.params.id);
    if (!darf(req.ctx, "lektion.teilnehmen", { unterrichtId: l.unterricht_id })) fehler(404, "Lektion nicht gefunden.");
    const art = String((req.body && req.body.art) || "");
    if (!APP_WARNUNGEN.includes(art) || !(req.lu && req.lu.gueltig)) fehler(400, "Unbekannt.");
    if (!laeuft(l)) return { ok: true };
    await q(`INSERT INTO lektion_teilnahme (lektion_id, schueler_id, modus, warnungen, warnung_art, warnung_zuletzt) VALUES ($1,$2,'gesperrt',1,$3,now())
      ON CONFLICT (lektion_id, schueler_id) DO UPDATE SET warnungen = lektion_teilnahme.warnungen + 1, warnung_art = $3, warnung_zuletzt = now()`, [l.id, req.ctx.personId, art]);
    return { ok: true };
  }));
}
