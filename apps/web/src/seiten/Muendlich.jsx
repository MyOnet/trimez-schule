// Mündliche Beobachtungen: für das Handy im Unterricht gemacht. Ein Tipp pro Beobachtung, Rückgängig im Hinweis.
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { useLaden, Laden, useMeldung, Note } from "../ui.jsx";

const STUFEN = [[2, "++", "w2", "sehr gut"], [1, "+", "w1", "gut"], [0, "○", "w0", "genügend"], [-1, "−", "wm1", "schwach"], [-2, "−−", "wm2", "ungenügend"]];
const ZEICHEN = Object.fromEntries(STUFEN.map(([w, z]) => [w, z]));

export default function Muendlich() {
  const { kurz, uid } = useParams();
  const z = useLaden(`/api/notenbuch/${uid}/beobachtungen`);
  return <Laden zustand={z}>{(d) => <Liste d={d} neu={z.neu} kurz={kurz} uid={uid} />}</Laden>;
}

function Liste({ d, neu, kurz, uid }) {
  const meld = useMeldung(); const nav = useNavigate();
  const [suche, setSuche] = useState("");
  const [lokal, setLokal] = useState({}); // schueler_id → zusätzliche Beobachtungen dieser Sitzung
  const u = d.unterricht;

  const erfassen = async (s, wert) => {
    try {
      const b = await api(`/api/notenbuch/${uid}/beobachtungen`, { methode: "POST", daten: { schueler_id: s.id, wert } });
      setLokal((l) => ({ ...l, [s.id]: [b, ...(l[s.id] || [])] }));
      if (navigator.vibrate) navigator.vibrate(12);
      meld(`${s.vorname}: ${ZEICHEN[wert]}`, false, { text: "Rückgängig", fn: async () => {
        await api(`/api/beobachtungen/${b.id}`, { methode: "DELETE" }).catch(() => {});
        setLokal((l) => ({ ...l, [s.id]: (l[s.id] || []).filter((x) => x.id !== b.id) }));
      } });
    } catch (x) { meld(x.message, true); }
  };
  const uebernehmen = async () => {
    if (!confirm("Aus den Beobachtungen eine mündliche Note als Entwurf anlegen? Sie können jede Note danach im Notenbuch anpassen.")) return;
    try { const r = await api(`/api/notenbuch/${uid}/muendlich-uebernehmen`, { methode: "POST", daten: { semester_id: d.semester.id } }); meld(`Entwurf mit ${r.anzahl} Noten angelegt.`); nav(`/s/${kurz}/unterricht/${uid}/noten`); }
    catch (x) { meld(x.message, true); }
  };

  const t = suche.trim().toLowerCase();
  const liste = d.schueler.filter((s) => !t || `${s.vorname} ${s.nachname}`.toLowerCase().includes(t));
  const total = d.schueler.reduce((a, s) => a + s.beobachtungen.length + (lokal[s.id] || []).length, 0);

  return (
    <div style={{ maxWidth: 760 }}>
      <div className="kopf">
        <div>
          <div className="pfad"><Link to={`/s/${kurz}/unterricht/${uid}/noten`}>Notenbuch {u.fach} {u.klasse}</Link></div>
          <h1>Mündlich erfassen</h1>
          <p className="leise" style={{ marginTop: 6 }}>{d.semester.nr}. Semester, {total} Beobachtungen. Ein Tipp genügt, es wird sofort gespeichert.</p>
        </div>
      </div>
      <div className="zwischen" style={{ marginBottom: 14 }}>
        <input type="search" className="suche" placeholder="Name suchen" value={suche} onChange={(e) => setSuche(e.target.value)} aria-label="Name suchen" style={{ flex: "1 1 220px", maxWidth: 360 }} />
        <button className="knopf" onClick={uebernehmen} disabled={!total}>Als Note übernehmen</button>
      </div>
      <div className="stapel" style={{ gap: 8 }}>
        {liste.map((s) => {
          const alle = [...(lokal[s.id] || []), ...s.beobachtungen];
          return (
            <div className="m-zeile" key={s.id}>
              <div className="wer"><b>{s.vorname} {s.nachname}</b><span>{alle.length ? `${alle.length} Beobachtungen` : "noch keine Beobachtung"}</span></div>
              <div className="m-knoepfe" role="group" aria-label={`Beobachtung für ${s.vorname} ${s.nachname}`}>
                {STUFEN.map(([w, zeichen, kl, name]) => <button key={w} className={kl} onClick={() => erfassen(s, w)} aria-label={`${name} für ${s.vorname}`}>{zeichen}</button>)}
              </div>
              {alle.length > 0 && <div className="m-spur" aria-hidden="true">{alle.slice(0, 16).map((b) => <i key={b.id}>{ZEICHEN[b.wert]}</i>)}{s.vorschlag && s.vorschlag.note != null && <span style={{ marginLeft: "auto" }}><Note wert={s.vorschlag.note} titel="Vorschlag aus den Beobachtungen" /></span>}</div>}
            </div>);
        })}
      </div>
      <p className="leise klein" style={{ marginTop: 14 }}>Vorschlag: ++ zählt als 6, + als 5, ○ als 4,5, − als 3,5, −− als 2,5. Der Durchschnitt wird auf Viertelnoten gerundet, ab drei Beobachtungen. Die Note entscheiden Sie.</p>
    </div>
  );
}
