// Ergebnis für Schülerinnen und Schüler, nachdem die Lehrperson die Korrektur zurückgegeben hat
import { Link, useParams } from "react-router-dom";
import { useLaden, Laden, Note } from "../../ui.jsx";
import Pruefungsblatt from "./Pruefungsblatt.jsx";

export default function Ergebnis() {
  const { kurz, vid } = useParams();
  const z = useLaden(`/api/versuche/${vid}/ergebnis`);
  return <Laden zustand={z}>{(d) => (
    <div className="vorschau-seite">
      <div className="kopf kein-druck"><div><div className="pfad"><Link to={`/s/${kurz}/`}>Übersicht</Link></div><h1>Ihre Prüfung</h1></div>
        <div className="reihe"><span className="leise">{String(d.ergebnis.punkte)} von {String(d.total)} Punkten</span>{d.note != null && <Note wert={d.note} gross titel="Note" />}<button className="knopf" onClick={() => window.print()}>Drucken</button></div></div>
      <Pruefungsblatt p={{ ...d.pruefung, einstellungen: { ...d.pruefung.einstellungen, mischen: false } }} teile={d.teile} antworten={d.antworten} setAntwort={() => {}} nurLesen zeigeLoesung
        auswertung={{ teile: d.ergebnis.teile, punkte: d.ergebnis.punkte, note: d.note }} schluessel={vid} />
      <p className="leise klein" style={{ textAlign: "center", marginTop: 16 }}>Abgegeben {new Date(d.quittung.abgegeben_am).toLocaleString("de-CH")}, Prüfnummer {String(d.quittung.hash).slice(0, 16).match(/.{4}/g).join(" ")}</p>
    </div>)}</Laden>;
}
