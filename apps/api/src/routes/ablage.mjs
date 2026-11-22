// Ablage: persönliches Laufwerk, gemeinsame Ordner pro Unterricht, Gruppen (z. B. Fachschaft, Projektgruppe)
import { geschuetzt } from "../sitzung.mjs";
import { fehler } from "../fehler.mjs";
import { protokolliere } from "../protokoll.mjs";
import { darf } from "@schule/shared";
import { id, optId, text, pflicht, unterrichtLaden, dateiLesen, dateiSpeichern, dateiLaden, dateiSenden, dateiEntfernen } from "../hilfen.mjs";

const MB = 1024 * 1024;
async function grenzen(q) {
  const [s] = await q("SELECT einstellungen FROM schule");
  const a = (s.einstellungen && s.einstellungen.ablage) || {};
  return { person: (Number(a.person_mb) || 2048) * MB, unterricht: (Number(a.unterricht_mb) || 5120) * MB, gruppe: (Number(a.gruppe_mb) || 5120) * MB };
}
const belegt = async (q, lwid) => Number((await q("SELECT coalesce(sum(groesse), 0)::bigint AS n FROM datei WHERE bezug_typ = 'laufwerk' AND bezug_id = $1 AND geloescht_am IS NULL", [lwid]))[0].n);

/** Persönliches Laufwerk und die Laufwerke des eigenen Unterrichts anlegen, falls es sie noch nicht gibt */
async function sicherstellen(q, ctx) {
  await q("INSERT INTO laufwerk (art, person_id, name, erstellt_von) VALUES ('person', $1, 'Meine Dateien', $1) ON CONFLICT DO NOTHING", [ctx.personId]);
  const ids = [...ctx.unterricht];
  if (ids.length) await q(`INSERT INTO laufwerk (art, unterricht_id, name) SELECT 'unterricht', u.id, f.name || ' ' || k.name || CASE WHEN u.gruppe <> '' THEN ' ' || u.gruppe ELSE '' END
    FROM unterricht u JOIN fach f ON f.id = u.fach_id JOIN klasse k ON k.id = u.klasse_id JOIN schuljahr j ON j.id = k.schuljahr_id AND j.aktiv WHERE u.id = ANY($1) ON CONFLICT DO NOTHING`, [ids]);
}

/** Rechte an einem Laufwerk: lesen, schreiben (Dateien und Ordner), verwalten (Einstellungen, Mitglieder) */
async function zugang(q, ctx, lwid) {
  const [lw] = await q("SELECT * FROM laufwerk WHERE id = $1", [id(lwid)]);
  if (!lw) fehler(404, "Ablage nicht gefunden.");
  let z = null;
  if (lw.art === "person") z = lw.person_id === ctx.personId ? { schreiben: true, verwalten: true } : null;
  else if (lw.art === "unterricht") {
    if (darf(ctx, "auftrag.verwalten", { unterrichtId: lw.unterricht_id })) z = { schreiben: true, verwalten: true, lehrperson: true };
    else if (ctx.rollen.has("schueler") && ctx.unterricht.has(lw.unterricht_id)) z = { schreiben: lw.schueler_schreiben, verwalten: false };
  } else {
    const [m] = await q("SELECT verwalten FROM laufwerk_mitglied WHERE laufwerk_id = $1 AND person_id = $2", [lw.id, ctx.personId]);
    if (m) z = { schreiben: true, verwalten: m.verwalten || lw.erstellt_von === ctx.personId };
  }
  if (!z) fehler(404, "Ablage nicht gefunden.");
  return { lw, ...z };
}
async function ordnerIn(q, lw, oid) {
  if (!oid) return null;
  const [o] = await q("SELECT * FROM lw_ordner WHERE id = $1 AND laufwerk_id = $2 AND geloescht_am IS NULL", [id(oid), lw.id]);
  if (!o) fehler(404, "Ordner nicht gefunden.");
  return o;
}
/** Ordnerpfad von oben nach unten */
async function pfad(q, o) {
  const out = []; let x = o, n = 0;
  while (x && n++ < 30) { out.unshift({ id: x.id, name: x.name }); x = x.eltern_id ? (await q("SELECT id, name, eltern_id FROM lw_ordner WHERE id = $1", [x.eltern_id]))[0] : null; }
  return out;
}

