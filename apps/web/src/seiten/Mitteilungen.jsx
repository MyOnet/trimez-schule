// Mitteilungen: persönliche Benachrichtigungen (Glocke) und Schulmitteilungen der Schulleitung
import { useEffect, useState } from "react";
import { Link, NavLink, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { useLaden, Laden, Dialog, Feld, Symbol, useMeldung, Absaetze, wann, zeitCH, lokal, ausLokal } from "../ui.jsx";

const ZIEL = { lehrperson: "Lehrpersonen", schueler: "Schülerinnen und Schüler", eltern: "Eltern" };

/** Glocke in der Navigation: Zahl ungelesener Mitteilungen, alle 60 Sekunden neu */
export function Glocke({ kurz }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let aus = false;
    const laden = () => api("/api/mitteilungen").then((d) => !aus && setN(d.ungelesen + d.schulmitteilungen)).catch(() => {});
    laden(); const t = setInterval(laden, 60000);
    window.addEventListener("rescool-mitteilungen", laden);
    return () => { aus = true; clearInterval(t); window.removeEventListener("rescool-mitteilungen", laden); };
  }, []);
  return <NavLink className="nav-link" to={`/s/${kurz}/mitteilungen`}><Symbol.glocke />Mitteilungen{n > 0 && <span className="nav-zahl" aria-label={`${n} ungelesen`}>{n}</span>}</NavLink>;
}

export default function Mitteilungen() {
  const { kurz } = useParams();
  const nav = useNavigate();
  const m = useLaden("/api/mitteilungen");
  const s = useLaden("/api/schulmitteilungen");
  const zeige = useMeldung();
  const [neu, setNeu] = useState(null);
  const alleGelesen = async () => { await api("/api/mitteilungen/gelesen", { methode: "POST", daten: {} }); m.neu(); window.dispatchEvent(new Event("rescool-mitteilungen")); };
  const oeffnen = async (x) => { if (!x.gelesen_am) await api("/api/mitteilungen/gelesen", { methode: "POST", daten: { ids: [x.id] } }).catch(() => {}); window.dispatchEvent(new Event("rescool-mitteilungen")); if (x.link) nav(`/s/${kurz}${x.link}`); else m.neu(); };
  return <div style={{ maxWidth: 860 }}>
    <div className="kopf"><div><h1>Mitteilungen</h1></div></div>
    <Laden zustand={s}>{(d) => <section style={{ marginBottom: 28 }}>
      <div className="reihe" style={{ justifyContent: "space-between", marginBottom: 8 }}><h2 style={{ fontSize: "1.15rem" }}>Von der Schule</h2>
        {d.darfVerfassen && <button className="knopf haupt-knopf" onClick={() => setNeu({ titel: "", text: "", zielgruppe: ["lehrperson", "schueler"], wichtig: false, ab: "", bis: "" })}><Symbol.plus />Neue Mitteilung</button>}</div>
      {!d.liste.length ? <p className="leise">Keine aktuellen Mitteilungen der Schule.</p> : <div className="stapel" style={{ gap: 10 }}>{d.liste.map((x) => <article key={x.id} className="karte stapel" style={{ gap: 6, borderLeft: x.wichtig ? "4px solid var(--rot, #C2410C)" : undefined, opacity: x.gelesen ? 0.85 : 1 }}>
        <div className="reihe" style={{ justifyContent: "space-between" }}><b>{x.titel}</b><span className="reihe" style={{ gap: 6 }}>{x.wichtig && <span className="warn-chip">wichtig</span>}{!x.gelesen && <span className="neu-chip">neu</span>}</span></div>
        <Absaetze text={x.text} />
        <div className="reihe leise klein" style={{ gap: 12, flexWrap: "wrap" }}><span>{x.autor} · {wann(x.ab)}</span><span>An: {x.zielgruppe.map((z) => ZIEL[z]).join(", ")}</span>
          {d.darfVerfassen && <span>{x.gelesen_von} gelesen{x.bis ? ` · bis ${zeitCH(x.bis)}` : ""}{new Date(x.ab) > new Date() ? ` · erscheint ${zeitCH(x.ab)}` : ""}</span>}</div>
        <div className="reihe" style={{ gap: 6 }}>
          {!x.gelesen && <button className="knopf leise-knopf klein" onClick={async () => { await api(`/api/schulmitteilungen/${x.id}/gelesen`, { methode: "POST" }); s.neu(); window.dispatchEvent(new Event("rescool-mitteilungen")); }}>Gelesen</button>}
          {d.darfVerfassen && <><button className="knopf leise-knopf klein" onClick={() => setNeu({ ...x, ab: lokal(x.ab), bis: lokal(x.bis) })}>Bearbeiten</button>
            <button className="knopf leise-knopf klein" onClick={async () => { if (!confirm("Mitteilung löschen?")) return; try { await api(`/api/schulmitteilungen/${x.id}`, { methode: "DELETE" }); s.neu(); } catch (e) { zeige(e.message, true); } }}>Löschen</button></>}
        </div>
      </article>)}</div>}
    </section>}</Laden>
    <Laden zustand={m}>{(d) => <section>
      <div className="reihe" style={{ justifyContent: "space-between", marginBottom: 8 }}><h2 style={{ fontSize: "1.15rem" }}>Für Sie</h2>{d.ungelesen > 0 && <button className="knopf leise-knopf" onClick={alleGelesen}>Alle als gelesen markieren</button>}</div>
      {!d.liste.length ? <p className="leise">Keine Benachrichtigungen.</p> : <div className="stapel" style={{ gap: 6 }}>{d.liste.map((x) => <button key={x.id} onClick={() => oeffnen(x)} className="karte reihe" style={{ justifyContent: "space-between", textAlign: "left", cursor: "pointer", font: "inherit", fontWeight: x.gelesen_am ? 400 : 600 }}>
        <span><span>{x.titel}</span>{x.text && <span className="leise klein" style={{ display: "block", fontWeight: 400 }}>{x.text}</span>}</span>
        <span className="leise klein" style={{ whiteSpace: "nowrap" }}>{wann(x.erstellt_am)}</span>
      </button>)}</div>}
    </section>}</Laden>
    <SchulmitteilungDialog m={neu} onZu={() => setNeu(null)} onFertig={() => { setNeu(null); s.neu(); }} />
  </div>;
}

