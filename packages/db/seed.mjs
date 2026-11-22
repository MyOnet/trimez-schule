// Testdaten: eine erfundene Zürcher Mittelschule mit 3 Klassen. Alle Namen sind erfunden.
//   node packages/db/seed.mjs            → legt die Schule «seeufer» neu an (löscht eine bestehende gleichen Namens)
import pg from "pg";
import { hash } from "@node-rs/argon2";

const url = process.env.DATABASE_OWNER_URL || "postgres://schule_owner:dev-owner@localhost/schule";
const c = new pg.Client({ connectionString: url });
await c.connect();
const q = async (t, p) => (await c.query(t, p)).rows;
const PW = process.env.SEED_PASSWORT || "Seeufer-Test-2026!";
const pwHash = await hash(PW, { memoryCost: 19456, timeCost: 2, parallelism: 1 });

await q("BEGIN");
await q("DELETE FROM schule WHERE kurzname = 'seeufer'");
const [s] = await q(`INSERT INTO schule (kurzname, name, kanton, typ, einstellungen) VALUES ('seeufer', 'Kantonsschule Seeufer (Testschule)', 'ZH', 'gymnasium',
  '{"rundung_zeugnis": 0.5, "notenskala": [1, 6]}') RETURNING id`);
await q("SELECT set_config('app.schule_id', $1, true)", [s.id]);

const [j] = await q("INSERT INTO schuljahr (bezeichnung, von, bis, aktiv) VALUES ('2026/27', '2026-08-17', '2027-07-16', true) RETURNING id");
await q("INSERT INTO semester (schuljahr_id, nr, von, bis) VALUES ($1,1,'2026-08-17','2027-01-31'), ($1,2,'2027-02-01','2027-07-16')", [j.id]);

const FAECHER = [["Deutsch", "D", "#C2410C"], ["Französisch", "F", "#1D4ED8"], ["Englisch", "E", "#0F766E"], ["Latein", "L", "#7C2D12"], ["Mathematik", "M", "#4338CA"],
  ["Biologie", "B", "#15803D"], ["Chemie", "C", "#A16207"], ["Physik", "P", "#0369A1"], ["Geschichte", "G", "#9D174D"], ["Geografie", "GG", "#4D7C0F"],
  ["Wirtschaft und Recht", "WR", "#334155"], ["Informatik", "IN", "#6D28D9"], ["Bildnerisches Gestalten", "BG", "#BE185D"], ["Musik", "MU", "#B45309"], ["Sport", "S", "#0E7490"]];
const fach = {};
for (const [n, k, f] of FAECHER) fach[k] = (await q("INSERT INTO fach (name, kuerzel, farbe, promotionsrelevant) VALUES ($1,$2,$3,$4) RETURNING id", [n, k, f, k !== "S"]))[0].id;

async function person(vorname, nachname, rollen, extra = {}) {
  const [p] = await q("INSERT INTO person (vorname, nachname, email, kuerzel, extern_id) VALUES ($1,$2,$3,$4,$5) RETURNING id", [vorname, nachname, extra.email || null, extra.kuerzel || null, extra.nr || null]);
  for (const r of rollen) await q("INSERT INTO rolle (person_id, art) VALUES ($1,$2)", [p.id, r]);
  if (extra.konto) await q("INSERT INTO konto (person_id, art, passwort_hash) VALUES ($1,'lokal',$2)", [p.id, pwHash]);
  return p.id;
}
const admin = await person("Ruth", "Bachmann", ["admin", "schulleitung"], { email: "admin@seeufer.test", konto: true });
const LP = [["Martin", "Keller", "KEM", "D"], ["Sandra", "Frei", "FRS", "F"], ["Thomas", "Brunner", "BRT", "M"], ["Nadine", "Huber", "HUN", "E"],
  ["Lukas", "Meier", "MEL", "B"], ["Claudia", "Steiner", "STC", "G"], ["Reto", "Wyss", "WYR", "P"], ["Andrea", "Gerber", "GEA", "L"],
  ["Barbara", "Kunz", "KUB", "D"]]; // Kunz: Fachgruppe Deutsch, in diesen Klassen ohne Unterricht
const lp = {};
for (const [v, n, k, f] of LP) lp[k] = await person(v, n, ["lehrperson"], { email: `${v.toLowerCase()}.${n.toLowerCase()}@seeufer.test`, kuerzel: k, konto: true });

