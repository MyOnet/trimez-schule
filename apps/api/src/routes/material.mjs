// Material: Ablage der Lehrpersonen (Ordner, Dateien, Links, Texte), Versionen, Teilen, Freigabe für den Unterricht,
// Suche (auch im Inhalt von PDF, Word, PowerPoint) und die Ansicht für Schülerinnen und Schüler.
import crypto from "node:crypto";
import { geschuetzt } from "../sitzung.mjs";
import { fehler } from "../fehler.mjs";
import { protokolliere } from "../protokoll.mjs";
import { pruefe, darf } from "@schule/shared";
import { speicher, neuerKey } from "../material/speicher.mjs";
import { dateiart, sauberName, inhaltPasst, textAuszug, MAX_GROESSE, INLINE, ARTEN } from "../material/dateien.mjs";

const id = (x) => (/^[0-9a-f-]{36}$/.test(String(x || "")) ? x : fehler(400, "Ungültige Kennung."));
const optId = (x) => (x ? id(x) : null);
const text = (x, max) => (x == null ? "" : String(x).trim().slice(0, max));
const SICHT = ["privat", "fachgruppe", "schule"];
const istLehr = (ctx) => ctx.rollen.has("lehrperson") || ctx.rollen.has("schulleitung");
const artVon = (mime, typ) => (typ !== "datei" ? typ : (Object.values(ARTEN).find((a) => a[0] === mime) || [, "sonstig"])[1]);

/* ---------- Sichtbarkeit: dieselbe Regel wie darf("material.lesen"), als SQL für Listen ---------- */
const AKTIV = "f.ab <= now() AND (f.bis IS NULL OR f.bis > now())";
const sichtbar = (ctx, p) => {
  p.push(ctx.personId, [...(ctx.faecher || [])], [...ctx.unterricht], istLehr(ctx));
  const [a, b, c, d] = [p.length - 3, p.length - 2, p.length - 1, p.length];
  return `(m.besitzer_id = $${a} OR (m.geloescht_am IS NULL AND (
    ($${d} AND m.sichtbarkeit = 'schule') OR ($${d} AND m.sichtbarkeit = 'fachgruppe' AND m.fach_id = ANY($${b}::uuid[]))
    OR EXISTS (SELECT 1 FROM freigabe f WHERE f.material_id = m.id AND f.unterricht_id = ANY($${c}::uuid[]) AND ${AKTIV}))))`;
};

// Suchbegriffe → tsquery mit Präfix (z. B. «Kafk» findet «Kafka»); nur Buchstaben und Ziffern
function suchAnfrage(s) {
  const w = String(s || "").toLowerCase().normalize("NFC").match(/[\p{L}\p{N}]+/gu) || [];
  return w.slice(0, 8).map((x) => `${x}:*`).join(" & ");
}

const FELDER = `m.id, m.typ, m.titel, m.beschreibung, m.url, m.schlagworte, m.sichtbarkeit, m.stufe, m.fach_id, m.ordner_id, m.besitzer_id,
  m.erstellt_am, m.geaendert_am, m.geloescht_am, m.lizenz, m.quelle,
  f.name AS fach, f.farbe, p.vorname || ' ' || p.nachname AS besitzer,
  v.id AS version_id, v.nr AS version, v.dateiname, v.mime, v.groesse, v.seiten`;
const JOINS = `LEFT JOIN fach f ON f.id = m.fach_id JOIN person p ON p.id = m.besitzer_id LEFT JOIN material_version v ON v.id = m.aktuelle_version_id`;

const eintrag = (ctx, m) => ({ ...m, art: artVon(m.mime, m.typ), mein: m.besitzer_id === ctx.personId, host: m.url ? new URL(m.url).hostname.replace(/^www\./, "") : null });

async function freigabenZu(q, ctx, ids) {
  if (!ids.length) return new Map();
  const rows = await q(`SELECT fr.id, fr.material_id, fr.unterricht_id, fr.ab, fr.bis, fr.hinweis, k.name AS klasse, fa.name AS fach, u.gruppe
    FROM freigabe fr JOIN unterricht u ON u.id = fr.unterricht_id JOIN klasse k ON k.id = u.klasse_id JOIN fach fa ON fa.id = u.fach_id
    WHERE fr.material_id = ANY($1) ORDER BY k.name`, [ids]);
  const m = new Map();
  // Lehrpersonen sehen die Freigaben ihres eigenen Unterrichts; Besitzer sehen alle
  for (const r of rows) { (m.get(r.material_id) || m.set(r.material_id, []).get(r.material_id)).push(r); }
  return m;
}

