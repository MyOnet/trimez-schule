// Prüfungen der Lehrperson: nach Klasse, mit Status. Neue Prüfung leer oder aus Word/PDF.
import { useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, hochladen } from "../../api.js";
import { useLaden, Laden, Dialog, Symbol, wann } from "../../ui.jsx";

const fmt = (d) => (d ? new Date(d).toLocaleDateString("de-CH", { weekday: "short", day: "numeric", month: "long" }) : "ohne Datum");

export default function Pruefungen() {
  const { kurz } = useParams(); const [sp] = useSearchParams();
  const z = useLaden("/api/pruefungen");
  const [neu, setNeu] = useState(false);
  const filter = sp.get("unterricht");
  return (
    <div>
      <div className="kopf"><div><h1>Prüfungen</h1><p className="leise" style={{ marginTop: 6 }}>Erstellen, aus Word oder PDF übernehmen und ansehen, wie die Klasse sie sieht.</p></div>
        <button className="knopf haupt-knopf" onClick={() => setNeu(true)}><Symbol.plus />Neue Prüfung</button></div>
      <Laden zustand={z}>{(d) => {
        const liste = d.pruefungen.filter((p) => !filter || p.unterricht_id === filter);
        const heute = new Date().toISOString().slice(0, 10);
        const kommend = liste.filter((p) => !p.datum || p.datum >= heute), vorbei = liste.filter((p) => p.datum && p.datum < heute);
        const zeile = (p) => (
          <Link key={p.id} to={`/s/${kurz}/pruefungen/${p.id}${p.status === "laeuft" ? "/aufsicht" : ["beendet", "zurueckgegeben"].includes(p.status) ? "/korrektur" : ""}`} className="pzeile">
            <div className="pdatum">{p.datum ? <><b>{new Date(p.datum).getDate()}</b><span>{new Date(p.datum).toLocaleDateString("de-CH", { month: "short" })}</span></> : <span>offen</span>}</div>
            <div style={{ minWidth: 0 }}>
              <div className="titel"><span className="punkt" style={{ background: p.farbe }} />{p.titel}</div>
              <div className="meta"><span>{p.fach} {p.klasse}{p.gruppe ? ` ${p.gruppe}` : ""}</span><span>{fmt(p.datum)}</span>{p.dauer_min && <span>{p.dauer_min} Min.</span>}<span>{p.aufgaben} {p.aufgaben === 1 ? "Aufgabe" : "Aufgaben"}, {String(p.punkte)} Punkte</span>{p.quelle === "umwandlung" && <span>aus Datei</span>}</div>
            </div>
            <span className={"status " + p.status}>{{ entwurf: "Entwurf", bereit: "Bereit", laeuft: "Läuft", beendet: "Zu korrigieren", zurueckgegeben: "Zurückgegeben" }[p.status]}</span>
          </Link>);
        return <>
          {!liste.length ? <div className="leer"><b>Noch keine Prüfung</b><span>Legen Sie eine Prüfung an oder übernehmen Sie eine bestehende aus Word oder PDF.</span><button className="knopf haupt-knopf" onClick={() => setNeu(true)}>Neue Prüfung</button></div> : <div className="stapel" style={{ gap: 26 }}>
            {kommend.length > 0 && <section className="abschnitt"><div className="abschnitt-kopf"><h2>Anstehend</h2></div><div className="mliste">{kommend.map(zeile)}</div></section>}
            {vorbei.length > 0 && <section className="abschnitt"><div className="abschnitt-kopf"><h2>Vergangen</h2></div><div className="mliste">{vorbei.map(zeile)}</div></section>}
          </div>}
          <NeuDialog offen={neu} zu={() => setNeu(false)} unterricht={d.meinUnterricht} vorwahl={filter} />
        </>;
      }}</Laden>
    </div>);
}

