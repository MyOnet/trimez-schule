// Elternzugang (nur lesen): Noten, Absenzen, Kalender und Zeugnisse der Kinder unter 18
// (volljährige Kinder nur mit deren Zustimmung). Dazu die Verknüpfung in der Personenverwaltung.
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { useLaden, Laden, Feld, Symbol, useMeldung } from "../ui.jsx";
import MeineNoten from "./MeineNoten.jsx";
import { MeineAbsenzen } from "./Absenzen.jsx";
import Kalender from "./Kalender.jsx";
import { MeineZeugnisse } from "./Zeugnisse.jsx";

const REITER = [["noten", "Noten"], ["absenzen", "Absenzen"], ["kalender", "Stundenplan und Termine"]];

export default function Eltern() {
  const z = useLaden("/api/eltern/kinder");
  const [such, setSuch] = useSearchParams();
  return <Laden zustand={z}>{(d) => {
    const sichtbar = d.kinder.filter((k) => k.sichtbar);
    const kid = such.get("kind") || (sichtbar[0] && sichtbar[0].id);
    const kind = sichtbar.find((k) => k.id === kid);
    const reiter = such.get("r") || "noten";
    return <div>
      <div className="kopf"><div><h1>{kind ? `${kind.vorname} ${kind.nachname}` : "Meine Kinder"}</h1>
        {kind && <p className="leise" style={{ marginTop: 6 }}>Klasse {kind.klasse || "–"}{kind.klassenlehrperson ? <> · Klassenlehrperson {kind.klassenlehrperson.name}{kind.klassenlehrperson.email && <> (<a href={`mailto:${kind.klassenlehrperson.email}`}>{kind.klassenlehrperson.email}</a>)</>}</> : ""}</p>}</div>
        {sichtbar.length > 1 && <div className="segment" role="group" aria-label="Kind">{sichtbar.map((k) => <button key={k.id} aria-pressed={k.id === kid} onClick={() => setSuch({ kind: k.id, r: reiter })}>{k.vorname}</button>)}</div>}</div>
      {d.kinder.filter((k) => !k.sichtbar).map((k) => <div key={k.id} className="hinweis" style={{ marginBottom: 8 }}>{k.vorname} ist volljährig. Noten und Absenzen sehen Sie nur, wenn {k.vorname} das in RESCOOL freigibt.</div>)}
      {!kind ? <div className="leer"><b>Kein Kind verknüpft</b><span>Die Schule verknüpft Ihr Konto mit Ihrem Kind. Melden Sie sich beim Sekretariat, falls etwas fehlt.</span></div> : <>
        {kind.absenzen && (kind.absenzen.offen > 0) && <div className="hinweis" style={{ marginBottom: 12 }}>{kind.absenzen.offen} Absenz{kind.absenzen.offen === 1 ? " ist" : "en sind"} noch nicht entschuldigt. <button className="knopf leise-knopf klein" onClick={() => setSuch({ kind: kid, r: "absenzen" })}>Entschuldigen</button></div>}
        <div className="segment" role="tablist" style={{ marginBottom: 16 }}>{REITER.map(([k, t]) => <button key={k} role="tab" aria-pressed={reiter === k} onClick={() => setSuch({ kind: kid, r: k })}>{t}</button>)}</div>
        {reiter === "noten" && <><MeineNoten person={kind.id} /><MeineZeugnisse person={kind.id} /></>}
        {reiter === "absenzen" && <MeineAbsenzen person={kind.id} />}
        {reiter === "kalender" && <Kalender person={kind.id} />}
      </>}
    </div>;
  }}</Laden>;
}

/** In «Personen»: Eltern mit Kindern verknüpfen (Administration) */
export function ElternVerknuepfung({ person }) {
  const z = useLaden(`/api/personen/${person.id}/kinder`);
  const zeige = useMeldung();
  const [such, setSuch] = useState("");
  const [bez, setBez] = useState("elternteil");
  const s = useLaden(such.length >= 2 ? `/api/personen?rolle=schueler&q=${encodeURIComponent(such)}` : null, [such]);
  const tun = async (fn) => { try { await fn(); z.neu(); } catch (e) { zeige(e.message, true); } };
  return <Laden zustand={z}>{(d) => <div className="karte stapel" style={{ padding: 14, gap: 8, background: "var(--flaeche2)" }}>
    {d.eltern.length > 0 && <div><b className="klein">Eltern</b><ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{d.eltern.map((e) => <li key={e.id}>{e.vorname} {e.nachname} ({e.beziehung}){e.email ? `, ${e.email}` : ""}</li>)}</ul></div>}
    {person.rollen.includes("eltern") && <>
      <b className="klein">Kinder (Eltern sehen Noten, Absenzen und Mitteilungen, nur lesen)</b>
      {d.kinder.length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{d.kinder.map((k) => <li key={k.id}>{k.vorname} {k.nachname} ({k.beziehung}) <button type="button" className="knopf leise-knopf klein" onClick={() => confirm(`Verknüpfung mit ${k.vorname} lösen?`) && tun(() => api(`/api/personen/${person.id}/kinder/${k.id}`, { methode: "DELETE", daten: {} }))}>Lösen</button></li>)}</ul> : <span className="leise klein">Noch kein Kind verknüpft.</span>}
      <div className="reihe" style={{ gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <Feld label="Kind suchen" value={such} onChange={(e) => setSuch(e.target.value)} placeholder="Name" />
        <Feld label="Beziehung" type="select" value={bez} onChange={(e) => setBez(e.target.value)}>{d.beziehungen.map((b) => <option key={b} value={b}>{b}</option>)}</Feld>
      </div>
      {s.daten && <div className="reihe" style={{ gap: 6, flexWrap: "wrap" }}>{s.daten.slice(0, 8).map((k) => <button type="button" key={k.id} className="knopf leise-knopf klein" onClick={() => tun(async () => { await api(`/api/personen/${person.id}/kinder`, { methode: "POST", daten: { kind_id: k.id, beziehung: bez } }); setSuch(""); })}><Symbol.plus />{k.vorname} {k.nachname}{k.klasse ? ` (${k.klasse})` : ""}</button>)}</div>}
    </>}
  </div>}</Laden>;
}
