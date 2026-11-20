// Kursnotizbuch (Sheaf) pro Unterricht.
//   Bereiche: Inhaltsbibliothek (Lehrperson schreibt, Klasse liest), Zusammenarbeit (alle schreiben),
//   Lehrkräfte (nur Lehrpersonen), eigener Bereich je Schüler/in (die Person und ihre Lehrpersonen).
//   Erlaubt oder gesperrt für Schüler/innen, in dieser Reihenfolge:
//     1. laufende Prüfung: nur das Notizbuch dieses Unterrichts, nur wenn die Prüfung es erlaubt (ohne Zusammenarbeitsbereich)
//     2. laufende Lektion: nur das Notizbuch dieses Unterrichts, nur wenn die Lektion es erlaubt
//     3. sonst die Grundeinstellung des Unterrichts
//   Lehrpersonen haben in ihrem Unterricht immer Zugriff. Die Administration sieht keine Notizen.
import { geschuetzt } from "../sitzung.mjs";
import { fehler } from "../fehler.mjs";
import { protokolliere } from "../protokoll.mjs";
import { darf } from "@schule/shared";
import { speicher, neuerKey } from "../material/speicher.mjs";
import { dateiart, sauberName, inhaltPasst, MAX_GROESSE, INLINE } from "../material/dateien.mjs";
import { schuelerVon } from "./durchfuehrung.mjs";