function SchulmitteilungDialog({ m, onZu, onFertig }) {
  const [f, setF] = useState(null);
  const [fehler, setFehler] = useState({});
  useEffect(() => { setF(m); setFehler({}); }, [m]);
  const speichern = async () => {
    try {
      const daten = { titel: f.titel, text: f.text, zielgruppe: f.zielgruppe, wichtig: f.wichtig, ab: ausLokal(f.ab), bis: ausLokal(f.bis) };
      await api(f.id ? `/api/schulmitteilungen/${f.id}` : "/api/schulmitteilungen", { methode: f.id ? "PUT" : "POST", daten });
      onFertig();
    } catch (e) { setFehler({ [e.feld || "_"]: e.message }); }
  };
  return <Dialog offen={!!m} titel={m && m.id ? "Mitteilung bearbeiten" : "Neue Mitteilung"} onZu={onZu} fuss={<><button className="knopf" onClick={onZu}>Abbrechen</button><button className="knopf haupt-knopf" onClick={speichern}>Veröffentlichen</button></>}>
    {f && <div className="stapel" style={{ gap: 12, minWidth: "min(520px, 80vw)" }}>
      {fehler._ && <div className="hinweis fehler">{fehler._}</div>}
      <Feld label="Titel" value={f.titel} onChange={(e) => setF({ ...f, titel: e.target.value })} fehler={fehler.titel} />
      <label className="feld">Text<textarea rows={6} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} />{fehler.text && <span className="feld-fehler">{fehler.text}</span>}</label>
      <fieldset style={{ border: 0, padding: 0 }}><legend className="klein"><b>An</b></legend><div className="reihe" style={{ gap: 16, flexWrap: "wrap" }}>{Object.entries(ZIEL).map(([k, t]) => <label key={k} className="check"><input type="checkbox" checked={f.zielgruppe.includes(k)} onChange={(e) => setF({ ...f, zielgruppe: e.target.checked ? [...f.zielgruppe, k] : f.zielgruppe.filter((x) => x !== k) })} />{t}</label>)}</div>{fehler.zielgruppe && <span className="feld-fehler">{fehler.zielgruppe}</span>}</fieldset>
      <label className="check"><input type="checkbox" checked={f.wichtig} onChange={(e) => setF({ ...f, wichtig: e.target.checked })} />Wichtig (oben angeheftet, rot markiert)</label>
      <div className="zwei"><Feld label="Sichtbar ab (leer = sofort)" type="datetime-local" value={f.ab} onChange={(e) => setF({ ...f, ab: e.target.value })} /><Feld label="Sichtbar bis (freiwillig)" type="datetime-local" value={f.bis} onChange={(e) => setF({ ...f, bis: e.target.value })} fehler={fehler.bis} /></div>
    </div>}
  </Dialog>;
}
