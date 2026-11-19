// Wissenschaftlicher Taschenrechner für Prüfungen (nur wenn die Lehrperson ihn erlaubt). Rechnet ohne eval.
import { useEffect, useRef, useState } from "react";
import { rechnen } from "@schule/shared";

const TASTEN = [
  ["sin", "cos", "tan", "(", ")"],
  ["ln", "log", "√", "^", "÷"],
  ["7", "8", "9", "π", "×"],
  ["4", "5", "6", "e", "−"],
  ["1", "2", "3", "ans", "+"],
  ["0", ".", "!", "⌫", "="],
];
const EINFUEGEN = { sin: "sin(", cos: "cos(", tan: "tan(", ln: "ln(", log: "log(", "√": "√(" };

export default function Taschenrechner({ zu }) {
  const [eingabe, setEingabe] = useState(""); const [verlauf, setVerlauf] = useState([]); const [grad, setGrad] = useState(true); const [fehler, setFehler] = useState("");
  const ans = useRef(0); const feld = useRef(null);
  useEffect(() => { feld.current && feld.current.focus(); }, []);
  const los = () => {
    if (!eingabe.trim()) return;
    try { const r = rechnen(eingabe, { grad, ans: ans.current }); ans.current = r; setVerlauf((v) => [...v.slice(-4), { a: eingabe, r }]); setEingabe(String(r)); setFehler(""); }
    catch (x) { setFehler(x.message); }
  };
  const taste = (t) => {
    setFehler("");
    if (t === "=") return los();
    if (t === "⌫") return setEingabe((e) => e.slice(0, -1));
    setEingabe((e) => e + (EINFUEGEN[t] || t));
    feld.current && feld.current.focus();
  };
  return (
    <div className="rechner" role="dialog" aria-label="Taschenrechner">
      <div className="rechner-kopf"><b>Taschenrechner</b>
        <div className="segment klein" role="radiogroup" aria-label="Winkel"><button type="button" aria-pressed={grad} onClick={() => setGrad(true)}>Grad</button><button type="button" aria-pressed={!grad} onClick={() => setGrad(false)}>Bogenmass</button></div>
        <button type="button" className="knopf leise-knopf klein-knopf" onClick={zu} aria-label="Taschenrechner schliessen">✕</button></div>
      <div className="rechner-anzeige">
        {verlauf.map((v, k) => <div key={k} className="rechner-alt"><span>{v.a}</span><b>= {String(v.r)}</b></div>)}
        <input ref={feld} value={eingabe} onChange={(e) => { setEingabe(e.target.value); setFehler(""); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); los(); } if (e.key === "Escape") setEingabe(""); }} aria-label="Rechnung" inputMode="decimal" spellCheck={false} autoComplete="off" />
        <div className="rechner-fehler" aria-live="polite">{fehler}</div>
      </div>
      <div className="rechner-tasten">
        <button type="button" className="breit2" onClick={() => { setEingabe(""); setFehler(""); }}>C</button>
        <button type="button" onClick={() => taste("^2")}>x²</button><button type="button" onClick={() => taste("%")}>%</button><button type="button" onClick={() => taste("10^")}>10ˣ</button>
        {TASTEN.flat().map((t) => <button type="button" key={t} className={t === "=" ? "gleich" : /^[0-9.]$/.test(t) ? "ziffer" : ""} onClick={() => taste(t)}>{t}</button>)}
      </div>
    </div>);
}
