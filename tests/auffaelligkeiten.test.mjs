// Auffälligkeiten: Regeln einzeln und ohne Fehlalarm bei gewöhnlichem Verlauf
import { describe, it, expect } from "vitest";
import { auswerten, aehnlichkeit } from "../packages/shared/src/auffaelligkeiten.mjs";

const T0 = new Date("2026-11-17T08:00:00Z").getTime();
const um = (s) => new Date(T0 + s * 1000).toISOString();
const aufgaben = [
  { id: "f1", typ: "freitext", punkte: 6 },
  ...[1, 2, 3, 4, 5].map((i) => ({ id: "e" + i, typ: "einfach", punkte: 1, inhalt: { optionen: ["a", "b", "c"] }, loesung: { richtig: 0 } })),
];
const LANG = "Gottfried Keller zeigt in Kleider machen Leute wie der Schneider Wenzel Strapinski durch seinen Mantel für einen Grafen gehalten wird und die Leute in Goldach sich vom Schein täuschen lassen.";
const v = (id, x = {}) => ({ id, name: id, gestartet_am: um(0), abgegeben_am: um(2400), zuschlag_min: 0, antworten: {}, ereignisse: [], warnungen: [], ...x });

describe("Auffälligkeiten", () => {
  it("gewöhnlicher Verlauf: nichts", () => {
    const tippen = []; for (let i = 1; i <= 40; i++) tippen.push({ teil_id: "f1", wert: LANG.slice(0, i * 5), zeit: um(60 + i * 20) });
    const m = auswerten({ dauer_min: 45 }, aufgaben, [v("lea", { ereignisse: tippen, antworten: { f1: LANG } })]);
    expect(m.get("lea")).toEqual([]);
  });
  it("viel Text auf einmal", () => {
    const m = auswerten({ dauer_min: 45 }, aufgaben, [v("lea", { ereignisse: [{ teil_id: "f1", wert: "Keller", zeit: um(100) }, { teil_id: "f1", wert: "Keller " + LANG + LANG, zeit: um(103) }] })]);
    expect(m.get("lea").map((x) => x.art)).toEqual(["text"]);
  });
  it("lange Pause und frühe Abgabe", () => {
    const voll = Object.fromEntries(aufgaben.map((t) => [t.id, t.typ === "freitext" ? "kurz" : 0]));
    const m = auswerten({ dauer_min: 60 }, aufgaben, [
      v("pause", { ereignisse: [{ teil_id: "e1", wert: 0, zeit: um(60) }, { teil_id: "e2", wert: 0, zeit: um(60 + 15 * 60) }] }),
      v("schnell", { abgegeben_am: um(600), antworten: voll, ereignisse: [{ teil_id: "e1", wert: 0, zeit: um(300) }] }),
    ]);
    expect(m.get("pause").map((x) => x.art)).toContain("pause");
    expect(m.get("schnell").map((x) => x.art)).toContain("schnell");
  });
  it("ähnliche Texte und gleiche Fehler, aber nicht gleiche richtige Antworten", () => {
    const falsch = { e1: 1, e2: 2, e3: 1, e4: 2, e5: 0 };
    const m = auswerten({ dauer_min: 45 }, aufgaben, [
      v("a", { antworten: { f1: LANG, ...falsch } }),
      v("b", { antworten: { f1: LANG.replace("Goldach", "der Stadt"), ...falsch } }),
      v("c", { antworten: { f1: "Ein ganz anderer Text über die Novelle, der mit eigenen Worten den Inhalt und die Figuren beschreibt und deutet.", e1: 0, e2: 0, e3: 0, e4: 0, e5: 0 } }),
      v("d", { antworten: { e1: 0, e2: 0, e3: 0, e4: 0, e5: 0 } }),
    ]);
    expect(m.get("a").map((x) => x.text)).toEqual([expect.stringContaining("ähnlich wie bei b"), "4 gleiche falsche Antworten wie b"]);
    expect(m.get("c")).toEqual([]); expect(m.get("d")).toEqual([]);
  });
  it("Gerätewechsel", () => {
    const m = auswerten({ dauer_min: 45 }, aufgaben, [v("x", { warnungen: [{ art: "ohne_lernumgebung" }, { art: "geraet" }] })]);
    expect(m.get("x").map((x) => x.art)).toEqual(["geraet", "geraet"]);
  });
  it("Ähnlichkeit", () => {
    expect(aehnlichkeit(LANG, LANG)).toBe(1);
    expect(aehnlichkeit(LANG, "völlig anders formuliert und ohne gemeinsame Wörter hier")).toBe(0);
  });
});