const VN = ["Lea", "Noah", "Mia", "Luca", "Emma", "Leon", "Lina", "Elias", "Sara", "Jonas", "Lara", "Levin", "Nina", "Tim", "Alina", "Nico", "Jana", "David", "Zoe", "Samuel", "Laura", "Fabio"];
const NN = ["Ammann", "Baumann", "Bühler", "Graf", "Hofmann", "Kälin", "Lüthi", "Marti", "Moser", "Müller", "Rüegg", "Schmid", "Sutter", "Vogel", "Weber", "Zürcher", "Egli", "Frey", "Gasser", "Hess", "Imhof", "Jäggi"];
const KLASSEN = [["3a", 3, "neusprachlich", "KEM"], ["3b", 3, "mathematisch-naturwissenschaftlich", "BRT"], ["5c", 5, "altsprachlich", "GEA"]];
let nr = 26001, i = 0;
for (const [name, stufe, profil, klp] of KLASSEN) {
  const [k] = await q("INSERT INTO klasse (schuljahr_id, name, stufe, profil, klassenlehrperson_id) VALUES ($1,$2,$3,$4,$5) RETURNING id", [j.id, name, stufe, profil, lp[klp]]);
  for (let n = 0; n < 20; n++, i++) {
    const v = VN[(i * 7) % VN.length], nn = NN[(i * 5 + n) % NN.length];
    const pid = await person(v, nn, ["schueler"], { email: `${v.toLowerCase()}.${nn.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")}.${nr}@schueler.seeufer.test`, nr: String(nr++), konto: name === "3a" && n < 3 });
    await q("INSERT INTO klasse_schueler (klasse_id, person_id, von) VALUES ($1,$2,'2026-08-17')", [k.id, pid]);
  }
  const plan = { D: "KEM", F: "FRS", M: "BRT", E: "HUN", B: "MEL", G: "STC", P: "WYR", ...(profil === "altsprachlich" ? { L: "GEA" } : {}) };
  for (const [f, l] of Object.entries(plan)) {
    const [u] = await q("INSERT INTO unterricht (klasse_id, fach_id) VALUES ($1,$2) RETURNING id", [k.id, fach[f]]);
    await q("INSERT INTO unterricht_lp (unterricht_id, person_id) VALUES ($1,$2)", [u.id, lp[l]]);
  }
}
for (const [k, f] of [["D", "D"], ["M", "M"]]) {
  const [g] = await q("INSERT INTO fachgruppe (fach_id, name) VALUES ($1,$2) RETURNING id", [fach[f], `Fachgruppe ${FAECHER.find((x) => x[1] === f)[0]}`]);
  for (const [, , kz, ff] of LP) if (ff === f) await q("INSERT INTO fachgruppe_mitglied (fachgruppe_id, person_id) VALUES ($1,$2)", [g.id, lp[kz]]);
}
// Notenbuch: Arten, Schlüssel und Beispielnoten (Deutsch und Mathematik 3a, 1. Semester)
for (const [n, k, g, r] of [["Prüfung", "schriftlich", 1, 1], ["Kurztest", "schriftlich", 0.5, 2], ["Vortrag", "muendlich", 1, 3], ["Projekt", "schriftlich", 1, 4], ["Mündlich", "muendlich", 1, 5]])
  await q("INSERT INTO bewertungsart (name, kategorie, gewicht_standard, reihenfolge) VALUES ($1,$2,$3,$4)", [n, k, g, r]);
await q(`INSERT INTO notenschluessel (name, art, parameter, rundung, geteilt) VALUES ('Linear (6 bei voller Punktzahl)', 'linear', '{"p6": 1}', 0.1, 'schule'), ('Linear, 6 ab 95 %, Viertelnoten', 'linear', '{"p6": 0.95}', 0.25, 'schule')`);
const art = Object.fromEntries((await q("SELECT id, name FROM bewertungsart")).map((a) => [a.name, a.id]));
const [schl] = await q("SELECT id FROM notenschluessel WHERE name LIKE 'Linear, 6 ab%'");
const [sem1] = await q("SELECT id FROM semester WHERE nr = 1");
const [k3a] = await q("SELECT id FROM klasse WHERE name = '3a'");
const sch3a = (await q("SELECT person_id FROM klasse_schueler WHERE klasse_id = $1", [k3a.id])).map((r) => r.person_id);
let zz = 7; const zufall = () => (zz = (zz * 1103515245 + 12345) % 2147483648) / 2147483648;
const NOTEN = [5.5, 4.5, 5, 4, 5.75, 3.5, 4.75, 5.25, 4.25, 6, 4.5, 5, 3.75, 5.5, 4.75, 5, 4.5, 5.25, 4, 5.5];
for (const [fk, lpk, bew] of [["D", "KEM", [["Erörterung", "Prüfung", "2026-09-18", 40, "freigegeben"], ["Grammatik", "Kurztest", "2026-10-09", null, "freigegeben"], ["Novelle: Interpretation", "Prüfung", "2026-11-06", 36, "entwurf"]]],
  ["M", "BRT", [["Funktionen", "Prüfung", "2026-09-25", 30, "freigegeben"], ["Trigonometrie", "Prüfung", "2026-11-13", 32, "entwurf"]]]]) {
  const [u] = await q("SELECT id FROM unterricht WHERE klasse_id = $1 AND fach_id = $2", [k3a.id, fach[fk]]);
  for (const [titel, a, datum, max, status] of bew) {
    const [b] = await q(`INSERT INTO bewertung (unterricht_id, semester_id, bewertungsart_id, kategorie, titel, datum, gewicht, max_punkte, notenschluessel_id, status, freigegeben_am, freigegeben_von, erstellt_von)
      VALUES ($1,$2,$3,'schriftlich',$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING id`, [u.id, sem1.id, art[a], titel, datum, a === "Kurztest" ? 0.5 : 1, max, max ? schl.id : null, status, status === "freigegeben" ? datum : null, lp[lpk]]);
    for (let i = 0; i < sch3a.length; i++) {
      const basis = NOTEN[i] + (zufall() - 0.5) * 1.2;
      if (i === 7 && titel === "Grammatik") { await q("INSERT INTO leistung (bewertung_id, schueler_id, kennzeichen) VALUES ($1,$2,'nachholen')", [b.id, sch3a[i]]); continue; }
      if (max) { const p = Math.max(0, Math.min(max, Math.round(((basis - 1) / 5) * 0.95 * max * 2) / 2)); const n = Math.min(6, Math.round((1 + 5 * p / (max * 0.95)) * 4) / 4);
        await q("INSERT INTO leistung (bewertung_id, schueler_id, punkte, note) VALUES ($1,$2,$3,$4)", [b.id, sch3a[i], p, n]); }
      else await q("INSERT INTO leistung (bewertung_id, schueler_id, note) VALUES ($1,$2,$3)", [b.id, sch3a[i], Math.min(6, Math.max(1, Math.round(basis * 2) / 2))]);
    }
  }
  if (fk === "D") for (let i = 0; i < sch3a.length; i++) for (let j = 0; j < 4; j++)
    await q("INSERT INTO beobachtung (unterricht_id, schueler_id, datum, wert, erfasst_von) VALUES ($1,$2,$3,$4,$5)", [u.id, sch3a[i], `2026-${String(9 + (j % 3)).padStart(2, "0")}-${String(3 + j * 5).padStart(2, "0")}`, Math.max(-2, Math.min(2, Math.round((NOTEN[i] - 4.5) * 1.3 + (zufall() - 0.5) * 1.4))), lp[lpk]]);
}

