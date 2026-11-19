// Umwandlung einer bestehenden Prüfung (Word oder PDF) in Teile.
// Zwei Verfahren:
//   regeln: erkennt Nummerierung («1.», «Aufgabe 2»), Punkte («(4 P.)»), Antwortmöglichkeiten («a)», «☐»),
//           Lücken («_____») und Abschnitte («Teil A»). Läuft immer, ohne externe Dienste.
//   ki:     nur wenn ANTHROPIC_API_KEY und KI_MODELL gesetzt sind und die Schule KI erlaubt. Der Text der Prüfung
//           (ohne Daten von Schülerinnen und Schülern) geht an den Anbieter. Fällt bei Fehlern auf «regeln» zurück.
// Das Ergebnis ist immer ein Vorschlag: Die Lehrperson prüft jede Aufgabe, bevor sie übernommen wird.
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import { TYPEN } from "@schule/shared";

export async function textAusDatei(ext, buf) {
  if (ext === "pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: false });
    return { text: text.join("\n\n"), seiten: text.length, html: null };
  }
  if (ext === "docx") {
    const [roh, html] = await Promise.all([mammoth.extractRawText({ buffer: buf }), mammoth.convertToHtml({ buffer: buf })]);
    return { text: roh.value, seiten: null, html: html.value };
  }
  if (ext === "txt" || ext === "md") return { text: buf.toString("utf8"), seiten: null, html: null };
  throw Object.assign(new Error("Bitte eine Word-Datei (.docx) oder ein PDF hochladen."), { status: 415 });
}

const PUNKTE = /\s*[([]\s*(\d+(?:[.,]\d+)?)\s*(?:P\.?|Pkt\.?|Punkte?|pt\.?)\s*[)\]]\s*|\s+(?:\/\s*)?(\d+(?:[.,]\d+)?)\s*(?:P\.|Pkt\.|Punkte)\s*$/i;
const AUFGABE = /^(?:(?:Aufgabe|Frage|Nr\.?)\s*(\d{1,3})\s*[:.)–-]?|(\d{1,3})\s*[.)])\s*(.*)$/i;
const OPTION = /^(?:[☐☑☒□○◯▢❏■●•✓✔✗]\s*|\[\s?[xX ]?\s?\]\s*|[a-hA-H]\s?[).]\s+|\(\s?[a-hA-H]\s?\)\s+)(.+)$/;
const KREUZ = /^(?:[■☑☒✓✔]|\[\s?[xX]\s?\])/;
const ABSCHNITT = /^(?:Teil|Abschnitt|Kapitel)\s+([A-Z]|\d{1,2}|[IVX]{1,4})\b\s*[:.–-]?\s*(.*)$/i;
const LINIE = /^[\s_.…·-]{6,}$/;
const LUECKE = /_{3,}|\.{5,}|…{2,}/g;
const KOPF = /^(?:Name|Vorname|Klasse|Datum|Lehrperson|Note|Punkte|Unterschrift)\s*[:_.]/i;

const zahl = (s) => Number(String(s).replace(",", "."));

