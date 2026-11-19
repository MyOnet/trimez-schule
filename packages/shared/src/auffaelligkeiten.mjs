// Auffälligkeiten in einer Prüfung: Hinweise für die Aufsicht, keine Beweise.
// Jede Regel hat harmlose Erklärungen (schnell tippen, gut vorbereitet, gleiche Quelle gelernt, WC-Pause).
// Die Lehrperson entscheidet; RESCOOL bewertet nichts automatisch.
import { bewerten } from "./pruefung.mjs";

export const GRENZEN = {
  textSprung: 200,       // so viele Zeichen kommen auf einmal dazu …
  zeichenProSekunde: 15, // … und schneller als so viele pro Sekunde (sehr schnelles Tippen: etwa 8)
  pauseMin: 10,          // Minuten ohne Eingabe während der Prüfung
  schnellAnteil: 0.25,   // abgegeben nach weniger als diesem Anteil der Zeit …
  schnellBeantwortet: 0.8, // … mit mindestens so viel beantwortet
  aehnlichMinZeichen: 80,
  aehnlichAnteil: 0.5,   // Anteil gemeinsamer Wortgruppen (3 Wörter)
  gleicheFehlerMin: 4,   // gleiche falsche Antworten bei Auswahl/Zahl/Lücken …
  gleicheFehlerAnteil: 0.6, // … und so viel aller Fehler der beiden
};

const text = (w) => (typeof w === "string" ? w : null);
const normal = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
function gruppen(s) {
  const w = normal(s).split(" ").filter(Boolean), g = new Set();
  for (let i = 0; i + 2 < w.length; i++) g.add(w[i] + " " + w[i + 1] + " " + w[i + 2]);
  return g;
}
export function aehnlichkeit(a, b) {
  const x = gruppen(a), y = gruppen(b);
  if (!x.size || !y.size) return 0;
  let gemeinsam = 0; for (const g of x) if (y.has(g)) gemeinsam++;
  return gemeinsam / Math.min(x.size, y.size);
}
const uhr = (d) => new Date(d).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Zurich" });

/**
 * @param p        { dauer_min }
 * @param aufgaben Teile ohne Abschnitte, in Reihenfolge (id, typ, punkte, loesung, inhalt)
 * @param versuche [{ id, name, gestartet_am, abgegeben_am, zuschlag_min, antworten, ereignisse: [{ teil_id, wert, zeit }], warnungen: [{ art, detail, zeit }] }]
 * @returns Map versuch_id → [{ art, text }]
 */
