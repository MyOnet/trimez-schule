// Ablage: persönliches Laufwerk, Ordner pro Unterricht (Lehrperson schreibt, Klasse liest) und Gruppenlaufwerke
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, hochladen } from "../api.js";
import { useLaden, Laden, Dialog, Feld, Symbol, useMeldung, DateiKnopf, groesse, wann } from "../ui.jsx";

const ART = { person: "Mein Laufwerk", unterricht: "Unterricht", gruppe: "Gruppe" };
const Balken = ({ belegt, grenze }) => <div title={`${groesse(belegt)} von ${groesse(grenze)}`} style={{ height: 6, background: "var(--linie, #e5e7eb)", borderRadius: 3, marginTop: 8 }}><div style={{ width: `${Math.min(100, (belegt / grenze) * 100)}%`, height: "100%", borderRadius: 3, background: belegt / grenze > 0.9 ? "#B91C1C" : "var(--blau, #2C3FC4)" }} /></div>;

export default function Ablage() {
  const z = useLaden("/api/ablage");
  const { kurz } = useParams();
  const [neu, setNeu] = useState(false);
  return <Laden zustand={z}>{(d) => <div>
    <div className="kopf"><div><h1>Ablage</h1><p className="leise" style={{ marginTop: 6 }}>Ihre Dateien, Ordner pro Unterricht und Gruppen. Gespeichert in der Schweiz.</p></div>
      {d.darfGruppe && <button className="knopf" onClick={() => setNeu(true)}><Symbol.gruppe />Neue Gruppe</button>}</div>
    {["person", "unterricht", "gruppe"].map((art) => { const l = d.laufwerke.filter((x) => x.art === art); return l.length ? <section key={art} style={{ marginBottom: 20 }}>
      {art !== "person" && <h2 style={{ fontSize: "1.1rem", marginBottom: 8 }}>{art === "unterricht" ? "Unterricht" : "Gruppen"}</h2>}
      <div className="raster" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>{l.map((x) => <Link key={x.id} to={`/s/${kurz}/ablage/${x.id}`} className="karte" style={{ textDecoration: "none", color: "inherit", borderTop: x.farbe ? `4px solid ${x.farbe}` : undefined }}>
        <div className="reihe" style={{ gap: 8 }}>{art === "gruppe" ? <Symbol.gruppe /> : <Symbol.ordner />}<b>{art === "person" ? ART.person : x.name}</b></div>
        <div className="leise klein" style={{ marginTop: 4 }}>{x.dateien} Dateien · {groesse(x.belegt)}{art === "gruppe" ? ` · ${x.mitglieder} Mitglieder` : ""}</div>
        <Balken belegt={x.belegt} grenze={x.grenze} />
      </Link>)}</div></section> : null; })}
    <NeueGruppe offen={neu} onZu={() => setNeu(false)} />
  </div>}</Laden>;
}

function PersonenWahl({ gewaehlt, setGewaehlt }) {
  const [such, setSuch] = useState("");
  const z = useLaden(such.length >= 2 ? `/api/ablage-personen?q=${encodeURIComponent(such)}` : null, [such]);
  return <div className="stapel" style={{ gap: 6 }}>
    <Feld label="Personen suchen" value={such} onChange={(e) => setSuch(e.target.value)} placeholder="Name oder Kürzel" />
    {such.length >= 2 && z.daten && <div className="reihe" style={{ gap: 6, flexWrap: "wrap" }}>{z.daten.filter((p) => !gewaehlt.some((g) => g.id === p.id)).map((p) => <button key={p.id} className="knopf leise-knopf klein" onClick={() => setGewaehlt([...gewaehlt, p])}><Symbol.plus />{p.vorname} {p.nachname}</button>)}</div>}
    {gewaehlt.length > 0 && <div className="reihe" style={{ gap: 6, flexWrap: "wrap" }}>{gewaehlt.map((p) => <span key={p.id} className="chip">{p.vorname} {p.nachname} <button aria-label="Entfernen" style={{ all: "unset", cursor: "pointer" }} onClick={() => setGewaehlt(gewaehlt.filter((g) => g.id !== p.id))}>×</button></span>)}</div>}
  </div>;
}