export default async function (app) {
  app.get("/api/ablage", geschuetzt(async (req, res, q) => {
    await sicherstellen(q, req.ctx);
    const lehrt = [...(req.ctx.lehrt || [])], besucht = req.ctx.rollen.has("schueler") ? [...req.ctx.unterricht] : [];
    const liste = await q(`SELECT l.id, l.art, l.name, l.unterricht_id, l.schueler_schreiben, f.farbe,
        (SELECT coalesce(sum(d.groesse), 0)::bigint FROM datei d WHERE d.bezug_typ = 'laufwerk' AND d.bezug_id = l.id AND d.geloescht_am IS NULL) AS belegt,
        (SELECT count(*)::int FROM datei d WHERE d.bezug_typ = 'laufwerk' AND d.bezug_id = l.id AND d.geloescht_am IS NULL) AS dateien,
        (SELECT count(*)::int FROM laufwerk_mitglied m WHERE m.laufwerk_id = l.id) AS mitglieder
      FROM laufwerk l LEFT JOIN unterricht u ON u.id = l.unterricht_id LEFT JOIN fach f ON f.id = u.fach_id
      WHERE (l.art = 'person' AND l.person_id = $1) OR (l.art = 'unterricht' AND l.unterricht_id = ANY($2))
        OR (l.art = 'gruppe' AND EXISTS (SELECT 1 FROM laufwerk_mitglied m WHERE m.laufwerk_id = l.id AND m.person_id = $1))
      ORDER BY (l.art = 'person') DESC, l.art, l.name`, [req.ctx.personId, [...lehrt, ...besucht]]);
    const g = await grenzen(q);
    return { laufwerke: liste.map((l) => ({ ...l, belegt: Number(l.belegt), grenze: g[l.art] })), darfGruppe: req.ctx.rollen.has("lehrperson") || req.ctx.rollen.has("schulleitung") || req.ctx.rollen.has("admin") };
  }));

  app.get("/api/ablage/:lw", geschuetzt(async (req, res, q) => {
    const z = await zugang(q, req.ctx, req.params.lw);
    const o = await ordnerIn(q, z.lw, req.query.ordner);
    const ordner = await q(`SELECT o.id, o.name, o.erstellt_am, (SELECT count(*)::int FROM datei d WHERE d.bezug_typ = 'laufwerk' AND d.ordner_id = o.id AND d.geloescht_am IS NULL) AS dateien
      FROM lw_ordner o WHERE o.laufwerk_id = $1 AND o.eltern_id IS NOT DISTINCT FROM $2 AND o.geloescht_am IS NULL ORDER BY lower(o.name)`, [z.lw.id, o ? o.id : null]);
    const dateien = await q(`SELECT d.id, d.name, d.mime, d.groesse, d.erstellt_am, d.geaendert_am, d.erstellt_von, p.vorname || ' ' || p.nachname AS von
      FROM datei d LEFT JOIN person p ON p.id = d.erstellt_von WHERE d.bezug_typ = 'laufwerk' AND d.bezug_id = $1 AND d.ordner_id IS NOT DISTINCT FROM $2 AND d.geloescht_am IS NULL ORDER BY lower(d.name)`, [z.lw.id, o ? o.id : null]);
    const mitglieder = z.lw.art === "gruppe" ? await q("SELECT p.id, p.vorname, p.nachname, m.verwalten FROM laufwerk_mitglied m JOIN person p ON p.id = m.person_id WHERE m.laufwerk_id = $1 ORDER BY p.nachname", [z.lw.id]) : [];
    const g = await grenzen(q);
    return { laufwerk: z.lw, ordner, dateien: dateien.map((d) => ({ ...d, mein: d.erstellt_von === req.ctx.personId })), pfad: o ? await pfad(q, o) : [], aktuell: o ? o.id : null,
      darf: { schreiben: z.schreiben, verwalten: z.verwalten }, mitglieder, belegt: await belegt(q, z.lw.id), grenze: g[z.lw.art] };
  }));

  /* ---------- Ordner ---------- */
  app.post("/api/ablage/:lw/ordner", geschuetzt(async (req, res, q) => {
    const z = await zugang(q, req.ctx, req.params.lw);
    if (!z.schreiben) fehler(403, "In dieser Ablage dürfen Sie nichts ändern.");
    const eltern = await ordnerIn(q, z.lw, req.body.eltern_id);
    const [o] = await q("INSERT INTO lw_ordner (laufwerk_id, eltern_id, name, erstellt_von) VALUES ($1,$2,$3,$4) RETURNING *", [z.lw.id, eltern ? eltern.id : null, pflicht(req.body.name, 120, "Bitte einen Namen eingeben.", "name").replace(/[\\/]/g, "-"), req.ctx.personId]);
    return o;
  }));
  app.put("/api/lw-ordner/:id", geschuetzt(async (req, res, q) => {
    const [o] = await q("SELECT * FROM lw_ordner WHERE id = $1 AND geloescht_am IS NULL", [id(req.params.id)]);
    if (!o) fehler(404, "Ordner nicht gefunden.");
    const z = await zugang(q, req.ctx, o.laufwerk_id);
    if (!z.schreiben || (!z.verwalten && o.erstellt_von !== req.ctx.personId)) fehler(403, "Dafür fehlt Ihnen die Berechtigung.");
    let eltern = o.eltern_id;
    if (req.body.eltern_id !== undefined) {
      const ziel = await ordnerIn(q, z.lw, req.body.eltern_id);
      // Nicht in sich selbst oder einen Unterordner verschieben
      if (ziel && (await pfad(q, ziel)).some((x) => x.id === o.id)) fehler(400, "Ein Ordner lässt sich nicht in sich selbst verschieben.");
      eltern = ziel ? ziel.id : null;
    }
    const [n] = await q("UPDATE lw_ordner SET name = $1, eltern_id = $2 WHERE id = $3 RETURNING *", [req.body.name !== undefined ? pflicht(req.body.name, 120, "Bitte einen Namen eingeben.", "name").replace(/[\\/]/g, "-") : o.name, eltern, o.id]);
    return n;
  }));
  app.delete("/api/lw-ordner/:id", geschuetzt(async (req, res, q) => {
    const [o] = await q("SELECT * FROM lw_ordner WHERE id = $1 AND geloescht_am IS NULL", [id(req.params.id)]);
    if (!o) fehler(404, "Ordner nicht gefunden.");
    const z = await zugang(q, req.ctx, o.laufwerk_id);
    if (!z.schreiben || (!z.verwalten && o.erstellt_von !== req.ctx.personId)) fehler(403, "Dafür fehlt Ihnen die Berechtigung.");
    // Ordner mit allen Unterordnern und Dateien
    const baum = (await q(`WITH RECURSIVE b AS (SELECT id FROM lw_ordner WHERE id = $1 UNION ALL SELECT o.id FROM lw_ordner o JOIN b ON o.eltern_id = b.id) SELECT id FROM b`, [o.id])).map((r) => r.id);
    const dateien = await q("SELECT * FROM datei WHERE bezug_typ = 'laufwerk' AND ordner_id = ANY($1) AND geloescht_am IS NULL", [baum]);
    if (dateien.some((d) => d.erstellt_von !== req.ctx.personId) && !z.verwalten) fehler(403, "Im Ordner liegen Dateien von anderen Personen.");
    for (const d of dateien) await dateiEntfernen(q, d);
    await q("UPDATE lw_ordner SET geloescht_am = now() WHERE id = ANY($1)", [baum]);
    return { ok: true, dateien: dateien.length };
  }));

  /* ---------- Dateien ---------- */
  app.post("/api/ablage/:lw/dateien", geschuetzt(async (req, res, q) => {
    const z = await zugang(q, req.ctx, req.params.lw);
    if (!z.schreiben) fehler(403, "In dieser Ablage dürfen Sie nichts ändern.");
    const { felder, datei } = await dateiLesen(req);
    const o = await ordnerIn(q, z.lw, felder.ordner_id);
    const g = (await grenzen(q))[z.lw.art];
    if ((await belegt(q, z.lw.id)) + datei.buf.length > g) fehler(413, `Die Ablage ist voll (höchstens ${Math.round(g / MB / 1024 * 10) / 10} GB). Bitte zuerst Dateien löschen.`);
    // Gleicher Name im gleichen Ordner: «Name (2).pdf»
    const vorhanden = new Set((await q("SELECT lower(name) AS n FROM datei WHERE bezug_typ = 'laufwerk' AND bezug_id = $1 AND ordner_id IS NOT DISTINCT FROM $2 AND geloescht_am IS NULL", [z.lw.id, o ? o.id : null])).map((r) => r.n));
    let n = datei.name, k = 2;
    while (vorhanden.has(n.toLowerCase())) { const p = datei.name.lastIndexOf("."); n = p > 0 ? `${datei.name.slice(0, p)} (${k})${datei.name.slice(p)}` : `${datei.name} (${k})`; k++; }
    return dateiSpeichern(q, req, { bezugTyp: "laufwerk", bezugId: z.lw.id, ordnerId: o ? o.id : null }, { ...datei, name: n });
  }));
  const dateiMitZugang = async (q, ctx, did) => {
    const f = await dateiLaden(q, did);
    if (f.bezug_typ !== "laufwerk") fehler(404, "Datei nicht gefunden.");
    return { f, z: await zugang(q, ctx, f.bezug_id) };
  };
  app.get("/api/ablage-dateien/:id", geschuetzt(async (req, res, q) => {
    const { f } = await dateiMitZugang(q, req.ctx, req.params.id);
    return dateiSenden(res, f, req.query.ansicht === "1");
  }));
  app.put("/api/ablage-dateien/:id", geschuetzt(async (req, res, q) => {
    const { f, z } = await dateiMitZugang(q, req.ctx, req.params.id);
    if (!z.schreiben || (!z.verwalten && f.erstellt_von !== req.ctx.personId)) fehler(403, "Dafür fehlt Ihnen die Berechtigung.");
    let ordner = f.ordner_id, nameNeu = f.name;
    if (req.body.ordner_id !== undefined) { const o = await ordnerIn(q, z.lw, req.body.ordner_id); ordner = o ? o.id : null; }
    if (req.body.name !== undefined) {
      nameNeu = pflicht(req.body.name, 200, "Bitte einen Namen eingeben.", "name").replace(/[\\/:*?"<>|]/g, "_");
      // Endung bleibt (sonst stimmt die Dateiart nicht mehr)
      const alt = f.name.split(".").pop().toLowerCase(), neu = nameNeu.split(".").pop().toLowerCase();
      if (alt !== neu) nameNeu = `${nameNeu}.${alt}`;
    }
    await q("UPDATE datei SET name = $1, ordner_id = $2, geaendert_am = now() WHERE id = $3", [nameNeu, ordner, f.id]);
    return { ok: true, name: nameNeu };
  }));
  app.delete("/api/ablage-dateien/:id", geschuetzt(async (req, res, q) => {
    const { f, z } = await dateiMitZugang(q, req.ctx, req.params.id);
    if (!z.schreiben || (!z.verwalten && f.erstellt_von !== req.ctx.personId)) fehler(403, "Dafür fehlt Ihnen die Berechtigung.");
    await dateiEntfernen(q, f);
    return { ok: true };
  }));

  /* ---------- Einstellungen und Gruppen ---------- */
  app.put("/api/ablage/:lw/einstellungen", geschuetzt(async (req, res, q) => {
    const z = await zugang(q, req.ctx, req.params.lw);
    if (!z.verwalten) fehler(403, "Dafür fehlt Ihnen die Berechtigung.");
    if (z.lw.art === "person") fehler(400, "Das persönliche Laufwerk hat keine Einstellungen.");
    await q("UPDATE laufwerk SET name = $1, schueler_schreiben = $2 WHERE id = $3", [req.body.name !== undefined ? pflicht(req.body.name, 80, "Bitte einen Namen eingeben.", "name") : z.lw.name, z.lw.art === "unterricht" ? req.body.schueler_schreiben === true : false, z.lw.id]);
    return { ok: true };
  }));
  // Personen für Gruppen: Lehrpersonen der Schule und Schüler/innen aus Klassen, in denen man unterrichtet
  app.get("/api/ablage-personen", geschuetzt(async (req, res, q) => {
    if (!(req.ctx.rollen.has("lehrperson") || req.ctx.rollen.has("schulleitung") || req.ctx.rollen.has("admin"))) fehler(403, "Dafür fehlt Ihnen die Berechtigung.");
    const such = text(req.query.q, 60);
    if (such.length < 2) return [];
    const alle = req.ctx.rollen.has("admin") || req.ctx.rollen.has("schulleitung");
    return q(`SELECT DISTINCT p.id, p.vorname, p.nachname, p.kuerzel, (SELECT string_agg(r.art, ',') FROM rolle r WHERE r.person_id = p.id) AS rollen FROM person p
      WHERE p.status = 'aktiv' AND (p.vorname || ' ' || p.nachname || ' ' || coalesce(p.kuerzel, '')) ILIKE '%' || $1 || '%'
        AND (EXISTS (SELECT 1 FROM rolle r WHERE r.person_id = p.id AND r.art IN ('lehrperson','schulleitung','admin'))
          OR ($2 AND EXISTS (SELECT 1 FROM rolle r WHERE r.person_id = p.id AND r.art = 'schueler'))
          OR EXISTS (SELECT 1 FROM klasse_schueler ks WHERE ks.person_id = p.id AND ks.klasse_id = ANY($3)))
      ORDER BY p.nachname, p.vorname LIMIT 20`, [such, alle, [...req.ctx.klassen]]);
  }));
  app.post("/api/ablage/gruppen", geschuetzt(async (req, res, q) => {
    if (!(req.ctx.rollen.has("lehrperson") || req.ctx.rollen.has("schulleitung") || req.ctx.rollen.has("admin"))) fehler(403, "Gruppen erstellen Lehrpersonen.");
    const [lw] = await q("INSERT INTO laufwerk (art, name, erstellt_von) VALUES ('gruppe', $1, $2) RETURNING *", [pflicht(req.body.name, 80, "Bitte einen Namen eingeben.", "name"), req.ctx.personId]);
    await q("INSERT INTO laufwerk_mitglied (laufwerk_id, person_id, verwalten) VALUES ($1,$2,true)", [lw.id, req.ctx.personId]);
    for (const pid of (Array.isArray(req.body.mitglieder) ? req.body.mitglieder : []).slice(0, 200)) await q("INSERT INTO laufwerk_mitglied (laufwerk_id, person_id) SELECT $1, id FROM person WHERE id = $2 AND status = 'aktiv' ON CONFLICT DO NOTHING", [lw.id, id(pid)]);
    await protokolliere(q, req, "ablage.gruppe_erstellt", "laufwerk", lw.id, null, { name: lw.name });
    return lw;
  }));
  app.put("/api/ablage/:lw/mitglieder", geschuetzt(async (req, res, q) => {
    const z = await zugang(q, req.ctx, req.params.lw);
    if (z.lw.art !== "gruppe" || !z.verwalten) fehler(403, "Dafür fehlt Ihnen die Berechtigung.");
    for (const pid of (req.body.hinzufuegen || []).slice(0, 200)) await q("INSERT INTO laufwerk_mitglied (laufwerk_id, person_id) SELECT $1, id FROM person WHERE id = $2 AND status = 'aktiv' ON CONFLICT DO NOTHING", [z.lw.id, id(pid)]);
    for (const pid of (req.body.entfernen || []).slice(0, 200)) { if (id(pid) === req.ctx.personId) continue; await q("DELETE FROM laufwerk_mitglied WHERE laufwerk_id = $1 AND person_id = $2", [z.lw.id, pid]); }
    return { ok: true };
  }));
  app.delete("/api/ablage/:lw", geschuetzt(async (req, res, q) => {
    const z = await zugang(q, req.ctx, req.params.lw);
    if (z.lw.art !== "gruppe" || !z.verwalten) fehler(403, "Nur Gruppen lassen sich löschen.");
    for (const d of await q("SELECT * FROM datei WHERE bezug_typ = 'laufwerk' AND bezug_id = $1 AND geloescht_am IS NULL", [z.lw.id])) await dateiEntfernen(q, d);
    await q("DELETE FROM laufwerk WHERE id = $1", [z.lw.id]);
    await protokolliere(q, req, "ablage.gruppe_geloescht", "laufwerk", z.lw.id, { name: z.lw.name });
    return { ok: true };
  }));
}
