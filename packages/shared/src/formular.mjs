// Formulare: Quiz (bewertet sich selbst), Umfrage und Anmeldung. Prüfen der Fragen, der Antworten und Auswertung.
// Quizfragen verwenden die Aufgabentypen der Prüfungen (dieselbe Bewertung). Dazu kommen Umfrage-Typen.
import { teilPruefen, bewerten, fuerSchueler, AufgabeFehler } from "./pruefung.mjs";

export const QUIZ_TYPEN = ["einfach", "mehrfach", "kurz", "zahl", "luecken", "zuordnung", "reihenfolge"];
export const UMFRAGE_TYPEN = {
  auswahl: "Auswahl (eine oder mehrere)",
  skala: "Skala (z. B. 1 bis 5)",
  text: "Textantwort",
  termin: "Zeitfenster mit Plätzen (Anmeldung)",
};
export const FORMULAR_ARTEN = { quiz: "Quiz zur Selbstkontrolle", umfrage: "Umfrage", anmeldung: "Anmeldung" };

const nein = (msg, feld) => { throw new AufgabeFehler(msg, feld); };
const t = (x, max = 2000) => String(x ?? "").replace(/\r\n/g, "\n").slice(0, max);
const kid = (x, i) => (/^[a-z0-9_-]{1,16}$/i.test(String(x || "")) ? String(x) : "o" + (i + 1));

/** Eine Frage prüfen. art bestimmt, welche Typen erlaubt sind. */
export function frageLesen(roh, art, i = 0) {
  const fid = kid(roh && roh.id, i).replace(/^o/, "f");
  const typ = roh && roh.typ;
  const pflicht = roh.pflicht !== false;
  if (art === "quiz" && !QUIZ_TYPEN.includes(typ)) nein(`Frage ${i + 1}: In einem Quiz gibt es nur Aufgaben mit richtiger Lösung.`, `fragen.${i}.typ`);
  if (QUIZ_TYPEN.includes(typ)) {
    try { const p = teilPruefen(roh); return { id: fid, ...p, pflicht }; }
    catch (e) { nein(`Frage ${i + 1}: ${e.message}`, `fragen.${i}.${e.feld || "typ"}`); }
  }
  if (!UMFRAGE_TYPEN[typ]) nein(`Frage ${i + 1}: Unbekannter Fragetyp.`, `fragen.${i}.typ`);
  if (typ === "termin" && art !== "anmeldung") nein(`Frage ${i + 1}: Zeitfenster gibt es nur bei Anmeldungen.`, `fragen.${i}.typ`);
  const inh = roh.inhalt || {};
  const frage = t(inh.frage, 1000).trim() || nein(`Frage ${i + 1}: Bitte die Frage eingeben.`, `fragen.${i}.frage`);
  if (typ === "text") return { id: fid, typ, pflicht, inhalt: { frage, lang: !!inh.lang } };
  if (typ === "skala") {
    const von = Math.max(0, Math.min(1, Number(inh.von ?? 1))), bis = Math.max(3, Math.min(10, Number(inh.bis ?? 5)));
    return { id: fid, typ, pflicht, inhalt: { frage, von, bis, links: t(inh.links, 60), rechts: t(inh.rechts, 60) } };
  }
  const opt = (Array.isArray(inh.optionen) ? inh.optionen : []).map((o, k) => ({ id: kid(o.id, k), text: t(o.text, 300).trim(), ...(typ === "termin" ? { plaetze: Math.max(0, Math.min(10000, Math.round(Number(o.plaetze) || 0))) } : {}) })).filter((o) => o.text);
  if (opt.length < (typ === "termin" ? 1 : 2)) nein(`Frage ${i + 1}: Bitte ${typ === "termin" ? "mindestens ein Zeitfenster" : "mindestens zwei Antworten"} eingeben.`, `fragen.${i}.optionen`);
  if (new Set(opt.map((o) => o.id)).size !== opt.length) nein(`Frage ${i + 1}: Antworten brauchen verschiedene Kennungen.`, `fragen.${i}.optionen`);
  if (typ === "termin") return { id: fid, typ, pflicht, inhalt: { frage, optionen: opt } };
  return { id: fid, typ, pflicht, inhalt: { frage, optionen: opt, mehrere: !!inh.mehrere } };
}

export function fragenLesen(liste, art) {
  if (!Array.isArray(liste)) return [];
  if (liste.length > 100) nein("Höchstens 100 Fragen.");
  const f = liste.map((x, i) => frageLesen(x, art, i));
  // Kennungen eindeutig machen
  const ids = new Set();
  for (const x of f) { let n = x.id, k = 2; while (ids.has(n)) n = `${x.id}_${k++}`; x.id = n; ids.add(n); }
  if (art === "anmeldung" && f.filter((x) => x.typ === "termin").length > 1) nein("Eine Anmeldung hat höchstens eine Frage mit Zeitfenstern.");
  return f;
}

/** Fragen ohne Lösung für die Teilnehmenden. belegt: { optionId: Anzahl } für Zeitfenster */
export function fuerTeilnehmer(fragen, schluessel, belegt = {}) {
  return fragen.map((f) => {
    if (QUIZ_TYPEN.includes(f.typ)) return { ...fuerSchueler(f, schluessel, { optionenMischen: false }), id: f.id, pflicht: f.pflicht };
    if (f.typ === "termin") return { ...f, inhalt: { ...f.inhalt, optionen: f.inhalt.optionen.map((o) => ({ ...o, frei: o.plaetze ? Math.max(0, o.plaetze - (belegt[o.id] || 0)) : null })) } };
    return f;
  });
}

