// Verwaltung: Schuljahre, Fächer, Klassen, Personen, Unterricht, Übersicht, Protokoll
import { geschuetzt } from "../sitzung.mjs";
import { fehler, gueltig } from "../fehler.mjs";
import { protokolliere } from "../protokoll.mjs";
import { pruefe, darf, Schuljahr, Fach, Klasse, Person, Unterricht } from "@schule/shared";
import { passwortHash } from "./anmeldung.mjs";

const id = (x) => (/^[0-9a-f-]{36}$/.test(String(x || "")) ? x : fehler(400, "Ungültige Kennung."));
const istAdmin = (ctx) => ctx.rollen.has("admin") || ctx.rollen.has("schulleitung");

export default async function (app) {
  /* ---------- Übersicht ---------- */
  app.get("/api/uebersicht", geschuetzt(async (req, res, q) => {
    const ctx = req.ctx;
    const [jahr] = await q("SELECT id, bezeichnung FROM schuljahr WHERE aktiv ORDER BY von DESC LIMIT 1");
    const zahlen = istAdmin(ctx) ? (await q(`SELECT
      (SELECT count(*) FROM klasse WHERE schuljahr_id = $1)::int AS klassen,
      (SELECT count(*) FROM rolle r JOIN person p ON p.id = r.person_id WHERE r.art = 'schueler' AND p.status = 'aktiv')::int AS schueler,
      (SELECT count(*) FROM rolle r JOIN person p ON p.id = r.person_id WHERE r.art = 'lehrperson' AND p.status = 'aktiv')::int AS lehrpersonen,
      (SELECT count(*) FROM unterricht u JOIN klasse k ON k.id = u.klasse_id WHERE k.schuljahr_id = $1)::int AS unterricht,
      (SELECT count(*) FROM unterricht u JOIN klasse k ON k.id = u.klasse_id WHERE k.schuljahr_id = $1 AND NOT EXISTS (SELECT 1 FROM unterricht_lp l WHERE l.unterricht_id = u.id))::int AS ohne_lp`, [jahr ? jahr.id : null]))[0] : null;
    const meinUnterricht = ctx.unterricht.size ? await q(`SELECT u.id, u.gruppe, k.id AS klasse_id, k.name AS klasse, f.name AS fach, f.kuerzel, f.farbe,
        (SELECT count(*)::int FROM klasse_schueler ks WHERE ks.klasse_id = k.id) AS schueler
      FROM unterricht u JOIN klasse k ON k.id = u.klasse_id JOIN fach f ON f.id = u.fach_id
      WHERE u.id = ANY($1) AND ($2::uuid IS NULL OR k.schuljahr_id = $2) ORDER BY k.name, f.name`, [[...ctx.unterricht], jahr ? jahr.id : null]) : [];
    // Pro eigenem Unterricht: Schnitte der Klasse (aktuelles Semester), Notenverteilung und offene Entwürfe
    const lehrt = meinUnterricht.filter((u) => ctx.lehrt.has(u.id));
    if (lehrt.length) {
      const heute = new Date().toISOString().slice(0, 10);
      const [sem] = await q("SELECT id FROM semester WHERE schuljahr_id = $1 ORDER BY (von <= $2 AND bis >= $2) DESC, nr LIMIT 1", [jahr ? jahr.id : null, heute]);
      const rows = sem ? await q(`SELECT b.unterricht_id, b.id, b.gewicht, b.status, l.schueler_id, l.note, l.kennzeichen FROM bewertung b LEFT JOIN leistung l ON l.bewertung_id = b.id
        WHERE b.unterricht_id = ANY($1) AND b.semester_id = $2`, [lehrt.map((u) => u.id), sem.id]) : [];
      const { schnitt } = await import("@schule/shared");
      for (const u of lehrt) {
        const r = rows.filter((x) => x.unterricht_id === u.id);
        const proSchueler = new Map();
        for (const x of r) if (x.schueler_id) { if (!proSchueler.has(x.schueler_id)) proSchueler.set(x.schueler_id, []); proSchueler.get(x.schueler_id).push({ note: x.note, gewicht: x.gewicht, kennzeichen: x.kennzeichen }); }
        const schnitte = [...proSchueler.values()].map((l) => schnitt(l).schnitt).filter((x) => x != null);
        u.bewertungen = new Set(r.map((x) => x.id)).size;
        u.entwuerfe = new Set(r.filter((x) => x.status === "entwurf").map((x) => x.id)).size;
        u.klassenschnitt = schnitte.length ? schnitt(schnitte.map((n) => ({ note: n, gewicht: 1 }))).schnitt : null;
        u.verteilung = { ungenuegend: schnitte.filter((n) => n < 4).length, knapp: schnitte.filter((n) => n >= 4 && n < 4.5).length, gut: schnitte.filter((n) => n >= 4.5 && n < 5.5).length, sehrgut: schnitte.filter((n) => n >= 5.5).length };
        u.lehrt = true;
      }
    }
    // Schülerinnen und Schüler: freigegebenes Material, das sie noch nicht geöffnet haben
    let materialNeu = null;
    if (ctx.rollen.has("schueler") && ctx.unterricht.size) [{ n: materialNeu }] = await q(`SELECT count(DISTINCT m.id)::int AS n FROM freigabe f JOIN material m ON m.id = f.material_id
      WHERE f.unterricht_id = ANY($1) AND m.geloescht_am IS NULL AND f.ab <= now() AND (f.bis IS NULL OR f.bis > now())
      AND NOT EXISTS (SELECT 1 FROM material_abruf a WHERE a.material_id = m.id AND a.person_id = $2)`, [[...ctx.unterricht], ctx.personId]);
    return { schuljahr: jahr || null, zahlen, meinUnterricht, materialNeu };
  }));

  /* ---------- Schuljahre ---------- */
  app.get("/api/schuljahre", geschuetzt(async (req, res, q) => {
    pruefe(req.ctx, "schuljahr.lesen");
    return q(`SELECT j.*, coalesce(json_agg(json_build_object('id', s.id, 'nr', s.nr, 'von', s.von, 'bis', s.bis) ORDER BY s.nr) FILTER (WHERE s.id IS NOT NULL), '[]') AS semester
      FROM schuljahr j LEFT JOIN semester s ON s.schuljahr_id = j.id GROUP BY j.id ORDER BY j.von DESC`);
  }));
  const jahrSpeichern = async (req, q, jid) => {
    pruefe(req.ctx, "schuljahr.verwalten");
    const d = gueltig(Schuljahr, req.body);
    if (d.aktiv) await q("UPDATE schuljahr SET aktiv = false WHERE aktiv");
    const [j] = jid
      ? await q("UPDATE schuljahr SET bezeichnung=$1, von=$2, bis=$3, aktiv=coalesce($4, aktiv) WHERE id=$5 RETURNING *", [d.bezeichnung, d.von, d.bis, d.aktiv, jid])
      : await q("INSERT INTO schuljahr (bezeichnung, von, bis, aktiv) VALUES ($1,$2,$3,coalesce($4,false)) RETURNING *", [d.bezeichnung, d.von, d.bis, d.aktiv]);
    if (!j) fehler(404, "Schuljahr nicht gefunden.");
    for (const s of d.semester || []) {
      if (s.von < d.von || s.bis > d.bis) fehler(400, `Semester ${s.nr} liegt nicht im Schuljahr.`, "semester");
      await q("INSERT INTO semester (schuljahr_id, nr, von, bis) VALUES ($1,$2,$3,$4) ON CONFLICT (schuljahr_id, nr) DO UPDATE SET von = EXCLUDED.von, bis = EXCLUDED.bis", [j.id, s.nr, s.von, s.bis]);
    }
    await protokolliere(q, req, jid ? "schuljahr.geaendert" : "schuljahr.erstellt", "schuljahr", j.id, null, d);
    return j;
  };
  app.post("/api/schuljahre", geschuetzt((req, res, q) => jahrSpeichern(req, q)));
  app.put("/api/schuljahre/:id", geschuetzt((req, res, q) => jahrSpeichern(req, q, id(req.params.id))));

  /* ---------- Fächer ---------- */
  app.get("/api/faecher", geschuetzt(async (req, res, q) => { pruefe(req.ctx, "fach.lesen"); return q("SELECT * FROM fach ORDER BY name"); }));
  const fachSpeichern = async (req, q, fid) => {
    pruefe(req.ctx, "fach.verwalten");
    const d = gueltig(Fach, req.body);
    try {
      const [f] = fid
        ? await q("UPDATE fach SET name=$1, kuerzel=$2, farbe=coalesce($3, farbe), promotionsrelevant=coalesce($4, promotionsrelevant) WHERE id=$5 RETURNING *", [d.name, d.kuerzel, d.farbe, d.promotionsrelevant, fid])
        : await q("INSERT INTO fach (name, kuerzel, farbe, promotionsrelevant) VALUES ($1,$2,coalesce($3,'#5B6B7F'),coalesce($4,true)) RETURNING *", [d.name, d.kuerzel, d.farbe, d.promotionsrelevant]);
      if (!f) fehler(404, "Fach nicht gefunden.");
      await protokolliere(q, req, fid ? "fach.geaendert" : "fach.erstellt", "fach", f.id, null, d);
      return f;
    } catch (e) { if (e.code === "23505") fehler(409, `Das Kürzel «${d.kuerzel}» gibt es schon.`, "kuerzel"); throw e; }
  };
  app.post("/api/faecher", geschuetzt((req, res, q) => fachSpeichern(req, q)));
  app.put("/api/faecher/:id", geschuetzt((req, res, q) => fachSpeichern(req, q, id(req.params.id))));
  app.delete("/api/faecher/:id", geschuetzt(async (req, res, q) => {
    pruefe(req.ctx, "fach.verwalten");
    try { await q("DELETE FROM fach WHERE id = $1", [id(req.params.id)]); }
    catch (e) { if (e.code === "23503") fehler(409, "Das Fach wird noch unterrichtet und kann nicht gelöscht werden."); throw e; }
    await protokolliere(q, req, "fach.geloescht", "fach", req.params.id);
    return { ok: true };
  }));

  /* ---------- Klassen ---------- */
  app.get("/api/klassen", geschuetzt(async (req, res, q) => {
    pruefe(req.ctx, "klasse.lesen");
    const jahr = req.query.schuljahr ? id(req.query.schuljahr) : (await q("SELECT id FROM schuljahr WHERE aktiv LIMIT 1"))[0]?.id;
    const alle = istAdmin(req.ctx);
    return q(`SELECT k.*, p.vorname || ' ' || p.nachname AS klassenlehrperson,
        (SELECT count(*)::int FROM klasse_schueler ks WHERE ks.klasse_id = k.id) AS schueler,
        (SELECT count(*)::int FROM unterricht u WHERE u.klasse_id = k.id) AS faecher
      FROM klasse k LEFT JOIN person p ON p.id = k.klassenlehrperson_id
      WHERE k.schuljahr_id = $1 AND ($2 OR k.id = ANY($3)) ORDER BY k.stufe NULLS LAST, k.name`, [jahr || null, alle, [...req.ctx.klassen]]);
  }));
  app.get("/api/klassen/:id", geschuetzt(async (req, res, q) => {
    const kid = id(req.params.id);
    pruefe(req.ctx, "klasse.lesen", { klasseId: kid });
    const [k] = await q("SELECT k.*, j.bezeichnung AS schuljahr FROM klasse k JOIN schuljahr j ON j.id = k.schuljahr_id WHERE k.id = $1", [kid]);
    if (!k) fehler(404, "Klasse nicht gefunden.");
    // Schülerinnen und Schüler sehen keine Mitschüler-Daten ausser Namen
    const schueler = await q(`SELECT p.id, p.vorname, p.nachname, ${req.ctx.rollen.has("schueler") && !istAdmin(req.ctx) && !req.ctx.rollen.has("lehrperson") ? "NULL" : "p.email"} AS email, p.extern_id
      FROM klasse_schueler ks JOIN person p ON p.id = ks.person_id WHERE ks.klasse_id = $1 AND p.status = 'aktiv' ORDER BY p.nachname, p.vorname`, [kid]);
    const unterricht = await q(`SELECT u.id, u.gruppe, f.id AS fach_id, f.name AS fach, f.kuerzel, f.farbe,
        coalesce(json_agg(json_build_object('id', p.id, 'name', p.vorname || ' ' || p.nachname, 'kuerzel', p.kuerzel, 'art', ul.art)) FILTER (WHERE p.id IS NOT NULL), '[]') AS lehrpersonen
      FROM unterricht u JOIN fach f ON f.id = u.fach_id LEFT JOIN unterricht_lp ul ON ul.unterricht_id = u.id LEFT JOIN person p ON p.id = ul.person_id
      WHERE u.klasse_id = $1 GROUP BY u.id, f.id ORDER BY f.name, u.gruppe`, [kid]);
    return { ...k, schueler, unterricht };
  }));
  const klasseSpeichern = async (req, q, kid) => {
    pruefe(req.ctx, "klasse.verwalten");
    const d = gueltig(Klasse, req.body);
    try {
      const [k] = kid
        ? await q("UPDATE klasse SET name=$1, stufe=$2, profil=$3, klassenlehrperson_id=$4 WHERE id=$5 RETURNING *", [d.name, d.stufe ?? null, d.profil ?? null, d.klassenlehrperson_id ?? null, kid])
        : await q("INSERT INTO klasse (schuljahr_id, name, stufe, profil, klassenlehrperson_id) VALUES ($1,$2,$3,$4,$5) RETURNING *", [d.schuljahr_id, d.name, d.stufe ?? null, d.profil ?? null, d.klassenlehrperson_id ?? null]);
      if (!k) fehler(404, "Klasse nicht gefunden.");
      await protokolliere(q, req, kid ? "klasse.geaendert" : "klasse.erstellt", "klasse", k.id, null, d);
      return k;
    } catch (e) { if (e.code === "23505") fehler(409, `Die Klasse «${d.name}» gibt es in diesem Schuljahr schon.`, "name"); throw e; }
  };
  app.post("/api/klassen", geschuetzt((req, res, q) => klasseSpeichern(req, q)));
  app.put("/api/klassen/:id", geschuetzt((req, res, q) => klasseSpeichern(req, q, id(req.params.id))));
  app.delete("/api/klassen/:id", geschuetzt(async (req, res, q) => {
    pruefe(req.ctx, "klasse.verwalten");
    await q("DELETE FROM klasse WHERE id = $1", [id(req.params.id)]);
    await protokolliere(q, req, "klasse.geloescht", "klasse", req.params.id);
    return { ok: true };
  }));
  app.post("/api/klassen/:id/schueler", geschuetzt(async (req, res, q) => {
    pruefe(req.ctx, "klasse.verwalten");
    const kid = id(req.params.id);
    const ids = (Array.isArray(req.body && req.body.personen) ? req.body.personen : []).slice(0, 60).map(id);
    for (const pid of ids) await q("INSERT INTO klasse_schueler (klasse_id, person_id, von) VALUES ($1,$2,current_date) ON CONFLICT DO NOTHING", [kid, pid]);
    await protokolliere(q, req, "klasse.schueler_hinzugefuegt", "klasse", kid, null, { personen: ids });
    return { ok: true, anzahl: ids.length };
  }));
  app.delete("/api/klassen/:id/schueler/:person", geschuetzt(async (req, res, q) => {
    pruefe(req.ctx, "klasse.verwalten");
    await q("DELETE FROM klasse_schueler WHERE klasse_id = $1 AND person_id = $2", [id(req.params.id), id(req.params.person)]);
    await protokolliere(q, req, "klasse.schueler_entfernt", "klasse", req.params.id, null, { person: req.params.person });
    return { ok: true };
  }));

  /* ---------- Personen ---------- */
  app.get("/api/personen", geschuetzt(async (req, res, q) => {
    if (!istAdmin(req.ctx)) fehler(403, "Dafür fehlt Ihnen die Berechtigung.");
    const rolle = ["admin", "schulleitung", "lehrperson", "schueler", "eltern"].includes(req.query.rolle) ? req.query.rolle : null;
    const such = String(req.query.q || "").trim().slice(0, 60);
    return q(`SELECT p.id, p.vorname, p.nachname, p.email, p.kuerzel, p.extern_id, p.status, p.geburtsdatum,
        (SELECT json_agg(json_build_object('id', k.id, 'vorname', k.vorname, 'nachname', k.nachname)) FROM eltern_kind ek JOIN person k ON k.id = ek.kind_id WHERE ek.eltern_id = p.id) AS kinder,
        array_agg(DISTINCT r.art) FILTER (WHERE r.art IS NOT NULL) AS rollen,
        (SELECT string_agg(k.name, ', ') FROM klasse_schueler ks JOIN klasse k ON k.id = ks.klasse_id JOIN schuljahr j ON j.id = k.schuljahr_id AND j.aktiv WHERE ks.person_id = p.id) AS klasse,
        EXISTS (SELECT 1 FROM konto x WHERE x.person_id = p.id AND x.art = 'lokal') AS lokales_konto
      FROM person p LEFT JOIN rolle r ON r.person_id = p.id
      WHERE p.status = 'aktiv' AND ($1::text IS NULL OR EXISTS (SELECT 1 FROM rolle r2 WHERE r2.person_id = p.id AND r2.art = $1))
        AND ($2 = '' OR (p.vorname || ' ' || p.nachname || ' ' || coalesce(p.email,'') || ' ' || coalesce(p.kuerzel,'')) ILIKE '%' || $2 || '%')
      GROUP BY p.id ORDER BY p.nachname, p.vorname LIMIT 500`, [rolle, such]);
  }));
  const personSpeichern = async (req, q, pid) => {
    pruefe(req.ctx, "person.verwalten");
    const d = gueltig(Person, req.body);
    // Niemand nimmt sich selbst die Admin-Rolle (sonst sperrt sich die Schule aus)
    if (pid === req.ctx.personId && req.ctx.rollen.has("admin") && !d.rollen.includes("admin")) fehler(400, "Sie können sich die Administration nicht selbst wegnehmen.", "rollen");
    try {
      const [p] = pid
        ? await q("UPDATE person SET vorname=$1, nachname=$2, email=$3, kuerzel=$4, extern_id=$5, geburtsdatum = CASE WHEN $7 THEN $6::date ELSE geburtsdatum END WHERE id=$8 AND status='aktiv' RETURNING *", [d.vorname, d.nachname, d.email ?? null, d.kuerzel ?? null, d.extern_id ?? null, d.geburtsdatum ?? null, d.geburtsdatum !== undefined, pid])
        : await q("INSERT INTO person (vorname, nachname, email, kuerzel, extern_id, geburtsdatum) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *", [d.vorname, d.nachname, d.email ?? null, d.kuerzel ?? null, d.extern_id ?? null, d.geburtsdatum ?? null]);
      if (!p) fehler(404, "Person nicht gefunden.");
      await q("DELETE FROM rolle WHERE person_id = $1 AND art <> ALL($2)", [p.id, d.rollen]);
      for (const r of d.rollen) await q("INSERT INTO rolle (person_id, art) VALUES ($1,$2) ON CONFLICT DO NOTHING", [p.id, r]);
      await protokolliere(q, req, pid ? "person.geaendert" : "person.erstellt", "person", p.id, null, { ...d });
      return { ...p, rollen: d.rollen };
    } catch (e) { if (e.code === "23505") fehler(409, "Diese E-Mail-Adresse oder Nummer gibt es an der Schule schon.", "email"); throw e; }
  };
  app.post("/api/personen", geschuetzt((req, res, q) => personSpeichern(req, q)));
  app.put("/api/personen/:id", geschuetzt((req, res, q) => personSpeichern(req, q, id(req.params.id))));
  // Austritt statt Löschen: Noten und Protokoll bleiben nachvollziehbar (Löschfristen kommen in Phase 8)
  app.delete("/api/personen/:id", geschuetzt(async (req, res, q) => {
    pruefe(req.ctx, "person.verwalten");
    const pid = id(req.params.id);
    if (pid === req.ctx.personId) fehler(400, "Sie können sich nicht selbst austragen.");
    await q("UPDATE person SET status = 'ausgetreten' WHERE id = $1", [pid]);
    await q("DELETE FROM sitzung WHERE person_id = $1", [pid]);
    await protokolliere(q, req, "person.ausgetreten", "person", pid);
    return { ok: true };
  }));
  // Eigenes Konto (Passwort) für eine Person anlegen; Einmal-Passwort wird einmal angezeigt
  app.post("/api/personen/:id/konto", geschuetzt(async (req, res, q) => {
    pruefe(req.ctx, "person.verwalten");
    const pid = id(req.params.id);
    const [p] = await q("SELECT email FROM person WHERE id = $1 AND status = 'aktiv'", [pid]);
    if (!p) fehler(404, "Person nicht gefunden.");
    if (!p.email) fehler(400, "Für ein eigenes Konto braucht die Person eine E-Mail-Adresse.");
    const { zufall } = await import("../krypto.mjs");
    const pw = zufall(12);
    await q(`INSERT INTO konto (person_id, art, passwort_hash) VALUES ($1,'lokal',$2)
      ON CONFLICT (person_id) WHERE art = 'lokal' DO UPDATE SET passwort_hash = EXCLUDED.passwort_hash, totp_aktiv = false, totp_geheimnis = NULL, fehlversuche = 0, gesperrt_bis = NULL`, [pid, await passwortHash(pw)]);
    await q("DELETE FROM sitzung WHERE person_id = $1", [pid]);
    await protokolliere(q, req, "person.konto_zurueckgesetzt", "person", pid);
    return { passwort: pw };
  }));

  /* ---------- Unterricht ---------- */
  app.get("/api/unterricht", geschuetzt(async (req, res, q) => {
    pruefe(req.ctx, "unterricht.lesen");
    const jahr = req.query.schuljahr ? id(req.query.schuljahr) : (await q("SELECT id FROM schuljahr WHERE aktiv LIMIT 1"))[0]?.id;
    return q(`SELECT u.id, u.gruppe, k.id AS klasse_id, k.name AS klasse, f.id AS fach_id, f.name AS fach, f.kuerzel, f.farbe,
        coalesce(json_agg(json_build_object('id', p.id, 'name', p.vorname || ' ' || p.nachname, 'kuerzel', p.kuerzel)) FILTER (WHERE p.id IS NOT NULL), '[]') AS lehrpersonen
      FROM unterricht u JOIN klasse k ON k.id = u.klasse_id JOIN fach f ON f.id = u.fach_id
      LEFT JOIN unterricht_lp ul ON ul.unterricht_id = u.id LEFT JOIN person p ON p.id = ul.person_id
      WHERE k.schuljahr_id = $1 AND ($2 OR u.id = ANY($3)) GROUP BY u.id, k.id, f.id ORDER BY k.name, f.name`, [jahr || null, istAdmin(req.ctx), [...req.ctx.unterricht]]);
  }));
  app.post("/api/unterricht", geschuetzt(async (req, res, q) => {
    pruefe(req.ctx, "unterricht.verwalten");
    const d = gueltig(Unterricht, req.body);
    try {
      const [u] = await q("INSERT INTO unterricht (klasse_id, fach_id, gruppe) VALUES ($1,$2,$3) RETURNING *", [d.klasse_id, d.fach_id, d.gruppe || ""]);
      for (const pid of d.lehrpersonen || []) await q("INSERT INTO unterricht_lp (unterricht_id, person_id) VALUES ($1,$2)", [u.id, pid]);
      await protokolliere(q, req, "unterricht.erstellt", "unterricht", u.id, null, d);
      return u;
    } catch (e) { if (e.code === "23505") fehler(409, "Dieses Fach gibt es in der Klasse schon (gleiche Gruppe)."); throw e; }
  }));
  app.put("/api/unterricht/:id/lehrpersonen", geschuetzt(async (req, res, q) => {
    pruefe(req.ctx, "unterricht.verwalten");
    const uid = id(req.params.id);
    const ids = (Array.isArray(req.body && req.body.lehrpersonen) ? req.body.lehrpersonen : []).slice(0, 4).map(id);
    await q("DELETE FROM unterricht_lp WHERE unterricht_id = $1 AND person_id <> ALL($2)", [uid, ids]);
    for (const pid of ids) await q("INSERT INTO unterricht_lp (unterricht_id, person_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [uid, pid]);
    await protokolliere(q, req, "unterricht.lehrpersonen", "unterricht", uid, null, { lehrpersonen: ids });
    return { ok: true };
  }));
  app.delete("/api/unterricht/:id", geschuetzt(async (req, res, q) => {
    pruefe(req.ctx, "unterricht.verwalten");
    await q("DELETE FROM unterricht WHERE id = $1", [id(req.params.id)]);
    await protokolliere(q, req, "unterricht.geloescht", "unterricht", req.params.id);
    return { ok: true };
  }));

  /* ---------- Protokoll ---------- */
  app.get("/api/protokoll", geschuetzt(async (req, res, q) => {
    pruefe(req.ctx, "protokoll.lesen");
    return q(`SELECT x.id, x.zeit, x.aktion, x.objekt_typ, x.objekt_id, x.grund, p.vorname || ' ' || p.nachname AS person
      FROM protokoll x LEFT JOIN person p ON p.id = x.person_id ORDER BY x.zeit DESC, x.id DESC LIMIT 300`);
  }));

  /* ---------- Rechte für die Oberfläche (nur zum Ein- und Ausblenden) ---------- */
  app.get("/api/rechte", geschuetzt(async (req, res, q) => {
    const out = {};
    for (const a of ["schule.einstellungen", "schuljahr.verwalten", "klasse.verwalten", "fach.verwalten", "person.verwalten", "unterricht.verwalten", "import.ausfuehren", "protokoll.lesen", "material.erstellen", "pruefung.verwalten",
      "schulmitteilung.verfassen", "formular.verwalten", "stundenplan.verwalten", "stundenplan.aendern", "termin.schule", "pruefungslimit.ausnahme", "promotion.entscheiden", "matura.verwalten", "matura.betreuen", "eltern.verwalten", "absenz.eigene"]) out[a] = darf(req.ctx, a);
    // Ohne Objekt: ob die Person überhaupt eine Klasse führt (Absenzen und Zeugnisse der Klasse)
    out.klassenlehrperson = req.ctx.klp.size > 0;
    out.absenzen = out.klassenlehrperson || req.ctx.rollen.has("admin") || req.ctx.rollen.has("schulleitung");
    out.eltern = req.ctx.rollen.has("eltern");
    // Maturaarbeit im Menü: Leitung, Lehrpersonen mit Betreuung, Schüler/innen (und Eltern) mit eigener Arbeit
    out.matura = out["matura.verwalten"] || !!(await q("SELECT 1 FROM maturaarbeit WHERE schueler_id = $1 OR betreuer_id = $1 OR koreferent_id = $1 OR schueler_id = ANY($2) LIMIT 1", [req.ctx.personId, [...req.ctx.kinder]])).length;
    out.zeugnisse = out.klassenlehrperson || req.ctx.rollen.has("admin") || req.ctx.rollen.has("schulleitung");
    return out;
  }, { konto: true }));
}
