// Kalender: persönlicher Stundenplan mit Änderungen, Termine, Prüfungsplan mit Limit, Untis-Import, Kalender-Abo (iCal)
import { geschuetzt } from "../sitzung.mjs";
import { sql, mitSchule } from "../db.mjs";
import { fehler } from "../fehler.mjs";
import { protokolliere } from "../protokoll.mjs";
import { kontext } from "../kontext.mjs";
import { hash, zufall } from "../krypto.mjs";
import { pruefe, darf, LEKTIONEN_STANDARD, PRUEFUNGSLIMIT_STANDARD, wochentag, wochenbeginn, plusTage, abWoche, zuerich, pruefungslimit, untisLesen } from "@schule/shared";
import { id, optId, text, pflicht, datum, optDatum, zeitpunkt, unterrichtLaden, schuelerVon, lehrpersonenVon, mitteilen, dateiLesen, heute } from "../hilfen.mjs";

const TERMIN_ARTEN = ["pruefung", "anlass", "ferien", "sonstig"];
const AENDERUNG = { ausfall: "fällt aus", raum: "Raumänderung", vertretung: "Vertretung", zusatz: "Zusatzlektion" };

async function einstellungen(q) {
  const [s] = await q("SELECT einstellungen FROM schule");
  const e = s.einstellungen || {};
  return { lektionen: Array.isArray(e.lektionen) && e.lektionen.length ? e.lektionen : LEKTIONEN_STANDARD, limit: { ...PRUEFUNGSLIMIT_STANDARD, ...(e.pruefungslimit || {}) } };
}

/** Prüfungen einer Klasse in einem Zeitraum: angekündigte Termine und Prüfungen mit Datum (ohne Termin) */
async function pruefungenDerKlasse(q, klasseId, von, bis, ohneTermin = null) {
  return q(`SELECT t.id, (t.von AT TIME ZONE 'Europe/Zurich')::date::text AS datum, t.titel, f.name AS fach, 'termin' AS quelle
      FROM termin t JOIN unterricht u ON u.id = t.unterricht_id JOIN fach f ON f.id = u.fach_id
      WHERE t.art = 'pruefung' AND u.klasse_id = $1 AND (t.von AT TIME ZONE 'Europe/Zurich')::date BETWEEN $2 AND $3 AND ($4::uuid IS NULL OR t.id <> $4)
    UNION ALL
    SELECT p.id, p.datum::text, p.titel, f.name, 'pruefung' FROM pruefung p JOIN unterricht u ON u.id = p.unterricht_id JOIN fach f ON f.id = u.fach_id
      WHERE u.klasse_id = $1 AND p.datum BETWEEN $2 AND $3 AND NOT EXISTS (SELECT 1 FROM termin t WHERE t.pruefung_id = p.id)
    ORDER BY 2`, [klasseId, von, bis, ohneTermin]);
}

/**
 * Kalender einer Person im Zeitraum (höchstens 6 Wochen): Lektionen (mit Änderungen), Termine, Aufträge, Prüfungen.
 * ctx: Rechte-Kontext der Person, deren Kalender gezeigt wird (bei Eltern: des Kindes)
 */
