// Klassenraum: Ankündigungen, Fragen und Beiträge pro Unterricht, mit Antworten und Dateien
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, hochladen } from "../api.js";
import { useLaden, Laden, Symbol, useMeldung, DateiListe, DateiKnopf, Absaetze, wann, useKurse, kursName, initialen } from "../ui.jsx";

const ART = { ankuendigung: "Ankündigung", frage: "Frage", beitrag: "Beitrag" };

export default function Raeume() {
  const z = useKurse();
  const { kurz } = useParams();
  return <Laden zustand={z}>{(liste) => <div>
    <div className="kopf"><div><h1>Klassenräume</h1><p className="leise" style={{ marginTop: 6 }}>Ankündigungen, Fragen und Dateien pro Unterricht. Gespeichert in der Schweiz.</p></div></div>
    {!liste.length ? <div className="leer"><b>Kein Unterricht</b><span>Jeder Unterricht hat seinen eigenen Raum.</span></div> :
      <div className="raster" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>{liste.map((u) => <Link key={u.id} to={`/s/${kurz}/raum/${u.id}`} className="karte" style={{ borderTop: `4px solid ${u.farbe || "var(--gruen)"}`, textDecoration: "none", color: "inherit" }}>
        <b>{kursName(u)}</b><div className="leise klein" style={{ marginTop: 4 }}>{u.zuletzt ? `Zuletzt ${wann(u.zuletzt)}` : "Noch still"}</div>
        {u.neu > 0 && <span className="neu-chip" style={{ marginTop: 8, display: "inline-block" }}>{u.neu} neu</span>}
      </Link>)}</div>}
  </div>}</Laden>;
}

export function Raum() {
  const { uid } = useParams();
  const [art, setArt] = useState("");
  const z = useLaden(`/api/raum/${uid}${art ? `?art=${art}` : ""}`, [uid, art]);
  const zeige = useMeldung();
  const { kurz } = useParams();
  return <Laden zustand={z}>{(d) => <div style={{ maxWidth: 820 }}>
    <div className="kopf"><div><p className="leise klein"><Link to={`/s/${kurz}/raum`}>Klassenräume</Link></p><h1>{d.unterricht.fach} {d.unterricht.klasse}</h1></div>
      <div className="segment" role="group" aria-label="Filter">{[["", "Alles"], ["ankuendigung", "Ankündigungen"], ["frage", "Fragen"]].map(([k, t]) => <button key={k} aria-pressed={art === k} onClick={() => setArt(k)}>{t}</button>)}</div>
    </div>
    {d.darfModerieren && <label className="check" style={{ marginBottom: 12 }}><input type="checkbox" checked={d.unterricht.raum_schueler_schreiben !== false} onChange={async (e) => { try { await api(`/api/raum/${uid}/einstellungen`, { methode: "PUT", daten: { schueler_schreiben: e.target.checked } }); z.neu(); } catch (x) { zeige(x.message, true); } }} />Schülerinnen und Schüler dürfen schreiben</label>}
    {d.darfSchreiben && <Schreiben uid={uid} mod={d.darfModerieren} onFertig={z.neu} />}
    {!d.beitraege.length && <div className="leer"><b>Noch keine Beiträge</b><span>{d.darfModerieren ? "Schreiben Sie eine erste Ankündigung." : "Stellen Sie eine Frage, wenn etwas unklar ist."}</span></div>}
    <div className="stapel" style={{ gap: 12 }}>{d.beitraege.map((b) => <Beitrag key={b.id} b={b} d={d} uid={uid} neu={z.neu} />)}</div>
  </div>}</Laden>;
}

function Schreiben({ uid, mod, onFertig, eltern }) {
  const zeige = useMeldung();
  const [text, setText] = useState("");
  const [art, setArt] = useState(mod ? "ankuendigung" : "frage");
  const [dateien, setDateien] = useState([]);
  const senden = async (e) => {
    e.preventDefault();
    try {
      const b = await api(`/api/raum/${uid}/beitraege`, { methode: "POST", daten: { text, art: eltern ? undefined : art, eltern_id: eltern || undefined } });
      for (const f of dateien) await hochladen(`/api/beitraege/${b.id}/dateien`, f);
      setText(""); setDateien([]); onFertig();
    } catch (x) { zeige(x.message, true); }
  };
  return <form onSubmit={senden} className={eltern ? "stapel" : "karte stapel"} style={{ gap: 8, marginBottom: eltern ? 0 : 16 }}>
    {!eltern && <div className="segment" role="group" aria-label="Art">{(mod ? ["ankuendigung", "beitrag"] : ["frage", "beitrag"]).map((k) => <button type="button" key={k} aria-pressed={art === k} onClick={() => setArt(k)}>{ART[k]}</button>)}</div>}
    <label className="feld"><span className="sr">{eltern ? "Antwort" : "Text"}</span><textarea rows={eltern ? 2 : 3} value={text} onChange={(e) => setText(e.target.value)} placeholder={eltern ? "Antworten …" : art === "frage" ? "Ihre Frage an die Klasse und die Lehrperson …" : "Was möchten Sie mitteilen?"} /></label>
    <div className="reihe" style={{ gap: 8, justifyContent: "space-between" }}>
      <div className="reihe" style={{ gap: 8 }}>{!eltern && <DateiKnopf text="Datei anhängen" mehrere onDatei={(f) => setDateien((x) => [...x, f])} />}{dateien.map((f, i) => <span key={i} className="chip">{f.name}</span>)}</div>
      <button className="knopf haupt-knopf" disabled={!text.trim()}><Symbol.senden />{eltern ? "Antworten" : "Senden"}</button>
    </div>
  </form>;
}

