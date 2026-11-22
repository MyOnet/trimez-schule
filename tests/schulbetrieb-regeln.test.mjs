// Reine Regeln: Promotion (Reglement Gymnasien ZH), Prüfungslimit, Untis-Import, Formulare, Rechte der neuen Module
import { describe, it, expect } from "vitest";
import { promotionPruefen, promotionVorschlag, fachnote, kriterienNote, pruefungslimit, untisLesen, wochenbeginn, abWoche, fragenLesen, antwortenLesen, formularAuswerten, darf } from "../packages/shared/src/index.mjs";

const n = (...werte) => werte.map((note, i) => ({ fach: `F${i}`, note, relevant: true }));

describe("Promotion (LS 413.251.1 §§ 9, 10)", () => {
  it("doppelte Kompensation: 2 × Summe unter 4 ≤ Summe über 4", () => {
    expect(promotionPruefen(n(3.5, 5, 4, 4)).erfuellt).toBe(true); // 2×0.5 = 1 ≤ 1
    expect(promotionPruefen(n(3.5, 4.5, 4, 4)).erfuellt).toBe(false); // 1 > 0.5
  });
  it("höchstens drei Noten unter 4", () => {
    expect(promotionPruefen(n(3.5, 3.5, 3.5, 6, 6, 6)).erfuellt).toBe(true);
    const p = promotionPruefen(n(3.5, 3.5, 3.5, 3.5, 6, 6, 6, 6));
    expect(p.erfuellt).toBe(false); expect(p.ungenuegend).toBe(4);
  });
  it("nicht promotionsrelevante Fächer zählen nicht, fehlende Noten verhindern den Vorschlag", () => {
    expect(promotionPruefen([...n(5, 5), { fach: "Sport", note: 2, relevant: false }]).erfuellt).toBe(true);
    const p = promotionPruefen([...n(5), { fach: "X", note: null, relevant: true }]);
    expect(p.vollstaendig).toBe(false); expect(promotionVorschlag(p)).toBe(null);
  });
  it("zweites Mal provisorisch in derselben Stufe → nicht promoviert; Unter- und Obergymnasium getrennt", () => {
    const schlecht = promotionPruefen(n(3, 4, 4, 4));
    expect(promotionVorschlag(schlecht, [], 3)).toBe("provisorisch");
    expect(promotionVorschlag(schlecht, [{ ergebnis: "provisorisch", stufe: 3 }], 4)).toBe("nicht_promoviert");
    expect(promotionVorschlag(schlecht, [{ ergebnis: "provisorisch", stufe: 2 }], 3)).toBe("provisorisch");
  });
  it("Fachnote auf halbe Noten, ein Viertel wird aufgerundet", () => {
    expect(fachnote([4.75])).toBe(5); expect(fachnote([4.25])).toBe(4.5); expect(fachnote([4.2])).toBe(4); expect(fachnote([])).toBe(null);
  });
  it("Maturaarbeit: gewichtete Note aus Kriterien", () => {
    expect(kriterienNote([{ note: 5, gewicht: 25 }, { note: 5.5, gewicht: 50 }, { note: 4.5, gewicht: 25 }])).toBe(5);
    expect(kriterienNote([{ note: 6, gewicht: 1 }, { note: null, gewicht: 1 }])).toBe(6);
  });
});

describe("Kalender", () => {
  it("Prüfungslimit pro Woche und pro Tag", () => {
    expect(pruefungslimit("2027-03-10", [{ datum: "2027-03-08" }], { proWoche: 2, proTag: 1 }).ok).toBe(true);
    expect(pruefungslimit("2027-03-10", [{ datum: "2027-03-08" }, { datum: "2027-03-09" }], { proWoche: 2, proTag: 1 }).ok).toBe(false);
    expect(pruefungslimit("2027-03-08", [{ datum: "2027-03-08" }], { proWoche: 2, proTag: 1 }).ok).toBe(false);
  });
  it("Wochenbeginn ist Montag; A/B-Wochen", () => {
    expect(wochenbeginn("2027-03-14")).toBe("2027-03-08");
    expect(abWoche("2027-03-08")).not.toBe(abWoche("2027-03-15"));
  });
  it("Untis GPU001 lesen, kaputte Zeilen melden", () => {
    const r = untisLesen('1,"3a","KEM","D","A12",1,1\n2,"3a","BRT","M","B04",9,3\nkaputt');
    expect(r.eintraege.length).toBe(1);
    expect(r.eintraege[0]).toMatchObject({ klasse: "3a", lehrer: "KEM", fach: "D", raum: "A12", tag: 1, stunde: 1 });
    expect(r.fehler.length).toBe(2);
  });
});

