// Vorschau: die Prüfung wie die Klasse sie sieht. Probe lösen, automatisch auswerten, Lösungen einblenden, drucken.
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useLaden, Laden, Symbol } from "../../ui.jsx";
import { punkteZuNote } from "@schule/shared";
import Pruefungsblatt, { auswerten } from "./Pruefungsblatt.jsx";

export default function Vorschau() {
  const { kurz, pid } = useParams();
  const z = useLaden(`/api/pruefungen/${pid}`);
  return <Laden zustand={z}>{(d) => <Ansicht d={d} kurz={kurz} pid={pid} schluesselListe={d.schluessel} />}</Laden>;
}

function Ansicht({ d, kurz, pid, schluesselListe }) {
  const [antworten, setAntworten] = useState({});
  const [loesung, setLoesung] = useState(false);
  const [ausgewertet, setAusgewertet] = useState(false);
  const teile = useMemo(() => d.teile.filter((t) => !t.fehler || t.typ === "abschnitt"), [d]);
  const total = teile.reduce((a, t) => a + Number(t.punkte || 0), 0);
  const aus = useMemo(() => {
    if (!ausgewertet) return null;
    const r = auswerten(teile, antworten);
    const sch = schluesselListe.find((x) => x.id === d.notenschluessel_id);
    return { ...r, note: sch && total ? punkteZuNote(r.punkte, total, sch) : null };
  }, [ausgewertet, antworten, d, teile, schluesselListe, total]);
  const setAntwort = (k, v) => { setAntworten((a) => ({ ...a, [k]: v })); };
  return (
    <div className="vorschau-seite">
      <div className="vorschau-leiste kein-druck">
        <Link className="knopf leise-knopf" to={`/s/${kurz}/pruefungen/${pid}`}>← Zurück zum Bearbeiten</Link>
        <span className="leise klein" style={{ marginRight: "auto" }}>So sieht die Klasse die Prüfung. Ihre Eingaben hier werden nicht gespeichert.</span>
        <label className="check klein"><input type="checkbox" checked={loesung} onChange={(e) => setLoesung(e.target.checked)} style={{ width: "auto", minHeight: 0 }} />Lösungen zeigen</label>
        {ausgewertet ? <button className="knopf" onClick={() => setAusgewertet(false)}>Auswertung ausblenden</button> : <button className="knopf haupt-knopf" onClick={() => setAusgewertet(true)}>Probe auswerten</button>}
        <button className="knopf" onClick={() => setAntworten({})}>Leeren</button>
        <button className="knopf" onClick={() => window.print()}><Symbol.drucken />Drucken</button>
      </div>
      {aus && <div className="hinweis kein-druck" role="status" style={{ marginBottom: 18 }}><span><b>{String(aus.punkte)} von {String(total)} Punkten</b>{aus.note != null && <>, Note {String(aus.note)}</>}{aus.offen ? `. ${aus.offen === 1 ? "Eine Aufgabe wird" : `${aus.offen} Aufgaben werden`} von Hand bewertet (mit «?» markiert).` : "."}</span></div>}
      {d.status !== "bereit" && <div className="hinweis kein-druck" style={{ marginBottom: 18 }}>Diese Prüfung ist noch ein Entwurf.</div>}
      {teile.length < d.teile.length && <div className="hinweis kein-druck" style={{ marginBottom: 18 }}>{d.teile.length - teile.length === 1 ? "Eine unvollständige Aufgabe ist" : `${d.teile.length - teile.length} unvollständige Aufgaben sind`} ausgeblendet.</div>}
      <Pruefungsblatt p={d} teile={teile} antworten={antworten} setAntwort={setAntwort} zeigeLoesung={loesung} auswertung={aus}
        kopf={<div className="blatt-name"><span>Name</span><span className="linie" /><span>Klasse</span><span className="linie kurz" /></div>} />
    </div>);
}
