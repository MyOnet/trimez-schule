// Aufgabentypen einer Prüfung: Prüfung der Eingaben und automatische Bewertung.
// Gemeinsam für Server (Speichern, später Korrektur) und Oberfläche (Editor, Vorschau, Probelösen).
//
// Ein Teil: { typ, inhalt, loesung, punkte }
// Texte (Frage, Abschnitt) dürfen **fett**, *kursiv* und Formeln in $…$ enthalten.

export const TYPEN = {
  abschnitt: { name: "Abschnitt mit Text", kurz: "Text", punkte: false, beschreibung: "Überschrift, Lesetext oder Material zu den folgenden Aufgaben" },
  einfach: { name: "Einfachauswahl", kurz: "Eine richtig", punkte: true, beschreibung: "Genau eine Antwort ist richtig" },
  mehrfach: { name: "Mehrfachauswahl", kurz: "Mehrere richtig", punkte: true, beschreibung: "Eine oder mehrere Antworten sind richtig" },
  kurz: { name: "Kurzantwort", kurz: "Kurzantwort", punkte: true, beschreibung: "Ein Wort oder eine kurze Wendung" },
  zahl: { name: "Zahl", kurz: "Zahl", punkte: true, beschreibung: "Ergebnis als Zahl, mit Toleranz" },
  luecken: { name: "Lückentext", kurz: "Lücken", punkte: true, beschreibung: "Lücken im Text ausfüllen" },
  zuordnung: { name: "Zuordnung", kurz: "Zuordnung", punkte: true, beschreibung: "Paare richtig zuordnen" },
  reihenfolge: { name: "Reihenfolge", kurz: "Reihenfolge", punkte: true, beschreibung: "Elemente in die richtige Reihenfolge bringen" },
  freitext: { name: "Freitext", kurz: "Freitext", punkte: true, beschreibung: "Längere Antwort, wird von Hand korrigiert" },
};

export class AufgabeFehler extends Error { constructor(msg, feld) { super(msg); this.feld = feld; this.status = 400; } }
const nein = (msg, feld) => { throw new AufgabeFehler(msg, feld); };
const t = (x, max = 20000) => String(x ?? "").replace(/\r\n/g, "\n").slice(0, max);
const kurzId = (i) => "abcdefghijklmnopqrstuvwxyz"[i] || "x" + i;

/** Lücken im Text: [[Antwort]] oder [[Antwort|Alternative]] */
export function lueckenLesen(text) {
  const luecken = []; const teile = [];
  let rest = String(text || ""), m;
  const re = /\[\[([^\]]+)\]\]/g; let letzte = 0;
  while ((m = re.exec(rest))) {
    teile.push({ text: rest.slice(letzte, m.index) });
    luecken.push(m[1].split("|").map((x) => x.trim()).filter(Boolean));
    teile.push({ luecke: luecken.length - 1 });
    letzte = m.index + m[0].length;
  }
  teile.push({ text: rest.slice(letzte) });
  return { teile: teile.filter((x) => x.luecke !== undefined || x.text), luecken };
}

