// Meine Noten: nur freigegebene Bewertungen, pro Fach mit Schnitt.
import { useState } from "react";
import { useLaden, Laden, Note, datumCH } from "../ui.jsx";
import { fmtNote } from "@schule/shared";

const KZ = { abwesend: "abwesend", nachholen: "wird nachgeholt", dispensiert: "dispensiert" };

export default function MeineNoten({ person }) {
  const [semester, setSemester] = useState("");
  const q = [semester && `semester=${semester}`, person && `person=${person}`].filter(Boolean).join("&");
  const z = useLaden(`/api/meine-noten${q ? `?${q}` : ""}`, [q]);
  return (
    <Laden zustand={z}>{(d) => (
      <div>
        <div className="kopf"><div>{!person && <h1>Meine Noten</h1>}<p className="leise" style={{ marginTop: 6 }}>Hier erscheinen Noten, sobald die Lehrperson sie freigibt.</p></div>
          {d.semesterListe && d.semesterListe.length > 1 && <div className="segment" role="group" aria-label="Semester">{d.semesterListe.map((s) => <button key={s.id} aria-pressed={d.semester && s.id === d.semester.id} onClick={() => setSemester(s.id)}>{s.nr}. Semester</button>)}</div>}
        </div>
        {!d.faecher.length ? <div className="leer"><b>Noch keine Noten in diesem Semester</b><span>Sobald eine Prüfung korrigiert und freigegeben ist, sehen Sie die Note hier.</span></div> : (
          <div className="raster" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", alignItems: "start" }}>
            {d.faecher.map((f) => (
              <section className="karte fach-karte" key={f.unterricht_id} style={{ borderTop: `4px solid ${f.farbe || "var(--gruen)"}` }}>
                <div className="fach-kopf">
                  <h3 style={{ fontFamily: "var(--titel)", fontSize: "1.2rem" }}>{f.fach}</h3>
                  <div style={{ textAlign: "right" }}>
                    <Note wert={f.schnitt} gross titel="Aktueller Schnitt" />
                    <div className="leise klein" style={{ marginTop: 4 }}>{f.zeugnis != null ? <>Zeugnis <b>{fmtNote(f.zeugnis)}</b></> : "Schnitt"}</div>
                  </div>
                </div>
                <div className="noten-liste">
                  {f.noten.map((n, i) => (
                    <div key={i}>
                      <span><b>{n.titel}</b><br /><small>{datumCH(n.datum)}{Number(n.gewicht) !== 1 ? `, zählt ${fmtNote(n.gewicht)}-fach` : ""}{n.max_punkte && n.punkte != null ? `, ${fmtNote(n.punkte)} von ${fmtNote(n.max_punkte)} Punkten` : ""}</small></span>
                      <small>{n.kommentar || ""}</small>
                      {n.kennzeichen ? <span className="chip">{KZ[n.kennzeichen]}</span> : <Note wert={n.note} />}
                    </div>))}
                </div>
              </section>))}
          </div>)}
      </div>)}</Laden>
  );
}