export async function kalenderVon(q, ctx, von, bis) {
  const { lektionen } = await einstellungen(q);
  const zeit = Object.fromEntries(lektionen.map((l) => [l.nr, l]));
  const meine = [...ctx.unterricht];
  const plan = meine.length ? await q(`SELECT s.*, f.name AS fach, f.kuerzel, f.farbe, k.name AS klasse, u.gruppe,
      (SELECT string_agg(p.kuerzel, ', ') FROM unterricht_lp ul JOIN person p ON p.id = ul.person_id WHERE ul.unterricht_id = u.id) AS lp
    FROM stundenplan s JOIN unterricht u ON u.id = s.unterricht_id JOIN fach f ON f.id = u.fach_id JOIN klasse k ON k.id = u.klasse_id
    WHERE s.unterricht_id = ANY($1) AND (s.gueltig_von IS NULL OR s.gueltig_von <= $3) AND (s.gueltig_bis IS NULL OR s.gueltig_bis >= $2)`, [meine, von, bis]) : [];
  const aenderungen = meine.length ? await q(`SELECT a.*, a.datum::text AS tag, p.kuerzel AS vertretung, f.name AS fach, f.farbe, k.name AS klasse FROM stundenplan_aenderung a
    LEFT JOIN person p ON p.id = a.vertretung_id JOIN unterricht u ON u.id = a.unterricht_id JOIN fach f ON f.id = u.fach_id JOIN klasse k ON k.id = u.klasse_id
    WHERE a.unterricht_id = ANY($1) AND a.datum BETWEEN $2 AND $3`, [meine, von, bis]) : [];
  // Vertretungen, die die Person selbst übernimmt
  const vertrete = await q(`SELECT a.*, a.datum::text AS tag, f.name AS fach, f.farbe, k.name AS klasse FROM stundenplan_aenderung a JOIN unterricht u ON u.id = a.unterricht_id
    JOIN fach f ON f.id = u.fach_id JOIN klasse k ON k.id = u.klasse_id WHERE a.vertretung_id = $1 AND a.datum BETWEEN $2 AND $3`, [ctx.personId, von, bis]);
  const lp = ctx.rollen.has("lehrperson") || ctx.rollen.has("schulleitung") || ctx.rollen.has("admin");
  const termine = await q(`SELECT t.id, t.art, t.titel, t.beschreibung, t.von, t.bis, t.ganztag, t.fuer, t.ort, t.unterricht_id, t.klasse_id, t.erstellt_von,
      f.name AS fach, f.farbe, k.name AS klasse
    FROM termin t LEFT JOIN unterricht u ON u.id = t.unterricht_id LEFT JOIN fach f ON f.id = u.fach_id LEFT JOIN klasse k ON k.id = coalesce(t.klasse_id, u.klasse_id)
    WHERE t.von < ($3::date + 1) AND t.bis >= $2::date AND (t.fuer = 'schule' OR (t.fuer = 'lehrpersonen' AND $4) OR (t.fuer = 'klasse' AND t.klasse_id = ANY($5)) OR (t.fuer = 'unterricht' AND t.unterricht_id = ANY($1)))
    ORDER BY t.von`, [meine, von, bis, lp, [...ctx.klassen]]);
  const ferien = termine.filter((t) => t.art === "ferien");
  const inFerien = (d) => ferien.some((t) => d >= new Date(t.von).toLocaleDateString("sv-SE", { timeZone: "Europe/Zurich" }) && d <= new Date(t.bis).toLocaleDateString("sv-SE", { timeZone: "Europe/Zurich" }));
  const eintraege = [];
  for (let d = von; d <= bis; d = plusTage(d, 1)) {
    const wt = wochentag(d);
    if (wt > 6 || inFerien(d)) continue;
    for (const s of plan.filter((x) => x.wochentag === wt && (x.woche === "alle" || x.woche === abWoche(d)) && (!x.gueltig_von || x.gueltig_von <= d) && (!x.gueltig_bis || x.gueltig_bis >= d))) {
      const z = zeit[s.lektion]; if (!z) continue;
      const a = aenderungen.find((x) => x.tag === d && x.unterricht_id === s.unterricht_id && x.lektion === s.lektion);
      eintraege.push({ typ: "lektion", datum: d, lektion: s.lektion, von: zuerich(d, z.von), bis: zuerich(d, z.bis), unterricht_id: s.unterricht_id, fach: s.fach, kuerzel: s.kuerzel, farbe: s.farbe,
        klasse: s.klasse, gruppe: s.gruppe, raum: a && a.art === "raum" ? a.raum : s.raum, lp: a && a.art === "vertretung" ? a.vertretung : s.lp,
        aenderung: a ? { art: a.art, text: a.text, raum: a.raum, vertretung: a.vertretung, label: AENDERUNG[a.art] } : null });
    }
  }
  for (const a of aenderungen.filter((x) => x.art === "zusatz")) {
    const z = zeit[a.lektion]; if (!z) continue;
    eintraege.push({ typ: "lektion", datum: a.tag, lektion: a.lektion, von: zuerich(a.tag, z.von), bis: zuerich(a.tag, z.bis), unterricht_id: a.unterricht_id, fach: a.fach, farbe: a.farbe, klasse: a.klasse, raum: a.raum, lp: a.vertretung, aenderung: { art: "zusatz", text: a.text, label: AENDERUNG.zusatz } });
  }
  for (const a of vertrete) {
    const z = zeit[a.lektion]; if (!z || meine.includes(a.unterricht_id)) continue;
    eintraege.push({ typ: "lektion", datum: a.tag, lektion: a.lektion, von: zuerich(a.tag, z.von), bis: zuerich(a.tag, z.bis), unterricht_id: a.unterricht_id, fach: a.fach, farbe: a.farbe, klasse: a.klasse, raum: a.raum, aenderung: { art: "vertretung", text: a.text, label: "Sie vertreten" } });
  }
  for (const t of termine) eintraege.push({ typ: "termin", id: t.id, art: t.art, titel: t.titel, beschreibung: t.beschreibung, von: t.von, bis: t.bis, ganztag: t.ganztag, fuer: t.fuer, ort: t.ort, fach: t.fach, farbe: t.farbe, klasse: t.klasse, unterricht_id: t.unterricht_id, eigen: t.erstellt_von === ctx.personId });
  // Prüfungen mit Datum, die (noch) keinen Termin haben
  if (meine.length) for (const p of await q(`SELECT p.id, p.titel, p.datum::text AS datum, p.unterricht_id, f.name AS fach, f.farbe, k.name AS klasse FROM pruefung p JOIN unterricht u ON u.id = p.unterricht_id
    JOIN fach f ON f.id = u.fach_id JOIN klasse k ON k.id = u.klasse_id WHERE p.unterricht_id = ANY($1) AND p.datum BETWEEN $2 AND $3 AND NOT EXISTS (SELECT 1 FROM termin t WHERE t.pruefung_id = p.id)`, [meine, von, bis]))
    eintraege.push({ typ: "termin", art: "pruefung", id: p.id, quelle: "pruefung", titel: p.titel, von: zuerich(p.datum, "00:00"), bis: zuerich(p.datum, "23:59"), ganztag: true, fach: p.fach, farbe: p.farbe, klasse: p.klasse, unterricht_id: p.unterricht_id });
  // Abgabetermine von Aufträgen
  if (meine.length) for (const a of await q(`SELECT a.id, a.titel, a.faellig_am, a.unterricht_id, f.name AS fach, f.farbe, k.name AS klasse FROM auftrag a JOIN unterricht u ON u.id = a.unterricht_id
    JOIN fach f ON f.id = u.fach_id JOIN klasse k ON k.id = u.klasse_id WHERE a.unterricht_id = ANY($1) AND a.faellig_am IS NOT NULL AND a.status <> 'entwurf'
    AND (a.faellig_am AT TIME ZONE 'Europe/Zurich')::date BETWEEN $2 AND $3`, [meine, von, bis]))
    eintraege.push({ typ: "auftrag", id: a.id, titel: a.titel, von: a.faellig_am, bis: a.faellig_am, fach: a.fach, farbe: a.farbe, klasse: a.klasse, unterricht_id: a.unterricht_id });
  return { eintraege: eintraege.sort((a, b) => String(a.von).localeCompare(String(b.von))), lektionen };
}