/** Prüft und bereinigt einen Teil. Wirft AufgabeFehler mit verständlicher Meldung. */
export function teilPruefen(roh) {
  const typ = roh && roh.typ;
  if (!TYPEN[typ]) nein("Unbekannter Aufgabentyp.", "typ");
  const i = roh.inhalt || {}, l = roh.loesung || {};
  let punkte = Math.round(Number(String(roh.punkte ?? 0).replace(",", ".")) * 100) / 100;
  if (!Number.isFinite(punkte) || punkte < 0 || punkte > 1000) nein("Punkte zwischen 0 und 1000.", "punkte");
  if (!TYPEN[typ].punkte) punkte = 0;
  const frage = t(i.frage);
  const optionen = (liste) => (Array.isArray(liste) ? liste : []).map((o, k) => ({ id: String(o.id || kurzId(k)).slice(0, 12), text: t(o.text, 2000) })).filter((o) => o.text.trim());
  switch (typ) {
    case "abschnitt": return { typ, punkte, inhalt: { titel: t(i.titel, 200), text: t(i.text, 50000) }, loesung: {} };
    case "einfach": case "mehrfach": {
      const o = optionen(i.optionen);
      if (!frage.trim()) nein("Bitte die Frage eingeben.", "frage");
      if (o.length < 2) nein("Bitte mindestens zwei Antworten eingeben.", "optionen");
      if (new Set(o.map((x) => x.id)).size !== o.length) nein("Antworten brauchen verschiedene Kennungen.", "optionen");
      const ids = new Set(o.map((x) => x.id));
      if (typ === "einfach") {
        if (!ids.has(l.richtig)) nein("Bitte die richtige Antwort markieren.", "loesung");
        return { typ, punkte, inhalt: { frage, optionen: o }, loesung: { richtig: l.richtig } };
      }
      const r = [...new Set((Array.isArray(l.richtig) ? l.richtig : []).filter((x) => ids.has(x)))];
      if (!r.length) nein("Bitte mindestens eine richtige Antwort markieren.", "loesung");
      return { typ, punkte, inhalt: { frage, optionen: o }, loesung: { richtig: r, teilpunkte: l.teilpunkte !== false } };
    }
    case "kurz": {
      if (!frage.trim()) nein("Bitte die Frage eingeben.", "frage");
      const a = (Array.isArray(l.antworten) ? l.antworten : String(l.antworten || "").split("\n")).map((x) => t(x, 300).trim()).filter(Boolean);
      return { typ, punkte, inhalt: { frage }, loesung: { antworten: a, gross_klein: !!l.gross_klein } };
    }
    case "zahl": {
      if (!frage.trim()) nein("Bitte die Frage eingeben.", "frage");
      const w = zahlLesen(l.wert); if (w === null) nein("Bitte das richtige Ergebnis als Zahl eingeben.", "loesung");
      const tol = l.toleranz === "" || l.toleranz == null ? 0 : zahlLesen(l.toleranz);
      if (tol === null || tol < 0) nein("Die Toleranz muss eine positive Zahl sein.", "loesung");
      return { typ, punkte, inhalt: { frage, einheit: t(i.einheit, 20).trim() }, loesung: { wert: w, toleranz: tol } };
    }
    case "luecken": {
      const text = t(i.text, 20000);
      const { luecken } = lueckenLesen(text);
      if (!luecken.length) nein("Markieren Sie Lücken mit doppelten eckigen Klammern, z. B. [[Antwort]].", "text");
      if (luecken.some((a) => a.some((x) => x === "?" || x === "…"))) nein("Bitte in jeder Lücke die Lösung statt «?» eintragen.", "text");
      return { typ, punkte, inhalt: { frage, text }, loesung: { gross_klein: !!l.gross_klein } };
    }
    case "zuordnung": {
      const p = (Array.isArray(i.paare) ? i.paare : []).map((x, k) => ({ id: String(x.id || kurzId(k)).slice(0, 12), links: t(x.links, 500).trim(), rechts: t(x.rechts, 500).trim() })).filter((x) => x.links && x.rechts);
      if (p.length < 2) nein("Bitte mindestens zwei Paare eingeben.", "paare");
      return { typ, punkte, inhalt: { frage, paare: p }, loesung: {} };
    }
    case "reihenfolge": {
      const e = optionen(i.elemente);
      if (e.length < 2) nein("Bitte mindestens zwei Elemente eingeben.", "elemente");
      return { typ, punkte, inhalt: { frage, elemente: e }, loesung: {} };
    }
    case "freitext": {
      if (!frage.trim()) nein("Bitte die Frage eingeben.", "frage");
      const z = Math.min(60, Math.max(1, Number(i.zeilen) || 8));
      return { typ, punkte, inhalt: { frage, zeilen: z }, loesung: { erwartung: t(l.erwartung, 20000) } };
    }
  }
}