async function materialLaden(q, ctx, mid, aktion = "material.lesen") {
  const [m] = await q(`SELECT ${FELDER}, m.inhalt FROM material m ${JOINS} WHERE m.id = $1`, [id(mid)]);
  if (!m) fehler(404, "Material nicht gefunden.");
  const fr = await q(`SELECT unterricht_id FROM freigabe f WHERE f.material_id = $1 AND ${AKTIV}`, [m.id]);
  const objekt = { besitzerId: m.besitzer_id, sichtbarkeit: m.sichtbarkeit, fachId: m.fach_id, geloescht: !!m.geloescht_am, freigegebenFuer: fr.map((r) => r.unterricht_id) };
  if (!darf(ctx, "material.lesen", objekt)) fehler(404, "Material nicht gefunden."); // nicht verraten, dass es existiert
  if (aktion !== "material.lesen") pruefe(ctx, aktion, objekt);
  return { m, objekt };
}

async function ordnerPruefen(q, ctx, oid) {
  if (!oid) return null;
  const [o] = await q("SELECT id FROM ordner WHERE id = $1 AND besitzer_id = $2", [id(oid), ctx.personId]);
  if (!o) fehler(400, "Diesen Ordner gibt es nicht.", "ordner_id");
  return o.id;
}

// Datei aus der Anfrage lesen (multipart): eine Datei plus Felder
async function dateiLesen(req) {
  const felder = {}; let datei = null;
  for await (const part of req.parts({ limits: { fileSize: MAX_GROESSE, files: 1 } })) {
    if (part.type === "file") {
      const buf = await part.toBuffer();
      if (part.file.truncated) fehler(413, "Die Datei ist grösser als 50 MB.");
      datei = { buf, name: sauberName(part.filename) };
    } else felder[part.fieldname] = part.value;
  }
  return { felder, datei };
}
async function dateiAblegen(q, req, mid, nr, datei) {
  const a = dateiart(datei.name);
  if (!a) fehler(415, "Diese Dateiart ist nicht erlaubt. Erlaubt sind z. B. PDF, Word, PowerPoint, Excel, Bilder, Audio und Video.", "datei");
  if (!datei.buf.length) fehler(400, "Die Datei ist leer.", "datei");
  if (!inhaltPasst(a.ext, datei.buf)) fehler(415, "Der Inhalt passt nicht zur Dateiendung.", "datei");
  const key = neuerKey(req.sitzung.schule_id);
  await speicher.ablegen(key, datei.buf, a.mime);
  const { text: t, seiten } = await textAuszug(a.ext, datei.buf);
  const [v] = await q(`INSERT INTO material_version (material_id, nr, datei_key, dateiname, mime, groesse, sha256, seiten, text_auszug, hochgeladen_von)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, nr`,
    [mid, nr, key, datei.name, a.mime, datei.buf.length, crypto.createHash("sha256").update(datei.buf).digest("hex"), seiten || null, t, req.ctx.personId]);
  await q("UPDATE material SET aktuelle_version_id = $1, such_text = $2, geaendert_am = now() WHERE id = $3", [v.id, t, mid]);
  return v;
}

function felderLesen(b, ctx, alt = {}) {
  const d = {
    titel: b.titel !== undefined ? text(b.titel, 160) : alt.titel,
    beschreibung: b.beschreibung !== undefined ? text(b.beschreibung, 2000) : alt.beschreibung || "",
    schlagworte: b.schlagworte !== undefined ? [...new Set((Array.isArray(b.schlagworte) ? b.schlagworte : String(b.schlagworte).split(",")).map((x) => text(x, 40).toLowerCase()).filter(Boolean))].slice(0, 20) : alt.schlagworte || [],
    sichtbarkeit: b.sichtbarkeit !== undefined ? (SICHT.includes(b.sichtbarkeit) ? b.sichtbarkeit : fehler(400, "Ungültige Sichtbarkeit.", "sichtbarkeit")) : alt.sichtbarkeit || "privat",
    fach_id: b.fach_id !== undefined ? optId(b.fach_id) : alt.fach_id || null,
    stufe: b.stufe !== undefined ? (b.stufe === "" || b.stufe === null ? null : Math.min(6, Math.max(1, Number(b.stufe) | 0))) : alt.stufe ?? null,
    ordner_id: b.ordner_id !== undefined ? optId(b.ordner_id) : alt.ordner_id || null,
    url: b.url !== undefined ? text(b.url, 2000) || null : alt.url || null,
    inhalt: b.inhalt !== undefined ? String(b.inhalt).slice(0, 100000) : alt.inhalt ?? null,
    lizenz: b.lizenz !== undefined ? text(b.lizenz, 120) || null : alt.lizenz || null,
    quelle: b.quelle !== undefined ? text(b.quelle, 300) || null : alt.quelle || null,
  };
  if (d.url && !/^https?:\/\/[^\s]+$/i.test(d.url)) fehler(400, "Bitte eine Adresse eingeben, die mit https:// beginnt.", "url");
  if (d.sichtbarkeit === "fachgruppe" && !d.fach_id) fehler(400, "Zum Teilen mit der Fachgruppe bitte ein Fach wählen.", "fach_id");
  return d;
}

