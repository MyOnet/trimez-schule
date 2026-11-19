// Umwandlung bestätigen: Original links, erkannte Aufgaben rechts. Jede Aufgabe lässt sich ändern, löschen oder ergänzen.
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../../api.js";
import { useLaden, Laden, useMeldung, Symbol } from "../../ui.jsx";
import { TYPEN, teilEntwurf, neuerTeil } from "@schule/shared";
import TeilFormular from "./TeilFormular.jsx";

export default function Umwandlung() {
  const { uid } = useParams();
  const z = useLaden(`/api/umwandlungen/${uid}`);
  return <Laden zustand={z}>{(u) => <Bestaetigen u={u} />}</Laden>;
}

function pruefen(t) { try { return teilEntwurf(t).fehler; } catch (e) { return e.message; } }

function Bestaetigen({ u }) {
  const { kurz, pid, uid } = useParams(); const nav = useNavigate(); const meld = useMeldung();
  const [teile, setTeile] = useState(() => u.vorschlag.map((t) => ({ ...t, fehler: pruefen(t) })));
  const [aktiv, setAktiv] = useState(() => Math.max(0, teile.findIndex((t) => t.fehler)));
  const [laeuft, setLaeuft] = useState(false);
  const aendern = (k, t) => setTeile((ts) => ts.map((x, i) => (i === k ? { ...t, fehler: pruefen(t) } : x)));
  const offen = teile.filter((t) => t.fehler).length;
  const uebernehmen = async () => {
    setLaeuft(true);
    try { const r = await api(`/api/umwandlungen/${uid}/uebernehmen`, { methode: "POST", daten: { teile: teile.map(({ fehler, schluessel, original, hinweis, ...t }) => t) } });
      meld(r.unvollstaendig ? `${r.anzahl} Teile übernommen, ${r.unvollstaendig} noch unvollständig.` : `${r.anzahl} Teile übernommen.`); nav(`/s/${kurz}/pruefungen/${pid}`); }
    catch (e) { meld(e.message, true); setLaeuft(false); }
  };
  if (u.status !== "offen") return <div className="leer"><b>Diese Umwandlung wurde schon übernommen.</b><Link className="knopf" to={`/s/${kurz}/pruefungen/${pid}`}>Zur Prüfung</Link></div>;
  let n = 0;
  return (
    <div>
      <div className="kopf">
        <div><div className="pfad"><Link to={`/s/${kurz}/pruefungen/${pid}`}>Zurück zur Prüfung</Link></div><h1>Aufgaben aus «{u.dateiname}»</h1>
          <p className="leise" style={{ marginTop: 6 }}>{u.verfahren === "ki" ? "Von der KI erkannt." : "Nach Nummerierung, Punkten und Antwortmöglichkeiten erkannt."} Prüfen Sie jede Aufgabe. Unvollständige können Sie auch später ergänzen.</p></div>
        <div className="reihe">
          <button className="knopf leise-knopf" onClick={() => { if (confirm("Vorschlag verwerfen?")) nav(`/s/${kurz}/pruefungen/${pid}`); }}>Verwerfen</button>
          <button className="knopf haupt-knopf" onClick={uebernehmen} disabled={laeuft || !teile.length}>{teile.length} {teile.length === 1 ? "Teil" : "Teile"} übernehmen</button>
        </div>
      </div>
      {u.hinweis && <div className="hinweis" style={{ marginBottom: 16 }}>{u.hinweis}</div>}
      {offen > 0 && <div className="hinweis" style={{ marginBottom: 16 }}><span><b>{offen === 1 ? "Bei einer Aufgabe fehlt" : `Bei ${offen} Aufgaben fehlt`} noch etwas</b>, meist die richtige Lösung. Sie sind markiert.</span></div>}
      <div className="umwandlung">
        <div className="original">
          <div className="original-kopf"><b>Original</b><span className="leise klein">{u.dateiname}</span></div>
          {u.mime === "application/pdf" ? <iframe src={`/api/umwandlungen/${uid}/datei`} title="Original" /> : u.original_html ? <div className="original-html" dangerouslySetInnerHTML={{ __html: saeubern(u.original_html) }} /> : <pre className="original-html">{teile.map((t) => t.original).join("\n\n")}</pre>}
        </div>
        <div className="vorschlaege">
          {teile.map((t, k) => { const nr = t.typ === "abschnitt" ? null : ++n; return (
            <section key={t.schluessel || k} className={"teil-karte" + (t.typ === "abschnitt" ? " abschnitt" : "") + (t.fehler ? " fehlt" : "") + (aktiv === k ? " offen" : "")}>
              <header className="teil-kopf" onClick={() => setAktiv(aktiv === k ? -1 : k)} style={{ cursor: "pointer" }}>
                <span className="teil-nr">{nr ? `Aufgabe ${nr}` : "Abschnitt"}</span>
                <select className="typ-wahl" value={t.typ} onClick={(e) => e.stopPropagation()} onChange={(e) => aendern(k, { ...neuerTeil(e.target.value), inhalt: { ...neuerTeil(e.target.value).inhalt, frage: t.inhalt.frage || t.inhalt.text || "", ...(e.target.value === "abschnitt" ? { titel: t.inhalt.titel || "", text: t.inhalt.frage || t.inhalt.text || "" } : {}) }, punkte: t.punkte, original: t.original, schluessel: t.schluessel })} aria-label="Aufgabentyp">
                  {Object.entries(TYPEN).map(([key, x]) => <option key={key} value={key}>{x.name}</option>)}
                </select>
                {TYPEN[t.typ].punkte && <span className="leise klein">{String(t.punkte)} P.</span>}
                {t.fehler ? <span className="chip gelb">prüfen</span> : <span className="chip gruen">ok</span>}
                <button className="knopf leise-knopf klein-knopf gefahr" style={{ marginLeft: "auto" }} onClick={(e) => { e.stopPropagation(); setTeile(teile.filter((_, i) => i !== k)); }} aria-label="Nicht übernehmen"><Symbol.papierkorb /></button>
              </header>
              {aktiv === k ? <>
                {(t.fehler || t.hinweis) && <p className="teil-fehler">{t.fehler || t.hinweis}</p>}
                {TYPEN[t.typ].punkte && <label className="punkte-feld" style={{ marginBottom: 12 }}><input inputMode="decimal" value={t.punkte} onChange={(e) => aendern(k, { ...t, punkte: e.target.value })} aria-label="Punkte" />Punkte</label>}
                <TeilFormular teil={t} setTeil={(x) => aendern(k, x)} />
                {t.original && <details className="leise klein" style={{ marginTop: 12 }}><summary>Originaltext</summary><pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{t.original}</pre></details>}
              </> : <p className="kurztext" onClick={() => setAktiv(k)}>{(t.inhalt.frage || t.inhalt.titel || t.inhalt.text || "").replace(/[*$]/g, "").slice(0, 160)}</p>}
            </section>); })}
          <button className="knopf" onClick={() => { setTeile([...teile, { ...neuerTeil("freitext"), schluessel: String(Date.now()) }]); setAktiv(teile.length); }}><Symbol.plus />Aufgabe ergänzen</button>
        </div>
      </div>
    </div>);
}
// HTML aus Word (mammoth): nur einfache Auszeichnungen behalten
function saeubern(html) {
  const d = new DOMParser().parseFromString(html, "text/html");
  const erlaubt = new Set(["P", "H1", "H2", "H3", "H4", "UL", "OL", "LI", "STRONG", "EM", "B", "I", "TABLE", "TR", "TD", "TH", "TBODY", "THEAD", "BR", "SUP", "SUB"]);
  const gehe = (el) => { for (const c of [...el.children]) { if (!erlaubt.has(c.tagName)) { gehe(c); c.replaceWith(...(c.tagName === "SCRIPT" || c.tagName === "STYLE" ? [] : c.childNodes)); continue; } for (const a of [...c.attributes]) c.removeAttribute(a.name); gehe(c); } };
  gehe(d.body);
  return d.body.innerHTML;
}
