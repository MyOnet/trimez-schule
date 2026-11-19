import { describe, it, expect } from "vitest";
import { runden, punkteZuNote, schnitt, zeugnisVorschlag, muendlichVorschlag, noteLesen, notenStufe, fmtNote } from "../packages/shared/src/noten.mjs";

describe("Runden", () => {
  it("halbe Noten", () => { expect(runden(4.74, 0.5)).toBe(4.5); expect(runden(4.75, 0.5)).toBe(5); expect(runden(5.24, 0.5)).toBe(5); });
  it("Viertel und Zehntel", () => { expect(runden(4.12, 0.25)).toBe(4); expect(runden(4.13, 0.25)).toBe(4.25); expect(runden(4.15, 0.1)).toBe(4.2); });
  it("bleibt zwischen 1 und 6", () => { expect(runden(6.4, 0.5)).toBe(6); expect(runden(0.2, 0.5)).toBe(1); });
});
describe("Punkte → Note", () => {
  it("linear: volle Punkte 6, null Punkte 1, Hälfte 3.5", () => {
    expect(punkteZuNote(40, 40)).toBe(6); expect(punkteZuNote(0, 40)).toBe(1); expect(punkteZuNote(20, 40)).toBe(3.5);
  });
  it("linear mit 6 ab 95 %", () => { expect(punkteZuNote(38, 40, { art: "linear", parameter: { p6: 0.95 }, rundung: 0.1 })).toBe(6); });
  it("Rundung auf Viertel", () => { expect(punkteZuNote(30, 40, { art: "linear", parameter: { p6: 1 }, rundung: 0.25 })).toBe(4.75); expect(punkteZuNote(31, 40, { art: "linear", parameter: { p6: 1 }, rundung: 0.25 })).toBe(5); });
  it("Tabelle", () => { const t = { art: "tabelle", parameter: { stufen: [{ ab: 90, note: 6 }, { ab: 60, note: 4 }, { ab: 0, note: 2 }] }, rundung: 0.5 }; expect(punkteZuNote(37, 40, t)).toBe(6); expect(punkteZuNote(25, 40, t)).toBe(4); expect(punkteZuNote(5, 40, t)).toBe(2); });
  it("ohne Punkte keine Note", () => { expect(punkteZuNote(null, 40)).toBe(null); expect(punkteZuNote(10, 0)).toBe(null); });
});
describe("Schnitt", () => {
  it("gewichtet", () => { expect(schnitt([{ note: 5, gewicht: 1 }, { note: 4, gewicht: 2 }]).schnitt).toBe(4.33); });
  it("Kennzeichen und leere zählen nicht", () => { expect(schnitt([{ note: 6, gewicht: 1 }, { note: 1, gewicht: 1, kennzeichen: "dispensiert" }, { note: null, gewicht: 1 }])).toEqual({ schnitt: 6, anzahl: 1 }); });
  it("keine Noten → leer", () => { expect(schnitt([])).toEqual({ schnitt: null, anzahl: 0 }); });
  it("Zeugnisvorschlag auf halbe Noten", () => { expect(zeugnisVorschlag(4.74)).toBe(4.5); expect(zeugnisVorschlag(4.75)).toBe(5); });
});
describe("Mündlich", () => {
  it("braucht mindestens 3 Beobachtungen", () => { expect(muendlichVorschlag([2, 1]).note).toBe(null); });
  it("Vorschlag aus Beobachtungen", () => { expect(muendlichVorschlag([2, 1, 0, 1]).note).toBe(5.25); });
});
describe("Eingabe und Anzeige", () => {
  it("Komma und Punkt", () => { expect(noteLesen("5,5").note).toBe(5.5); expect(noteLesen("4.75").note).toBe(4.75); expect(noteLesen("").note).toBe(null); });
  it("ungültig", () => { expect(noteLesen("7").fehler).toBeTruthy(); expect(noteLesen("5-").fehler).toBeTruthy(); expect(noteLesen("abc").fehler).toBeTruthy(); });
  it("Stufen", () => { expect(notenStufe(3.9)).toBe("ungenuegend"); expect(notenStufe(4)).toBe("knapp"); expect(notenStufe(5)).toBe("gut"); expect(notenStufe(5.5)).toBe("sehrgut"); });
  it("Format", () => { expect(fmtNote(5)).toBe("5"); expect(fmtNote(5.5)).toBe("5.5"); expect(fmtNote(4.75)).toBe("4.75"); expect(fmtNote(null)).toBe(""); });
});
