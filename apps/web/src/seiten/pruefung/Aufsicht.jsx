// Aufsicht während der Prüfung: Code für die Klasse (gross, für den Beamer), Stand jeder Person, Warnungen, Zuschlag, Ende.
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../../api.js";
import { useMeldung, Laden } from "../../ui.jsx";

const vor = (d, jetzt) => { if (!d) return ""; const s = Math.max(0, Math.round((jetzt - new Date(d).getTime()) / 1000)); return s < 60 ? `vor ${s} s` : s < 3600 ? `vor ${Math.floor(s / 60)} min` : new Date(d).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" }); };
const WARN = { fokus: "Fenster verlassen", neu_geladen: "neu begonnen", offline: "offline", prozess: "verbotenes Programm", vm: "virtuelle Maschine", debugger: "Debugger", aufnahme: "Aufnahme", bildschirm: "zweiter Bildschirm", sperre: "Sperre verlassen", ohne_lernumgebung: "ohne Lernumgebung", geraet: "anderes Gerät", fremder_code: "fremder Code" };
const uhr = (ms) => { const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000); return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`; };

export default function Aufsicht() {
  const { kurz, pid } = useParams(); const nav = useNavigate(); const meld = useMeldung();
  const [d, setD] = useState(null); const [fehler, setFehler] = useState(null); const [beamer, setBeamer] = useState(false);
  const [versatz, setVersatz] = useState(0); const [jetzt, setJetzt] = useState(Date.now());
  const [auff, setAuff] = useState(null);
  const laden = async () => { try { const x = await api(`/api/pruefungen/${pid}/aufsicht`); setD(x); setVersatz(new Date(x.jetzt).getTime() - Date.now()); } catch (e) { setFehler(e); } };
  const auffLaden = async () => { try { setAuff(await api(`/api/pruefungen/${pid}/auffaelligkeiten`)); } catch { /* Hinweise sind Zusatz; Aufsicht läuft weiter */ } };
  useEffect(() => { laden(); auffLaden(); const t = setInterval(laden, 4000); const a = setInterval(auffLaden, 20000); const u = setInterval(() => setJetzt(Date.now()), 1000); return () => { clearInterval(t); clearInterval(a); clearInterval(u); }; }, [pid]);
  const tun = async (fn, text) => { try { await fn(); if (text) meld(text); laden(); } catch (e) { meld(e.message, true); } };
  if (!d) return <Laden zustand={{ daten: null, fehler }}>{() => null}</Laden>;
  const t = jetzt + versatz;
  const rest = d.endet_am ? Math.max(0, new Date(d.endet_am).getTime() - t) : null;
  const zaehl = { laeuft: 0, abgegeben: 0, fehlt: 0 };
  for (const s of d.schueler) zaehl[s.versuch ? s.versuch.status : "fehlt"]++;
  const code = d.startcode ? d.startcode.slice(0, 3) + " " + d.startcode.slice(3) : null;

  if (beamer && code) return (
    <div className="beamer" onClick={() => setBeamer(false)}>
      <p>{d.fach} {d.klasse}: {d.titel}</p>
      <div className="beamer-code">{code}</div>
      <p>Anmelden, auf der Übersicht den Code eingeben.{rest != null ? ` Noch ${Math.ceil(rest / 60000)} Minuten.` : ""}</p>
      <small>Klicken, um zur Aufsicht zurückzukehren</small>
    </div>);

  return (
    <div>
      <div className="kopf">
        <div><div className="pfad"><Link to={`/s/${kurz}/pruefungen/${pid}`}>{d.titel}</Link><span aria-hidden="true">/</span><span>{d.fach} {d.klasse}</span></div><h1>Aufsicht</h1></div>
        <div className="reihe">
          {d.status === "laeuft" ? <button className="knopf gefahr" onClick={() => { if (confirm(zaehl.laeuft ? `${zaehl.laeuft} Personen schreiben noch. Prüfung jetzt beenden? Ihre Antworten werden abgegeben.` : "Prüfung beenden?")) tun(() => api(`/api/pruefungen/${pid}/beenden`, { methode: "POST" }), "Prüfung beendet."); }}>Prüfung beenden</button>
            : <button className="knopf haupt-knopf" onClick={() => nav(`/s/${kurz}/pruefungen/${pid}/korrektur`)}>Zur Korrektur</button>}
        </div>
      </div>

      <div className="aufsicht-oben">
        <div className="code-tafel">
          {code ? <>
            <span>Code für die Klasse</span>
            <b aria-label={`Code ${d.startcode.split("").join(" ")}`}>{code}</b>
            <div className="reihe"><button className="knopf klein-knopf" onClick={() => setBeamer(true)}>Gross anzeigen</button><button className="knopf klein-knopf leise-knopf" onClick={() => tun(() => api(`/api/pruefungen/${pid}/code-neu`, { methode: "POST" }), "Neuer Code. Der alte gilt nicht mehr.")}>Neuer Code</button></div>
          </> : <><span>Prüfung beendet</span><b className="beendet">{d.beendet_am ? new Date(d.beendet_am).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" }) : ""}</b></>}
        </div>
        <div className="aufsicht-zahlen">
          {rest != null && d.status === "laeuft" && <div className={"kennzahl" + (rest < 5 * 60000 ? " knapp" : "")}><b>{uhr(rest)}</b><span>verbleibend (ohne Zuschlag)</span></div>}
          <div className="kennzahl"><b>{zaehl.laeuft}</b><span>schreiben</span></div>
          <div className="kennzahl"><b>{zaehl.abgegeben}</b><span>abgegeben</span></div>
          <div className="kennzahl"><b>{zaehl.fehlt}</b><span>nicht begonnen</span></div>
        </div>
      </div>

      <div className="tabelle-huelle">
        <table className="tabelle aufsicht">
          <thead><tr><th>Name</th><th>Stand</th><th>Fortschritt</th><th>Zuletzt aktiv</th><th>Hinweise</th><th><span className="sr">Aktionen</span></th></tr></thead>
          <tbody>{d.schueler.map((s) => { const v = s.versuch; const still = v && v.status === "laeuft" && t - new Date(v.letzte_aktivitaet).getTime() > 3 * 60000; return (
            <tr key={s.id} className={v ? v.status : "fehlt"}>
              <th scope="row"><b>{s.nachname}</b> {s.vorname}</th>
              <td>{!v ? <span className="status fehlt">nicht begonnen</span> : v.status === "laeuft" ? <span className="status laeuft">schreibt</span> : <span className="status bereit">abgegeben{v.abgabe_art === "zeit" ? " (Zeit)" : v.abgabe_art === "lehrperson" ? " (eingezogen)" : ""}</span>}
                {v && v.zuschlag_min > 0 && <span className="chip" style={{ marginLeft: 6 }}>+{v.zuschlag_min} min</span>}
                {v && <span className={"chip" + (v.modus === "gesperrt" ? " gruen" : "")} style={{ marginLeft: 6 }} title={v.app_version ? `Lernumgebung ${v.app_version}` : "normaler Browser"}>{v.modus === "gesperrt" ? (v.plattform === "macos" ? "Mac, gesperrt" : "Windows, gesperrt") : "Browser"}</span>}</td>
              <td>{v && <span className="oeffnungen" style={{ justifyItems: "start" }}><span>{v.beantwortet} von {d.aufgaben}</span><span className="balken"><i style={{ width: `${(100 * v.beantwortet) / d.aufgaben}%` }} /></span></span>}</td>
              <td className={still ? "still" : ""}>{v ? (v.status === "abgegeben" ? new Date(v.abgegeben_am).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" }) : vor(v.letzte_aktivitaet, t)) : ""}</td>
              <td>{v && v.warnungen > 0 && <span className="warn-chip" title={`Zuletzt ${new Date(v.warnung_zuletzt).toLocaleTimeString("de-CH")}`}>{v.warnungen}× {WARN[v.warnung_art] || v.warnung_art}</span>}</td>
              <td className="zahl">{v && d.status === "laeuft" && <span className="reihe" style={{ gap: 2, justifyContent: "flex-end", flexWrap: "nowrap" }}>
                {v.status === "laeuft" && <button className="knopf leise-knopf klein-knopf" onClick={() => { const m = prompt(`Zuschlag für ${s.vorname} ${s.nachname} in Minuten (gesamt)`, String(v.zuschlag_min || 10)); if (m !== null) tun(() => api(`/api/versuche/${v.id}/zuschlag`, { methode: "POST", daten: { minuten: m } }), "Zuschlag gespeichert."); }}>Zuschlag</button>}
                {v.modus === "gesperrt" && v.status === "laeuft" && v.warnung_art === "ohne_lernumgebung" && <button className="knopf leise-knopf klein-knopf" title="z. B. wenn der Akku leer ist: auf einem anderen Laptop weiterschreiben" onClick={() => tun(() => api(`/api/versuche/${v.id}/geraet-freigeben`, { methode: "POST" }), "Anderes Gerät erlaubt.")}>Gerät wechseln</button>}
                {v.status === "laeuft" ? <button className="knopf leise-knopf klein-knopf" onClick={() => { if (confirm(`Prüfung von ${s.vorname} ${s.nachname} jetzt einziehen?`)) tun(() => api(`/api/versuche/${v.id}/einziehen`, { methode: "POST" }), "Eingezogen."); }}>Einziehen</button>
                  : <button className="knopf leise-knopf klein-knopf" onClick={() => tun(() => api(`/api/versuche/${v.id}/wieder-oeffnen`, { methode: "POST" }), "Wieder geöffnet.")}>Wieder öffnen</button>}
              </span>}</td>
            </tr>); })}</tbody>
        </table>
      </div>
      {auff && auff.versuche.length > 0 && <section className="auffaellig" aria-labelledby="auff-t">
        <h2 id="auff-t">Auffälligkeiten</h2>
        <p>{auff.hinweis} Zum Beispiel: schnell getippt, gemeinsam gelernt, kurz auf der Toilette.</p>
        <ul>{auff.versuche.map((v) => <li key={v.id}><b>{v.name}</b><ul>{v.auffaelligkeiten.map((a, i) => <li key={i} className={"auff-" + a.art}>{a.text}</li>)}</ul></li>)}</ul>
      </section>}
      <p className="leise klein" style={{ marginTop: 12 }}>Aktualisiert sich alle paar Sekunden. {d.lernumgebung ? "Diese Prüfung läuft nur in der Lernumgebung. Meldungen kommen von der App (z. B. ein verbotenes Programm wurde beendet) oder vom Server (Versuch ohne Lernumgebung)." : "«Fenster verlassen» heisst: Die Person hat zu einem anderen Fenster oder Tab gewechselt. Im Browser lässt sich das nur melden, nicht verhindern."}</p>
    </div>);
}