/** Wessen Kalender? Eigener, oder (für Eltern) der eines Kindes */
async function kalenderKontext(q, req) {
  if (!req.query.person || req.query.person === req.ctx.personId) return req.ctx;
  const pid = id(req.query.person);
  pruefe(req.ctx, "eltern.kind", { personId: pid });
  return kontext(q, pid);
}
const zeitraum = (von, bis) => {
  const v = von ? datum(von, "von") : wochenbeginn(heute());
  const b = bis ? datum(bis, "bis") : plusTage(v, 6);
  if (b < v || (new Date(b) - new Date(v)) / 864e5 > 62) fehler(400, "Höchstens neun Wochen auf einmal.");
  return [v, b];
};

/* ---------- iCal ---------- */
const icsText = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsZeit = (d) => new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const falten = (z) => { const out = []; let s = z; while (Buffer.byteLength(s) > 74) { let n = 74; while (Buffer.byteLength(s.slice(0, n)) > 74) n--; out.push(s.slice(0, n)); s = " " + s.slice(n); } out.push(s); return out.join("\r\n"); };
function ical(eintraege, name) {
  const z = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//RESCOOL//Kalender//DE", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${icsText(name)}`, "X-WR-TIMEZONE:Europe/Zurich"];
  for (const e of eintraege) {
    if (e.typ === "lektion" && e.aenderung && e.aenderung.art === "ausfall") continue;
    const titel = e.typ === "lektion" ? `${e.fach}${e.klasse ? " " + e.klasse : ""}${e.aenderung ? ` (${e.aenderung.label})` : ""}` : e.typ === "auftrag" ? `Abgabe: ${e.titel} (${e.fach})` : e.art === "pruefung" ? `Prüfung ${e.fach}: ${e.titel}` : e.titel;
    const uid = `${e.typ}-${e.id || e.unterricht_id}-${e.datum || ""}-${e.lektion || ""}@rescool`;
    z.push("BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${icsZeit(new Date())}`);
    if (e.ganztag) { const d = new Date(e.von).toLocaleDateString("sv-SE", { timeZone: "Europe/Zurich" }).replace(/-/g, ""); const b = plusTage(new Date(e.bis).toLocaleDateString("sv-SE", { timeZone: "Europe/Zurich" }), 1).replace(/-/g, ""); z.push(`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${b}`); }
    else z.push(`DTSTART:${icsZeit(e.von)}`, `DTEND:${icsZeit(e.typ === "auftrag" ? new Date(new Date(e.von).getTime() + 15 * 60e3) : e.bis)}`);
    z.push(falten(`SUMMARY:${icsText(titel)}`));
    if (e.raum || e.ort) z.push(falten(`LOCATION:${icsText(e.raum || e.ort)}`));
    if (e.beschreibung || (e.aenderung && e.aenderung.text)) z.push(falten(`DESCRIPTION:${icsText(e.beschreibung || e.aenderung.text)}`));
    z.push("END:VEVENT");
  }
  z.push("END:VCALENDAR");
  return z.join("\r\n") + "\r\n";
}

export default async function (app) {
  /* ---------- Persönlicher Kalender ---------- */
  app.get("/api/kalender", geschuetzt(async (req, res, q) => {
    const ctx = await kalenderKontext(q, req);
    const [von, bis] = zeitraum(req.query.von, req.query.bis);
    const k = await kalenderVon(q, ctx, von, bis);
    const [abo] = await q("SELECT erstellt_am FROM kalender_abo WHERE person_id = $1", [req.ctx.personId]);
    return { von, bis, ...k, abo: !!abo, darf: { schule: darf(req.ctx, "termin.schule"), aendern: darf(req.ctx, "stundenplan.aendern"), stundenplan: darf(req.ctx, "stundenplan.verwalten") } };
  }));

  /* ---------- Lektionszeiten und Prüfungslimit (Administration) ---------- */
  app.get("/api/kalender/einstellungen", geschuetzt(async (req, res, q) => einstellungen(q)));
  app.put("/api/kalender/einstellungen", geschuetzt(async (req, res, q) => {
    pruefe(req.ctx, "schule.einstellungen");
    const hm = (x) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(x || "")) ? String(x) : fehler(400, "Zeit im Format HH:MM.", "lektionen"));
    const lektionen = (Array.isArray(req.body.lektionen) ? req.body.lektionen : []).slice(0, 16).map((l, i) => ({ nr: i + 1, von: hm(l.von), bis: hm(l.bis) }));
    if (!lektionen.length) fehler(400, "Mindestens eine Lektion.", "lektionen");
    if (lektionen.some((l, i) => l.bis <= l.von || (i && l.von < lektionen[i - 1].bis))) fehler(400, "Die Lektionen müssen nacheinander liegen.", "lektionen");
    const limit = { proWoche: Math.max(0, Math.min(10, Number(req.body.pruefungslimit?.proWoche ?? 2) | 0)), proTag: Math.max(0, Math.min(5, Number(req.body.pruefungslimit?.proTag ?? 1) | 0)) };
    await q("UPDATE schule SET einstellungen = einstellungen || jsonb_build_object('lektionen', $1::jsonb, 'pruefungslimit', $2::jsonb)", [JSON.stringify(lektionen), JSON.stringify(limit)]);
    await protokolliere(q, req, "kalender.einstellungen", "schule", null, null, { lektionen: lektionen.length, limit });
    return { lektionen, limit };
  }));

  /* ---------- Stundenplan (Administration) ---------- */
  app.get("/api/stundenplan", geschuetzt(async (req, res, q) => {
    const kid = id(req.query.klasse);
    pruefe(req.ctx, "klasse.lesen", { klasseId: kid });
    const eintraege = await q(`SELECT s.id, s.unterricht_id, s.wochentag, s.lektion, s.raum, s.woche, s.gueltig_von, s.gueltig_bis, s.quelle, f.name AS fach, f.kuerzel, f.farbe, u.gruppe,
        (SELECT string_agg(p.kuerzel, ', ') FROM unterricht_lp ul JOIN person p ON p.id = ul.person_id WHERE ul.unterricht_id = u.id) AS lp
      FROM stundenplan s JOIN unterricht u ON u.id = s.unterricht_id JOIN fach f ON f.id = u.fach_id WHERE u.klasse_id = $1 ORDER BY s.wochentag, s.lektion`, [kid]);
    const unterricht = await q("SELECT u.id, f.name AS fach, f.kuerzel, u.gruppe FROM unterricht u JOIN fach f ON f.id = u.fach_id WHERE u.klasse_id = $1 ORDER BY f.name", [kid]);
    return { eintraege, unterricht, ...(await einstellungen(q)) };
  }));
  app.post("/api/stundenplan", geschuetzt(async (req, res, q) => {
    pruefe(req.ctx, "stundenplan.verwalten");
    const b = req.body || {};
    const u = await unterrichtLaden(q, b.unterricht_id);
    const wt = Number(b.wochentag), l = Number(b.lektion);
    if (!(wt >= 1 && wt <= 6) || !(l >= 1 && l <= 16)) fehler(400, "Bitte Tag und Lektion wählen.");
    try {
      const [s] = await q("INSERT INTO stundenplan (unterricht_id, wochentag, lektion, raum, woche, gueltig_von, gueltig_bis) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
        [u.id, wt, l, text(b.raum, 30) || null, ["A", "B"].includes(b.woche) ? b.woche : "alle", optDatum(b.gueltig_von), optDatum(b.gueltig_bis)]);
      return s;
    } catch (e) { if (e.code === "23505") fehler(409, "Diese Lektion ist schon eingetragen."); throw e; }
  }));
  app.delete("/api/stundenplan/:id", geschuetzt(async (req, res, q) => {
    pruefe(req.ctx, "stundenplan.verwalten");
    await q("DELETE FROM stundenplan WHERE id = $1", [id(req.params.id)]);
    return { ok: true };
  }));
  // Untis: GPU001.TXT. Erst Vorschau (vorschau=1), dann übernehmen; ersetzt alle früher aus Untis übernommenen Lektionen
  app.post("/api/stundenplan/untis", geschuetzt(async (req, res, q) => {
    pruefe(req.ctx, "stundenplan.verwalten");
    const { felder, datei } = await dateiLesen(req);
    if (datei.buf.length > 5e6) fehler(413, "Die Datei ist zu gross.");
    const { eintraege, fehler: kaputt } = untisLesen(datei.buf.toString("utf8").includes("\ufffd") ? datei.buf.toString("latin1") : datei.buf.toString("utf8"));
    const [jahr] = await q("SELECT id FROM schuljahr WHERE aktiv LIMIT 1");
    if (!jahr) fehler(400, "Kein aktives Schuljahr.");
    const unt = await q(`SELECT u.id, lower(k.name) AS klasse, lower(f.kuerzel) AS fach, u.gruppe, (SELECT array_agg(lower(p.kuerzel)) FROM unterricht_lp ul JOIN person p ON p.id = ul.person_id WHERE ul.unterricht_id = u.id) AS lp
      FROM unterricht u JOIN klasse k ON k.id = u.klasse_id JOIN fach f ON f.id = u.fach_id WHERE k.schuljahr_id = $1`, [jahr.id]);
    const zugeordnet = [], offen = [];
    for (const e of eintraege) {
      const passend = unt.filter((u) => u.klasse === e.klasse.toLowerCase() && u.fach === e.fach.toLowerCase());
      const u = passend.length > 1 ? passend.find((x) => (x.lp || []).includes(e.lehrer.toLowerCase())) || passend.find((x) => !x.gruppe) : passend[0];
      if (u) zugeordnet.push({ ...e, unterricht_id: u.id }); else offen.push(e);
    }
    if (felder.vorschau === "1") return { zugeordnet: zugeordnet.length, offen: offen.slice(0, 100), anzahlOffen: offen.length, unlesbar: kaputt.slice(0, 20), anzahlUnlesbar: kaputt.length };
    await q("DELETE FROM stundenplan WHERE quelle = 'untis'");
    let n = 0;
    for (const e of zugeordnet) n += (await q(`INSERT INTO stundenplan (unterricht_id, wochentag, lektion, raum, quelle, extern_nr) VALUES ($1,$2,$3,$4,'untis',$5)
      ON CONFLICT DO NOTHING RETURNING id`, [e.unterricht_id, e.tag, e.stunde, e.raum.slice(0, 30) || null, e.nr.slice(0, 20)])).length;
    await protokolliere(q, req, "stundenplan.untis", "stundenplan", null, null, { uebernommen: n, offen: offen.length });
    return { uebernommen: n, anzahlOffen: offen.length, offen: offen.slice(0, 100) };
  }));

  /* ---------- Änderungen (Ausfall, Raum, Vertretung, Zusatz) ---------- */
  app.post("/api/stundenplan/aenderungen", geschuetzt(async (req, res, q) => {
    const b = req.body || {};
    const u = await unterrichtLaden(q, b.unterricht_id);
    // Ausfall und Raum darf auch die Lehrperson im eigenen Unterricht melden; Vertretungen organisiert die Schulleitung
    if (!darf(req.ctx, "stundenplan.aendern") && !(["ausfall", "raum"].includes(b.art) && darf(req.ctx, "auftrag.verwalten", { unterrichtId: u.id }))) fehler(403, "Dafür fehlt Ihnen die Berechtigung.");
    if (!AENDERUNG[b.art]) fehler(400, "Bitte die Art der Änderung wählen.", "art");
    const d = datum(b.datum), l = Number(b.lektion);
    if (!(l >= 1 && l <= 16)) fehler(400, "Bitte die Lektion wählen.", "lektion");
    const vertretung = b.art === "vertretung" ? id(b.vertretung_id) : null;
    if (b.art === "raum" && !text(b.raum, 30)) fehler(400, "Bitte den neuen Raum angeben.", "raum");
    const [a] = await q(`INSERT INTO stundenplan_aenderung (datum, unterricht_id, lektion, art, raum, vertretung_id, text, erstellt_von) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (datum, unterricht_id, lektion) DO UPDATE SET art = EXCLUDED.art, raum = EXCLUDED.raum, vertretung_id = EXCLUDED.vertretung_id, text = EXCLUDED.text, erstellt_von = EXCLUDED.erstellt_von RETURNING *`,
      [d, u.id, l, b.art, text(b.raum, 30) || null, vertretung, text(b.text, 300), req.ctx.personId]);
    const wann = `${new Date(d + "T12:00:00Z").toLocaleDateString("de-CH", { weekday: "short", day: "numeric", month: "numeric" })}, ${l}. Lektion`;
    const ziel = [...(await schuelerVon(q, u)).map((s) => s.id), ...(await lehrpersonenVon(q, u.id)).map((p) => p.id), vertretung].filter((x) => x && x !== req.ctx.personId);
    await mitteilen(q, ziel, { art: "stundenplan", titel: `${u.fach} ${u.klasse}: ${AENDERUNG[b.art]}${b.art === "raum" ? ` (${text(b.raum, 30)})` : ""}`, text: `${wann}${a.text ? ". " + a.text : ""}`, link: "/kalender", schluessel: `aenderung:${a.id}:${b.art}:${a.raum || ""}:${vertretung || ""}` });
    await protokolliere(q, req, "stundenplan.geaendert", "stundenplan_aenderung", a.id, null, { art: b.art, datum: d, lektion: l });
    return a;
  }));
  app.delete("/api/stundenplan/aenderungen/:id", geschuetzt(async (req, res, q) => {
    const [a] = await q("SELECT * FROM stundenplan_aenderung WHERE id = $1", [id(req.params.id)]);
    if (!a) fehler(404, "Änderung nicht gefunden.");
    if (!darf(req.ctx, "stundenplan.aendern") && a.erstellt_von !== req.ctx.personId) fehler(403, "Dafür fehlt Ihnen die Berechtigung.");
    await q("DELETE FROM stundenplan_aenderung WHERE id = $1", [a.id]);
    return { ok: true };
  }));

  /* ---------- Termine (inkl. Prüfungsankündigung mit Limit) ---------- */
  app.get("/api/pruefungsplan", geschuetzt(async (req, res, q) => {
    const u = await unterrichtLaden(q, req.query.unterricht);
    pruefe(req.ctx, "unterricht.lesen", { unterrichtId: u.id });
    const von = req.query.von ? datum(req.query.von) : wochenbeginn(heute());
    const { limit } = await einstellungen(q);
    const liste = await pruefungenDerKlasse(q, u.klasse_id, von, plusTage(von, 7 * 12 - 1));
    return { klasse: u.klasse, limit, pruefungen: liste, pruefen: req.query.datum ? pruefungslimit(datum(req.query.datum), liste, limit) : null };
  }));
  app.post("/api/termine", geschuetzt(async (req, res, q) => {
    const b = req.body || {};
    const art = TERMIN_ARTEN.includes(b.art) ? b.art : fehler(400, "Bitte die Art wählen.", "art");
    const fuer = art === "pruefung" ? "unterricht" : ["schule", "lehrpersonen", "klasse", "unterricht"].includes(b.fuer) ? b.fuer : fehler(400, "Bitte wählen, für wen der Termin gilt.", "fuer");
    let u = null, klasseId = null;
    if (fuer === "schule" || fuer === "lehrpersonen") pruefe(req.ctx, "termin.schule");
    if (fuer === "klasse") { klasseId = id(b.klasse_id); pruefe(req.ctx, "termin.klasse", { klasseId }); }
    if (fuer === "unterricht") {
      u = await unterrichtLaden(q, b.unterricht_id);
      // Die Schulleitung darf Prüfungen eintragen (z. B. eine bewilligte Ausnahme), sonst die unterrichtende Lehrperson
      if (!(art === "pruefung" && darf(req.ctx, "pruefungslimit.ausnahme"))) pruefe(req.ctx, art === "pruefung" ? "pruefung.ankuendigen" : "auftrag.verwalten", { unterrichtId: u.id });
    }
    const ganztag = art === "ferien" || b.ganztag === true;
    let von, bis;
    if (ganztag) { const dv = datum(b.datum || b.von, "von"), db = b.bis_datum ? datum(b.bis_datum, "bis") : dv; if (db < dv) fehler(400, "Das Ende liegt vor dem Beginn.", "bis"); von = zuerich(dv, "00:00"); bis = zuerich(db, "23:59"); }
    else { von = zeitpunkt(b.von, "von"); bis = b.bis ? zeitpunkt(b.bis, "bis") : von; if (bis < von) fehler(400, "Das Ende liegt vor dem Beginn.", "bis"); }
    let ausnahme = null;
    if (art === "pruefung") {
      const tag = new Date(von).toLocaleDateString("sv-SE", { timeZone: "Europe/Zurich" });
      const { limit } = await einstellungen(q);
      const wb = wochenbeginn(tag);
      const p = pruefungslimit(tag, await pruefungenDerKlasse(q, u.klasse_id, wb, plusTage(wb, 6)), limit);
      if (!p.ok) {
        ausnahme = text(b.ausnahme_grund, 300);
        if (!ausnahme || !darf(req.ctx, "pruefungslimit.ausnahme")) {
          const e = new Error(p.grund + (darf(req.ctx, "pruefungslimit.ausnahme") ? " Mit einer Begründung können Sie eine Ausnahme bewilligen." : " Bitte ein anderes Datum wählen oder bei der Schulleitung eine Ausnahme beantragen."));
          e.status = 409; e.feld = "limit"; throw e;
        }
      }
    }
    const [t] = await q(`INSERT INTO termin (art, titel, beschreibung, von, bis, ganztag, fuer, klasse_id, unterricht_id, pruefung_id, ort, ausnahme_grund, ausnahme_von, erstellt_von)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [art, pflicht(b.titel, 160, "Bitte einen Titel eingeben.", "titel"), text(b.beschreibung, 4000), von, bis, ganztag, fuer, klasseId, u ? u.id : null, optId(b.pruefung_id), text(b.ort, 80) || null, ausnahme, ausnahme ? req.ctx.personId : null, req.ctx.personId]);
    if (art === "pruefung") {
      await mitteilen(q, (await schuelerVon(q, u)).map((s) => s.id), { art: "termin", titel: `Prüfung ${u.fach}: ${t.titel}`, text: new Date(von).toLocaleDateString("de-CH", { timeZone: "Europe/Zurich", weekday: "long", day: "numeric", month: "long" }), link: "/kalender", schluessel: `pruefung:${t.id}` });
      if (ausnahme) await protokolliere(q, req, "pruefungslimit.ausnahme", "termin", t.id, null, { grund: ausnahme }, ausnahme);
    }
    return t;
  }));
  app.delete("/api/termine/:id", geschuetzt(async (req, res, q) => {
    const [t] = await q("SELECT * FROM termin WHERE id = $1", [id(req.params.id)]);
    if (!t) fehler(404, "Termin nicht gefunden.");
    const darfLoeschen = t.erstellt_von === req.ctx.personId || darf(req.ctx, "termin.schule")
      || (t.unterricht_id && darf(req.ctx, "auftrag.verwalten", { unterrichtId: t.unterricht_id })) || (t.klasse_id && darf(req.ctx, "termin.klasse", { klasseId: t.klasse_id }));
    if (!darfLoeschen) fehler(403, "Dafür fehlt Ihnen die Berechtigung.");
    await q("DELETE FROM termin WHERE id = $1", [t.id]);
    return { ok: true };
  }));

  /* ---------- Kalender-Abo (iCal) ---------- */
  app.post("/api/kalender/abo", geschuetzt(async (req, res, q) => {
    const token = zufall(24);
    await q("INSERT INTO kalender_abo (person_id, token_hash) VALUES ($1,$2) ON CONFLICT (person_id) DO UPDATE SET token_hash = EXCLUDED.token_hash, erstellt_am = now()", [req.ctx.personId, hash(token)]);
    return { pfad: `/api/ical/${token}.ics` };
  }));
  app.delete("/api/kalender/abo", geschuetzt(async (req, res, q) => { await q("DELETE FROM kalender_abo WHERE person_id = $1", [req.ctx.personId]); return { ok: true }; }));
  app.get("/api/ical/:datei", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, res) => {
    const token = String(req.params.datei || "").replace(/\.ics$/, "");
    if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) fehler(404, "Nicht gefunden.");
    const { rows } = await sql("SELECT * FROM kalender_abo_finden($1)", [hash(token)]);
    if (!rows[0]) fehler(404, "Dieses Abo gibt es nicht mehr.");
    const body = await mitSchule(rows[0].schule_id, async (q) => {
      const ctx = await kontext(q, rows[0].person_id);
      if (!ctx) fehler(404, "Nicht gefunden.");
      const von = plusTage(wochenbeginn(heute()), -14), bis = plusTage(von, 62);
      const [s] = await q("SELECT name FROM schule");
      return ical((await kalenderVon(q, ctx, von, bis)).eintraege, `${s.name.replace(/ \(Testschule\)$/, "")}: ${ctx.person.vorname}`);
    });
    res.header("Content-Type", "text/calendar; charset=utf-8");
    res.header("Cache-Control", "private, max-age=900");
    return body;
  });
}