function Kopfzeile({ b }) {
  return <div className="reihe" style={{ gap: 8, alignItems: "center" }}>
    <span className="avatar" aria-hidden="true" style={{ width: 28, height: 28, fontSize: 12 }}>{initialen(b)}</span>
    <b>{b.vorname} {b.nachname}</b>{b.von_lp && <span className="chip">Lehrperson</span>}<span className="leise klein">{wann(b.erstellt_am)}{b.bearbeitet_am ? " · bearbeitet" : ""}</span>
  </div>;
}

function Beitrag({ b, d, uid, neu }) {
  const zeige = useMeldung();
  const [antworten, setAntworten] = useState(false);
  const tun = async (pfad, methode = "POST", daten) => { try { await api(pfad, { methode, daten }); neu(); } catch (e) { zeige(e.message, true); } };
  return <article className="karte stapel" style={{ gap: 8, borderLeft: b.art === "ankuendigung" ? "4px solid var(--blau, #2C3FC4)" : b.art === "frage" ? "4px solid var(--gelb, #E5B800)" : undefined }}>
    <div className="reihe" style={{ justifyContent: "space-between" }}><Kopfzeile b={b} />
      <div className="reihe" style={{ gap: 6 }}>{b.angeheftet && <span className="chip">angeheftet</span>}{b.art !== "beitrag" && <span className="chip">{ART[b.art]}</span>}{b.art === "frage" && b.beantwortet && <span className="chip">beantwortet</span>}{b.neu && <span className="neu-chip">neu</span>}</div></div>
    <Absaetze text={b.text} />
    <DateiListe dateien={b.dateien} pfad="/api/beitrag-dateien/" />
    <div className="reihe" style={{ gap: 6 }}>
      {d.darfSchreiben && <button className="knopf leise-knopf klein" onClick={() => setAntworten(!antworten)}>Antworten{b.antworten.length ? ` (${b.antworten.length})` : ""}</button>}
      {d.darfModerieren && <button className="knopf leise-knopf klein" onClick={() => tun(`/api/beitraege/${b.id}/anheften`, "POST", { an: !b.angeheftet })}>{b.angeheftet ? "Lösen" : "Anheften"}</button>}
      {b.art === "frage" && (d.darfModerieren || b.mein) && <button className="knopf leise-knopf klein" onClick={() => tun(`/api/beitraege/${b.id}/beantwortet`, "POST", { an: !b.beantwortet })}>{b.beantwortet ? "Wieder offen" : "Als beantwortet markieren"}</button>}
      {(b.mein || d.darfModerieren) && <button className="knopf leise-knopf klein" onClick={() => confirm("Beitrag löschen?") && tun(`/api/beitraege/${b.id}`, "DELETE")}><Symbol.papierkorb />Löschen</button>}
    </div>
    {(b.antworten.length > 0 || antworten) && <div className="stapel" style={{ gap: 8, marginLeft: 24, paddingLeft: 12, borderLeft: "2px solid var(--linie, #ddd)" }}>
      {b.antworten.map((a) => a.geloescht ? <p key={a.id} className="leise klein">Antwort gelöscht.</p> : <div key={a.id} className="stapel" style={{ gap: 4 }}><Kopfzeile b={a} /><Absaetze text={a.text} /><DateiListe dateien={a.dateien} pfad="/api/beitrag-dateien/" />
        {(a.mein || d.darfModerieren) && <button className="knopf leise-knopf klein" style={{ alignSelf: "flex-start" }} onClick={() => confirm("Antwort löschen?") && tun(`/api/beitraege/${a.id}`, "DELETE")}>Löschen</button>}</div>)}
      {antworten && <Schreiben uid={uid} eltern={b.id} onFertig={() => { setAntworten(false); neu(); }} />}
    </div>}
  </article>;
}
