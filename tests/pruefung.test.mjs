// Aufgabentypen: Eingaben prüfen und automatisch bewerten
import { describe, it, expect } from "vitest";
import { teilPruefen, bewerten, lueckenLesen, zahlLesen, mischen } from "../packages/shared/src/pruefung.mjs";

const einfach = teilPruefen({ typ: "einfach", punkte: 2, inhalt: { frage: "Hauptstadt?", optionen: [{ id: "a", text: "Bern" }, { id: "b", text: "Zürich" }] }, loesung: { richtig: "a" } });
const mehrfach = teilPruefen({ typ: "mehrfach", punkte: 4, inhalt: { frage: "Primzahlen?", optionen: [{ text: "2" }, { text: "3" }, { text: "4" }, { text: "9" }] }, loesung: { richtig: ["a", "b"] } });

describe("Eingaben prüfen", () => {
  it("verlangt Frage, Antworten und Lösung", () => {
    expect(() => teilPruefen({ typ: "einfach", inhalt: { frage: "", optionen: [] } })).toThrow(/Frage/);
    expect(() => teilPruefen({ typ: "einfach", inhalt: { frage: "x", optionen: [{ text: "a" }] } })).toThrow(/zwei Antworten/);
    expect(() => teilPruefen({ typ: "einfach", inhalt: { frage: "x", optionen: [{ text: "a" }, { text: "b" }] }, loesung: { richtig: "z" } })).toThrow(/richtige Antwort/);
    expect(() => teilPruefen({ typ: "luecken", inhalt: { text: "ohne Lücken" } })).toThrow(/\[\[Antwort\]\]/);
    expect(() => teilPruefen({ typ: "gibtsnicht" })).toThrow(/Unbekannt/);
  });
  it("leere Antworten fallen weg, Kennungen werden ergänzt, Abschnitte haben keine Punkte", () => {
    expect(mehrfach.inhalt.optionen.map((o) => o.id)).toEqual(["a", "b", "c", "d"]);
    expect(teilPruefen({ typ: "abschnitt", punkte: 5, inhalt: { titel: "Teil A" } }).punkte).toBe(0);
  });
  it("Zahlen in Schweizer Schreibweise", () => {
    expect(zahlLesen("3,5")).toBe(3.5);
    expect(zahlLesen("1'250")).toBe(1250);
    expect(zahlLesen("−2.5")).toBe(-2.5);
    expect(zahlLesen("abc")).toBe(null);
  });
});

