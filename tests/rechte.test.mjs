// Rechte-Matrix: jede Rolle × jede Aktion
import { describe, it, expect } from "vitest";
import { darf } from "../packages/shared/src/rechte.mjs";

const ctx = (rollen, extra = {}) => ({ personId: "ich", rollen: new Set(rollen), unterricht: new Set(extra.unterricht || []), lehrt: new Set(extra.lehrt || []), klassen: new Set(extra.klassen || []), faecher: new Set(extra.faecher || []) });
const ERWARTET = {
  //                         admin  schulleitung lehrperson schueler
  "schule.einstellungen":   [true,  false,       false,     false],
  "schuljahr.verwalten":    [true,  false,       false,     false],
  "klasse.verwalten":       [true,  false,       false,     false],
  "fach.verwalten":         [true,  false,       false,     false],
  "person.verwalten":       [true,  false,       false,     false],
  "unterricht.verwalten":   [true,  false,       false,     false],
  "import.ausfuehren":      [true,  false,       false,     false],
  "protokoll.lesen":        [true,  true,        false,     false],
  "schuljahr.lesen":        [true,  true,        true,      true],
  "fach.lesen":             [true,  true,        true,      true],
};
describe("Rechte-Matrix", () => {
  const ROLLEN = ["admin", "schulleitung", "lehrperson", "schueler"];
  for (const [aktion, werte] of Object.entries(ERWARTET)) {
    ROLLEN.forEach((r, i) => it(`${r} ${werte[i] ? "darf" : "darf nicht"} ${aktion}`, () => expect(darf(ctx([r]), aktion)).toBe(werte[i])));
  }
  it("Lektion: leiten nur im eigenen Unterricht, teilnehmen nur als Schüler/in des Unterrichts", () => {
    expect(darf(ctx(["lehrperson"], { lehrt: ["u1"], unterricht: ["u1"] }), "lektion.leiten", { unterrichtId: "u1" })).toBe(true);
    expect(darf(ctx(["lehrperson"], { lehrt: ["u1"] }), "lektion.leiten", { unterrichtId: "u2" })).toBe(false);
    expect(darf(ctx(["schulleitung", "admin"]), "lektion.leiten", { unterrichtId: "u1" })).toBe(false);
    expect(darf(ctx(["schueler"], { unterricht: ["u1"] }), "lektion.teilnehmen", { unterrichtId: "u1" })).toBe(true);
    expect(darf(ctx(["schueler"], { unterricht: ["u1"] }), "lektion.teilnehmen", { unterrichtId: "u2" })).toBe(false);
    expect(darf(ctx(["lehrperson"], { unterricht: ["u1"], lehrt: ["u1"] }), "lektion.teilnehmen", { unterrichtId: "u1" })).toBe(false);
  });
  it("Lehrperson sieht nur eigene Klassen", () => {
    const c = ctx(["lehrperson"], { klassen: ["k1"] });
    expect(darf(c, "klasse.lesen", { klasseId: "k1" })).toBe(true);
    expect(darf(c, "klasse.lesen", { klasseId: "k2" })).toBe(false);
  });
  it("Schüler/in sieht nur eigenen Unterricht und sich selbst", () => {
    const c = ctx(["schueler"], { unterricht: ["u1"], klassen: ["k1"] });
    expect(darf(c, "unterricht.lesen", { unterrichtId: "u1" })).toBe(true);
    expect(darf(c, "unterricht.lesen", { unterrichtId: "u2" })).toBe(false);
    expect(darf(c, "person.lesen", { personId: "ich" })).toBe(true);
    expect(darf(c, "person.lesen", { personId: "andere", klasseId: "k1" })).toBe(false);
  });
  it("Notenbuch: nur die unterrichtende Lehrperson schreibt, Schüler/in nie", () => {
    expect(darf(ctx(["lehrperson"], { lehrt: ["u1"] }), "noten.schreiben", { unterrichtId: "u1" })).toBe(true);
    expect(darf(ctx(["lehrperson"], { lehrt: ["u1"] }), "noten.schreiben", { unterrichtId: "u2" })).toBe(false);
    expect(darf(ctx(["lehrperson"], { lehrt: ["u1"] }), "noten.lesen", { unterrichtId: "u2" })).toBe(false);
    expect(darf(ctx(["schueler"], { unterricht: ["u1"] }), "noten.lesen", { unterrichtId: "u1" })).toBe(false);
    expect(darf(ctx(["schueler"]), "noten.eigene")).toBe(true);
    expect(darf(ctx(["admin"]), "noten.schreiben", { unterrichtId: "u1" })).toBe(false);
    expect(darf(ctx(["schulleitung"]), "noten.lesen", { unterrichtId: "u1" })).toBe(true);
  });
  it("Unbekannte Aktion ist verboten", () => expect(darf(ctx(["admin"]), "gibt.es.nicht")).toBe(false));
  it("Ohne Kontext ist alles verboten", () => expect(darf(null, "fach.lesen")).toBe(false));
  it("Material: privat nur für die Besitzerin, auch nicht für die Administration", () => {
    const m = { besitzerId: "andere", sichtbarkeit: "privat", fachId: "d" };
    expect(darf(ctx(["admin", "schulleitung"]), "material.lesen", m)).toBe(false);
    expect(darf(ctx(["lehrperson"], { faecher: ["d"] }), "material.lesen", m)).toBe(false);
    expect(darf({ ...ctx(["lehrperson"]), personId: "andere" }, "material.lesen", m)).toBe(true);
  });
  it("Material: Fachgruppe sieht nur, wer das Fach hat; Schule sehen alle Lehrpersonen, nicht Schüler", () => {
    const fg = { besitzerId: "x", sichtbarkeit: "fachgruppe", fachId: "d" }, sc = { besitzerId: "x", sichtbarkeit: "schule", fachId: "m" };
    expect(darf(ctx(["lehrperson"], { faecher: ["d"] }), "material.lesen", fg)).toBe(true);
    expect(darf(ctx(["lehrperson"], { faecher: ["f"] }), "material.lesen", fg)).toBe(false);
    expect(darf(ctx(["lehrperson"]), "material.lesen", sc)).toBe(true);
    expect(darf(ctx(["schueler"]), "material.lesen", sc)).toBe(false);
  });
  it("Material: Schüler/in sieht nur, was für den eigenen Unterricht freigegeben ist; Papierkorb sieht niemand sonst", () => {
    const m = { besitzerId: "x", sichtbarkeit: "privat", freigegebenFuer: ["u1"] };
    expect(darf(ctx(["schueler"], { unterricht: ["u1"] }), "material.lesen", m)).toBe(true);
    expect(darf(ctx(["schueler"], { unterricht: ["u2"] }), "material.lesen", m)).toBe(false);
    expect(darf(ctx(["schueler"], { unterricht: ["u1"] }), "material.lesen", { ...m, geloescht: true })).toBe(false);
  });
  it("Material freigeben: nur für eigenen Unterricht und nur, was man sehen darf", () => {
    const c = ctx(["lehrperson"], { lehrt: ["u1"], faecher: ["d"] });
    expect(darf(c, "material.freigeben", { besitzerId: "ich", unterrichtId: "u1" })).toBe(true);
    expect(darf(c, "material.freigeben", { besitzerId: "ich", unterrichtId: "u2" })).toBe(false);
    expect(darf(c, "material.freigeben", { besitzerId: "x", sichtbarkeit: "fachgruppe", fachId: "d", unterrichtId: "u1" })).toBe(true);
    expect(darf(c, "material.freigeben", { besitzerId: "x", sichtbarkeit: "privat", unterrichtId: "u1" })).toBe(false);
    expect(darf(ctx(["schueler"], { lehrt: ["u1"] }), "material.freigeben", { besitzerId: "ich", unterrichtId: "u1" })).toBe(false);
  });
});