export function mitRegeln(text) {
  const zeilen = String(text).replace(/\r/g, "").split("\n").map((z) => z.replace(/\s+$/, ""));
  const teile = []; let titel = ""; let akt = null; let vorspann = [];
  const abschliessen = () => {
    if (!akt) return;
    // Antwortmöglichkeiten: mindestens zwei aufeinanderfolgende Optionen am Schluss
    const opt = akt.optionen;
    let frage = akt.zeilen.join("\n").trim();
    let teil;
    if (opt.length >= 2) {
      const ids = opt.map((_, k) => "abcdefgh"[k]);
      const gekreuzt = opt.map((o, k) => (o.kreuz ? ids[k] : null)).filter(Boolean);
      const typ = /mehrere|alle zutreffenden|mehrfach/i.test(frage) || gekreuzt.length > 1 ? "mehrfach" : "einfach";
      teil = { typ, punkte: akt.punkte ?? (typ === "mehrfach" ? 2 : 1), inhalt: { frage, optionen: opt.map((o, k) => ({ id: ids[k], text: o.text })) },
        loesung: typ === "mehrfach" ? { richtig: gekreuzt, teilpunkte: true } : { richtig: gekreuzt[0] || "" },
        hinweis: gekreuzt.length ? null : "Richtige Antwort markieren" };
    } else if (LUECKE.test(frage) && !/^\s*_{3,}\s*$/m.test(frage)) {
      LUECKE.lastIndex = 0;
      const n = (frage.match(LUECKE) || []).length;
      // Kurze Aufgabe mit einer Lücke am Ende → Kurzantwort; sonst Lückentext (Lösungen ergänzen)
      if (n === 1 && /[_.…]{3,}\s*$/.test(frage) && frage.length < 300) teil = { typ: "kurz", punkte: akt.punkte ?? 1, inhalt: { frage: frage.replace(LUECKE, "").trim() }, loesung: { antworten: [] }, hinweis: "Richtige Antwort ergänzen" };
      else teil = { typ: "luecken", punkte: akt.punkte ?? n, inhalt: { frage: "Ergänzen Sie die Lücken.", text: frage.replace(LUECKE, "[[?]]") }, loesung: {}, hinweis: "In jeder Lücke das ? durch die Lösung ersetzen" };
    } else {
      const zahlFrage = /\b(berechne|bestimme|wie (gross|viel|viele|lang|hoch))/i.test(frage) && frage.length < 400;
      teil = zahlFrage
        ? { typ: "zahl", punkte: akt.punkte ?? 2, inhalt: { frage, einheit: "" }, loesung: { wert: "", toleranz: "" }, hinweis: "Ergebnis eintragen oder als Freitext belassen" }
        : { typ: "freitext", punkte: akt.punkte ?? 2, inhalt: { frage, zeilen: Math.min(30, Math.max(3, akt.linien || 6)) }, loesung: { erwartung: "" }, hinweis: akt.punkte == null ? "Punkte prüfen" : null };
    }
    if (akt.punkte == null && teil.hinweis == null) teil.hinweis = "Punkte prüfen";
    teil.original = akt.original.join("\n").slice(0, 2000);
    teile.push(teil); akt = null;
  };
  const vorspannAbschliessen = () => {
    const t = vorspann.join("\n").trim();
    if (t.length > 0) teile.push({ typ: "abschnitt", punkte: 0, inhalt: { titel: "", text: t }, loesung: {}, original: t.slice(0, 2000) });
    vorspann = [];
  };

  for (const roh of zeilen) {
    const z = roh.trim();
    if (!z) { if (akt && akt.optionen.length === 0 && akt.zeilen.length) akt.zeilen.push(""); continue; }
    if (KOPF.test(z)) continue;
    if (!titel && !akt && !teile.length && !vorspann.length && z.length < 120 && !AUFGABE.test(z)) { titel = z; continue; }
    if (LINIE.test(z)) { if (akt) akt.linien = (akt.linien || 0) + 1; continue; }
    const ab = z.match(ABSCHNITT);
    if (ab && z.length < 120) { abschliessen(); vorspannAbschliessen(); teile.push({ typ: "abschnitt", punkte: 0, inhalt: { titel: z.replace(PUNKTE, " ").trim(), text: "" }, loesung: {}, original: z }); continue; }
    const a = z.match(AUFGABE);
    if (a && (a[3] || "").length > 0 && !/^\d{1,3}[.)]\s*\d/.test(z)) {
      abschliessen(); vorspannAbschliessen();
      let rest = a[3]; let punkte = null;
      const p = rest.match(PUNKTE); if (p) { punkte = zahl(p[1] || p[2]); rest = rest.replace(PUNKTE, " ").trim(); }
      akt = { zeilen: [rest], optionen: [], punkte, original: [z] };
      continue;
    }
    if (akt) {
      akt.original.push(z);
      const p = z.match(PUNKTE);
      let zz = z; if (p && akt.punkte == null) { akt.punkte = zahl(p[1] || p[2]); zz = z.replace(PUNKTE, " ").trim(); if (!zz) continue; }
      const o = zz.match(OPTION);
      if (o && zz.length < 300) { akt.optionen.push({ text: o[1].trim(), kreuz: KREUZ.test(zz) }); continue; }
      if (akt.optionen.length) { // Text nach den Optionen: doch keine Auswahlaufgabe, Optionen gehören zur Frage
        akt.zeilen.push(...akt.optionen.map((x, k) => `${"abcdefgh"[k]}) ${x.text}`)); akt.optionen = [];
      }
      akt.zeilen.push(zz);
    } else vorspann.push(z);
  }
  abschliessen(); vorspannAbschliessen();
  // Leere Zeilen am Ende von Fragen entfernen
  for (const t of teile) if (t.inhalt.frage) t.inhalt.frage = t.inhalt.frage.replace(/\n{3,}/g, "\n\n").trim();
  return { titel, teile };
}

