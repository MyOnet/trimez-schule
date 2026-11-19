// Umwandlung: Erkennung nach Regeln und Anbindung an die KI (mit nachgebildeter Antwort)
import { describe, it, expect } from "vitest";
import { mitRegeln, mitKi, kiVerfuegbar } from "../apps/api/src/pruefung/umwandeln.mjs";

const TEXT = `Prüfung Deutsch: Kleider machen Leute
Name: ____________  Klasse: ____
Teil A: Wissen
1. Wer hat die Novelle geschrieben? (1 P.)
a) Gottfried Keller
b) Friedrich Schiller
2. In welcher Stadt kommt Strapinski an? ______________ (1 P.)
3. Welche Aussagen treffen zu? Kreuzen Sie alle zutreffenden an. (2 P.)
☐ Strapinski ist Schneider
☒ Nettchen ist die Tochter des Amtsrats
Teil B: Verstehen
Aufgabe 4: Erklären Sie, warum Strapinski die Verwechslung nicht aufklärt. (4 Punkte)
____________________________________
____________________________________
5. Ergänzen Sie: Die Novelle erschien in der Sammlung «Die Leute von ______» und spielt in ______. (2 P.)
6. Berechnen Sie, wie viele Seiten ein Kapitel durchschnittlich hat.`;

describe("Umwandlung nach Regeln", () => {
  const { titel, teile } = mitRegeln(TEXT);
  it("erkennt Titel, Abschnitte, Aufgabentypen und Punkte; Kopfzeile «Name» fällt weg", () => {
    expect(titel).toBe("Prüfung Deutsch: Kleider machen Leute");
    expect(teile.map((t) => t.typ)).toEqual(["abschnitt", "einfach", "kurz", "mehrfach", "abschnitt", "freitext", "luecken", "zahl"]);
    expect(teile.map((t) => t.punkte)).toEqual([0, 1, 1, 2, 0, 4, 2, 2]);
    expect(teile.some((t) => JSON.stringify(t).includes("Name:"))).toBe(false);
  });
  it("angekreuzte Antworten werden als Lösung übernommen, sonst ein Hinweis", () => {
    expect(teile[3].loesung.richtig).toEqual(["b"]);
    expect(teile[1].hinweis).toMatch(/Richtige Antwort/);
  });
  it("Lücken werden zu [[?]], fehlende Punkte werden markiert", () => {
    expect(teile[6].inhalt.text).toContain("[[?]]");
    expect(teile[7].hinweis).toMatch(/Ergebnis|Punkte/);
  });
});

describe("Umwandlung mit KI", () => {
  it("nur mit Schlüssel und Modell, und nur wenn die Schule es erlaubt", () => {
    const alt = { ...process.env };
    delete process.env.ANTHROPIC_API_KEY; expect(kiVerfuegbar({})).toBe(false);
    process.env.ANTHROPIC_API_KEY = "x"; process.env.KI_MODELL = "m";
    expect(kiVerfuegbar({})).toBe(true); expect(kiVerfuegbar({ ki: false })).toBe(false);
    process.env = alt;
  });
  it("liest die Antwort des Werkzeugs und verwirft unbekannte Typen", async () => {
    const fetchFn = async (url, opts) => {
      const body = JSON.parse(opts.body);
      expect(body.tool_choice).toEqual({ type: "auto" });
      expect(body.messages[0].content).toContain("Kleider machen Leute");
      return { ok: true, json: async () => ({ content: [{ type: "text", text: "…" }, { type: "tool_use", name: "pruefung", input: { titel: "T", teile: [{ typ: "einfach", punkte: 1, inhalt: { frage: "F", optionen: [{ id: "a", text: "x" }, { id: "b", text: "y" }] }, loesung: { richtig: "a" } }, { typ: "zeichnung", punkte: 1, inhalt: {} }] } }] }) };
    };
    const r = await mitKi(TEXT, { fetchFn });
    expect(r.titel).toBe("T"); expect(r.teile).toHaveLength(1);
  });
  it("meldet Fehler, damit auf Regeln zurückgefallen wird", async () => {
    await expect(mitKi("x", { fetchFn: async () => ({ ok: false, status: 529 }) })).rejects.toThrow(/529/);
  });
});