export function auswerten(p, aufgaben, versuche, g = GRENZEN) {
  const nr = new Map(aufgaben.map((t, i) => [t.id, i + 1]));
  const typ = new Map(aufgaben.map((t) => [t.id, t]));
  const aus = new Map(versuche.map((v) => [v.id, []]));
  const dazu = (v, art, t) => aus.get(v.id).push({ art, text: t });

  for (const v of versuche) {
    const ev = [...(v.ereignisse || [])].sort((a, b) => new Date(a.zeit) - new Date(b.zeit));
    // 1. Viel Text auf einmal (eingefügt oder vorbereitet)
    const letzter = new Map();
    for (const e of ev) {
      const neu = text(e.wert), alt = letzter.get(e.teil_id);
      if (neu !== null && alt) {
        const plus = neu.length - alt.len, s = Math.max(1, (new Date(e.zeit) - new Date(alt.zeit)) / 1000);
        if (plus >= g.textSprung && plus / s > g.zeichenProSekunde) dazu(v, "text", `Aufgabe ${nr.get(e.teil_id)}: ${plus} Zeichen in ${Math.round(s)} s dazugekommen (eingefügt?)`);
      } else if (neu !== null && !alt && neu.length >= g.textSprung) {
        const s = Math.max(1, (new Date(e.zeit) - new Date(v.gestartet_am)) / 1000);
        if (neu.length / s > g.zeichenProSekunde) dazu(v, "text", `Aufgabe ${nr.get(e.teil_id)}: ${neu.length} Zeichen ${Math.round(s)} s nach dem Start`);
      }
      if (neu !== null) letzter.set(e.teil_id, { len: neu.length, zeit: e.zeit });
    }
    // 2. Lange Pause zwischen zwei Eingaben (vor der ersten wird gelesen, nach der letzten durchgesehen: das zählt nicht)
    const ende = v.abgegeben_am || null;
    const punkte = ev.map((e) => new Date(e.zeit).getTime());
    let lang = 0, von = 0;
    for (let i = 1; i < punkte.length; i++) if (punkte[i] - punkte[i - 1] > lang) { lang = punkte[i] - punkte[i - 1]; von = punkte[i - 1]; }
    if (lang >= g.pauseMin * 60000) dazu(v, "pause", `${Math.round(lang / 60000)} Minuten ohne Eingabe (ab ${uhr(von)})`);
    // 3. Sehr früh abgegeben, fast alles beantwortet
    if (ende && p.dauer_min) {
      const min = (new Date(ende) - new Date(v.gestartet_am)) / 60000, zeit = p.dauer_min + (v.zuschlag_min || 0);
      const beantwortet = aufgaben.filter((t) => { const a = (v.antworten || {})[t.id]; return a !== undefined && a !== null && a !== "" && !(Array.isArray(a) && !a.length); }).length;
      if (min < zeit * g.schnellAnteil && aufgaben.length && beantwortet / aufgaben.length >= g.schnellBeantwortet) dazu(v, "schnell", `Nach ${Math.round(min)} von ${zeit} Minuten abgegeben, ${beantwortet} von ${aufgaben.length} beantwortet`);
    }
    // 4. Gerätewechsel und Versuche ohne Lernumgebung
    const w = v.warnungen || [];
    const geraet = w.filter((x) => x.art === "geraet").length, ohne = w.filter((x) => x.art === "ohne_lernumgebung").length;
    if (geraet) dazu(v, "geraet", `Gerät gewechselt (${geraet}×)`);
    if (ohne) dazu(v, "geraet", `${ohne}× Zugriff ohne Lernumgebung oder von einem anderen Gerät`);
  }

  // 5. Ähnliche Texte und gleiche Fehler (paarweise)
  for (let i = 0; i < versuche.length; i++) for (let j = i + 1; j < versuche.length; j++) {
    const a = versuche[i], b = versuche[j], A = a.antworten || {}, B = b.antworten || {};
    let gleicheFehler = 0, fehlerA = 0, fehlerB = 0;
    for (const t of aufgaben) {
      const x = A[t.id], y = B[t.id];
      if (text(x) && text(y) && t.typ === "freitext" && Math.min(x.length, y.length) >= g.aehnlichMinZeichen) {
        const s = aehnlichkeit(x, y);
        if (s >= g.aehnlichAnteil) {
          const pr = `${Math.round(s * 100)} %`;
          dazu(a, "aehnlich", `Aufgabe ${nr.get(t.id)}: Text ähnlich wie bei ${b.name} (${pr} gleiche Wortgruppen)`);
          dazu(b, "aehnlich", `Aufgabe ${nr.get(t.id)}: Text ähnlich wie bei ${a.name} (${pr} gleiche Wortgruppen)`);
        }
        continue;
      }
      if (["einfach", "mehrfach", "zahl", "luecken", "kurz", "zuordnung"].includes(t.typ)) {
        const ra = x == null ? null : bewerten(typ.get(t.id), x), rb = y == null ? null : bewerten(typ.get(t.id), y);
        const fa = ra && ra.automatisch && ra.punkte < Number(t.punkte), fb = rb && rb.automatisch && rb.punkte < Number(t.punkte);
        if (fa) fehlerA++; if (fb) fehlerB++;
        if (fa && fb && JSON.stringify(x) === JSON.stringify(y)) gleicheFehler++;
      }
    }
    if (gleicheFehler >= g.gleicheFehlerMin && gleicheFehler >= g.gleicheFehlerAnteil * Math.max(fehlerA, fehlerB)) {
      dazu(a, "aehnlich", `${gleicheFehler} gleiche falsche Antworten wie ${b.name}`);
      dazu(b, "aehnlich", `${gleicheFehler} gleiche falsche Antworten wie ${a.name}`);
    }
  }
  return aus;
}
