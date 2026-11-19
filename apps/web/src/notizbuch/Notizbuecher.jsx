// Alle Kursnotizbücher der Person, als Hefte. Gesperrte Notizbücher zeigen den Grund.
import { Link, useParams } from "react-router-dom";
import { useLaden, Laden, wann } from "../ui.jsx";

export default function Notizbuecher() {
  const { kurz } = useParams();
  const z = useLaden("/api/notizbuecher");
  return <div>
    <div className="kopf"><div><h1>Notizbücher</h1><p>Ein Kursnotizbuch pro Fach und Klasse: Inhaltsbibliothek der Lehrperson, Zusammenarbeit und ein eigener Bereich für jede Schülerin und jeden Schüler.</p></div></div>
    <Laden zustand={z}>{(d) => !d.notizbuecher.length
      ? <div className="leer"><b>Noch keine Notizbücher</b><span>Sobald Sie einem Unterricht zugeteilt sind, erscheint hier sein Kursnotizbuch.</span></div>
      : <div className="regal">{d.notizbuecher.map((n) => <div key={n.id} className="heft">
        <Link to={`/s/${kurz}/notizbuch/${n.id}`} className={"ukarte" + (n.erlaubt ? "" : " gesperrt")} style={{ "--farbe": n.farbe }}>
          <div className="etikett-heft"><div className="klasse">{n.fach}</div><div className="fach">Klasse {n.klasse}{n.gruppe ? `, ${n.gruppe}` : ""}</div></div>
          <div className="unten">
            <span>{n.erlaubt ? (n.zuletzt ? `geändert ${wann(n.zuletzt)}` : "noch leer") : "gesperrt"}</span>
            {n.rolle === "lp" && <span>{n.notizbuch ? "für die Klasse offen" : "für die Klasse gesperrt"}</span>}
          </div>
        </Link>
        {!n.erlaubt && <p className="leise klein" style={{ marginTop: 8 }}>{n.grund}</p>}
      </div>)}</div>}
    </Laden>
  </div>;
}