/** Antworten prüfen und (bei Quizfragen) bewerten → { antworten, punkte, max, ergebnisse: { fid: { punkte, max, richtig } } } */
export function antwortenLesen(fragen, roh) {
  const a = roh && typeof roh === "object" ? roh : {};
  const out = {}, ergebnisse = {};
  let punkte = 0, max = 0;
  for (const [i, f] of fragen.entries()) {
    let v = a[f.id];
    const leer = v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length) || (typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length);
    if (leer) { if (f.pflicht) nein(`Bitte Frage ${i + 1} beantworten.`, f.id); continue; }
    if (QUIZ_TYPEN.includes(f.typ)) {
      const ok = f.typ === "einfach" ? typeof v === "string" : f.typ === "zuordnung" ? typeof v === "object" && !Array.isArray(v) : ["mehrfach", "luecken", "reihenfolge"].includes(f.typ) ? Array.isArray(v) : true;
      if (!ok) nein(`Frage ${i + 1}: ungültige Antwort.`, f.id);
      v = JSON.parse(JSON.stringify(v).slice(0, 20000));
      const b = bewerten(f, v);
      const p = b.punkte ?? 0;
      punkte += p; max += Number(f.punkte) || 0;
      ergebnisse[f.id] = { punkte: p, max: Number(f.punkte) || 0, richtig: p >= (Number(f.punkte) || 0) };
    } else if (f.typ === "text") v = t(v, f.inhalt.lang ? 5000 : 500);
    else if (f.typ === "skala") { const n = Number(v); if (!Number.isInteger(n) || n < f.inhalt.von || n > f.inhalt.bis) nein(`Frage ${i + 1}: Wert zwischen ${f.inhalt.von} und ${f.inhalt.bis}.`, f.id); v = n; }
    else if (f.typ === "auswahl") {
      const ids = new Set(f.inhalt.optionen.map((o) => o.id));
      const w = (Array.isArray(v) ? v : [v]).map(String).filter((x) => ids.has(x));
      if (!w.length) nein(`Frage ${i + 1}: ungültige Antwort.`, f.id);
      v = f.inhalt.mehrere ? [...new Set(w)] : w[0];
    } else if (f.typ === "termin") {
      if (!f.inhalt.optionen.some((o) => o.id === String(v))) nein(`Frage ${i + 1}: Bitte ein Zeitfenster wählen.`, f.id);
      v = String(v);
    }
    out[f.id] = v;
  }
  return { antworten: out, punkte: Math.round(punkte * 100) / 100, max: Math.round(max * 100) / 100, ergebnisse };
}

/** Lösung zu einer Quizfrage zum Anzeigen nach dem Absenden */
export function loesungAnzeige(f) {
  const i = f.inhalt || {}, l = f.loesung || {};
  switch (f.typ) {
    case "einfach": return (i.optionen.find((o) => o.id === l.richtig) || {}).text || "";
    case "mehrfach": return i.optionen.filter((o) => (l.richtig || []).includes(o.id)).map((o) => o.text).join(" · ");
    case "kurz": return (l.antworten || []).join(" oder ");
    case "zahl": return `${l.wert}${i.einheit ? " " + i.einheit : ""}${l.toleranz ? ` (± ${l.toleranz})` : ""}`;
    case "luecken": return String(i.text || "").replace(/\[\[([^\]|]+)[^\]]*\]\]/g, "«$1»");
    case "zuordnung": return (i.paare || []).map((p) => `${p.links} → ${p.rechts}`).join(" · ");
    case "reihenfolge": return (i.elemente || []).map((e) => e.text).join(" → ");
  }
  return "";
}

/** Auswertung über alle Antworten: pro Frage Zählung, Schnitt, Texte, Anteil richtig */
export function formularAuswerten(fragen, antworten) {
  return fragen.map((f) => {
    const werte = antworten.map((a) => a.antworten && a.antworten[f.id]).filter((v) => v !== undefined && v !== null && v !== "");
    const basis = { id: f.id, typ: f.typ, frage: (f.inhalt && f.inhalt.frage) || "", anzahl: werte.length };
    if (f.typ === "auswahl" || f.typ === "termin" || f.typ === "einfach" || f.typ === "mehrfach") {
      const z = {}; for (const v of werte) for (const x of Array.isArray(v) ? v : [v]) z[x] = (z[x] || 0) + 1;
      const r = { ...basis, optionen: (f.inhalt.optionen || []).map((o) => ({ id: o.id, text: o.text, anzahl: z[o.id] || 0, ...(o.plaetze !== undefined ? { plaetze: o.plaetze } : {}) })) };
      if (QUIZ_TYPEN.includes(f.typ)) r.richtig = werte.filter((v) => (bewerten(f, v).punkte ?? 0) >= (Number(f.punkte) || 0)).length;
      return r;
    }
    if (f.typ === "skala") {
      const z = {}; for (const v of werte) z[v] = (z[v] || 0) + 1;
      return { ...basis, verteilung: z, schnitt: werte.length ? Math.round((werte.reduce((s, x) => s + Number(x), 0) / werte.length) * 100) / 100 : null, von: f.inhalt.von, bis: f.inhalt.bis };
    }
    if (f.typ === "text") return { ...basis, texte: werte.slice(-200).map(String) };
    return { ...basis, richtig: werte.filter((v) => (bewerten(f, v).punkte ?? 0) >= (Number(f.punkte) || 0)).length };
  });
}