function NeueGruppe({ offen, onZu }) {
  const nav = useNavigate();
  const { kurz } = useParams();
  const [name, setName] = useState("");
  const [p, setP] = useState([]);
  const [fehler, setFehler] = useState(null);
  const los = async () => { try { const g = await api("/api/ablage/gruppen", { methode: "POST", daten: { name, mitglieder: p.map((x) => x.id) } }); onZu(); nav(`/s/${kurz}/ablage/${g.id}`); } catch (e) { setFehler(e.message); } };
  return <Dialog offen={offen} titel="Neue Gruppe" onZu={onZu} fuss={<><button className="knopf" onClick={onZu}>Abbrechen</button><button className="knopf haupt-knopf" onClick={los}>Erstellen</button></>}>
    <div className="stapel" style={{ gap: 12, minWidth: "min(440px, 80vw)" }}>
      <Feld label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Projektwoche 3a" autoFocus />
      <PersonenWahl gewaehlt={p} setGewaehlt={setP} />
      {fehler && <div className="hinweis fehler">{fehler}</div>}
    </div>
  </Dialog>;
}

export function Laufwerk() {
  const { lw, kurz } = useParams();
  const [such, setSuch] = useSearchParams();
  const ordner = such.get("ordner") || "";
  const z = useLaden(`/api/ablage/${lw}${ordner ? `?ordner=${ordner}` : ""}`, [lw, ordner]);
  const zeige = useMeldung();
  const nav = useNavigate();
  const [fortschritt, setFortschritt] = useState(null);
  const [mitglieder, setMitglieder] = useState(false);
  const tun = async (fn, text) => { try { await fn(); if (text) zeige(text); z.neu(); } catch (e) { zeige(e.message, true); } };
  const hoch = async (f) => { setFortschritt({ name: f.name, p: 0 }); try { await hochladen(`/api/ablage/${lw}/dateien`, f, { ordner_id: ordner }, (p) => setFortschritt({ name: f.name, p })); } catch (e) { zeige(e.message, true); } setFortschritt(null); z.neu(); };
  return <Laden zustand={z}>{(d) => <div onDragOver={(e) => d.darf.schreiben && e.preventDefault()} onDrop={async (e) => { if (!d.darf.schreiben) return; e.preventDefault(); for (const f of e.dataTransfer.files) await hoch(f); }}>
    <div className="kopf"><div>
      <p className="leise klein"><Link to={`/s/${kurz}/ablage`}>Ablage</Link></p>
      <h1>{d.laufwerk.art === "person" ? ART.person : d.laufwerk.name}</h1>
      <nav aria-label="Pfad" className="pfad leise" style={{ marginTop: 6 }}><button className="knopf leise-knopf klein" onClick={() => setSuch({})}>Start</button>{d.pfad.map((o) => <span key={o.id}> / <button className="knopf leise-knopf klein" onClick={() => setSuch({ ordner: o.id })}>{o.name}</button></span>)}</nav>
    </div>
      <div className="reihe" style={{ gap: 8, flexWrap: "wrap" }}>
        {d.darf.schreiben && <><button className="knopf" onClick={() => { const n = prompt("Name des Ordners"); if (n) tun(() => api(`/api/ablage/${lw}/ordner`, { methode: "POST", daten: { name: n, eltern_id: ordner || null } })); }}><Symbol.ordner />Neuer Ordner</button>
          <DateiKnopf mehrere onDatei={hoch} /></>}
        {d.laufwerk.art === "gruppe" && <button className="knopf" onClick={() => setMitglieder(true)}><Symbol.gruppe />Mitglieder ({d.mitglieder.length})</button>}
        {d.darf.verwalten && d.laufwerk.art === "unterricht" && <label className="check"><input type="checkbox" checked={!!d.laufwerk.schueler_schreiben} onChange={(e) => tun(() => api(`/api/ablage/${lw}/einstellungen`, { methode: "PUT", daten: { schueler_schreiben: e.target.checked } }))} />Klasse darf hochladen</label>}
        {d.darf.verwalten && d.laufwerk.art === "gruppe" && <button className="knopf leise-knopf" onClick={() => confirm(`Gruppe «${d.laufwerk.name}» mit allen Dateien löschen?`) && tun(async () => { await api(`/api/ablage/${lw}`, { methode: "DELETE" }); nav(`/s/${kurz}/ablage`); })}><Symbol.papierkorb /></button>}
      </div></div>
    <Balken belegt={d.belegt} grenze={d.grenze} /><p className="leise klein" style={{ marginTop: 4 }}>{groesse(d.belegt)} von {groesse(d.grenze)} belegt{d.darf.schreiben ? " · Dateien hierher ziehen zum Hochladen" : " · nur lesen"}</p>
    {fortschritt && <div className="hinweis">{fortschritt.name}: {Math.round(fortschritt.p * 100)} %</div>}
    {!d.ordner.length && !d.dateien.length ? <div className="leer"><b>Leer</b><span>{d.darf.schreiben ? "Laden Sie Dateien hoch oder legen Sie einen Ordner an." : "Hier liegt noch nichts."}</span></div> :
      <div className="tabelle-huelle" style={{ marginTop: 12 }}><table><thead><tr><th>Name</th><th>Grösse</th><th>Geändert</th><th>Von</th><th></th></tr></thead><tbody>
        {d.ordner.map((o) => <tr key={o.id}><td><button className="knopf leise-knopf" onClick={() => setSuch({ ordner: o.id })}><Symbol.ordner /><b>{o.name}</b></button></td><td className="leise">{o.dateien} Dateien</td><td></td><td></td>
          <td>{d.darf.schreiben && <span className="reihe" style={{ gap: 4 }}><button className="knopf leise-knopf klein" onClick={() => { const n = prompt("Neuer Name", o.name); if (n && n !== o.name) tun(() => api(`/api/lw-ordner/${o.id}`, { methode: "PUT", daten: { name: n } })); }}>Umbenennen</button>
            <button className="knopf leise-knopf klein" aria-label={`${o.name} löschen`} onClick={() => confirm(`Ordner «${o.name}» mit Inhalt löschen?`) && tun(() => api(`/api/lw-ordner/${o.id}`, { methode: "DELETE" }), "Gelöscht")}><Symbol.papierkorb /></button></span>}</td></tr>)}
        {d.dateien.map((f) => <tr key={f.id}><td><a href={`/api/ablage-dateien/${f.id}?ansicht=1`} target="_blank" rel="noopener">{f.name}</a></td><td>{groesse(f.groesse)}</td><td>{wann(f.geaendert_am || f.erstellt_am)}</td><td className="leise">{f.von}</td>
          <td><span className="reihe" style={{ gap: 4 }}><a className="knopf leise-knopf klein" href={`/api/ablage-dateien/${f.id}`} download>Laden</a>
            {(f.mein || d.darf.verwalten) && <><button className="knopf leise-knopf klein" onClick={() => { const n = prompt("Neuer Name", f.name); if (n && n !== f.name) tun(() => api(`/api/ablage-dateien/${f.id}`, { methode: "PUT", daten: { name: n } })); }}>Umbenennen</button>
              {(d.pfad.length > 0 || d.ordner.length > 0) && <select aria-label="Verschieben" value="" onChange={(e) => tun(() => api(`/api/ablage-dateien/${f.id}`, { methode: "PUT", daten: { ordner_id: e.target.value === "_" ? null : e.target.value } }), "Verschoben")}>
                <option value="">Verschieben …</option>{d.pfad.length > 0 && <option value="_">nach Start</option>}{d.pfad.length > 1 && <option value={d.pfad[d.pfad.length - 2].id}>eine Ebene hinauf</option>}{d.ordner.map((o) => <option key={o.id} value={o.id}>in {o.name}</option>)}</select>}
              <button className="knopf leise-knopf klein" aria-label={`${f.name} löschen`} onClick={() => confirm(`«${f.name}» löschen?`) && tun(() => api(`/api/ablage-dateien/${f.id}`, { methode: "DELETE" }), "Gelöscht")}><Symbol.papierkorb /></button></>}</span></td></tr>)}
      </tbody></table></div>}
    {d.laufwerk.art === "gruppe" && <Mitglieder offen={mitglieder} onZu={() => setMitglieder(false)} d={d} lw={lw} onFertig={z.neu} />}
  </div>}</Laden>;
}

