// Promotion nach den Regeln der Schule. Standard: Promotionsreglement für die Gymnasien des Kantons Zürich (LS 413.251.1)
//   § 9  Promoviert wird, wenn in den Promotionsfächern
//        a. die doppelte Summe aller Notenabweichungen von 4 nach unten nicht grösser ist als die Summe der Abweichungen nach oben und
//        b. nicht mehr als drei Noten unter 4 erteilt werden.
//   § 10 Sonst provisorisch promoviert oder, wenn schon einmal provisorisch promoviert (Unter- bzw. Obergymnasium), nicht promoviert.
//   § 13 Der Klassenkonvent kann in besonderen Fällen zugunsten der Schülerin, des Schülers abweichen.
// RESCOOL rechnet und schlägt vor. Entscheiden tut die Schule; jede Abweichung wird mit Begründung festgehalten.

export const PROMOTION_STANDARD = { doppelteKompensation: true, maxUngenuegend: 3, mindestschnitt: null };
export const ERGEBNIS = { promoviert: "promoviert", provisorisch: "provisorisch promoviert", nicht_promoviert: "nicht promoviert" };

const H = (x) => Math.round(Number(x) * 100);

/** Mehrere Noten im selben Fach (z. B. Halbklassen): Mittel, auf halbe Noten gerundet (ein Viertel wird aufgerundet) */
export function fachnote(noten) {
  const n = noten.filter((x) => x != null).map(Number);
  if (!n.length) return null;
  const m = n.reduce((s, x) => s + x, 0) / n.length;
  return Math.min(6, Math.max(1, Math.floor(m * 2 + 0.5 + 1e-9) / 2));
}

/**
 * noten: [{ fach, note, relevant }]. Nur promotionsrelevante Fächer mit Note zählen.
 * → { erfuellt, ungenuegend, minus, plus, schnitt, gruende: [...], fehlend: [...] }
 */
export function promotionPruefen(noten, regeln = PROMOTION_STANDARD) {
  const r = { ...PROMOTION_STANDARD, ...(regeln || {}) };
  const zaehlt = (noten || []).filter((n) => n.relevant !== false);
  const mit = zaehlt.filter((n) => n.note != null);
  const fehlend = zaehlt.filter((n) => n.note == null).map((n) => n.fach);
  let minus = 0, plus = 0, unter = 0;
  for (const n of mit) { const d = H(n.note) - 400; if (d < 0) { minus += -d; unter++; } else plus += d; }
  const gruende = [];
  if (r.doppelteKompensation && 2 * minus > plus) gruende.push(`Doppelte Summe der Abweichungen unter 4 (${(2 * minus / 100).toFixed(1)}) ist grösser als die Summe über 4 (${(plus / 100).toFixed(1)}).`);
  if (r.maxUngenuegend != null && unter > r.maxUngenuegend) gruende.push(`${unter} Noten unter 4 (erlaubt: höchstens ${r.maxUngenuegend}).`);
  const schnitt = mit.length ? Math.round(mit.reduce((s, n) => s + H(n.note), 0) / mit.length) / 100 : null;
  if (r.mindestschnitt != null && schnitt != null && schnitt < r.mindestschnitt) gruende.push(`Schnitt ${schnitt} unter ${r.mindestschnitt}.`);
  return { erfuellt: !gruende.length && !fehlend.length && mit.length > 0, vollstaendig: !fehlend.length && mit.length > 0, ungenuegend: unter, minus: minus / 100, plus: plus / 100, schnitt, gruende, fehlend, anzahl: mit.length };
}

/**
 * Vorschlag für den Entscheid. bisher: frühere Entscheide [{ ergebnis, stufe }] (stufe der Klasse damals).
 * Unter- (Stufe 1–2) und Obergymnasium (3–6) zählen getrennt (§ 10).
 */
export function promotionVorschlag(pruefung, bisher = [], stufe = null) {
  if (!pruefung.vollstaendig) return null;
  if (pruefung.erfuellt) return "promoviert";
  const ober = (s) => (s == null ? null : s >= 3);
  const schonProvisorisch = bisher.some((b) => b.ergebnis === "provisorisch" && (stufe == null || b.stufe == null || ober(b.stufe) === ober(stufe)));
  return schonProvisorisch ? "nicht_promoviert" : "provisorisch";
}

/** Gewichtete Note aus Kriterien (Maturaarbeit), auf halbe Noten gerundet */
export function kriterienNote(kriterien) {
  const k = (kriterien || []).filter((x) => x.note != null && Number(x.gewicht) > 0);
  if (!k.length) return null;
  const g = k.reduce((s, x) => s + Number(x.gewicht), 0);
  const m = k.reduce((s, x) => s + Number(x.note) * Number(x.gewicht), 0) / g;
  return Math.min(6, Math.max(1, Math.floor(m * 2 + 0.5 + 1e-9) / 2));
}
export const MATURA_KRITERIEN_STANDARD = [
  { id: "prozess", name: "Arbeitsprozess", gewicht: 25 },
  { id: "produkt", name: "Produkt (schriftliche Arbeit)", gewicht: 50 },
  { id: "praesentation", name: "Präsentation", gewicht: 25 },
];
export const MATURA_MEILENSTEINE_STANDARD = ["Thema und Fragestellung festgelegt", "Disposition und Zeitplan", "Zwischenbericht", "Rohfassung", "Abgabe der Arbeit", "Präsentation"];