const id = (x) => (/^[0-9a-f-]{36}$/.test(String(x || "")) ? x : fehler(400, "Ungültige Kennung."));
const optId = (x) => (x ? id(x) : null);
const text = (x, max) => (x == null ? "" : String(x).trim().slice(0, max));
const farbe = (x, alt = "#3E8EED") => (/^#[0-9A-Fa-f]{6}$/.test(String(x || "")) ? x : alt);
const zahl = (x, alt = 0) => (Number.isFinite(Number(x)) ? Number(x) : alt);
const BEREICHE = ["bibliothek", "gemeinsam", "lehrkraefte", "schueler"];
const LAUFEND = "l.beendet_am IS NULL AND l.gestartet_am > now() - interval '6 hours'";
const GROSS = { bodyLimit: 30 * 1024 * 1024 };

/* ---------- Zugang ---------- */
export async function zugang(q, ctx, uid) {
  if (darf(ctx, "notizbuch.leiten", { unterrichtId: uid })) return { rolle: "lp", erlaubt: true, modus: "normal" };
  if (!darf(ctx, "notizbuch.teilnehmen", { unterrichtId: uid })) fehler(404, "Notizbuch nicht gefunden.");
  const [p] = await q(`SELECT p.unterricht_id, p.einstellungen FROM versuch v JOIN pruefung p ON p.id = v.pruefung_id
    WHERE v.schueler_id = $1 AND v.status = 'laeuft' AND p.status = 'laeuft' LIMIT 1`, [ctx.personId]);
  if (p) {
    if (p.unterricht_id === uid && p.einstellungen && p.einstellungen.notizbuch) return { rolle: "sch", erlaubt: true, modus: "pruefung" };
    return { rolle: "sch", erlaubt: false, modus: "pruefung", grund: "Während der Prüfung ist das Kursnotizbuch gesperrt." };
  }
  const lekt = await q(`SELECT l.unterricht_id, l.notizbuch FROM lektion l WHERE l.unterricht_id = ANY($1) AND ${LAUFEND}`, [[...ctx.unterricht]]);
  if (lekt.length) {
    const l = lekt.find((x) => x.unterricht_id === uid);
    if (!l) return { rolle: "sch", erlaubt: false, modus: "lektion", grund: "Während der Lektion ist nur das Kursnotizbuch dieses Fachs offen." };
    return l.notizbuch ? { rolle: "sch", erlaubt: true, modus: "lektion" } : { rolle: "sch", erlaubt: false, modus: "lektion", grund: "Ihre Lehrperson hat das Kursnotizbuch für diese Lektion gesperrt." };
  }
  const [u] = await q("SELECT notizbuch FROM unterricht WHERE id = $1", [uid]);
  return u && u.notizbuch ? { rolle: "sch", erlaubt: true, modus: "normal" } : { rolle: "sch", erlaubt: false, modus: "normal", grund: "Ihre Lehrperson hat das Kursnotizbuch für diese Klasse gesperrt." };
}
const offenOderFehler = (z) => { if (!z.erlaubt) fehler(403, z.grund); return z; };

function darfLesen(z, a, ctx) {
  if (z.rolle === "lp") return true;
  if (a.bereich === "bibliothek") return true;
  if (a.bereich === "gemeinsam") return z.modus !== "pruefung";
  if (a.bereich === "schueler") return a.besitzer_id === ctx.personId;
  return false;
}
function darfSchreiben(z, a, ctx) {
  if (z.rolle === "lp") return true;
  if (a.bereich === "gemeinsam") return z.modus !== "pruefung";
  if (a.bereich === "schueler") return a.besitzer_id === ctx.personId;
  return false;
}

export async function abschnitt(q, ctx, aid, schreiben = false) {
  const [a] = await q("SELECT * FROM notiz_abschnitt WHERE id = $1 AND geloescht_am IS NULL", [id(aid)]);
  if (!a) fehler(404, "Abschnitt nicht gefunden.");
  const z = offenOderFehler(await zugang(q, ctx, a.unterricht_id));
  if (!darfLesen(z, a, ctx)) fehler(404, "Abschnitt nicht gefunden.");
  if (schreiben && !darfSchreiben(z, a, ctx)) fehler(403, "Hier dürfen Sie nur lesen.");
  return { a, z };
}
async function seite(q, ctx, sid, schreiben = false) {
  const [s] = await q("SELECT * FROM notiz_seite WHERE id = $1 AND geloescht_am IS NULL", [id(sid)]);
  if (!s) fehler(404, "Seite nicht gefunden.");
  const r = await abschnitt(q, ctx, s.abschnitt_id, schreiben);
  return { s, ...r };
}

async function unterrichtInfo(q, uid) {
  const [u] = await q(`SELECT u.id, u.gruppe, u.notizbuch, k.name AS klasse, f.name AS fach, f.farbe FROM unterricht u
    JOIN klasse k ON k.id = u.klasse_id JOIN fach f ON f.id = u.fach_id WHERE u.id = $1`, [uid]);
  if (!u) fehler(404, "Notizbuch nicht gefunden.");
  return u;
}

// Inhalt prüfen: nur bekannte Felder, Grössen begrenzt
function inhaltLesen(x) {
  if (!x || typeof x !== "object") fehler(400, "Ungültiger Inhalt.");
  const items = Array.isArray(x.items) ? x.items.slice(0, 2000) : [];
  const strokes = Array.isArray(x.strokes) ? x.strokes.slice(0, 20000) : [];
  const bg = x.bg && typeof x.bg === "object" ? { color: text(x.bg.color, 9), rule: text(x.bg.rule, 12) } : {};
  return { items, strokes, bg };
}
const seitenMeta = (s) => ({ id: s.id, titel: s.titel, ebene: s.ebene, reihenfolge: s.reihenfolge, geaendert_am: s.geaendert_am, erstellt_am: s.erstellt_am, vorschau: (s.text || "").slice(0, 120) });

// Abschnitte als Baum, mit Seiten (ohne Inhalt)
async function baum(q, uid, bedingung, params) {
  const abschnitte = await q(`SELECT * FROM notiz_abschnitt a WHERE a.unterricht_id = $1 AND a.geloescht_am IS NULL AND ${bedingung} ORDER BY a.reihenfolge, a.erstellt_am`, [uid, ...params]);
  const ids = abschnitte.map((a) => a.id);
  const seiten = ids.length ? await q(`SELECT id, abschnitt_id, titel, ebene, reihenfolge, geaendert_am, erstellt_am, left(text, 120) AS text FROM notiz_seite
    WHERE abschnitt_id = ANY($1) AND geloescht_am IS NULL ORDER BY reihenfolge, erstellt_am`, [ids]) : [];
  const knoten = new Map(abschnitte.map((a) => [a.id, { id: a.id, art: a.art, name: a.name, farbe: a.farbe, offen: a.offen, reihenfolge: a.reihenfolge, bereich: a.bereich, besitzer_id: a.besitzer_id, eltern_id: a.eltern_id, kinder: a.art === "gruppe" ? [] : undefined, seiten: a.art === "abschnitt" ? [] : undefined }]));
  for (const s of seiten) { const k = knoten.get(s.abschnitt_id); if (k && k.seiten) k.seiten.push(seitenMeta(s)); }
  const wurzel = [];
  for (const k of knoten.values()) { const e = k.eltern_id && knoten.get(k.eltern_id); (e && e.kinder ? e.kinder : wurzel).push(k); }
  return wurzel;
}

export default async function (app) {
  /* ---------- Übersicht ---------- */
  app.get("/api/notizbuecher", geschuetzt(async (req, res, q) => {
    const ids = [...req.ctx.unterricht];
    if (!ids.length) return { notizbuecher: [] };
    const liste = await q(`SELECT u.id, u.gruppe, u.notizbuch, k.name AS klasse, f.name AS fach, f.farbe,
      (SELECT max(s.geaendert_am) FROM notiz_seite s JOIN notiz_abschnitt a ON a.id = s.abschnitt_id WHERE a.unterricht_id = u.id AND s.geloescht_am IS NULL
        AND (a.bereich <> 'schueler' OR a.besitzer_id = $2)) AS zuletzt
      FROM unterricht u JOIN klasse k ON k.id = u.klasse_id JOIN fach f ON f.id = u.fach_id WHERE u.id = ANY($1) ORDER BY f.name, k.name`, [ids, req.ctx.personId]);
    const out = [];
    for (const u of liste) {
      if (!darf(req.ctx, "notizbuch.leiten", { unterrichtId: u.id }) && !darf(req.ctx, "notizbuch.teilnehmen", { unterrichtId: u.id })) continue;
      const z = await zugang(q, req.ctx, u.id);
      out.push({ ...u, rolle: z.rolle, erlaubt: z.erlaubt, grund: z.grund || null, modus: z.modus });
    }
    return { notizbuecher: out };
  }));

  app.get("/api/notizbuch/:uid", geschuetzt(async (req, res, q) => {
    const uid = id(req.params.uid);
    const z = await zugang(q, req.ctx, uid);
    const u = await unterrichtInfo(q, uid);
    if (!z.erlaubt) return { unterricht: u, rolle: z.rolle, erlaubt: false, grund: z.grund, modus: z.modus, bereiche: [] };
    const me = req.ctx.personId, lp = z.rolle === "lp";
    const bereiche = [];
    bereiche.push({ bereich: "bibliothek", name: "Inhaltsbibliothek", schreiben: lp, abschnitte: await baum(q, uid, "a.bereich = 'bibliothek'", []) });
    if (z.modus !== "pruefung") bereiche.push({ bereich: "gemeinsam", name: "Zusammenarbeit", schreiben: true, abschnitte: await baum(q, uid, "a.bereich = 'gemeinsam'", []) });
    if (lp) {
      bereiche.push({ bereich: "lehrkraefte", name: "Nur Lehrpersonen", schreiben: true, abschnitte: await baum(q, uid, "a.bereich = 'lehrkraefte'", []) });
      const sch = await schuelerVon(q, uid);
      const alle = await baum(q, uid, "a.bereich = 'schueler' AND a.besitzer_id = ANY($2)", [sch.map((s) => s.id)]);
      for (const s of sch) bereiche.push({ bereich: "schueler", besitzer_id: s.id, name: `${s.vorname} ${s.nachname}`, schreiben: true, abschnitte: alle.filter((a) => a.besitzer_id === s.id) });
    } else {
      bereiche.push({ bereich: "schueler", besitzer_id: me, name: "Mein Bereich", schreiben: true, abschnitte: await baum(q, uid, "a.bereich = 'schueler' AND a.besitzer_id = $2", [me]) });
    }
    return { unterricht: u, rolle: z.rolle, erlaubt: true, modus: z.modus, bereiche };
  }));

  /* ---------- Erlauben / sperren (dauerhaft pro Unterricht) ---------- */
  app.put("/api/unterricht/:uid/notizbuch", geschuetzt(async (req, res, q) => {
    const uid = id(req.params.uid);
    if (!darf(req.ctx, "notizbuch.leiten", { unterrichtId: uid })) fehler(404, "Unterricht nicht gefunden.");
    const erlaubt = !!(req.body && req.body.erlaubt);
    await q("UPDATE unterricht SET notizbuch = $1, geaendert_am = now() WHERE id = $2", [erlaubt, uid]);
    await protokolliere(q, req, erlaubt ? "notizbuch.erlaubt" : "notizbuch.gesperrt", "unterricht", uid);
    return { erlaubt };
  }));

  /* ---------- Seiten ---------- */
  app.get("/api/notizbuch/seiten/:sid", geschuetzt(async (req, res, q) => {
    const { s, a, z } = await seite(q, req.ctx, req.params.sid);
    return { id: s.id, abschnitt_id: s.abschnitt_id, titel: s.titel, ebene: s.ebene, inhalt: s.inhalt, version: s.version,
      erstellt_am: s.erstellt_am, geaendert_am: s.geaendert_am, schreiben: darfSchreiben(z, a, req.ctx) };
  }));

  app.put("/api/notizbuch/seiten/:sid", { ...GROSS }, geschuetzt(async (req, res, q) => {
    const b = req.body || {};
    const { s } = await seite(q, req.ctx, req.params.sid, true);
    if (b.inhalt !== undefined && b.version !== undefined && Number(b.version) !== s.version) {
      return res.status(409).send({ fehler: "Diese Seite wurde inzwischen von jemand anderem geändert.", aktuell: { titel: s.titel, inhalt: s.inhalt, version: s.version } });
    }
    const titel = b.titel !== undefined ? text(b.titel, 300) : s.titel;
    const inhalt = b.inhalt !== undefined ? inhaltLesen(b.inhalt) : s.inhalt;
    const t = b.text !== undefined ? String(b.text).slice(0, 100000) : s.text;
    const [n] = await q(`UPDATE notiz_seite SET titel = $1, inhalt = $2, text = $3, version = version + 1, geaendert_am = now(), geaendert_von = $4
      WHERE id = $5 RETURNING version, geaendert_am`, [titel, JSON.stringify(inhalt), t, req.ctx.personId, s.id]);
    return n;
  }));

  app.post("/api/notizbuch/abschnitte/:aid/seiten", geschuetzt(async (req, res, q) => {
    const { a } = await abschnitt(q, req.ctx, req.params.aid, true);
    if (a.art !== "abschnitt") fehler(400, "Seiten gehören in einen Abschnitt, nicht in eine Gruppe.");
    const b = req.body || {};
    const [m] = await q("SELECT coalesce(max(reihenfolge), 0) AS m FROM notiz_seite WHERE abschnitt_id = $1 AND geloescht_am IS NULL", [a.id]);
    const [s] = await q(`INSERT INTO notiz_seite (abschnitt_id, titel, ebene, reihenfolge, geaendert_von) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [a.id, text(b.titel, 300), Math.max(0, Math.min(2, zahl(b.ebene))), b.reihenfolge !== undefined ? zahl(b.reihenfolge) : m.m + 1, req.ctx.personId]);
    return { ...seitenMeta(s), version: s.version, inhalt: s.inhalt };
  }));

  // Ort einer Seite: Reihenfolge, Ebene, anderer Abschnitt
  app.put("/api/notizbuch/seiten/:sid/ort", geschuetzt(async (req, res, q) => {
    const b = req.body || {};
    const { s, a } = await seite(q, req.ctx, req.params.sid, true);
    let ziel = a;
    if (b.abschnitt_id && b.abschnitt_id !== a.id) {
      ziel = (await abschnitt(q, req.ctx, b.abschnitt_id, true)).a;
      if (ziel.art !== "abschnitt" || ziel.unterricht_id !== a.unterricht_id) fehler(400, "Dorthin lässt sich die Seite nicht verschieben.");
      // Bilder und Anhänge ziehen mit, damit sie lesbar bleiben, wer die Seite am neuen Ort sieht
      const ids = [...new Set(JSON.stringify(s.inhalt).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) || [])];
      if (ids.length) await q("UPDATE notiz_datei SET abschnitt_id = $1 WHERE abschnitt_id = $2 AND id = ANY($3)", [ziel.id, a.id, ids]);
    }
    await q("UPDATE notiz_seite SET abschnitt_id = $1, reihenfolge = $2, ebene = $3 WHERE id = $4",
      [ziel.id, b.reihenfolge !== undefined ? zahl(b.reihenfolge) : s.reihenfolge, b.ebene !== undefined ? Math.max(0, Math.min(2, zahl(b.ebene))) : s.ebene, s.id]);
    return { ok: true };
  }));

  app.delete("/api/notizbuch/seiten/:sid", geschuetzt(async (req, res, q) => {
    const { s } = await seite(q, req.ctx, req.params.sid, true);
    await q("UPDATE notiz_seite SET geloescht_am = now() WHERE id = $1", [s.id]);
    return { ok: true };
  }));

  /* ---------- Abschnitte und Gruppen ---------- */
  app.post("/api/notizbuch/:uid/abschnitte", geschuetzt(async (req, res, q) => {
    const uid = id(req.params.uid), b = req.body || {};
    const z = offenOderFehler(await zugang(q, req.ctx, uid));
    const bereich = BEREICHE.includes(b.bereich) ? b.bereich : fehler(400, "Unbekannter Bereich.");
    let besitzer = null;
    if (bereich === "schueler") {
      besitzer = z.rolle === "lp" ? id(b.besitzer_id) : req.ctx.personId;
      if (z.rolle === "lp" && !(await schuelerVon(q, uid)).some((s) => s.id === besitzer)) fehler(400, "Diese Person ist nicht in der Klasse.");
    }
    const a0 = { bereich, besitzer_id: besitzer };
    if (!darfSchreiben(z, a0, req.ctx)) fehler(403, "Hier dürfen Sie nur lesen.");
    const eltern = optId(b.eltern_id);
    if (eltern) {
      const [e] = await q("SELECT * FROM notiz_abschnitt WHERE id = $1 AND geloescht_am IS NULL", [eltern]);
      if (!e || e.art !== "gruppe" || e.unterricht_id !== uid || e.bereich !== bereich || e.besitzer_id !== besitzer) fehler(400, "Diese Gruppe gibt es hier nicht.");
    }
    const art = b.art === "gruppe" ? "gruppe" : "abschnitt";
    const quelle = text(b.quelle, 200) || null;
    // Import wiederholt oder fortgesetzt: denselben Abschnitt (gleiche Herkunft, gleicher Ort) weiterverwenden
    if (quelle) {
      const [v] = await q(`SELECT * FROM notiz_abschnitt WHERE unterricht_id = $1 AND bereich = $2 AND besitzer_id IS NOT DISTINCT FROM $3
        AND quelle = $4 AND art = $5 AND eltern_id IS NOT DISTINCT FROM $6 AND geloescht_am IS NULL LIMIT 1`, [uid, bereich, besitzer, quelle, art, eltern]);
      if (v) return { id: v.id, art, name: v.name, farbe: v.farbe, reihenfolge: v.reihenfolge, eltern_id: v.eltern_id, bereich, besitzer_id: besitzer, offen: v.offen, vorhanden: true };
    }
    const [m] = await q("SELECT coalesce(max(reihenfolge), 0) AS m FROM notiz_abschnitt WHERE unterricht_id = $1 AND bereich = $2 AND besitzer_id IS NOT DISTINCT FROM $3", [uid, bereich, besitzer]);
    const [a] = await q(`INSERT INTO notiz_abschnitt (unterricht_id, bereich, besitzer_id, eltern_id, art, name, farbe, reihenfolge, offen, quelle)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [uid, bereich, besitzer, eltern, art, text(b.name, 120) || (art === "gruppe" ? "Neue Gruppe" : "Neuer Abschnitt"), farbe(b.farbe), b.reihenfolge !== undefined ? zahl(b.reihenfolge) : m.m + 1, b.offen !== false, quelle]);
    let erste = null;
    if (art === "abschnitt" && b.ohneSeite !== true) [erste] = await q("INSERT INTO notiz_seite (abschnitt_id, geaendert_von) VALUES ($1,$2) RETURNING *", [a.id, req.ctx.personId]);
    return { id: a.id, art, name: a.name, farbe: a.farbe, reihenfolge: a.reihenfolge, eltern_id: a.eltern_id, bereich, besitzer_id: besitzer, offen: a.offen,
      kinder: art === "gruppe" ? [] : undefined, seiten: art === "abschnitt" ? (erste ? [seitenMeta(erste)] : []) : undefined };
  }));

  app.put("/api/notizbuch/abschnitte/:aid", geschuetzt(async (req, res, q) => {
    const b = req.body || {};
    const { a } = await abschnitt(q, req.ctx, req.params.aid, true);
    let eltern = a.eltern_id;
    if (b.eltern_id !== undefined) {
      eltern = optId(b.eltern_id);
      if (eltern) {
        const [e] = await q("SELECT * FROM notiz_abschnitt WHERE id = $1 AND geloescht_am IS NULL", [eltern]);
        if (!e || e.art !== "gruppe" || e.unterricht_id !== a.unterricht_id || e.bereich !== a.bereich || e.besitzer_id !== a.besitzer_id) fehler(400, "Dorthin lässt sich das nicht verschieben.");
        // nicht in sich selbst
        const [kreis] = await q(`WITH RECURSIVE k AS (SELECT id, eltern_id FROM notiz_abschnitt WHERE id = $1 UNION ALL SELECT n.id, n.eltern_id FROM notiz_abschnitt n JOIN k ON n.id = k.eltern_id) SELECT 1 FROM k WHERE id = $2`, [eltern, a.id]);
        if (kreis) fehler(400, "Eine Gruppe kann nicht in sich selbst liegen.");
      }
    }
    await q("UPDATE notiz_abschnitt SET name = $1, farbe = $2, offen = $3, eltern_id = $4, reihenfolge = $5, geaendert_am = now() WHERE id = $6",
      [b.name !== undefined ? text(b.name, 120) || a.name : a.name, b.farbe !== undefined ? farbe(b.farbe, a.farbe) : a.farbe, b.offen !== undefined ? !!b.offen : a.offen,
        eltern, b.reihenfolge !== undefined ? zahl(b.reihenfolge) : a.reihenfolge, a.id]);
    return { ok: true };
  }));

  app.delete("/api/notizbuch/abschnitte/:aid", geschuetzt(async (req, res, q) => {
    const { a } = await abschnitt(q, req.ctx, req.params.aid, true);
    await q(`WITH RECURSIVE k AS (SELECT id FROM notiz_abschnitt WHERE id = $1 UNION ALL SELECT n.id FROM notiz_abschnitt n JOIN k ON n.eltern_id = k.id)
      UPDATE notiz_abschnitt SET geloescht_am = now() WHERE id IN (SELECT id FROM k) AND geloescht_am IS NULL`, [a.id]);
    return { ok: true };
  }));

  /* ---------- Papierkorb (30 Tage) ---------- */
  app.get("/api/notizbuch/:uid/papierkorb", geschuetzt(async (req, res, q) => {
    const uid = id(req.params.uid);
    const z = offenOderFehler(await zugang(q, req.ctx, uid));
    const lp = z.rolle === "lp", me = req.ctx.personId;
    const sicht = lp ? "TRUE" : "((a.bereich = 'schueler' AND a.besitzer_id = $2) OR a.bereich = 'gemeinsam')";
    const params = lp ? [uid] : [uid, me];
    const abschnitte = await q(`SELECT a.id, a.name, a.art, a.bereich, a.geloescht_am FROM notiz_abschnitt a WHERE a.unterricht_id = $1 AND a.geloescht_am > now() - interval '30 days'
      AND (a.eltern_id IS NULL OR (SELECT e.geloescht_am FROM notiz_abschnitt e WHERE e.id = a.eltern_id) IS DISTINCT FROM a.geloescht_am) AND ${sicht} ORDER BY a.geloescht_am DESC LIMIT 200`, params);
    const seiten = await q(`SELECT s.id, s.titel, a.name AS abschnitt, s.geloescht_am FROM notiz_seite s JOIN notiz_abschnitt a ON a.id = s.abschnitt_id
      WHERE a.unterricht_id = $1 AND a.geloescht_am IS NULL AND s.geloescht_am > now() - interval '30 days' AND ${sicht} ORDER BY s.geloescht_am DESC LIMIT 200`, params);
    return { abschnitte, seiten };
  }));
  app.post("/api/notizbuch/wiederherstellen", geschuetzt(async (req, res, q) => {
    const b = req.body || {};
    if (b.seite_id) {
      const [s] = await q("SELECT * FROM notiz_seite WHERE id = $1", [id(b.seite_id)]);
      if (!s) fehler(404, "Nicht gefunden.");
      await abschnitt(q, req.ctx, s.abschnitt_id, true);
      await q("UPDATE notiz_seite SET geloescht_am = NULL WHERE id = $1", [s.id]);
    } else {
      const [a] = await q("SELECT * FROM notiz_abschnitt WHERE id = $1", [id(b.abschnitt_id)]);
      if (!a) fehler(404, "Nicht gefunden.");
      const z = offenOderFehler(await zugang(q, req.ctx, a.unterricht_id));
      if (!darfSchreiben(z, a, req.ctx)) fehler(403, "Hier dürfen Sie nur lesen.");
      await q(`WITH RECURSIVE k AS (SELECT id FROM notiz_abschnitt WHERE id = $1 UNION ALL SELECT n.id FROM notiz_abschnitt n JOIN k ON n.eltern_id = k.id)
        UPDATE notiz_abschnitt SET geloescht_am = NULL WHERE id IN (SELECT id FROM k) AND geloescht_am = (SELECT geloescht_am FROM notiz_abschnitt WHERE id = $1)`, [a.id]);
      if (a.eltern_id) await q("UPDATE notiz_abschnitt SET eltern_id = NULL WHERE id = $1 AND (SELECT geloescht_am FROM notiz_abschnitt WHERE id = $2) IS NOT NULL", [a.id, a.eltern_id]);
    }
    return { ok: true };
  }));

  /* ---------- Seite an alle verteilen (Lehrperson) ---------- */
  app.post("/api/notizbuch/:uid/verteilen", geschuetzt(async (req, res, q) => {
    const uid = id(req.params.uid), b = req.body || {};
    if (!darf(req.ctx, "notizbuch.leiten", { unterrichtId: uid })) fehler(404, "Notizbuch nicht gefunden.");
    const { s, a } = await seite(q, req.ctx, b.seite_id);
    if (a.unterricht_id !== uid) fehler(400, "Diese Seite gehört zu einem anderen Notizbuch.");
    const name = text(b.abschnitt, 120) || "Aufträge";
    const schueler = b.schueler && Array.isArray(b.schueler) && b.schueler.length ? (await schuelerVon(q, uid)).filter((x) => b.schueler.includes(x.id)) : await schuelerVon(q, uid);
    for (const p of schueler) {
      let [z] = await q("SELECT id FROM notiz_abschnitt WHERE unterricht_id = $1 AND bereich = 'schueler' AND besitzer_id = $2 AND name = $3 AND art = 'abschnitt' AND geloescht_am IS NULL LIMIT 1", [uid, p.id, name]);
      if (!z) {
        const [m] = await q("SELECT coalesce(max(reihenfolge), 0) AS m FROM notiz_abschnitt WHERE unterricht_id = $1 AND bereich = 'schueler' AND besitzer_id = $2", [uid, p.id]);
        [z] = await q("INSERT INTO notiz_abschnitt (unterricht_id, bereich, besitzer_id, art, name, farbe, reihenfolge) VALUES ($1,'schueler',$2,'abschnitt',$3,$4,$5) RETURNING id", [uid, p.id, name, farbe(b.farbe, "#E8B931"), m.m + 1]);
      }
      const [r] = await q("SELECT coalesce(max(reihenfolge), 0) AS m FROM notiz_seite WHERE abschnitt_id = $1", [z.id]);
      await q("INSERT INTO notiz_seite (abschnitt_id, titel, ebene, reihenfolge, inhalt, text, geaendert_von, verteilt_von) VALUES ($1,$2,0,$3,$4,$5,$6,$7)",
        [z.id, s.titel, r.m + 1, JSON.stringify(s.inhalt), s.text, req.ctx.personId, s.id]);
    }
    await protokolliere(q, req, "notizbuch.verteilt", "notiz_seite", s.id);
    return { anzahl: schueler.length, abschnitt: name };
  }));

  /* ---------- Dateien (Bilder, Anhänge) ---------- */
  app.post("/api/notizbuch/abschnitte/:aid/dateien", geschuetzt(async (req, res, q) => {
    const { a } = await abschnitt(q, req.ctx, req.params.aid, true);
    let datei = null;
    for await (const part of req.parts({ limits: { fileSize: MAX_GROESSE, files: 1 } })) {
      if (part.type === "file") { const buf = await part.toBuffer(); if (part.file.truncated) fehler(413, "Die Datei ist grösser als 50 MB."); datei = { buf, name: sauberName(part.filename) }; }
    }
    if (!datei) fehler(400, "Keine Datei erhalten.");
    return dateiAblegen(q, req, a, datei);
  }));

  app.get("/api/notizbuch/dateien/:fid", geschuetzt(async (req, res, q) => {
    const [f] = await q("SELECT * FROM notiz_datei WHERE id = $1", [id(req.params.fid)]);
    if (!f) fehler(404, "Datei nicht gefunden.");
    // Kopien verteilter Seiten zeigen auf Dateien der Bibliothek: lesbar, wer die Bibliothek lesen darf
    await abschnitt(q, req.ctx, f.abschnitt_id);
    const inline = req.query.ansicht === "1" && INLINE.has(f.mime);
    if (speicher.art === "s3") return res.redirect(await speicher.link(f.speicher_key, { dateiname: f.dateiname, mime: f.mime, inline }), 302);
    const buf = await speicher.lesen(f.speicher_key);
    res.header("Content-Type", f.mime + (f.mime.startsWith("text/") ? "; charset=utf-8" : ""));
    res.header("Content-Disposition", `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.dateiname)}`);
    res.header("Content-Security-Policy", f.mime === "application/pdf" ? "frame-ancestors 'self'" : "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'");
    res.header("X-Frame-Options", "SAMEORIGIN");
    res.header("Cache-Control", "private, max-age=86400");
    return buf;
  }));

  /* ---------- Import (aus OneNote oder Dateien): ein Abschnitt mit allen Seiten ---------- */
  app.post("/api/notizbuch/abschnitte/:aid/seiten-import", { ...GROSS }, geschuetzt(async (req, res, q) => {
    const { a } = await abschnitt(q, req.ctx, req.params.aid, true);
    const seiten = Array.isArray(req.body && req.body.seiten) ? req.body.seiten.slice(0, 2000) : fehler(400, "Keine Seiten erhalten.");
    const dat = (x) => (x && !isNaN(new Date(x)) ? new Date(x).toISOString() : new Date().toISOString());
    const [m] = await q("SELECT coalesce(max(reihenfolge), 0) AS m FROM notiz_seite WHERE abschnitt_id = $1", [a.id]);
    let r = m.m, neu = 0, aktualisiert = 0, uebersprungen = 0;
    for (const s of seiten) {
      const quelle = text(s.quelle, 200) || null;
      const reihe = s.reihenfolge !== undefined ? zahl(s.reihenfolge) : (r += 1);
      const werte = [text(s.titel, 300), Math.max(0, Math.min(2, zahl(s.ebene))), reihe, JSON.stringify(inhaltLesen(s.inhalt || {})), String(s.text || "").slice(0, 100000), dat(s.erstellt_am), dat(s.geaendert_am)];
      if (quelle) {
        const [v] = await q("SELECT id, version, geaendert_am FROM notiz_seite WHERE abschnitt_id = $1 AND quelle = $2 AND geloescht_am IS NULL LIMIT 1", [a.id, quelle]);
        if (v) {
          // In OneNote geändert und in RESCOOL noch nie bearbeitet: neue Fassung übernehmen; sonst die Seite in RESCOOL lassen
          if (v.version === 1 && new Date(werte[6]) > new Date(v.geaendert_am)) {
            await q("UPDATE notiz_seite SET titel = $1, ebene = $2, reihenfolge = $3, inhalt = $4, text = $5, geaendert_am = $6 WHERE id = $7", [werte[0], werte[1], werte[2], werte[3], werte[4], werte[6], v.id]);
            aktualisiert += 1;
          } else uebersprungen += 1;
          continue;
        }
      }
      await q(`INSERT INTO notiz_seite (abschnitt_id, titel, ebene, reihenfolge, inhalt, text, erstellt_am, geaendert_am, geaendert_von, quelle) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [a.id, ...werte, req.ctx.personId, quelle]);
      neu += 1;
    }
    return { anzahl: neu + aktualisiert, neu, aktualisiert, uebersprungen };
  }));

  /* ---------- Was aus OneNote schon da ist (Herkunft -> Änderungszeit), damit ein wiederholter Import nur Neues liest ---------- */
  app.get("/api/notizbuch/:uid/quellen", geschuetzt(async (req, res, q) => {
    const uid = id(req.params.uid);
    const z = offenOderFehler(await zugang(q, req.ctx, uid));
    const bereich = BEREICHE.includes(req.query.bereich) ? req.query.bereich : fehler(400, "Unbekannter Bereich.");
    const besitzer = bereich === "schueler" ? (z.rolle === "lp" ? id(req.query.besitzer_id) : req.ctx.personId) : null;
    if (!darfLesen(z, { bereich, besitzer_id: besitzer }, req.ctx)) fehler(404, "Notizbuch nicht gefunden.");
    const zeilen = await q(`SELECT s.quelle, s.geaendert_am FROM notiz_seite s JOIN notiz_abschnitt a ON a.id = s.abschnitt_id
      WHERE a.unterricht_id = $1 AND a.bereich = $2 AND a.besitzer_id IS NOT DISTINCT FROM $3 AND a.geloescht_am IS NULL AND s.geloescht_am IS NULL AND s.quelle IS NOT NULL`, [uid, bereich, besitzer]);
    return { seiten: Object.fromEntries(zeilen.map((x) => [x.quelle, x.geaendert_am])) };
  }));

  /* ---------- Aufgaben und Tags (Seiten mit Tags, die man lesen darf) ---------- */
  app.get("/api/notizbuch/:uid/tags", geschuetzt(async (req, res, q) => {
    const uid = id(req.params.uid);
    const z = offenOderFehler(await zugang(q, req.ctx, uid));
    const params = [uid];
    let sicht = "TRUE";
    if (z.rolle !== "lp") { params.push(req.ctx.personId); sicht = `(a.bereich = 'bibliothek' ${z.modus !== "pruefung" ? "OR a.bereich = 'gemeinsam'" : ""} OR (a.bereich = 'schueler' AND a.besitzer_id = $2))`; }
    else if (req.query.bereich) { params.push(String(req.query.bereich)); sicht = `a.bereich = $2`; }
    const seiten = await q(`SELECT s.id, s.titel, a.name AS abschnitt, a.farbe, a.bereich,
        (SELECT coalesce(jsonb_agg(i->'html'), '[]'::jsonb) FROM jsonb_array_elements(s.inhalt->'items') i WHERE i->>'type' = 'text' AND i->>'html' LIKE '%class="tg"%') AS html
      FROM notiz_seite s JOIN notiz_abschnitt a ON a.id = s.abschnitt_id
      WHERE a.unterricht_id = $1 AND a.geloescht_am IS NULL AND s.geloescht_am IS NULL AND ${sicht} AND EXISTS (SELECT 1 FROM jsonb_array_elements(s.inhalt->'items') i WHERE i->>'html' LIKE '%class="tg"%') ORDER BY s.geaendert_am DESC LIMIT 300`, params);
    return { seiten };
  }));

  /* ---------- Suche ---------- */
  app.get("/api/notizbuch/:uid/suche", geschuetzt(async (req, res, q) => {
    const uid = id(req.params.uid);
    const z = offenOderFehler(await zugang(q, req.ctx, uid));
    const woerter = String(req.query.q || "").trim().split(/\s+/).filter(Boolean).slice(0, 6);
    if (!woerter.length) return { treffer: [] };
    const params = [uid];
    let sicht = "TRUE";
    if (z.rolle !== "lp") { params.push(req.ctx.personId); sicht = `(a.bereich = 'bibliothek' ${z.modus !== "pruefung" ? "OR a.bereich = 'gemeinsam'" : ""} OR (a.bereich = 'schueler' AND a.besitzer_id = $2))`; }
    const bed = woerter.map((w) => { params.push("%" + w.replace(/[%_\\]/g, (c) => "\\" + c) + "%"); return `(s.titel ILIKE $${params.length} OR s.text ILIKE $${params.length})`; }).join(" AND ");
    const treffer = await q(`SELECT s.id, s.titel, left(s.text, 4000) AS text, s.geaendert_am, a.id AS abschnitt_id, a.name AS abschnitt, a.farbe, a.bereich, a.besitzer_id
      FROM notiz_seite s JOIN notiz_abschnitt a ON a.id = s.abschnitt_id
      WHERE a.unterricht_id = $1 AND a.geloescht_am IS NULL AND s.geloescht_am IS NULL AND ${sicht} AND ${bed} ORDER BY s.geaendert_am DESC LIMIT 100`, params);
    return { treffer };
  }));
}

/** Datei ablegen (auch für den OneNote-Import) */
export async function dateiAblegen(q, req, a, datei) {
  const art = dateiart(datei.name);
  if (!art) fehler(415, "Diese Dateiart ist nicht erlaubt. Erlaubt sind z. B. PDF, Word, PowerPoint, Excel, Bilder, Audio und Video.");
  if (!datei.buf.length) fehler(400, "Die Datei ist leer.");
  if (!inhaltPasst(art.ext, datei.buf)) fehler(415, "Der Inhalt passt nicht zur Dateiendung.");
  const key = neuerKey(req.sitzung.schule_id);
  await speicher.ablegen(key, datei.buf, art.mime);
  const [f] = await q("INSERT INTO notiz_datei (abschnitt_id, speicher_key, dateiname, mime, groesse, erstellt_von) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, dateiname, mime, groesse",
    [a.id, key, datei.name, art.mime, datei.buf.length, req.ctx.personId]);
  return f;
}