// Material: Ablage von Martin Keller (Deutsch), geteiltes Material von Kolleginnen und Kollegen, Freigaben für 3a
{
  const { speicher, neuerKey } = await import("../../apps/api/src/material/speicher.mjs");
  const { textAuszug } = await import("../../apps/api/src/material/dateien.mjs");
  const { beispielPdf } = await import("./beispiel-pdf.mjs");
  const ordner = async (besitzer, name, eltern = null) => (await q("INSERT INTO ordner (besitzer_id, eltern_id, name) VALUES ($1,$2,$3) RETURNING id", [besitzer, eltern, name]))[0].id;
  const tage = (n) => new Date(Date.now() + n * 864e5).toISOString();
  async function mat(besitzer, o, f, typ, titel, extra = {}) {
    const [m] = await q(`INSERT INTO material (besitzer_id, ordner_id, fach_id, stufe, typ, titel, beschreibung, url, inhalt, schlagworte, sichtbarkeit, erstellt_am, geaendert_am)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING id`, [besitzer, o, fach[f], extra.stufe || 3, typ, titel, extra.beschreibung || "", extra.url || null, extra.inhalt || null, extra.schlagworte || [], extra.sichtbarkeit || "privat", extra.am || tage(-10)]);
    if (extra.pdf) {
      const buf = beispielPdf(titel, extra.pdf), key = neuerKey(s.id);
      await speicher.ablegen(key, buf, "application/pdf");
      const t = await textAuszug("pdf", buf);
      const [v] = await q(`INSERT INTO material_version (material_id, nr, datei_key, dateiname, mime, groesse, sha256, seiten, text_auszug, hochgeladen_von)
        VALUES ($1,1,$2,$3,'application/pdf',$4,'seed',$5,$6,$7) RETURNING id`, [m.id, key, (extra.dateiname || titel) + ".pdf", buf.length, t.seiten || 1, t.text, besitzer]);
      await q("UPDATE material SET aktuelle_version_id = $1, such_text = $2 WHERE id = $3", [v.id, t.text, m.id]);
    }
    return m.id;
  }
  const [uD3a] = await q("SELECT id FROM unterricht WHERE klasse_id = $1 AND fach_id = $2", [k3a.id, fach.D]);
  const [uD3b] = await q("SELECT u.id FROM unterricht u JOIN klasse k ON k.id = u.klasse_id WHERE k.name = '3b' AND u.fach_id = $1", [fach.D]);
  const frei = (m, u, ab = tage(-7), bis = null, hinweis = "") => q("INSERT INTO freigabe (material_id, unterricht_id, ab, bis, hinweis, erstellt_von) VALUES ($1,$2,$3,$4,$5,$6)", [m, u, ab, bis, hinweis, lp.KEM]);

  const oD3 = await ordner(lp.KEM, "Deutsch 3. Klasse"), oNov = await ordner(lp.KEM, "Novelle", oD3), oGr = await ordner(lp.KEM, "Grammatik", oD3);
  await ordner(lp.KEM, "Maturavorbereitung");
  const m1 = await mat(lp.KEM, oD3, "D", "datei", "Merkblatt Erörterung", { dateiname: "Merkblatt_Eroerterung", schlagworte: ["erörterung", "aufsatz", "argumentation"], sichtbarkeit: "fachgruppe", am: tage(-30), pdf: [
    "Eine Erörterung untersucht eine Frage von mehreren Seiten und kommt zu einem begründeten Urteil.",
    "Aufbau: Einleitung mit Hinführung zur Frage. Hauptteil mit Argumenten und Gegenargumenten, jeweils mit Behauptung, Begründung und Beispiel. Schluss mit eigenem, begründetem Urteil.",
    "Lineare Erörterung: Die Argumente sprechen alle für eine Seite und werden nach Gewicht steigend geordnet. Dialektische Erörterung: Pro und Contra werden gegenübergestellt.",
    "Checkliste vor der Abgabe: Ist die Frage in der Einleitung klar gestellt? Hat jedes Argument ein Beispiel? Sind die Übergänge zwischen den Abschnitten verständlich? Folgt das Urteil aus den Argumenten?"] });
  const m2 = await mat(lp.KEM, oNov, "D", "datei", "Kleider machen Leute: Leseauftrag Kapitel 1 bis 3", { dateiname: "Leseauftrag_Kleider_machen_Leute", schlagworte: ["novelle", "gottfried keller", "lektüre"], am: tage(-12), pdf: [
    "Lesen Sie die ersten drei Kapitel der Novelle «Kleider machen Leute» von Gottfried Keller.",
    "Aufgabe 1: Beschreiben Sie, wie der Schneider Wenzel Strapinski in Goldach ankommt und warum ihn die Leute für einen Grafen halten.",
    "Aufgabe 2: Notieren Sie drei Stellen, an denen Strapinski die Verwechslung aufklären könnte. Warum tut er es nicht?",
    "Aufgabe 3: Was sagt der Titel über die Gesellschaft in Goldach aus? Halten Sie Ihre Gedanken in fünf bis acht Sätzen fest.",
    "Abgabe: Bringen Sie Ihre Notizen in die nächste Lektion mit."] });
  const m3 = await mat(lp.KEM, oNov, "D", "datei", "Kleider machen Leute: Lösungshinweise", { dateiname: "Loesungen_Kleider_machen_Leute", schlagworte: ["novelle", "lösungen"], am: tage(-12), pdf: [
    "Hinweise zu Aufgabe 1: Der Kutscher fährt mit Strapinski in einem herrschaftlichen Wagen vor; sein Mantel und sein Auftreten genügen den Goldachern als Beweis.",
    "Hinweise zu Aufgabe 2: Mögliche Stellen sind das Essen im Gasthaus, das Kartenspiel und die Begegnung mit Nettchen. Entscheidend sind Scham, Hunger und der Wunsch, nicht aufzufallen."] });
  const m4 = await mat(lp.KEM, oGr, "D", "text", "Kommaregeln auf einen Blick", { schlagworte: ["komma", "zeichensetzung", "grammatik"], am: tage(-20), inhalt:
    "1. Zwischen Hauptsätzen steht ein Komma, ausser sie sind mit «und» oder «oder» verbunden.\n2. Nebensätze werden mit Komma abgetrennt: «Ich komme, wenn ich Zeit habe.»\n3. Eingeschobene Nebensätze werden vorne und hinten abgetrennt.\n4. Aufzählungen ohne «und» oder «oder» werden mit Komma getrennt.\n5. Vor «aber», «sondern» und «doch» steht ein Komma." });
  const m5 = await mat(lp.KEM, oGr, "D", "link", "Duden online: Rechtschreibung nachschlagen", { url: "https://www.duden.de", schlagworte: ["rechtschreibung", "wörterbuch"], am: tage(-40) });
  await mat(lp.KEM, null, "D", "text", "Ideen für die Projektwoche", { inhalt: "Lesenacht in der Bibliothek, Schreibwerkstatt mit Kurzgeschichten, Besuch im Literaturhaus.", am: tage(-2) });
  await mat(lp.KUB, null, "D", "datei", "Zitieren und Belegen", { dateiname: "Zitieren_und_Belegen", schlagworte: ["zitieren", "quellen", "maturaarbeit"], sichtbarkeit: "fachgruppe", stufe: 5, am: tage(-60), pdf: [
    "Wörtliche Zitate stehen in Anführungszeichen und werden mit Autor, Jahr und Seite belegt.",
    "Sinngemässe Wiedergaben brauchen ebenfalls einen Beleg. Das Literaturverzeichnis am Schluss enthält alle verwendeten Quellen, alphabetisch nach Autor."] });
  await mat(lp.BRT, null, "M", "datei", "Formelsammlung Trigonometrie", { dateiname: "Formelsammlung_Trigonometrie", schlagworte: ["trigonometrie", "formeln"], sichtbarkeit: "schule", am: tage(-15), pdf: [
    "Im rechtwinkligen Dreieck gilt: Sinus = Gegenkathete durch Hypotenuse, Kosinus = Ankathete durch Hypotenuse, Tangens = Gegenkathete durch Ankathete.",
    "Sinussatz: a / sin(alpha) = b / sin(beta) = c / sin(gamma). Kosinussatz: c² = a² + b² - 2ab cos(gamma)."] });

  await frei(m1, uD3a.id, tage(-25)); await frei(m1, uD3b.id, tage(-25));
  await frei(m2, uD3a.id, tage(-10), null, "Bis nächsten Montag lesen.");
  await frei(m3, uD3a.id, tage(5), null, "Erst nach der Besprechung sichtbar.");
  await frei(m4, uD3a.id, tage(-18)); await frei(m5, uD3a.id, tage(-18));
  // Einige Schülerinnen und Schüler haben das Merkblatt schon geöffnet
  for (const pid of sch3a.slice(0, 14)) await q("INSERT INTO material_abruf (material_id, person_id, erstes_am) VALUES ($1,$2,$3)", [m1, pid, tage(-20)]);
  for (const pid of sch3a.slice(2, 9)) await q("INSERT INTO material_abruf (material_id, person_id) VALUES ($1,$2)", [m2, pid]);
}

