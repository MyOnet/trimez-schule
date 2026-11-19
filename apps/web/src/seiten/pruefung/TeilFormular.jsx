// Eingabe einer Aufgabe je nach Typ. Gesteuert: teil rein, setTeil(neu) raus. Speichern macht der Aufrufer.
import { useId } from "react";
import { lueckenLesen } from "@schule/shared";
import Formatiert, { hatFormat } from "./Formatiert.jsx";
import { Symbol } from "../../ui.jsx";

const ids = "abcdefghijklmnopqrstuvwxyz";
const naechsteId = (liste) => ids.split("").find((c) => !liste.some((x) => x.id === c)) || "z" + liste.length;

export function TextFeld({ label, hilfe, value, onChange, rows = 2, placeholder, vorschau = true, autoFocus }) {
  return (
    <label className="feld">{label}{hilfe && <small>{hilfe}</small>}
      <textarea value={value || ""} onChange={(e) => onChange(e.target.value)} rows={rows} placeholder={placeholder} autoFocus={autoFocus} style={{ minHeight: rows * 24 + 22 }} />
      {vorschau && hatFormat(value) && <Formatiert text={value} className="formel-vorschau" />}
    </label>);
}

export default function TeilFormular({ teil, setTeil }) {
  const i = teil.inhalt || {}, l = teil.loesung || {};
  const inhalt = (x) => setTeil({ ...teil, inhalt: { ...i, ...x } });
  const loesung = (x) => setTeil({ ...teil, loesung: { ...l, ...x } });
  const name = useId();
  const frage = <TextFeld label="Aufgabe" hilfe="**fett**, *kursiv*, Formeln in $…$, z. B. $\sqrt{2}$" value={i.frage} onChange={(v) => inhalt({ frage: v })} rows={2} />;

  switch (teil.typ) {
    case "abschnitt": return <div className="formular">
      <label className="feld">Überschrift<input value={i.titel || ""} onChange={(e) => inhalt({ titel: e.target.value })} placeholder="z. B. Teil A: Grammatik" /></label>
      <TextFeld label="Text" hilfe="Lesetext, Material oder Hinweise zu den folgenden Aufgaben" value={i.text} onChange={(v) => inhalt({ text: v })} rows={4} />
    </div>;

    case "einfach": case "mehrfach": {
      const o = i.optionen || [];
      const richtig = teil.typ === "einfach" ? [l.richtig] : l.richtig || [];
      const setRichtig = (id, an) => teil.typ === "einfach" ? loesung({ richtig: id }) : loesung({ richtig: an ? [...new Set([...richtig, id])] : richtig.filter((x) => x !== id) });
      return <div className="formular">
        {frage}
        <div className="feld" role="group" aria-label="Antworten"><span>Antworten <small>{teil.typ === "einfach" ? "Die richtige markieren" : "Alle richtigen markieren"}</small></span>
          <div className="optionen-edit">
            {o.map((x, k) => <div key={x.id} className={"option-edit" + (richtig.includes(x.id) ? " richtig" : "")}>
              <input type={teil.typ === "einfach" ? "radio" : "checkbox"} name={name} checked={richtig.includes(x.id)} onChange={(e) => setRichtig(x.id, e.target.checked)} aria-label={`Antwort ${k + 1} ist richtig`} />
              <input value={x.text} onChange={(e) => inhalt({ optionen: o.map((y) => (y.id === x.id ? { ...y, text: e.target.value } : y)) })} placeholder={`Antwort ${k + 1}`} aria-label={`Antwort ${k + 1}`} />
              {o.length > 2 && <button type="button" className="knopf leise-knopf klein-knopf" onClick={() => { inhalt({ optionen: o.filter((y) => y.id !== x.id) }); }} aria-label={`Antwort ${k + 1} entfernen`}><Symbol.schliessen /></button>}
            </div>)}
          </div>
          {o.length < 12 && <button type="button" className="knopf leise-knopf klein-knopf" style={{ justifySelf: "start" }} onClick={() => inhalt({ optionen: [...o, { id: naechsteId(o), text: "" }] })}><Symbol.plus />Antwort</button>}
        </div>
        {teil.typ === "mehrfach" && <label className="check"><input type="checkbox" checked={l.teilpunkte !== false} onChange={(e) => loesung({ teilpunkte: e.target.checked })} style={{ width: "auto", minHeight: 0 }} />Teilpunkte (falsche Kreuze ziehen ab, nie unter 0)</label>}
      </div>;
    }

    case "kurz": return <div className="formular">
      {frage}
      <label className="feld">Richtige Antworten<small>Eine pro Zeile. Andere Antworten prüfen Sie bei der Korrektur.</small>
        <textarea value={(l.antworten || []).join("\n")} onChange={(e) => loesung({ antworten: e.target.value.split("\n") })} rows={3} placeholder={"Gottfried Keller\nKeller"} /></label>
      <label className="check"><input type="checkbox" checked={!!l.gross_klein} onChange={(e) => loesung({ gross_klein: e.target.checked })} style={{ width: "auto", minHeight: 0 }} />Gross- und Kleinschreibung beachten</label>
    </div>;

    case "zahl": return <div className="formular">
      {frage}
      <div className="drei">
        <label className="feld">Ergebnis<input inputMode="decimal" value={l.wert ?? ""} onChange={(e) => loesung({ wert: e.target.value })} placeholder="z. B. 5.74" /></label>
        <label className="feld">Toleranz ±<input inputMode="decimal" value={l.toleranz ?? ""} onChange={(e) => loesung({ toleranz: e.target.value })} placeholder="0" /></label>
        <label className="feld">Einheit<input value={i.einheit || ""} onChange={(e) => inhalt({ einheit: e.target.value })} placeholder="z. B. cm" /></label>
      </div>
    </div>;

    case "luecken": {
      const { luecken } = lueckenLesen(i.text);
      return <div className="formular">
        <TextFeld label="Anweisung" value={i.frage} onChange={(v) => inhalt({ frage: v })} rows={1} />
        <TextFeld label="Text mit Lücken" hilfe="Lücke mit Lösung: [[Antwort]]. Mehrere richtige: [[Antwort|Alternative]]" value={i.text} onChange={(v) => inhalt({ text: v })} rows={4} vorschau={false} />
        {luecken.length > 0 && <p className="leise klein">{luecken.length} {luecken.length === 1 ? "Lücke" : "Lücken"}: {luecken.map((a) => a.join(" / ")).join(", ")}</p>}
        <label className="check"><input type="checkbox" checked={!!l.gross_klein} onChange={(e) => loesung({ gross_klein: e.target.checked })} style={{ width: "auto", minHeight: 0 }} />Gross- und Kleinschreibung beachten</label>
      </div>;
    }

    case "zuordnung": {
      const p = i.paare || [];
      return <div className="formular">
        {frage}
        <div className="feld"><span>Paare <small>So eingeben, wie sie richtig zusammengehören. Die rechte Seite wird gemischt.</small></span>
          <div className="optionen-edit">
            {p.map((x, k) => <div key={x.id} className="option-edit paar">
              <input value={x.links} onChange={(e) => inhalt({ paare: p.map((y) => (y.id === x.id ? { ...y, links: e.target.value } : y)) })} placeholder={`Links ${k + 1}`} aria-label={`Links ${k + 1}`} />
              <span aria-hidden="true" className="leise">gehört zu</span>
              <input value={x.rechts} onChange={(e) => inhalt({ paare: p.map((y) => (y.id === x.id ? { ...y, rechts: e.target.value } : y)) })} placeholder={`Rechts ${k + 1}`} aria-label={`Rechts ${k + 1}`} />
              {p.length > 2 && <button type="button" className="knopf leise-knopf klein-knopf" onClick={() => inhalt({ paare: p.filter((y) => y.id !== x.id) })} aria-label={`Paar ${k + 1} entfernen`}><Symbol.schliessen /></button>}
            </div>)}
          </div>
          {p.length < 12 && <button type="button" className="knopf leise-knopf klein-knopf" style={{ justifySelf: "start" }} onClick={() => inhalt({ paare: [...p, { id: naechsteId(p), links: "", rechts: "" }] })}><Symbol.plus />Paar</button>}
        </div>
      </div>;
    }

    case "reihenfolge": {
      const e = i.elemente || [];
      const tausch = (k, d) => { const n = [...e]; [n[k], n[k + d]] = [n[k + d], n[k]]; inhalt({ elemente: n }); };
      return <div className="formular">
        {frage}
        <div className="feld"><span>Elemente <small>In der richtigen Reihenfolge eingeben. Die Klasse sieht sie gemischt.</small></span>
          <div className="optionen-edit">
            {e.map((x, k) => <div key={x.id} className="option-edit">
              <span className="nr-kreis">{k + 1}</span>
              <input value={x.text} onChange={(ev) => inhalt({ elemente: e.map((y) => (y.id === x.id ? { ...y, text: ev.target.value } : y)) })} placeholder={`Element ${k + 1}`} aria-label={`Element ${k + 1}`} />
              <span className="reihe" style={{ gap: 0, flexWrap: "nowrap" }}>
                <button type="button" className="knopf leise-knopf klein-knopf" disabled={!k} onClick={() => tausch(k, -1)} aria-label="nach oben">↑</button>
                <button type="button" className="knopf leise-knopf klein-knopf" disabled={k === e.length - 1} onClick={() => tausch(k, 1)} aria-label="nach unten">↓</button>
                {e.length > 2 && <button type="button" className="knopf leise-knopf klein-knopf" onClick={() => inhalt({ elemente: e.filter((y) => y.id !== x.id) })} aria-label={`Element ${k + 1} entfernen`}><Symbol.schliessen /></button>}
              </span>
            </div>)}
          </div>
          {e.length < 12 && <button type="button" className="knopf leise-knopf klein-knopf" style={{ justifySelf: "start" }} onClick={() => inhalt({ elemente: [...e, { id: naechsteId(e), text: "" }] })}><Symbol.plus />Element</button>}
        </div>
      </div>;
    }

    case "freitext": return <div className="formular">
      <TextFeld label="Aufgabe" hilfe="**fett**, *kursiv*, Formeln in $…$" value={i.frage} onChange={(v) => inhalt({ frage: v })} rows={3} />
      <div className="zwei">
        <label className="feld">Platz für die Antwort<select value={i.zeilen || 8} onChange={(e) => inhalt({ zeilen: Number(e.target.value) })}>{[3, 5, 8, 12, 20, 30].map((n) => <option key={n} value={n}>{n} Zeilen</option>)}</select></label>
      </div>
      <TextFeld label="Erwartung und Bewertungsraster" hilfe="Nur für Sie, hilft bei der Korrektur" value={l.erwartung} onChange={(v) => loesung({ erwartung: v })} rows={3} />
    </div>;
  }
  return null;
}