function Mitglieder({ offen, onZu, d, lw, onFertig }) {
  const zeige = useMeldung();
  const [neu, setNeu] = useState([]);
  const tun = async (daten) => { try { await api(`/api/ablage/${lw}/mitglieder`, { methode: "PUT", daten }); setNeu([]); onFertig(); } catch (e) { zeige(e.message, true); } };
  return <Dialog offen={offen} titel="Mitglieder" onZu={onZu} fuss={<button className="knopf" onClick={onZu}>Fertig</button>}>
    <div className="stapel" style={{ gap: 12, minWidth: "min(440px, 80vw)" }}>
      <ul style={{ margin: 0, paddingLeft: 18 }}>{d.mitglieder.map((m) => <li key={m.id}>{m.vorname} {m.nachname}{m.verwalten ? " (verwaltet)" : ""}{d.darf.verwalten && !m.verwalten && <button className="knopf leise-knopf klein" onClick={() => tun({ entfernen: [m.id] })}>Entfernen</button>}</li>)}</ul>
      {d.darf.verwalten && <><PersonenWahl gewaehlt={neu} setGewaehlt={setNeu} />{neu.length > 0 && <button className="knopf haupt-knopf" onClick={() => tun({ hinzufuegen: neu.map((x) => x.id) })}>Hinzufügen</button>}</>}
    </div>
  </Dialog>;
}