describe("Bewerten", () => {
  it("Einfachauswahl", () => {
    expect(bewerten(einfach, "a")).toEqual({ punkte: 2, automatisch: true });
    expect(bewerten(einfach, "b").punkte).toBe(0);
  });
  it("Mehrfachauswahl mit Teilpunkten: falsche Kreuze ziehen ab, nie unter 0", () => {
    expect(bewerten(mehrfach, ["a", "b"]).punkte).toBe(4);
    expect(bewerten(mehrfach, ["a"]).punkte).toBe(2);
    expect(bewerten(mehrfach, ["a", "c"]).punkte).toBe(0);
    expect(bewerten(mehrfach, ["c", "d"]).punkte).toBe(0);
    const streng = { ...mehrfach, loesung: { ...mehrfach.loesung, teilpunkte: false } };
    expect(bewerten(streng, ["a"]).punkte).toBe(0);
  });
  it("Kurzantwort: Gross/Klein und Leerzeichen egal; unbekannte Antwort geht an die Lehrperson", () => {
    const k = teilPruefen({ typ: "kurz", punkte: 1, inhalt: { frage: "Autor?" }, loesung: { antworten: ["Gottfried Keller", "Keller"] } });
    expect(bewerten(k, "  gottfried   keller ")).toEqual({ punkte: 1, automatisch: true });
    expect(bewerten(k, "G. Keller")).toEqual({ punkte: 0, automatisch: false });
  });
  it("Zahl mit Toleranz", () => {
    const z = teilPruefen({ typ: "zahl", punkte: 2, inhalt: { frage: "sin 30°?" }, loesung: { wert: "0,5", toleranz: "0.01" } });
    expect(bewerten(z, "0,505").punkte).toBe(2);
    expect(bewerten(z, "0.52").punkte).toBe(0);
  });
  it("Lückentext mit Alternativen, anteilig", () => {
    const l = teilPruefen({ typ: "luecken", punkte: 3, inhalt: { text: "Die [[Romantik]] folgt auf die [[Klassik|Weimarer Klassik]] und den [[Sturm und Drang]]." } });
    expect(lueckenLesen(l.inhalt.text).luecken).toHaveLength(3);
    expect(bewerten(l, ["romantik", "Weimarer Klassik", "Sturm und Drang"])).toEqual({ punkte: 3, automatisch: true });
    expect(bewerten(l, ["Romantik", "", ""])).toEqual({ punkte: 1, automatisch: true });
    expect(bewerten(l, ["Romantik", "Barock", ""]).automatisch).toBe(false);
  });
  it("Zuordnung und Reihenfolge anteilig", () => {
    const z = teilPruefen({ typ: "zuordnung", punkte: 4, inhalt: { paare: [{ links: "Goethe", rechts: "Faust" }, { links: "Schiller", rechts: "Die Räuber" }] } });
    expect(bewerten(z, { a: "a", b: "b" }).punkte).toBe(4);
    expect(bewerten(z, { a: "b", b: "b" }).punkte).toBe(2);
    const r = teilPruefen({ typ: "reihenfolge", punkte: 3, inhalt: { elemente: [{ text: "Einleitung" }, { text: "Hauptteil" }, { text: "Schluss" }] } });
    expect(bewerten(r, ["a", "b", "c"]).punkte).toBe(3);
    expect(bewerten(r, ["b", "a", "c"]).punkte).toBe(1);
  });
  it("Freitext wird von Hand bewertet, leere Antwort gibt 0", () => {
    const f = teilPruefen({ typ: "freitext", punkte: 6, inhalt: { frage: "Erörtern Sie." } });
    expect(bewerten(f, "Eine Antwort")).toEqual({ punkte: null, automatisch: false });
    expect(bewerten(f, "")).toEqual({ punkte: 0, automatisch: true });
  });
  it("Mischen ist pro Schlüssel fest", () => {
    const a = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(mischen(a, "lea")).toEqual(mischen(a, "lea"));
    expect(mischen(a, "lea")).not.toEqual(mischen(a, "noah"));
    expect([...mischen(a, "x")].sort()).toEqual(a);
  });
});

import { fuerSchueler } from "../packages/shared/src/pruefung.mjs";
describe("Fassung für Schülerinnen und Schüler", () => {
  it("enthält keine Lösungen", () => {
    const l = teilPruefen({ typ: "luecken", punkte: 2, inhalt: { text: "Die [[Romantik]] und [[Klassik]]." } });
    const z = teilPruefen({ typ: "zuordnung", punkte: 2, inhalt: { paare: [{ links: "Goethe", rechts: "Faust" }, { links: "Schiller", rechts: "Räuber" }, { links: "Keller", rechts: "Seldwyla" }] } });
    for (const t of [einfach, mehrfach, l, z]) { const s = fuerSchueler(t, "v1"); expect(s.loesung).toBeUndefined(); }
    expect(JSON.stringify(fuerSchueler(l, "v1"))).not.toMatch(/Romantik|Klassik/);
    const zs = fuerSchueler(z, "v1");
    expect(zs.inhalt.paare).toBeUndefined();
    expect(zs.inhalt.rechts.map((r) => r.text).sort()).toEqual(["Faust", "Räuber", "Seldwyla"]);
  });
  it("Antworten der Schülerfassung werden richtig bewertet", () => {
    const z = teilPruefen({ typ: "zuordnung", punkte: 2, inhalt: { paare: [{ links: "Goethe", rechts: "Faust" }, { links: "Schiller", rechts: "Räuber" }] } });
    const s = fuerSchueler(z, "x");
    const antwort = Object.fromEntries(s.inhalt.links.map((li) => [li.id, s.inhalt.rechts.find((r) => r.text === (li.text === "Goethe" ? "Faust" : "Räuber")).id]));
    expect(bewerten(z, antwort).punkte).toBe(2);
  });
});