export function zahlLesen(x) {
  if (x === null || x === undefined) return null;
  const s = String(x).trim().replace(/[’'\s]/g, "").replace(",", ".").replace(/[−–]/g, "-");
  if (!/^-?\d*\.?\d+(e-?\d+)?$/i.test(s)) return null;
  const n = Number(s); return Number.isFinite(n) ? n : null;
}
const norm = (s, gk) => { const x = String(s ?? "").normalize("NFC").trim().replace(/\s+/g, " ").replace(/[.!]$/, ""); return gk ? x : x.toLowerCase(); };
const r2 = (x) => Math.round(x * 100) / 100;

/**
 * Bewertet eine Antwort. Ergebnis: { punkte, automatisch }
 *   automatisch = false: Lehrperson muss entscheiden (Freitext, unbekannte Kurzantwort)
 */
export function bewerten(teil, antwort) {
  const P = Number(teil.punkte) || 0, l = teil.loesung || {}, i = teil.inhalt || {};
  const leer = antwort === undefined || antwort === null || antwort === "" || (Array.isArray(antwort) && !antwort.length) || (typeof antwort === "object" && !Array.isArray(antwort) && !Object.values(antwort).some((v) => v !== "" && v != null));
  switch (teil.typ) {
    case "abschnitt": return { punkte: 0, automatisch: true };
    case "freitext": return { punkte: leer ? 0 : null, automatisch: leer };
    case "einfach": return { punkte: antwort === l.richtig ? P : 0, automatisch: true };
    case "mehrfach": {
      const r = new Set(l.richtig || []), w = new Set(Array.isArray(antwort) ? antwort : []);
      if (!l.teilpunkte) return { punkte: r.size === w.size && [...r].every((x) => w.has(x)) ? P : 0, automatisch: true };
      let treffer = 0, fehl = 0; for (const x of w) r.has(x) ? treffer++ : fehl++;
      return { punkte: r2(P * Math.max(0, (treffer - fehl) / r.size)), automatisch: true };
    }
    case "kurz": {
      if (leer) return { punkte: 0, automatisch: true };
      const ok = (l.antworten || []).some((a) => norm(a, l.gross_klein) === norm(antwort, l.gross_klein));
      return ok ? { punkte: P, automatisch: true } : { punkte: 0, automatisch: false }; // vielleicht richtig, anders geschrieben
    }
    case "zahl": {
      const n = zahlLesen(antwort);
      if (n === null) return { punkte: 0, automatisch: true };
      return { punkte: Math.abs(n - l.wert) <= (l.toleranz || 0) + 1e-9 ? P : 0, automatisch: true };
    }
    case "luecken": {
      const { luecken } = lueckenLesen(i.text);
      const a = Array.isArray(antwort) ? antwort : [];
      let richtig = 0, unsicher = false;
      luecken.forEach((alt, k) => { if (alt.some((x) => norm(x, l.gross_klein) === norm(a[k], l.gross_klein))) richtig++; else if (String(a[k] || "").trim()) unsicher = true; });
      return { punkte: r2((P * richtig) / luecken.length), automatisch: !unsicher };
    }
    case "zuordnung": {
      const p = i.paare || [], a = antwort && typeof antwort === "object" ? antwort : {};
      const richtig = p.filter((x) => a[x.id] === x.id).length;
      return { punkte: r2((P * richtig) / p.length), automatisch: true };
    }
    case "reihenfolge": {
      const e = i.elemente || [], a = Array.isArray(antwort) ? antwort : [];
      const richtig = e.filter((x, k) => a[k] === x.id).length;
      return { punkte: r2((P * richtig) / e.length), automatisch: true };
    }
  }
  return { punkte: null, automatisch: false };
}

/** Text für die Suche in der Aufgabenbank */
export function suchText(teil) {
  const i = teil.inhalt || {};
  return [i.titel, i.text, i.frage, ...(i.optionen || []).map((o) => o.text), ...(i.paare || []).flatMap((p) => [p.links, p.rechts]), ...(i.elemente || []).map((e) => e.text)].filter(Boolean).join(" ").slice(0, 20000);
}

/** Feste Mischung (gleicher Schlüssel → gleiche Reihenfolge), z. B. pro Schüler/in */
export function mischen(liste, schluessel) {
  let h = 2166136261; for (const c of String(schluessel)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const zufall = () => { h += 0x6d2b79f5; let x = h; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  const a = [...liste]; for (let k = a.length - 1; k > 0; k--) { const j = Math.floor(zufall() * (k + 1)); [a[k], a[j]] = [a[j], a[k]]; } return a;
}

/** Leerer Teil eines Typs für den Editor */
export function neuerTeil(typ) {
  const o = [{ id: "a", text: "" }, { id: "b", text: "" }, { id: "c", text: "" }];
  return ({
    abschnitt: { typ, punkte: 0, inhalt: { titel: "", text: "" }, loesung: {} },
    einfach: { typ, punkte: 1, inhalt: { frage: "", optionen: o }, loesung: { richtig: "" } },
    mehrfach: { typ, punkte: 2, inhalt: { frage: "", optionen: o }, loesung: { richtig: [], teilpunkte: true } },
    kurz: { typ, punkte: 1, inhalt: { frage: "" }, loesung: { antworten: [], gross_klein: false } },
    zahl: { typ, punkte: 2, inhalt: { frage: "", einheit: "" }, loesung: { wert: "", toleranz: "" } },
    luecken: { typ, punkte: 3, inhalt: { frage: "Ergänzen Sie die Lücken.", text: "" }, loesung: { gross_klein: false } },
    zuordnung: { typ, punkte: 3, inhalt: { frage: "", paare: [{ id: "a", links: "", rechts: "" }, { id: "b", links: "", rechts: "" }, { id: "c", links: "", rechts: "" }] }, loesung: {} },
    reihenfolge: { typ, punkte: 2, inhalt: { frage: "", elemente: o }, loesung: {} },
    freitext: { typ, punkte: 4, inhalt: { frage: "", zeilen: 8 }, loesung: { erwartung: "" } },
  })[typ];
}

/**
 * Für Entwürfe: Unvollständige Teile dürfen gespeichert werden (z. B. aus einer Umwandlung).
 * Gibt { teil, fehler } zurück; fehler = null, wenn der Teil vollständig ist.
 */
export function teilEntwurf(roh) {
  try { return { teil: teilPruefen(roh), fehler: null }; }
  catch (e) {
    if (!roh || !TYPEN[roh.typ]) throw e;
    const punkte = Math.min(1000, Math.max(0, Math.round((Number(String(roh.punkte ?? 0).replace(",", ".")) || 0) * 100) / 100));
    const inhalt = roh.inhalt && typeof roh.inhalt === "object" ? roh.inhalt : {}, loesung = roh.loesung && typeof roh.loesung === "object" ? roh.loesung : {};
    if (JSON.stringify(inhalt).length + JSON.stringify(loesung).length > 200000) throw new AufgabeFehler("Diese Aufgabe ist zu lang.");
    return { teil: { typ: roh.typ, punkte: TYPEN[roh.typ].punkte ? punkte : 0, inhalt, loesung }, fehler: e.message };
  }
}

/**
 * Teil ohne Lösung für Schülerinnen und Schüler. Alles, was die Lösung verraten würde, wird entfernt oder gemischt:
 *   Lücken → [[·]], Zuordnung → getrennte, gemischte Listen, Reihenfolge → gemischt, Optionen → gemischt (wenn eingestellt).
 * schluessel: z. B. die Kennung des Versuchs, damit jede Person eine feste eigene Reihenfolge hat.
 */
export function fuerSchueler(teil, schluessel, { optionenMischen = false } = {}) {
  const i = teil.inhalt || {};
  const basis = { id: teil.id, nr: teil.nr, typ: teil.typ, punkte: teil.punkte };
  switch (teil.typ) {
    case "abschnitt": return { ...basis, inhalt: { titel: i.titel, text: i.text } };
    case "einfach": case "mehrfach": return { ...basis, inhalt: { frage: i.frage, optionen: optionenMischen ? mischen(i.optionen || [], schluessel + ":o") : i.optionen || [] } };
    case "kurz": return { ...basis, inhalt: { frage: i.frage } };
    case "zahl": return { ...basis, inhalt: { frage: i.frage, einheit: i.einheit } };
    case "luecken": return { ...basis, inhalt: { frage: i.frage, text: String(i.text || "").replace(/\[\[[^\]]+\]\]/g, "[[·]]") } };
    case "zuordnung": return { ...basis, inhalt: { frage: i.frage, links: (i.paare || []).map((p) => ({ id: p.id, text: p.links })), rechts: mischen((i.paare || []).map((p) => ({ id: p.id, text: p.rechts })), schluessel + ":r") } };
    case "reihenfolge": return { ...basis, inhalt: { frage: i.frage, elemente: mischen(i.elemente || [], schluessel + ":e") } };
    case "freitext": return { ...basis, inhalt: { frage: i.frage, zeilen: i.zeilen } };
  }
  return basis;
}