function NeuDialog({ offen, zu, unterricht, vorwahl }) {
  const { kurz } = useParams(); const nav = useNavigate();
  const [f, setF] = useState({ art: "leer" }); const [fehler, setFehler] = useState(""); const [laeuft, setLaeuft] = useState(""); const datei = useRef(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const senden = async (e) => {
    e.preventDefault(); setFehler("");
    const uid = f.unterricht_id || vorwahl || (unterricht[0] && unterricht[0].id);
    try {
      if (f.art === "datei") {
        const d = datei.current.files[0]; if (!d) return setFehler("Bitte eine Word-Datei oder ein PDF wählen.");
        setLaeuft("Datei wird gelesen und Aufgaben werden erkannt …");
        const p = await api("/api/pruefungen", { methode: "POST", daten: { unterricht_id: uid, titel: f.titel || d.name.replace(/\.[^.]+$/, "").replace(/_/g, " "), datum: f.datum, dauer_min: f.dauer_min, quelle: "umwandlung" } });
        try { const u = await hochladen(`/api/pruefungen/${p.id}/umwandlung`, d); nav(`/s/${kurz}/pruefungen/${p.id}/umwandlung/${u.id}`); }
        catch (x) { await api(`/api/pruefungen/${p.id}`, { methode: "DELETE" }).catch(() => {}); throw x; }
      } else {
        const p = await api("/api/pruefungen", { methode: "POST", daten: { unterricht_id: uid, titel: f.titel, datum: f.datum, dauer_min: f.dauer_min } });
        nav(`/s/${kurz}/pruefungen/${p.id}`);
      }
    } catch (x) { setFehler(x.message); } finally { setLaeuft(""); }
  };
  return (
    <Dialog offen={offen} titel="Neue Prüfung" onZu={zu}>
      <form className="formular" onSubmit={senden}>
        {fehler && <div className="hinweis fehler" role="alert">{fehler}</div>}
        <div className="segment" role="radiogroup" aria-label="Wie beginnen">
          <button type="button" role="radio" aria-checked={f.art === "leer"} aria-pressed={f.art === "leer"} onClick={() => setF({ ...f, art: "leer" })}>Leer beginnen</button>
          <button type="button" role="radio" aria-checked={f.art === "datei"} aria-pressed={f.art === "datei"} onClick={() => setF({ ...f, art: "datei" })}>Aus Word oder PDF</button>
        </div>
        {f.art === "datei" && <label className="feld">Datei<small>Nummerierte Aufgaben, Punkte und Antwortmöglichkeiten werden erkannt. Sie prüfen jede Aufgabe vor dem Übernehmen.</small><input ref={datei} type="file" accept=".docx,.pdf" required /></label>}
        <label className="feld">Klasse<select value={f.unterricht_id || vorwahl || ""} onChange={set("unterricht_id")}>{unterricht.map((u) => <option key={u.id} value={u.id}>{u.klasse} {u.fach}{u.gruppe ? ` ${u.gruppe}` : ""}</option>)}</select></label>
        <label className="feld">Titel{f.art === "datei" && <small>Leer lassen, dann wird der Dateiname verwendet</small>}<input value={f.titel || ""} onChange={set("titel")} required={f.art === "leer"} maxLength={160} placeholder="z. B. Kleider machen Leute" /></label>
        <div className="zwei">
          <label className="feld">Datum<input type="date" value={f.datum || ""} onChange={set("datum")} /></label>
          <label className="feld">Dauer in Minuten<input inputMode="numeric" value={f.dauer_min || ""} onChange={set("dauer_min")} placeholder="z. B. 45" /></label>
        </div>
        {laeuft && <p className="hinweis" role="status">{laeuft}</p>}
        <div className="reihe" style={{ justifyContent: "flex-end" }}><button type="button" className="knopf leise-knopf" onClick={zu}>Abbrechen</button><button className="knopf haupt-knopf" disabled={!!laeuft || !unterricht.length}>{f.art === "datei" ? "Hochladen und erkennen" : "Anlegen"}</button></div>
      </form>
    </Dialog>);
}