export default async function (app) {
  /* ---------- Liste und Suche ---------- */
  app.get("/api/material", geschuetzt(async (req, res, q) => {
    const ctx = req.ctx, b = req.query || {};
    if (!darf(ctx, "material.erstellen")) fehler(403, "Die Ablage gibt es für Lehrpersonen.");
    const bereich = ["meine", "fachgruppe", "schule", "papierkorb", "alle"].includes(b.bereich) ? b.bereich : "meine";
    const such = suchAnfrage(b.suche);
    const p = [], w = [sichtbar(ctx, p)];
    const P = (v) => (p.push(v), `$${p.length}`);
    if (bereich === "papierkorb") w.push(`m.besitzer_id = ${P(ctx.personId)} AND m.geloescht_am IS NOT NULL`);
    else {
      w.push("m.geloescht_am IS NULL");
      if (bereich === "meine") w.push(`m.besitzer_id = ${P(ctx.personId)}`);
      if (bereich === "fachgruppe") w.push(`m.sichtbarkeit = 'fachgruppe' AND m.besitzer_id <> ${P(ctx.personId)}`);
      if (bereich === "schule") w.push(`m.sichtbarkeit = 'schule' AND m.besitzer_id <> ${P(ctx.personId)}`);
    }
    // Ohne Suche: Inhalt des gewählten Ordners. Mit Suche: alles im Bereich.
    if (bereich === "meine" && !such) w.push(b.ordner ? `m.ordner_id = ${P(id(b.ordner))}` : "m.ordner_id IS NULL");
    if (b.fach) w.push(`m.fach_id = ${P(id(b.fach))}`);
    if (b.art) w.push(`(CASE WHEN m.typ <> 'datei' THEN m.typ ELSE v.mime END) = ANY(${P(b.art === "link" || b.art === "text" ? [b.art] : Object.values(ARTEN).filter((a) => a[1] === b.art).map((a) => a[0]))})`);
    let rang = "m.geaendert_am DESC", auszug = "NULL";
    if (such) {
      const tq = P(such);
      w.push(`(m.suche @@ to_tsquery('german', ${tq}) OR lower(m.titel) LIKE ${P("%" + String(b.suche).toLowerCase().trim().slice(0, 60).replace(/[%_\\]/g, "") + "%")})`);
      rang = `ts_rank(m.suche, to_tsquery('german', ${tq})) DESC, m.geaendert_am DESC`;
      auszug = `CASE WHEN m.such_text <> '' OR m.inhalt IS NOT NULL THEN ts_headline('german', left(coalesce(m.inhalt, '') || ' ' || m.such_text, 50000), to_tsquery('german', ${tq}),
        'StartSel=«, StopSel=», MaxWords=22, MinWords=10, MaxFragments=1') END`;
    }
    const rows = await q(`SELECT ${FELDER}, ${auszug} AS auszug FROM material m ${JOINS} WHERE ${w.join(" AND ")} ORDER BY ${rang} LIMIT 300`, p);
    const fr = await freigabenZu(q, ctx, rows.map((r) => r.id));
    const eintraege = rows.map((r) => ({ ...eintrag(ctx, r), auszug: r.auszug && r.auszug.includes("«") ? r.auszug : null,
      freigaben: (fr.get(r.id) || []).filter((f) => r.besitzer_id === ctx.personId || ctx.lehrt.has(f.unterricht_id)) }));
    const ordner = await q("SELECT o.id, o.name, o.eltern_id, (SELECT count(*)::int FROM material m WHERE m.ordner_id = o.id AND m.geloescht_am IS NULL) AS anzahl FROM ordner o WHERE o.besitzer_id = $1 ORDER BY o.name", [ctx.personId]);
    const zahlen = (await q(`SELECT
        count(*) FILTER (WHERE besitzer_id = $1 AND geloescht_am IS NULL)::int AS meine,
        count(*) FILTER (WHERE besitzer_id = $1 AND geloescht_am IS NOT NULL)::int AS papierkorb,
        count(*) FILTER (WHERE besitzer_id <> $1 AND geloescht_am IS NULL AND sichtbarkeit = 'fachgruppe' AND fach_id = ANY($2::uuid[]))::int AS fachgruppe,
        count(*) FILTER (WHERE besitzer_id <> $1 AND geloescht_am IS NULL AND sichtbarkeit = 'schule')::int AS schule
      FROM material`, [ctx.personId, [...(ctx.faecher || [])]]))[0];
    const faecher = await q("SELECT id, name, farbe FROM fach ORDER BY name");
    const meinUnterricht = await q(`SELECT u.id, u.gruppe, k.name AS klasse, k.stufe, f.name AS fach, f.farbe, f.id AS fach_id FROM unterricht u JOIN klasse k ON k.id = u.klasse_id JOIN fach f ON f.id = u.fach_id
      JOIN schuljahr j ON j.id = k.schuljahr_id WHERE u.id = ANY($1) AND j.aktiv ORDER BY k.name, f.name`, [[...ctx.lehrt]]);
    return { bereich, eintraege, ordner, zahlen, faecher, meineFaecher: [...(ctx.faecher || [])], meinUnterricht };
  }));

  /* ---------- Einzelnes Material ---------- */
  app.get("/api/material/:id", geschuetzt(async (req, res, q) => {
    const { m } = await materialLaden(q, req.ctx, req.params.id);
    const mein = m.besitzer_id === req.ctx.personId;
    const d = eintrag(req.ctx, m);
    d.darfBearbeiten = mein;
    if (istLehr(req.ctx)) {
      d.versionen = await q(`SELECT v.id, v.nr, v.dateiname, v.groesse, v.mime, v.erstellt_am, p.vorname || ' ' || p.nachname AS von
        FROM material_version v LEFT JOIN person p ON p.id = v.hochgeladen_von WHERE v.material_id = $1 ORDER BY v.nr DESC`, [m.id]);
      const fr = (await freigabenZu(q, req.ctx, [m.id])).get(m.id) || [];
      d.freigaben = [];
      for (const f of fr.filter((f) => mein || req.ctx.lehrt.has(f.unterricht_id))) {
        const [z] = await q(`SELECT
            (SELECT count(*)::int FROM material_abruf a WHERE a.material_id = $1 AND a.person_id IN (SELECT person_id FROM unterricht_schueler WHERE unterricht_id = $2
               UNION SELECT ks.person_id FROM klasse_schueler ks JOIN unterricht u ON u.klasse_id = ks.klasse_id AND u.gruppe = '' WHERE u.id = $2)) AS geoeffnet,
            (SELECT count(*)::int FROM (SELECT person_id FROM unterricht_schueler WHERE unterricht_id = $2
               UNION SELECT ks.person_id FROM klasse_schueler ks JOIN unterricht u ON u.klasse_id = ks.klasse_id AND u.gruppe = '' WHERE u.id = $2 AND (ks.bis IS NULL OR ks.bis >= current_date)) s) AS schueler`, [m.id, f.unterricht_id]);
        d.freigaben.push({ ...f, ...z, aktiv: new Date(f.ab) <= new Date() && (!f.bis || new Date(f.bis) > new Date()), darfAendern: req.ctx.lehrt.has(f.unterricht_id) || mein });
      }
    } else {
      // Schülerinnen und Schüler: Text-Material zählt beim Öffnen als gelesen
      if (m.typ === "text") await abruf(q, m.id, req.ctx.personId);
      const [h] = await q(`SELECT fr.hinweis FROM freigabe fr WHERE fr.material_id = $1 AND fr.unterricht_id = ANY($2) LIMIT 1`, [m.id, [...req.ctx.unterricht]]);
      d.hinweis = h ? h.hinweis : "";
      delete d.besitzer_id; delete d.ordner_id; delete d.sichtbarkeit;
    }
    return d;
  }));

  /* ---------- Anlegen ---------- */
  app.post("/api/material", geschuetzt(async (req, res, q) => {
    pruefe(req.ctx, "material.erstellen");
    let felder, datei = null;
    if (req.isMultipart()) ({ felder, datei } = await dateiLesen(req)); else felder = req.body || {};
    const typ = datei ? "datei" : felder.typ === "text" ? "text" : felder.typ === "link" ? "link" : fehler(400, "Bitte eine Datei wählen.", "datei");
    if (!felder.titel) felder.titel = datei ? datei.name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim() : felder.typ === "link" ? felder.url : "";
    // Fach vorschlagen: unterrichtet die Person nur ein Fach, nimm dieses
    if (felder.fach_id === undefined && req.ctx.faecher && req.ctx.faecher.size === 1) felder.fach_id = [...req.ctx.faecher][0];
    const d = felderLesen(felder, req.ctx);
    if (!d.titel) fehler(400, "Bitte einen Titel eingeben.", "titel");
    if (typ === "link" && !d.url) fehler(400, "Bitte die Adresse des Links eingeben.", "url");
    d.ordner_id = await ordnerPruefen(q, req.ctx, d.ordner_id);
    const [m] = await q(`INSERT INTO material (besitzer_id, ordner_id, fach_id, stufe, typ, titel, beschreibung, url, inhalt, schlagworte, sichtbarkeit, lizenz, quelle)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [req.ctx.personId, d.ordner_id, d.fach_id, d.stufe, typ, d.titel, d.beschreibung, typ === "link" ? d.url : null, typ === "text" ? d.inhalt || "" : null, d.schlagworte, d.sichtbarkeit, d.lizenz, d.quelle]);
    if (datei) await dateiAblegen(q, req, m.id, 1, datei);
    await protokolliere(q, req, "material.erstellt", "material", m.id, null, { titel: d.titel, typ });
    // Direkt freigeben (z. B. beim Hochladen aus der Klassenansicht)
    if (felder.freigeben_fuer) {
      const uid = id(felder.freigeben_fuer);
      pruefe(req.ctx, "material.freigeben", { besitzerId: req.ctx.personId, unterrichtId: uid });
      await q("INSERT INTO freigabe (material_id, unterricht_id, erstellt_von) VALUES ($1,$2,$3)", [m.id, uid, req.ctx.personId]);
      await protokolliere(q, req, "freigabe.erstellt", "material", m.id, null, { unterricht_id: uid });
    }
    const [neu] = await q(`SELECT ${FELDER} FROM material m ${JOINS} WHERE m.id = $1`, [m.id]);
    return eintrag(req.ctx, neu);
  }));

  /* ---------- Ändern, verschieben ---------- */
  app.put("/api/material/:id", geschuetzt(async (req, res, q) => {
    const { m } = await materialLaden(q, req.ctx, req.params.id, "material.bearbeiten");
    const d = felderLesen(req.body || {}, req.ctx, m);
    if (!d.titel) fehler(400, "Bitte einen Titel eingeben.", "titel");
    if (m.typ === "link" && !d.url) fehler(400, "Bitte die Adresse des Links eingeben.", "url");
    d.ordner_id = await ordnerPruefen(q, req.ctx, d.ordner_id);
    await q(`UPDATE material SET titel=$1, beschreibung=$2, schlagworte=$3, sichtbarkeit=$4, fach_id=$5, stufe=$6, ordner_id=$7, url=$8, inhalt=$9, lizenz=$10, quelle=$11, geaendert_am=now() WHERE id=$12`,
      [d.titel, d.beschreibung, d.schlagworte, d.sichtbarkeit, d.fach_id, d.stufe, d.ordner_id, m.typ === "link" ? d.url : null, m.typ === "text" ? d.inhalt || "" : null, d.lizenz, d.quelle, m.id]);
    if (m.sichtbarkeit !== d.sichtbarkeit) await protokolliere(q, req, "material.geteilt", "material", m.id, { sichtbarkeit: m.sichtbarkeit }, { sichtbarkeit: d.sichtbarkeit });
    return { ok: true };
  }));

  /* ---------- Versionen ---------- */
  app.post("/api/material/:id/versionen", geschuetzt(async (req, res, q) => {
    const { m } = await materialLaden(q, req.ctx, req.params.id, "material.bearbeiten");
    if (m.typ !== "datei") fehler(400, "Nur Dateien haben Versionen.");
    if (!req.isMultipart()) fehler(400, "Bitte eine Datei wählen.", "datei");
    const { datei } = await dateiLesen(req);
    if (!datei) fehler(400, "Bitte eine Datei wählen.", "datei");
    const [{ nr }] = await q("SELECT coalesce(max(nr), 0) + 1 AS nr FROM material_version WHERE material_id = $1", [m.id]);
    const v = await dateiAblegen(q, req, m.id, nr, datei);
    await protokolliere(q, req, "material.neue_version", "material", m.id, { version: m.version }, { version: v.nr });
    return v; // Freigaben bleiben bestehen: die Klasse sieht ab sofort die neue Version
  }));
  app.post("/api/material/:id/versionen/:vid/aktuell", geschuetzt(async (req, res, q) => {
    const { m } = await materialLaden(q, req.ctx, req.params.id, "material.bearbeiten");
    const [v] = await q("SELECT id, nr, text_auszug FROM material_version WHERE id = $1 AND material_id = $2", [id(req.params.vid), m.id]);
    if (!v) fehler(404, "Version nicht gefunden.");
    await q("UPDATE material SET aktuelle_version_id = $1, such_text = $2, geaendert_am = now() WHERE id = $3", [v.id, v.text_auszug, m.id]);
    await protokolliere(q, req, "material.version_zurueck", "material", m.id, { version: m.version }, { version: v.nr });
    return { ok: true };
  }));

  /* ---------- Papierkorb ---------- */
  app.delete("/api/material/:id", geschuetzt(async (req, res, q) => {
    const { m } = await materialLaden(q, req.ctx, req.params.id, "material.bearbeiten");
    await q("UPDATE material SET geloescht_am = now() WHERE id = $1", [m.id]);
    await protokolliere(q, req, "material.geloescht", "material", m.id, { titel: m.titel });
    return { ok: true };
  }));
  app.post("/api/material/:id/wiederherstellen", geschuetzt(async (req, res, q) => {
    const { m } = await materialLaden(q, req.ctx, req.params.id, "material.bearbeiten");
    await q("UPDATE material SET geloescht_am = NULL, geaendert_am = now() WHERE id = $1", [m.id]);
    return { ok: true };
  }));
  app.delete("/api/material/:id/endgueltig", geschuetzt(async (req, res, q) => {
    const { m } = await materialLaden(q, req.ctx, req.params.id, "material.bearbeiten");
    if (!m.geloescht_am) fehler(400, "Nur Material im Papierkorb kann endgültig gelöscht werden.");
    const keys = (await q("SELECT datei_key FROM material_version WHERE material_id = $1", [m.id])).map((r) => r.datei_key);
    await q("UPDATE material SET aktuelle_version_id = NULL WHERE id = $1", [m.id]);
    await q("DELETE FROM material WHERE id = $1", [m.id]);
    await protokolliere(q, req, "material.endgueltig_geloescht", "material", m.id, { titel: m.titel, versionen: keys.length });
    for (const k of keys) await speicher.loeschen(k).catch(() => {});
    return { ok: true };
  }));

  /* ---------- Öffnen und Herunterladen ---------- */
  async function abruf(q, mid, pid) {
    await q(`INSERT INTO material_abruf (material_id, person_id) VALUES ($1,$2)
      ON CONFLICT (material_id, person_id) DO UPDATE SET letztes_am = now(), anzahl = material_abruf.anzahl + 1`, [mid, pid]);
  }
  app.get("/api/material/:id/datei", geschuetzt(async (req, res, q) => {
    const { m } = await materialLaden(q, req.ctx, req.params.id);
    if (m.typ !== "datei") fehler(400, "Dieses Material ist keine Datei.");
    let v = { id: m.version_id };
    // Ältere Versionen nur für Lehrpersonen
    if (req.query.v && req.query.v !== m.version_id) { if (!istLehr(req.ctx)) fehler(404, "Version nicht gefunden."); v = { id: id(req.query.v) }; }
    const [ver] = await q("SELECT datei_key, dateiname, mime FROM material_version WHERE id = $1 AND material_id = $2", [v.id, m.id]);
    if (!ver) fehler(404, "Datei nicht gefunden.");
    if (m.besitzer_id !== req.ctx.personId) await abruf(q, m.id, req.ctx.personId);
    const inline = req.query.ansicht === "1" && INLINE.has(ver.mime);
    if (speicher.art === "s3") return res.redirect(await speicher.link(ver.datei_key, { dateiname: ver.dateiname, mime: ver.mime, inline }), 302);
    const buf = await speicher.lesen(ver.datei_key);
    res.header("Content-Type", ver.mime + (ver.mime.startsWith("text/") ? "; charset=utf-8" : ""));
    res.header("Content-Disposition", `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(ver.dateiname)}`);
    // Strenge Regeln für alles ausser PDF (der PDF-Betrachter des Browsers braucht eigene Rechte); eingebettet nur auf eigenen Seiten
    res.header("Content-Security-Policy", ver.mime === "application/pdf" ? "frame-ancestors 'self'" : "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'");
    res.header("X-Frame-Options", "SAMEORIGIN");
    res.header("Cache-Control", "private, no-store");
    return buf;
  }));
  app.get("/api/material/:id/oeffnen", geschuetzt(async (req, res, q) => {
    const { m } = await materialLaden(q, req.ctx, req.params.id);
    if (m.typ !== "link") fehler(400, "Dieses Material ist kein Link.");
    if (m.besitzer_id !== req.ctx.personId) await abruf(q, m.id, req.ctx.personId);
    return res.redirect(m.url, 302);
  }));

  /* ---------- Ordner ---------- */
  app.post("/api/ordner", geschuetzt(async (req, res, q) => {
    pruefe(req.ctx, "material.erstellen");
    const name = text(req.body && req.body.name, 80) || fehler(400, "Bitte einen Namen eingeben.", "name");
    const eltern = await ordnerPruefen(q, req.ctx, req.body.eltern_id);
    const [o] = await q("INSERT INTO ordner (besitzer_id, eltern_id, name) VALUES ($1,$2,$3) RETURNING id, name, eltern_id", [req.ctx.personId, eltern, name]);
    return o;
  }));
  app.put("/api/ordner/:id", geschuetzt(async (req, res, q) => {
    const oid = await ordnerPruefen(q, req.ctx, req.params.id);
    const name = text(req.body && req.body.name, 80) || fehler(400, "Bitte einen Namen eingeben.", "name");
    const eltern = req.body.eltern_id !== undefined ? await ordnerPruefen(q, req.ctx, req.body.eltern_id) : undefined;
    if (eltern) { // keine Schleifen: Ziel darf nicht im eigenen Unterordner liegen
      const [s] = await q(`WITH RECURSIVE u AS (SELECT id FROM ordner WHERE id = $1 UNION SELECT o.id FROM ordner o JOIN u ON o.eltern_id = u.id) SELECT 1 FROM u WHERE id = $2`, [oid, eltern]);
      if (s) fehler(400, "Ein Ordner kann nicht in sich selbst verschoben werden.");
    }
    await q(`UPDATE ordner SET name = $1${eltern !== undefined ? ", eltern_id = $3" : ""} WHERE id = $2`, eltern !== undefined ? [name, oid, eltern] : [name, oid]);
    return { ok: true };
  }));
  app.delete("/api/ordner/:id", geschuetzt(async (req, res, q) => {
    const oid = await ordnerPruefen(q, req.ctx, req.params.id);
    const [o] = await q("SELECT eltern_id FROM ordner WHERE id = $1", [oid]);
    // Inhalt wandert eine Ebene nach oben, nichts geht verloren
    await q("UPDATE material SET ordner_id = $1 WHERE ordner_id = $2", [o.eltern_id, oid]);
    await q("UPDATE ordner SET eltern_id = $1 WHERE eltern_id = $2", [o.eltern_id, oid]);
    await q("DELETE FROM ordner WHERE id = $1", [oid]);
    return { ok: true };
  }));

  /* ---------- Freigaben ---------- */
  const zeit = (x, feld) => { if (!x) return null; const d = new Date(x); if (isNaN(d)) fehler(400, "Ungültiges Datum.", feld); return d.toISOString(); };
  app.post("/api/material/:id/freigaben", geschuetzt(async (req, res, q) => {
    const { m, objekt } = await materialLaden(q, req.ctx, req.params.id);
    const b = req.body || {};
    const ids = (Array.isArray(b.unterricht_ids) ? b.unterricht_ids : [b.unterricht_id]).filter(Boolean).map(id);
    if (!ids.length) fehler(400, "Bitte mindestens eine Klasse wählen.", "unterricht_ids");
    const ab = zeit(b.ab, "ab") || new Date().toISOString(), bis = zeit(b.bis, "bis");
    if (bis && bis <= ab) fehler(400, "Das Ende muss nach dem Beginn liegen.", "bis");
    for (const uid of ids) {
      pruefe(req.ctx, "material.freigeben", { ...objekt, unterrichtId: uid });
      await q(`INSERT INTO freigabe (material_id, unterricht_id, ab, bis, hinweis, erstellt_von) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (material_id, unterricht_id) DO UPDATE SET ab = EXCLUDED.ab, bis = EXCLUDED.bis, hinweis = EXCLUDED.hinweis`, [m.id, uid, ab, bis, text(b.hinweis, 300), req.ctx.personId]);
      await protokolliere(q, req, "freigabe.erstellt", "material", m.id, null, { unterricht_id: uid, ab, bis });
    }
    return { ok: true, anzahl: ids.length };
  }));
  app.delete("/api/freigaben/:id", geschuetzt(async (req, res, q) => {
    const [f] = await q("SELECT f.id, f.material_id, f.unterricht_id, m.besitzer_id FROM freigabe f JOIN material m ON m.id = f.material_id WHERE f.id = $1", [id(req.params.id)]);
    if (!f || !(f.besitzer_id === req.ctx.personId || req.ctx.lehrt.has(f.unterricht_id))) fehler(404, "Freigabe nicht gefunden.");
    await q("DELETE FROM freigabe WHERE id = $1", [f.id]);
    await protokolliere(q, req, "freigabe.entfernt", "material", f.material_id, { unterricht_id: f.unterricht_id });
    return { ok: true };
  }));

  /* ---------- Material eines Unterrichts (Lehrperson und Klasse) ---------- */
  app.get("/api/unterricht/:uid/material", geschuetzt(async (req, res, q) => {
    const uid = id(req.params.uid), lehrt = req.ctx.lehrt.has(uid);
    if (!lehrt && !req.ctx.unterricht.has(uid)) fehler(404, "Unterricht nicht gefunden.");
    const [u] = await q(`SELECT u.id, u.gruppe, k.id AS klasse_id, k.name AS klasse, f.id AS fach_id, f.name AS fach, f.farbe FROM unterricht u JOIN klasse k ON k.id = u.klasse_id JOIN fach f ON f.id = u.fach_id WHERE u.id = $1`, [uid]);
    const rows = await q(`SELECT ${FELDER}, fr.id AS freigabe_id, fr.ab, fr.bis, fr.hinweis, a.erstes_am AS geoeffnet_am
      FROM freigabe fr JOIN material m ON m.id = fr.material_id ${JOINS}
      LEFT JOIN material_abruf a ON a.material_id = m.id AND a.person_id = $2
      WHERE fr.unterricht_id = $1 AND m.geloescht_am IS NULL ${lehrt ? "" : `AND fr.ab <= now() AND (fr.bis IS NULL OR fr.bis > now())`}
      ORDER BY fr.ab DESC`, [uid, req.ctx.personId]);
    let schueler = 0, oeffnungen = new Map();
    if (lehrt) {
      const s = await q(`SELECT person_id FROM unterricht_schueler WHERE unterricht_id = $1 UNION SELECT ks.person_id FROM klasse_schueler ks
        WHERE ks.klasse_id = $2 AND $3 = '' AND (ks.bis IS NULL OR ks.bis >= current_date)`, [uid, u.klasse_id, u.gruppe]);
      schueler = s.length;
      if (rows.length) for (const r of await q("SELECT material_id, count(*)::int AS n FROM material_abruf WHERE material_id = ANY($1) AND person_id = ANY($2) GROUP BY material_id", [rows.map((r) => r.id), s.map((x) => x.person_id)])) oeffnungen.set(r.material_id, r.n);
    }
    const extra = lehrt ? {
      faecher: await q("SELECT id, name, farbe FROM fach ORDER BY name"),
      meinUnterricht: await q(`SELECT u.id, u.gruppe, k.name AS klasse, f.name AS fach, f.farbe, f.id AS fach_id FROM unterricht u JOIN klasse k ON k.id = u.klasse_id JOIN fach f ON f.id = u.fach_id
        JOIN schuljahr j ON j.id = k.schuljahr_id WHERE u.id = ANY($1) AND j.aktiv ORDER BY k.name, f.name`, [[...req.ctx.lehrt]]),
    } : {};
    return { ...extra, unterricht: u, lehrt, schueler, eintraege: rows.map((r) => {
      const e = { ...eintrag(req.ctx, r), freigabe_id: r.freigabe_id, ab: r.ab, bis: r.bis, hinweis: r.hinweis, neu: !r.geoeffnet_am && r.besitzer_id !== req.ctx.personId };
      if (lehrt) { e.geoeffnet = oeffnungen.get(r.id) || 0; e.aktiv = new Date(r.ab) <= new Date() && (!r.bis || new Date(r.bis) > new Date()); }
      else { delete e.besitzer_id; delete e.ordner_id; delete e.sichtbarkeit; }
      return e;
    }) };
  }));

  /* ---------- Schülerinnen und Schüler: alles Material, nach Fach ---------- */
  app.get("/api/mein-material", geschuetzt(async (req, res, q) => {
    const such = suchAnfrage(req.query.suche);
    const p = [[...req.ctx.unterricht], req.ctx.personId];
    let filter = "", rang = "fr.ab DESC";
    if (such) { p.push(such); filter = `AND (m.suche @@ to_tsquery('german', $3) OR lower(m.titel) LIKE $4)`; p.push("%" + String(req.query.suche).toLowerCase().trim().slice(0, 60).replace(/[%_\\]/g, "") + "%"); rang = "ts_rank(m.suche, to_tsquery('german', $3)) DESC"; }
    const rows = await q(`SELECT DISTINCT ON (m.id) ${FELDER}, fr.ab, fr.hinweis, fr.unterricht_id, fu.name AS unterricht_fach, fu.farbe AS unterricht_farbe, a.erstes_am AS geoeffnet_am
      FROM freigabe fr JOIN material m ON m.id = fr.material_id ${JOINS}
      JOIN unterricht u ON u.id = fr.unterricht_id JOIN fach fu ON fu.id = u.fach_id
      LEFT JOIN material_abruf a ON a.material_id = m.id AND a.person_id = $2
      WHERE fr.unterricht_id = ANY($1) AND m.geloescht_am IS NULL AND fr.ab <= now() AND (fr.bis IS NULL OR fr.bis > now()) ${filter}
      ORDER BY m.id, fr.ab DESC`, p);
    rows.sort(such ? () => 0 : (a, b) => new Date(b.ab) - new Date(a.ab));
    const faecher = new Map();
    for (const r of rows) {
      const k = r.unterricht_id;
      if (!faecher.has(k)) faecher.set(k, { unterricht_id: k, fach: r.unterricht_fach, farbe: r.unterricht_farbe, eintraege: [] });
      const e = eintrag(req.ctx, r); delete e.besitzer_id; delete e.ordner_id; delete e.sichtbarkeit;
      faecher.get(k).eintraege.push({ ...e, ab: r.ab, hinweis: r.hinweis, neu: !r.geoeffnet_am });
    }
    return { faecher: [...faecher.values()].sort((a, b) => a.fach.localeCompare(b.fach, "de")), anzahl: rows.length, neu: rows.filter((r) => !r.geoeffnet_am).length };
  }));
}
