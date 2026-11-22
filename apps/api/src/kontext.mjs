// Rechte-Kontext einer angemeldeten Person laden: Rollen, eigener Unterricht, eigene Klassen
export async function kontext(q, personId) {
  const [p] = await q("SELECT id, vorname, nachname, email, kuerzel FROM person WHERE id = $1 AND status = 'aktiv'", [personId]);
  if (!p) return null;
  const rollen = new Set((await q("SELECT art FROM rolle WHERE person_id = $1 AND (gueltig_von IS NULL OR gueltig_von <= current_date) AND (gueltig_bis IS NULL OR gueltig_bis >= current_date)", [personId])).map((r) => r.art));
  const unterricht = new Set((await q(`
    SELECT ul.unterricht_id AS id FROM unterricht_lp ul WHERE ul.person_id = $1 AND (ul.bis IS NULL OR ul.bis >= current_date) AND (ul.von IS NULL OR ul.von <= current_date)
    UNION SELECT us.unterricht_id FROM unterricht_schueler us WHERE us.person_id = $1
    UNION SELECT u.id FROM unterricht u JOIN klasse_schueler ks ON ks.klasse_id = u.klasse_id
      WHERE ks.person_id = $1 AND u.gruppe = '' AND (ks.bis IS NULL OR ks.bis >= current_date)`, [personId])).map((r) => r.id));
  // Unterricht, den die Person selbst erteilt (für Notenbuch-Rechte; Schüler-Unterricht zählt hier nicht)
  const lehrt = new Set((await q("SELECT unterricht_id AS id FROM unterricht_lp WHERE person_id = $1 AND (bis IS NULL OR bis >= current_date) AND (von IS NULL OR von <= current_date)", [personId])).map((r) => r.id));
  const klassen = new Set((await q(`
    SELECT k.id FROM klasse k WHERE k.klassenlehrperson_id = $1
    UNION SELECT u.klasse_id FROM unterricht u JOIN unterricht_lp ul ON ul.unterricht_id = u.id WHERE ul.person_id = $1 AND (ul.bis IS NULL OR ul.bis >= current_date)
    UNION SELECT ks.klasse_id FROM klasse_schueler ks WHERE ks.person_id = $1 AND (ks.bis IS NULL OR ks.bis >= current_date)`, [personId])).map((r) => r.id));
  // Fächer der Person: Mitglied der Fachgruppe oder selbst unterrichtet (für Material, das mit der Fachgruppe geteilt ist)
  const faecher = new Set((await q(`
    SELECT fg.fach_id AS id FROM fachgruppe_mitglied m JOIN fachgruppe fg ON fg.id = m.fachgruppe_id WHERE m.person_id = $1
    UNION SELECT u.fach_id FROM unterricht u WHERE u.id = ANY($2)`, [personId, [...lehrt]])).map((r) => r.id));
  // Klassen, deren Klassenlehrperson die Person ist (Absenzen, Zeugnisse)
  const klp = new Set((await q("SELECT id FROM klasse WHERE klassenlehrperson_id = $1", [personId])).map((r) => r.id));
  // Eltern: Kinder unter 18 (oder volljährig mit Freigabe). Ohne Geburtsdatum gilt die Verknüpfung (die Schule hat sie erfasst).
  const kinder = rollen.has("eltern") ? new Set((await q(`SELECT ek.kind_id AS id FROM eltern_kind ek JOIN person k ON k.id = ek.kind_id
    WHERE ek.eltern_id = $1 AND k.status = 'aktiv' AND (k.geburtsdatum IS NULL OR k.geburtsdatum > current_date - interval '18 years' OR k.eltern_freigabe)`, [personId])).map((r) => r.id)) : new Set();
  return { personId, person: p, rollen, unterricht, lehrt, klassen, faecher, klp, kinder };
}