describe("Formulare", () => {
  const fragen = fragenLesen([
    { id: "q1", typ: "einfach", punkte: 2, inhalt: { frage: "1+1?", optionen: [{ id: "a", text: "2" }, { id: "b", text: "3" }] }, loesung: { richtig: "a" } },
  ], "quiz");
  it("Quiz bewertet sich selbst", () => {
    expect(antwortenLesen(fragen, { q1: "a" }).punkte).toBe(2);
    expect(antwortenLesen(fragen, { q1: "b" }).punkte).toBe(0);
  });
  it("Umfrage-Typen im Quiz sind nicht erlaubt; Pflichtfragen werden geprüft", () => {
    expect(() => fragenLesen([{ typ: "text", inhalt: { frage: "Wie?" } }], "quiz")).toThrow();
    const u = fragenLesen([{ id: "w", typ: "auswahl", inhalt: { frage: "Farbe?", optionen: [{ id: "r", text: "Rot" }, { id: "g", text: "Grün" }] } }], "umfrage");
    expect(() => antwortenLesen(u, {})).toThrow();
    const a = formularAuswerten(u, [{ antworten: { w: "r" } }, { antworten: { w: "r" } }, { antworten: { w: "g" } }]);
    expect(JSON.stringify(a)).toContain("2");
  });
});

describe("Rechte der neuen Module", () => {
  const ctx = (rollen, extra = {}) => ({ personId: "p", rollen: new Set(rollen), unterricht: new Set(), lehrt: new Set(), klassen: new Set(), klp: new Set(), kinder: new Set(), ...extra });
  const lp = ctx(["lehrperson"], { lehrt: new Set(["u1"]), klp: new Set(["k1"]) });
  const sch = ctx(["schueler"], { unterricht: new Set(["u1"]) });
  const el = ctx(["eltern"], { kinder: new Set(["kind"]) });
  const sl = ctx(["schulleitung"]);
  it("Aufträge und Prüfungen nur im eigenen Unterricht", () => {
    expect(darf(lp, "auftrag.verwalten", { unterrichtId: "u1" })).toBe(true);
    expect(darf(lp, "auftrag.verwalten", { unterrichtId: "u2" })).toBe(false);
    expect(darf(sch, "auftrag.abgeben", { unterrichtId: "u1" })).toBe(true);
    expect(darf(sch, "auftrag.verwalten", { unterrichtId: "u1" })).toBe(false);
    expect(darf(lp, "pruefung.ankuendigen", { unterrichtId: "u1" })).toBe(true);
  });
  it("Prüfungslimit-Ausnahme und Promotionsentscheid nur durch die Schulleitung", () => {
    expect(darf(lp, "pruefungslimit.ausnahme")).toBe(false);
    expect(darf(sl, "pruefungslimit.ausnahme")).toBe(true);
    expect(darf(lp, "promotion.entscheiden")).toBe(false);
    expect(darf(sl, "promotion.entscheiden")).toBe(true);
  });
  it("Absenzen: Klassenlehrperson für die Klasse, Eltern nur für das eigene Kind", () => {
    expect(darf(lp, "absenz.klasse", { klasseId: "k1" })).toBe(true);
    expect(darf(lp, "absenz.klasse", { klasseId: "k2" })).toBe(false);
    expect(darf(el, "eltern.kind", { personId: "kind" })).toBe(true);
    expect(darf(el, "eltern.kind", { personId: "fremd" })).toBe(false);
    expect(darf(el, "absenz.erfassen", { unterrichtId: "u1" })).toBe(false);
  });
  it("Schulmitteilungen verfasst die Schulleitung", () => {
    expect(darf(sl, "schulmitteilung.verfassen")).toBe(true);
    expect(darf(lp, "schulmitteilung.verfassen")).toBe(false);
  });
});