/* ---------- KI (optional) ---------- */
const SCHEMA = {
  type: "object", required: ["titel", "teile"],
  properties: {
    titel: { type: "string" },
    teile: { type: "array", items: { type: "object", required: ["typ", "punkte", "inhalt"], properties: {
      typ: { type: "string", enum: Object.keys(TYPEN) },
      punkte: { type: "number" },
      inhalt: { type: "object", description: "abschnitt: {titel,text}; einfach/mehrfach: {frage, optionen:[{id,text}]}; kurz: {frage}; zahl: {frage, einheit}; luecken: {frage, text mit [[Lösung]] je Lücke, [[?]] wenn unbekannt}; zuordnung: {frage, paare:[{id,links,rechts}]} (richtige Paare); reihenfolge: {frage, elemente:[{id,text}]} (richtige Reihenfolge); freitext: {frage, zeilen}" },
      loesung: { type: "object", description: "einfach: {richtig:id}; mehrfach: {richtig:[ids]}; kurz: {antworten:[...]}; zahl: {wert, toleranz}; freitext: {erwartung}. Nur ausfüllen, wenn die Lösung im Dokument steht oder eindeutig ist; sonst leer lassen." },
      hinweis: { type: "string", description: "Was die Lehrperson prüfen soll, kurz" },
      original: { type: "string", description: "Der Originaltext dieser Aufgabe" },
    } } },
  },
};

export const kiVerfuegbar = (einstellungen = {}) => !!(process.env.ANTHROPIC_API_KEY && process.env.KI_MODELL && einstellungen.ki !== false);

export async function mitKi(text, { fetchFn = fetch, timeoutMs = 90000 } = {}) {
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetchFn("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: ctl.signal,
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.KI_MODELL, max_tokens: 16000,
        system: "Du wandelst eine Prüfung eines Schweizer Gymnasiums in strukturierte Aufgaben um. Übernimm den Wortlaut der Aufgaben genau, erfinde keine Aufgaben und keine Lösungen. Punkte nur aus dem Dokument; fehlen sie, schätze sie und schreibe das in «hinweis». Antworte ausschliesslich mit einem Aufruf des Werkzeugs «pruefung».",
        tools: [{ name: "pruefung", description: "Die erkannten Teile der Prüfung", input_schema: SCHEMA }],
        tool_choice: { type: "auto" },
        messages: [{ role: "user", content: `Hier ist der Text der Prüfung:\n\n<pruefung>\n${String(text).slice(0, 120000)}\n</pruefung>` }],
      }),
    });
    if (!r.ok) throw new Error(`KI-Anfrage abgelehnt (${r.status})`);
    const d = await r.json();
    const tool = (d.content || []).find((c) => c.type === "tool_use" && c.name === "pruefung");
    if (!tool || !Array.isArray(tool.input?.teile)) throw new Error("Die KI hat keine Aufgaben geliefert.");
    return { titel: String(tool.input.titel || ""), teile: tool.input.teile.filter((t) => TYPEN[t.typ]).slice(0, 200) };
  } finally { clearTimeout(tm); }
}
