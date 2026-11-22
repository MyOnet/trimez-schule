// Kalender: Lektionszeiten, Wochen, Prüfungslimit, Untis-Import. Eine Stelle für Server, Oberfläche und Tests.

/** Standard-Lektionszeiten (die Schule passt sie unter «Kalender» an) */
export const LEKTIONEN_STANDARD = [
  { nr: 1, von: "07:45", bis: "08:30" }, { nr: 2, von: "08:35", bis: "09:20" }, { nr: 3, von: "09:30", bis: "10:15" },
  { nr: 4, von: "10:35", bis: "11:20" }, { nr: 5, von: "11:25", bis: "12:10" }, { nr: 6, von: "12:15", bis: "13:00" },
  { nr: 7, von: "13:10", bis: "13:55" }, { nr: 8, von: "14:00", bis: "14:45" }, { nr: 9, von: "14:55", bis: "15:40" },
  { nr: 10, von: "15:45", bis: "16:30" }, { nr: 11, von: "16:35", bis: "17:20" },
];
/** Standard: höchstens 2 Prüfungen pro Klasse und Woche, höchstens 1 pro Tag */
export const PRUEFUNGSLIMIT_STANDARD = { proWoche: 2, proTag: 1 };
export const WOCHENTAGE = ["", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

/** «JJJJ-MM-TT» → Wochentag 1 (Mo) … 7 (So) */
export function wochentag(d) { const x = new Date(d + "T12:00:00Z").getUTCDay(); return x === 0 ? 7 : x; }
/** Montag der Woche (ISO) als «JJJJ-MM-TT» */
export function wochenbeginn(d) { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() - (wochentag(d) - 1)); return x.toISOString().slice(0, 10); }
export function plusTage(d, n) { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
/** ISO-Kalenderwoche */
export function kalenderwoche(d) {
  const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + 4 - wochentag(d));
  const jan1 = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  return Math.ceil(((x - jan1) / 864e5 + 1) / 7);
}
/** A/B-Woche: ungerade Kalenderwoche = A */
export const abWoche = (d) => (kalenderwoche(d) % 2 === 1 ? "A" : "B");

/** Lokale Zeit in Zürich (Datum + «HH:MM») → ISO-Zeitpunkt (Sommer- und Winterzeit) */
export function zuerich(datum, hhmm) {
  const [y, m, d] = datum.split("-").map(Number), [h, mi] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const teile = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Zurich", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(guess)).map((p) => [p.type, p.value]));
  const lokal = Date.UTC(+teile.year, +teile.month - 1, +teile.day, +teile.hour, +teile.minute);
  return new Date(guess - (lokal - guess)).toISOString();
}

/**
 * Prüfungslimit prüfen. vorhanden: [{ datum, titel, fach }] in derselben Klasse (ohne die neue Prüfung).
 * → { ok, woche: [...], tag: [...], grund }
 */
export function pruefungslimit(datum, vorhanden, limit = PRUEFUNGSLIMIT_STANDARD) {
  const wb = wochenbeginn(datum);
  const woche = vorhanden.filter((p) => wochenbeginn(p.datum) === wb);
  const tag = vorhanden.filter((p) => p.datum === datum);
  let grund = null;
  if (limit.proTag && tag.length >= limit.proTag) grund = `Die Klasse hat an diesem Tag schon ${tag.length === 1 ? "eine Prüfung" : `${tag.length} Prüfungen`} (erlaubt: ${limit.proTag}).`;
  else if (limit.proWoche && woche.length >= limit.proWoche) grund = `Die Klasse hat in dieser Woche schon ${woche.length} Prüfungen (erlaubt: ${limit.proWoche}).`;
  return { ok: !grund, woche, tag, grund };
}

/**
 * Untis-Export GPU001.TXT (Stundenplan) lesen. Spalten: Unterrichtsnummer, Klasse, Lehrperson, Fach, Raum, Tag, Stunde.
 * Trennzeichen Komma, Semikolon oder Tabulator; Felder in Anführungszeichen. → [{ nr, klasse, lehrer, fach, raum, tag, stunde, zeile }]
 */
export function untisLesen(textRoh) {
  const zeilen = String(textRoh || "").replace(/^﻿/, "").split(/\r?\n/);
  const out = [], fehler = [];
  zeilen.forEach((z, i) => {
    if (!z.trim()) return;
    const trenner = z.includes(";") ? ";" : z.includes("\t") ? "\t" : ",";
    const f = []; let cur = "", inQ = false;
    for (let k = 0; k < z.length; k++) {
      const c = z[k];
      if (c === '"') { if (inQ && z[k + 1] === '"') { cur += '"'; k++; } else inQ = !inQ; }
      else if (c === trenner && !inQ) { f.push(cur); cur = ""; }
      else cur += c;
    }
    f.push(cur);
    const [nr, klasse, lehrer, fach, raum, tag, stunde] = f.map((x) => x.trim());
    const t = Number(tag), s = Number(stunde);
    if (!klasse || !fach || !(t >= 1 && t <= 6) || !(s >= 1 && s <= 16)) { fehler.push({ zeile: i + 1, text: z.slice(0, 120) }); return; }
    out.push({ nr: nr || "", klasse, lehrer: lehrer || "", fach, raum: raum || "", tag: t, stunde: s, zeile: i + 1 });
  });
  return { eintraege: out, fehler };
}