// Prüfungen: eine fertige Deutschprüfung für 3a, ein Entwurf in Mathematik, einige Aufgaben in der Aufgabenbank
{
  const [uD3a] = await q("SELECT id FROM unterricht WHERE klasse_id = $1 AND fach_id = $2", [k3a.id, fach.D]);
  const [uM3a] = await q("SELECT id FROM unterricht WHERE klasse_id = $1 AND fach_id = $2", [k3a.id, fach.M]);
  const [schlP] = await q("SELECT id FROM notenschluessel WHERE name LIKE 'Linear, 6 ab%'");
  async function pruefung(uid, von, titel, datum, dauer, status, teile, hinweise = "") {
    const [p] = await q(`INSERT INTO pruefung (unterricht_id, erstellt_von, titel, datum, dauer_min, status, notenschluessel_id, einstellungen) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [uid, von, titel, datum, dauer, status, schlP.id, { rueckwaerts: true, mischen: false, hinweise, hilfsmittel: "" }]);
    let nr = 1; for (const t of teile) await q("INSERT INTO pruefung_teil (pruefung_id, nr, typ, inhalt, loesung, punkte) VALUES ($1,$2,$3,$4,$5,$6)", [p.id, nr++, t.typ, t.inhalt, t.loesung || {}, t.punkte || 0]);
    return p.id;
  }
  await pruefung(uD3a.id, lp.KEM, "Kleider machen Leute", "2026-11-27", 45, "bereit", [
    { typ: "abschnitt", inhalt: { titel: "Teil A: Inhalt", text: "Beantworten Sie die Fragen zur Novelle. Bei Auswahlfragen ist jeweils angegeben, ob eine oder mehrere Antworten richtig sind." } },
    { typ: "einfach", punkte: 1, inhalt: { frage: "Wer hat die Novelle «Kleider machen Leute» geschrieben?", optionen: [{ id: "a", text: "Gottfried Keller" }, { id: "b", text: "Jeremias Gotthelf" }, { id: "c", text: "Conrad Ferdinand Meyer" }] }, loesung: { richtig: "a" } },
    { typ: "kurz", punkte: 1, inhalt: { frage: "Wie heisst der Schneider, der für einen Grafen gehalten wird?" }, loesung: { antworten: ["Wenzel Strapinski", "Strapinski"], gross_klein: false } },
    { typ: "mehrfach", punkte: 2, inhalt: { frage: "Welche Aussagen treffen zu? Mehrere Antworten sind richtig.", optionen: [{ id: "a", text: "Strapinski kommt in einer herrschaftlichen Kutsche nach Goldach." }, { id: "b", text: "Strapinski gibt sich von Anfang an als Graf aus." }, { id: "c", text: "Sein Mantel trägt zur Verwechslung bei." }, { id: "d", text: "Die Geschichte spielt in Zürich." }] }, loesung: { richtig: ["a", "c"], teilpunkte: true } },
    { typ: "reihenfolge", punkte: 2, inhalt: { frage: "Bringen Sie die Ereignisse in die richtige Reihenfolge.", elemente: [{ id: "a", text: "Ankunft in Goldach" }, { id: "b", text: "Essen im Gasthaus" }, { id: "c", text: "Begegnung mit Nettchen" }, { id: "d", text: "Die Verwechslung wird aufgedeckt" }] } },
    { typ: "abschnitt", inhalt: { titel: "Teil B: Sprache und Deutung", text: "" } },
    { typ: "luecken", punkte: 3, inhalt: { frage: "Ergänzen Sie die Lücken.", text: "Eine Novelle erzählt eine [[unerhörte]] Begebenheit. Oft gibt es einen [[Wendepunkt]], an dem sich das Geschehen entscheidet. «Kleider machen Leute» gehört zur Sammlung «Die Leute von [[Seldwyla]]»." }, loesung: { gross_klein: false } },
    { typ: "zuordnung", punkte: 3, inhalt: { frage: "Ordnen Sie die Figuren ihrer Rolle zu.", paare: [{ id: "a", links: "Strapinski", rechts: "Schneidergeselle" }, { id: "b", links: "Nettchen", rechts: "Tochter des Amtsrats" }, { id: "c", links: "Melchior Böhni", rechts: "Buchhalter und Rivale" }] } },
    { typ: "freitext", punkte: 6, inhalt: { frage: "Erklären Sie, warum Strapinski die Verwechslung nicht aufklärt. Stützen Sie sich auf mindestens zwei Stellen im Text.", zeilen: 12 }, loesung: { erwartung: "Scham und Hunger; der Wunsch, nicht aufzufallen; jede verpasste Gelegenheit macht das Aufklären schwieriger. Zwei passende Textstellen." } },
  ], "Lesen Sie jede Aufgabe genau. Sie können jederzeit zu früheren Aufgaben zurückkehren.");
  await pruefung(uM3a.id, lp.BRT, "Trigonometrie", "2026-12-04", 60, "entwurf", [
    { typ: "zahl", punkte: 2, inhalt: { frage: "Berechnen Sie $\\sin(30^\\circ)$.", einheit: "" }, loesung: { wert: 0.5, toleranz: 0 } },
    { typ: "zahl", punkte: 3, inhalt: { frage: "In einem rechtwinkligen Dreieck ist die Hypotenuse $c = 10$ cm und der Winkel $\\alpha = 35^\\circ$. Berechnen Sie die Gegenkathete $a$ auf zwei Nachkommastellen.", einheit: "cm" }, loesung: { wert: 5.74, toleranz: 0.01 } },
    { typ: "freitext", punkte: 4, inhalt: { frage: "Leiten Sie den Kosinussatz $c^2 = a^2 + b^2 - 2ab\\cos\\gamma$ für ein spitzwinkliges Dreieck her.", zeilen: 14 } },
  ]);
  for (const [typ, punkte, inhalt, loesung, sw] of [
    ["einfach", 1, { frage: "Welche Epoche folgt auf die Klassik?", optionen: [{ id: "a", text: "Romantik" }, { id: "b", text: "Barock" }, { id: "c", text: "Aufklärung" }] }, { richtig: "a" }, ["epochen"]],
    ["kurz", 1, { frage: "Wie nennt man den Wendepunkt einer Novelle mit einem Fachbegriff aus der Novellentheorie?" }, { antworten: ["Falke", "Dingsymbol"] }, ["novelle"]],
    ["luecken", 2, { frage: "Ergänzen Sie die Kommaregel.", text: "Nebensätze werden durch ein [[Komma]] vom [[Hauptsatz]] abgetrennt." }, {}, ["komma", "grammatik"]],
  ]) await q("INSERT INTO aufgabe (besitzer_id, fach_id, typ, inhalt, loesung, punkte, schlagworte, geteilt, such_text) VALUES ($1,$2,$3,$4,$5,$6,$7,'fachgruppe',$8)",
    [lp.KEM, fach.D, typ, inhalt, loesung, punkte, sw, [inhalt.frage, inhalt.text, ...(inhalt.optionen || []).map((o) => o.text)].filter(Boolean).join(" ")]);
}

// Schulbetrieb: Geburtsdaten, Eltern, Stundenplan, Auftrag, Klassenraum, Formular, Absenzen, Maturaarbeit
{
  const tag = (n) => { const d = new Date(Date.now() + n * 864e5); return d.toLocaleDateString("sv-SE", { timeZone: "Europe/Zurich" }); };
  const klassen = await q("SELECT id, name, stufe FROM klasse");
  for (const k of klassen) {
    const sch = await q("SELECT ks.person_id AS id FROM klasse_schueler ks JOIN person p ON p.id = ks.person_id WHERE ks.klasse_id = $1 ORDER BY p.extern_id", [k.id]);
    // 3. Klasse: etwa 15 bis 16 Jahre, 5. Klasse: 17 bis 18 Jahre (die ersten fünf sind schon volljährig)
    for (let n = 0; n < sch.length; n++) {
      const jahr = k.stufe === 5 ? (n < 5 ? 2008 : 2009) : 2010 + (n % 3 === 0 ? 1 : 0);
      await q("UPDATE person SET geburtsdatum = $1 WHERE id = $2", [`${jahr}-${String(1 + (n * 5) % 12).padStart(2, "0")}-${String(1 + (n * 7) % 28).padStart(2, "0")}`, sch[n].id]);
    }
  }
  const [lea] = await q("SELECT id FROM person WHERE email = 'lea.ammann.26001@schueler.seeufer.test'");
  const [kind2] = await q("SELECT p.id FROM person p JOIN klasse_schueler ks ON ks.person_id = p.id WHERE ks.klasse_id = $1 AND p.extern_id = '26002'", [k3a.id]);
  const mama = await person("Daniela", "Ammann", ["eltern"], { email: "daniela.ammann@eltern.seeufer.test", konto: true });
  await q("INSERT INTO eltern_kind (eltern_id, kind_id, beziehung) VALUES ($1,$2,'mutter')", [mama, lea.id]);
  if (kind2) { const p2 = await person("Marco", "Lüthi", ["eltern"], { email: "marco.luethi@eltern.seeufer.test" }); await q("INSERT INTO eltern_kind (eltern_id, kind_id, beziehung) VALUES ($1,$2,'vater')", [p2, kind2.id]); }

  // Stundenplan 3a (aus einem Untis-Export würde dasselbe entstehen)
  const u3a = Object.fromEntries((await q("SELECT u.id, f.kuerzel FROM unterricht u JOIN fach f ON f.id = u.fach_id WHERE u.klasse_id = $1", [k3a.id])).map((r) => [r.kuerzel, r.id]));
  const PLAN = [[1, 1, "D", "A12"], [1, 2, "D", "A12"], [1, 3, "M", "B04"], [1, 4, "E", "A12"], [1, 6, "B", "N21"], [1, 7, "B", "N21"],
    [2, 1, "F", "A12"], [2, 2, "M", "B04"], [2, 3, "G", "A15"], [2, 4, "G", "A15"], [2, 6, "P", "N11"],
    [3, 1, "E", "A12"], [3, 2, "D", "A12"], [3, 3, "F", "A12"], [3, 4, "M", "B04"],
    [4, 1, "M", "B04"], [4, 2, "P", "N11"], [4, 3, "P", "N11"], [4, 4, "D", "A12"], [4, 6, "F", "A12"], [4, 7, "E", "A12"],
    [5, 1, "B", "N21"], [5, 2, "G", "A15"], [5, 3, "F", "A12"], [5, 4, "M", "B04"]];
  for (const [wt, l, f, raum] of PLAN) await q("INSERT INTO stundenplan (unterricht_id, wochentag, lektion, raum, gueltig_von, gueltig_bis) VALUES ($1,$2,$3,$4,'2026-08-17','2027-07-16')", [u3a[f], wt, l, raum]);
  // Eine Änderung in den nächsten Tagen: Mathematik fällt aus
  for (let n = 1; n <= 7; n++) { const d = new Date(Date.now() + n * 864e5); if (d.getDay() === 3) { await q("INSERT INTO stundenplan_aenderung (datum, unterricht_id, lektion, art, text, erstellt_von) VALUES ($1,$2,4,'ausfall','Weiterbildung',$3)", [tag(n), u3a.M, admin]); break; } }

  // Auftrag in Deutsch 3a
  const [auf] = await q(`INSERT INTO auftrag (unterricht_id, titel, anleitung, faellig_am, punkte_max, raster, abgabe, status, erstellt_von) VALUES ($1,$2,$3,$4,12,$5,$6,'veroeffentlicht',$7) RETURNING id`,
    [u3a.D, "Charakterisierung Nettchen", "Schreiben Sie eine Charakterisierung von Nettchen (400 bis 600 Wörter). Belegen Sie jede Aussage mit einer Textstelle.",
      new Date(Date.now() + 5 * 864e5).toISOString(), JSON.stringify([{ id: "inhalt", kriterium: "Inhalt und Belege", beschreibung: "", punkte: 6 }, { id: "aufbau", kriterium: "Aufbau", beschreibung: "", punkte: 3 }, { id: "sprache", kriterium: "Sprache", beschreibung: "", punkte: 3 }]),
      { text: true, datei: true, notizbuch: true }, lp.KEM]);
  await q("INSERT INTO auftrag_abgabe (auftrag_id, schueler_id, status, text, abgegeben_am) VALUES ($1,$2,'abgegeben',$3, now() - interval '1 day')", [auf.id, sch3a[1], "Nettchen ist die Tochter des Amtsrats …"]);

  // Klassenraum Deutsch 3a
  const [ank] = await q("INSERT INTO beitrag (unterricht_id, autor_id, art, text, angeheftet) VALUES ($1,$2,'ankuendigung',$3,true) RETURNING id", [u3a.D, lp.KEM, "Bitte bringen Sie am Montag die Lektüre «Kleider machen Leute» mit. Wir lesen Kapitel 4 gemeinsam."]);
  const [fr] = await q("INSERT INTO beitrag (unterricht_id, autor_id, art, text) VALUES ($1,$2,'frage',$3) RETURNING id", [u3a.D, lea.id, "Zählt bei der Charakterisierung das Zitat zur Wortzahl?"]);
  await q("INSERT INTO beitrag (unterricht_id, autor_id, art, text, eltern_id) VALUES ($1,$2,'beitrag',$3,$4)", [u3a.D, lp.KEM, "Nein, Zitate zählen nicht zur Wortzahl.", fr.id]);
  await q("UPDATE beitrag SET beantwortet = true WHERE id = $1", [fr.id]);
  await q("INSERT INTO schulmitteilung (titel, text, zielgruppe, wichtig, autor_id) VALUES ($1,$2,$3,true,$4)",
    ["Elternabend der 3. Klassen", "Der Elternabend der 3. Klassen findet am Donnerstag, 10. Dezember, um 19 Uhr in der Aula statt. Bitte melden Sie sich über das Formular an.", ["lehrperson", "schueler", "eltern"], admin]);

  // Formulare: Quiz Deutsch, Anmeldung Elternabend (Fragen über dieselbe Prüfung wie in der App)
  const { fragenLesen } = await import("../shared/src/formular.mjs");
  const quiz = fragenLesen([
    { id: "f1", typ: "einfach", punkte: 1, inhalt: { frage: "Wo steht das Komma? «Ich hoffe dass du kommst.»", optionen: [{ id: "a", text: "nach «hoffe»" }, { id: "b", text: "nach «dass»" }, { id: "c", text: "Es braucht keines." }] }, loesung: { richtig: "a" } },
    { id: "f2", typ: "mehrfach", punkte: 2, inhalt: { frage: "Welche Sätze sind richtig gesetzt?", optionen: [{ id: "a", text: "Er kam, sah und siegte." }, { id: "b", text: "Er kam, und sah, und siegte." }, { id: "c", text: "Weil es regnet, bleiben wir drinnen." }] }, loesung: { richtig: ["a", "c"], teilpunkte: true } },
  ], "quiz");
  await q(`INSERT INTO formular (art, titel, beschreibung, unterricht_id, fragen, einstellungen, status, erstellt_von) VALUES ('quiz', 'Kommaregeln: Selbsttest', 'Prüfen Sie, ob Sie die Kommaregeln sicher beherrschen.', $1, $2, $3, 'offen', $4)`,
    [u3a.D, JSON.stringify(quiz), { mehrfach: true, loesungen: true }, lp.KEM]);
  const anm = fragenLesen([
    { id: "zeit", typ: "termin", inhalt: { frage: "Gespräch mit der Klassenlehrperson (freiwillig, 10 Minuten)", optionen: [{ id: "t1", text: "Do 10.12., 20:00", plaetze: 3 }, { id: "t2", text: "Do 10.12., 20:15", plaetze: 3 }, { id: "t3", text: "Kein Gespräch nötig", plaetze: 0 }] } },
    { id: "personen", typ: "auswahl", inhalt: { frage: "Wie viele Personen kommen?", optionen: [{ id: "p1", text: "1 Person" }, { id: "p2", text: "2 Personen" }] } },
    { id: "fragen", typ: "text", pflicht: false, inhalt: { frage: "Fragen an die Klassenlehrperson" } },
  ], "anmeldung");
  await q(`INSERT INTO formular (art, titel, beschreibung, fragen, einstellungen, status, erstellt_von, schliesst_am) VALUES ('anmeldung', 'Elternabend 3. Klassen', 'Bitte melden Sie sich bis eine Woche vorher an.', $1, $2, 'offen', $3, $4)`,
    [JSON.stringify(anm), { oeffentlich: true }, admin, new Date(Date.now() + 14 * 864e5).toISOString()]);

  // Absenzen 3a
  const [uE] = [u3a.E];
  for (const [n, sid, l, status] of [[-3, sch3a[4], 1, "offen"], [-3, sch3a[4], 2, "offen"], [-20, sch3a[5], 1, "unentschuldigt"], [-20, sch3a[5], 2, "unentschuldigt"], [-10, sch3a[5], 4, "unentschuldigt"], [-6, lea.id, 4, "entschuldigt"]])
    await q("INSERT INTO absenz (schueler_id, datum, lektion, unterricht_id, art, status, erfasst_von) VALUES ($1,$2,$3,$4,'abwesend',$5,$6)", [sid, tag(n), l, uE, status, lp.HUN]);

  // Zeugnisnoten 1. Semester 3a (Deutsch und Mathematik noch Entwurf, Rest freigegeben), damit Promotion und Zeugnis etwas zeigen. Zwei Fälle unter dem Strich.
  {
    const unt = await q("SELECT u.id, f.kuerzel FROM unterricht u JOIN fach f ON f.id = u.fach_id WHERE u.klasse_id = $1 ORDER BY f.kuerzel", [k3a.id]);
    const sch = await q("SELECT ks.person_id AS id FROM klasse_schueler ks JOIN person p ON p.id = ks.person_id WHERE ks.klasse_id = $1 ORDER BY p.extern_id", [k3a.id]);
    for (let n = 0; n < sch.length; n++) for (let j = 0; j < unt.length; j++) {
      let note = Math.min(6, Math.max(3, Math.round((NOTEN[n] + ((n * 7 + j * 3) % 5 - 2) * 0.25) * 2) / 2));
      if (n === 5 && j < 4) note = 3.5; // knapp nicht erfüllt
      if (n === 12 && j < 5) note = 3; // deutlich nicht erfüllt
      await q("INSERT INTO zeugnisnote (unterricht_id, schueler_id, semester_id, gesetzt, status, geaendert_von) VALUES ($1,$2,$3,$4,$5,$6)", [unt[j].id, sch[n].id, sem1.id, note, ["D", "M"].includes(unt[j].kuerzel) ? "entwurf" : "freigegeben", admin]);
    }
  }

  // Maturaarbeit in 5c
  const [k5c] = await q("SELECT id FROM klasse WHERE name = '5c'");
  const [s5] = await q("SELECT ks.person_id AS id FROM klasse_schueler ks JOIN person p ON p.id = ks.person_id WHERE ks.klasse_id = $1 ORDER BY p.extern_id LIMIT 1", [k5c.id]);
  await q("INSERT INTO konto (person_id, art, passwort_hash) VALUES ($1,'lokal',$2)", [s5.id, pwHash]);
  const [ma] = await q(`INSERT INTO maturaarbeit (schueler_id, betreuer_id, fach_id, titel, fragestellung, status, abgabe_bis, bewertung) VALUES ($1,$2,$3,$4,$5,'in_arbeit','2027-01-15',$6) RETURNING id`,
    [s5.id, lp.STC, fach.G, "Die Seegfrörni von 1963 in Zürcher Zeitzeugenberichten", "Wie erinnern sich Zeitzeuginnen und Zeitzeugen an die Seegfrörni 1963, und wie unterscheiden sich ihre Berichte von der Zeitungsberichterstattung?",
      { kriterien: [{ id: "prozess", name: "Arbeitsprozess", gewicht: 25, note: null, kommentar: "" }, { id: "produkt", name: "Produkt (schriftliche Arbeit)", gewicht: 50, note: null, kommentar: "" }, { id: "praesentation", name: "Präsentation", gewicht: 25, note: null, kommentar: "" }] }]);
  const MS = ["Thema und Fragestellung festgelegt", "Disposition und Zeitplan", "Zwischenbericht", "Rohfassung", "Abgabe der Arbeit", "Präsentation"];
  for (let r = 0; r < MS.length; r++) await q("INSERT INTO ma_meilenstein (arbeit_id, titel, faellig, reihenfolge, erledigt_am, bestaetigt_am, bestaetigt_von) VALUES ($1,$2,$3,$4,$5,$5,$6)",
    [ma.id, MS[r], ["2026-06-15", "2026-08-31", "2026-10-30", "2026-12-11", "2027-01-15", "2027-02-26"][r], r, r < 2 ? "2026-09-01T10:00:00Z" : null, r < 2 ? lp.STC : null]);
  for (const [d, art, t, h, von] of [["2026-09-14", "eintrag", "Drei Interviewpartner gefunden, Fragebogen entworfen.", 3, s5.id], ["2026-10-02", "besprechung", "Fragebogen besprochen: offene Fragen stärker gewichten.", null, lp.STC], ["2026-10-20", "eintrag", "Zwei Interviews geführt und transkribiert.", 6, s5.id]])
    await q("INSERT INTO ma_journal (arbeit_id, autor_id, datum, art, text, stunden) VALUES ($1,$2,$3,$4,$5,$6)", [ma.id, von, d, art, t, h]);
}

await q("COMMIT");
await c.end();
console.log(`Testschule «seeufer» angelegt. Anmeldung: /s/seeufer · admin@seeufer.test oder martin.keller@seeufer.test · Passwort: ${PW}`);
