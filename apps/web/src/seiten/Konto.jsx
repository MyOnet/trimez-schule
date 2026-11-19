import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api.js";
import { useIch } from "../App.jsx";
import { useMeldung } from "../ui.jsx";
import { TEXTE } from "@schule/shared";

export default function Konto() {
  const ich = useIch(); const { kurz } = useParams(); const meld = useMeldung();
  const [f, setF] = useState({ alt: "", neu: "", neu2: "" }); const [fehler, setFehler] = useState("");
  const pw = async (e) => {
    e.preventDefault(); setFehler("");
    if (f.neu !== f.neu2) return setFehler("Die beiden neuen Passwörter sind nicht gleich.");
    try { await api("/api/konto/passwort", { methode: "POST", daten: { alt: f.alt, neu: f.neu } }); setF({ alt: "", neu: "", neu2: "" }); meld("Passwort geändert. Andere Geräte wurden abgemeldet."); } catch (x) { setFehler(x.message); }
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const wie = { lokal: "eigenes Konto (Passwort)", ms: "Microsoft 365", eduid: "edu-ID" }[ich.via];
  return (
    <div className="stapel" style={{ maxWidth: 640, gap: 20 }}>
      <div className="kopf"><div><h1>Mein Konto</h1><p>{ich.person.vorname} {ich.person.nachname}, {ich.rollen.map((r) => TEXTE.rollen[r]).join(", ")}</p></div></div>
      <section className="karte stapel"><h2>Anmeldung</h2><p>Sie sind angemeldet über: <b>{wie}</b>.</p>
        {ich.zweiterFaktor.lokalesKonto && <p>Zwei-Faktor-Anmeldung: {ich.zweiterFaktor.aktiv ? <span className="chip gruen">eingerichtet</span> : <><span className="chip gelb">nicht eingerichtet</span> <Link to={`/s/${kurz}/zweiter-faktor`}>Jetzt einrichten</Link></>}</p>}
      </section>
      {ich.zweiterFaktor.lokalesKonto && <form className="karte formular" onSubmit={pw}>
        <h2>Passwort ändern</h2>
        {fehler && <div className="hinweis fehler" role="alert">{fehler}</div>}
        <label className="feld">Bisheriges Passwort<input type="password" autoComplete="current-password" value={f.alt} onChange={set("alt")} required /></label>
        <label className="feld">Neues Passwort<small>Mindestens 12 Zeichen. Ein Satz ist gut zu merken und sicher.</small><input type="password" autoComplete="new-password" value={f.neu} onChange={set("neu")} required minLength={12} /></label>
        <label className="feld">Neues Passwort wiederholen<input type="password" autoComplete="new-password" value={f.neu2} onChange={set("neu2")} required minLength={12} /></label>
        <div><button className="knopf haupt-knopf">Passwort ändern</button></div>
      </form>}
    </div>
  );
}
