// Notenrechnung (Schweizer Skala 1 bis 6). Eine Stelle für Server, Oberfläche und Tests.
// Alle Rechnungen mit ganzen Hundertsteln, damit keine Gleitkomma-Fehler entstehen (5.75 bleibt 5.75).

const H = (x) => Math.round(Number(x) * 100);          // in Hundertstel
const N = (h) => Math.round(h) / 100;

/** Auf Schritt runden (0.5, 0.25, 0.1, 0.01). Kaufmännisch: genau in der Mitte wird aufgerundet. */
export function runden(note, schritt = 0.1) {
  if (note == null || Number.isNaN(Number(note))) return null;
  const s = H(schritt);
  return N(Math.min(600, Math.max(100, Math.floor((H(note) + s / 2) / s) * s)));
}

/** Punkte → Note mit Notenschlüssel { art, parameter, rundung } */
export function punkteZuNote(punkte, max, schluessel = { art: "linear", parameter: { p6: 1 }, rundung: 0.1 }) {
  if (punkte == null || punkte === "" || !(Number(max) > 0)) return null;
  const p = Math.max(0, Number(punkte)), m = Number(max);
  const anteil = p / m;
  let note;
  if (schluessel.art === "tabelle") {
    const stufen = [...(schluessel.parameter.stufen || [])].sort((a, b) => b.ab - a.ab);
    note = (stufen.find((s) => anteil * 100 >= s.ab) || { note: 1 }).note;
  } else {
    const p6 = Math.min(1, Math.max(0.5, Number(schluessel.parameter && schluessel.parameter.p6) || 1));
    note = 1 + (5 * anteil) / p6;
  }
  return runden(Math.min(6, Math.max(1, note)), schluessel.rundung || 0.1);
}

/**
 * Gewichteter Schnitt. eintraege: [{ note, gewicht, kennzeichen? }]
 * Ohne Note oder mit Kennzeichen (abwesend, nachholen, dispensiert) zählt ein Eintrag nicht.
 * → { schnitt (auf 0.01), anzahl } oder { schnitt: null, anzahl: 0 }
 */
export function schnitt(eintraege) {
  let summe = 0, gewichte = 0, anzahl = 0;
  for (const e of eintraege || []) {
    if (e == null || e.note == null || e.note === "" || e.kennzeichen) continue;
    const g = H(e.gewicht == null ? 1 : e.gewicht);
    if (g <= 0) continue;
    summe += H(e.note) * g; gewichte += g; anzahl++;
  }
  if (!gewichte) return { schnitt: null, anzahl: 0 };
  return { schnitt: N(Math.round(summe / gewichte)), anzahl };
}

/** Vorschlag für die Zeugnisnote: Schnitt auf die Zeugnis-Rundung der Schule (Gymnasium ZH: halbe Noten) */
export const zeugnisVorschlag = (s, rundung = 0.5) => (s == null ? null : runden(s, rundung));

/** Mündliche Beobachtungen (−2 … +2) → Notenvorschlag. Zuordnung einstellbar, Standard: ++ 6, + 5, ○ 4.5, − 3.5, −− 2.5 */
export const BEOBACHTUNG_NOTE = { 2: 6, 1: 5, 0: 4.5, [-1]: 3.5, [-2]: 2.5 };
export function muendlichVorschlag(werte, { zuordnung = BEOBACHTUNG_NOTE, rundung = 0.25, mindestens = 3 } = {}) {
  const w = (werte || []).filter((x) => x != null && zuordnung[x] != null);
  if (w.length < mindestens) return { note: null, anzahl: w.length, grund: `Noch zu wenige Beobachtungen (${w.length} von mindestens ${mindestens}).` };
  const s = w.reduce((a, x) => a + H(zuordnung[x]), 0) / w.length;
  return { note: runden(N(s), rundung), anzahl: w.length };
}

/** Eingabe einer Note prüfen («5.5», «5,5», «5-» ist nicht erlaubt) → Zahl oder Fehlertext */
export function noteLesen(text) {
  const t = String(text ?? "").trim().replace(",", ".");
  if (t === "") return { note: null };
  if (!/^\d(\.\d{1,2})?$/.test(t)) return { fehler: "Note als Zahl von 1 bis 6, z. B. 4.5" };
  const n = Number(t);
  if (n < 1 || n > 6) return { fehler: "Die Note muss zwischen 1 und 6 liegen." };
  return { note: N(H(n)) };
}

/** Farbstufe für die Anzeige: ungenügend (< 4), knapp (4 bis < 4.5), gut (4.5 bis < 5.5), sehr gut (≥ 5.5) */
export function notenStufe(n) {
  if (n == null) return "ohne";
  return n < 4 ? "ungenuegend" : n < 4.5 ? "knapp" : n < 5.5 ? "gut" : "sehrgut";
}

/** Anzeige: 5 → «5», 5.5 → «5.5», 4.75 → «4.75» */
export const fmtNote = (n) => (n == null || n === "" ? "" : String(Number(Number(n).toFixed(2))));
