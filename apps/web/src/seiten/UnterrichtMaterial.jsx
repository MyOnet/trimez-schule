// Material eines Unterrichts. Lehrperson: was die Klasse sieht, wer es geöffnet hat, schnell freigeben oder hochladen.
// Schülerinnen und Schüler: alles, was für diesen Unterricht freigegeben ist.
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, NavLink, useParams } from "react-router-dom";
import { api } from "../api.js";
import { useLaden, Laden, Dialog, useMeldung, Symbol, Etikett, datumCH, wann } from "../ui.jsx";
import { MaterialZeile, MaterialSchublade, useHochladen, useAblegen, AblegenHinweis } from "./Material.jsx";
import { MaterialAnsicht } from "./MeinMaterial.jsx";

export function UnterrichtReiter({ kurz, uid, notenbuch = true }) {
  return (
    <nav className="reiter" aria-label="Unterricht">
      {notenbuch && <NavLink to={`/s/${kurz}/unterricht/${uid}/noten`}><Symbol.noten />Notenbuch</NavLink>}
      {notenbuch && <NavLink to={`/s/${kurz}/unterricht/${uid}/lektion`}><Symbol.lektion />Lektion</NavLink>}
      <NavLink to={`/s/${kurz}/unterricht/${uid}/material`}><Symbol.material />Material</NavLink>
      {notenbuch && <NavLink to={`/s/${kurz}/pruefungen?unterricht=${uid}`}><Symbol.pruefung />Prüfungen</NavLink>}
    </nav>);
}

export default function UnterrichtMaterial() {
  const { kurz, uid } = useParams();
  const z = useLaden(`/api/unterricht/${uid}/material`);
  return <Laden zustand={z}>{(d) => d.lehrt ? <FuerLehrperson d={d} neu={z.neu} kurz={kurz} uid={uid} /> : <FuerKlasse d={d} kurz={kurz} uid={uid} neu={z.neu} />}</Laden>;
}

function Kopf({ d, kurz, uid, lehrt, kinder }) {
  const u = d.unterricht;
  return <>
    <div className="kopf">
      <div>
        <div className="pfad"><Link to={`/s/${kurz}/`}>Übersicht</Link>{lehrt && <><span aria-hidden="true">/</span><Link to={`/s/${kurz}/klassen/${u.klasse_id}`}>Klasse {u.klasse}</Link></>}</div>
        <h1 style={{ display: "flex", gap: 14, alignItems: "center" }}><span className="punkt" style={{ background: u.farbe, width: 14, height: 14, borderRadius: 4 }} />{u.fach} {u.klasse}{u.gruppe ? `, ${u.gruppe}` : ""}</h1>
      </div>
      {kinder}
    </div>
    <UnterrichtReiter kurz={kurz} uid={uid} notenbuch={lehrt} />
  </>;
}

function FuerLehrperson({ d, neu, kurz, uid }) {
  const [offen, setOffen] = useState(null); const [waehlen, setWaehlen] = useState(false);
  const wahl = useRef(null);
  const { start, anzeige } = useHochladen(neu);
  const zieht = useAblegen(true, useCallback((f) => start(f, { freigeben_fuer: uid }), [start, uid]));
  const aktiv = d.eintraege.filter((e) => e.aktiv), spaeter = d.eintraege.filter((e) => !e.aktiv && new Date(e.ab) > new Date()), vorbei = d.eintraege.filter((e) => !e.aktiv && new Date(e.ab) <= new Date());
  const zeile = (e) => <MaterialZeile key={e.id} e={{ ...e, freigaben: [] }} aktiv={offen === e.id} onClick={() => setOffen(e.id)}
    unten={e.hinweis ? <div className="klein" style={{ marginTop: 4, color: "var(--text2)" }}>«{e.hinweis}»</div> : null}
    rechts={e.aktiv ? <span className="oeffnungen" title="Schülerinnen und Schüler, die es geöffnet haben"><span>{e.geoeffnet} von {d.schueler} geöffnet</span><span className="balken"><i style={{ width: `${d.schueler ? (100 * e.geoeffnet) / d.schueler : 0}%` }} /></span></span>
      : new Date(e.ab) > new Date() ? <span className="kl-chip spaeter">ab {datumCH(e.ab)}</span> : <span className="chip">abgelaufen</span>} />;
  return (
    <div>
      <Kopf d={d} kurz={kurz} uid={uid} lehrt kinder={<div className="reihe">
        <button className="knopf" onClick={() => setWaehlen(true)}><Symbol.material />Aus der Ablage</button>
        <button className="knopf haupt-knopf" onClick={() => wahl.current.click()}><Symbol.hoch />Hochladen für {d.unterricht.klasse}</button>
        <input ref={wahl} type="file" multiple hidden onChange={(e) => { if (e.target.files.length) start(e.target.files, { freigeben_fuer: uid }); e.target.value = ""; }} />
      </div>} />
      {!d.eintraege.length ? <div className="leer"><b>Noch kein Material für diese Klasse</b><span>Ziehen Sie Dateien hierher: Sie landen in Ihrer Ablage und sind sofort für die Klasse sichtbar. Oder geben Sie Material aus Ihrer Ablage frei.</span>
        <div className="reihe"><button className="knopf" onClick={() => setWaehlen(true)}>Aus der Ablage</button><button className="knopf haupt-knopf" onClick={() => wahl.current.click()}>Dateien wählen</button></div></div> : (
        <div className="stapel" style={{ gap: 26 }}>
          {aktiv.length > 0 && <section className="abschnitt"><div className="abschnitt-kopf"><h2>Sichtbar für die Klasse</h2><p className="leise klein">{aktiv.length} {aktiv.length === 1 ? "Eintrag" : "Einträge"}, neueste zuerst</p></div><div className="mliste">{aktiv.map(zeile)}</div></section>}
          {spaeter.length > 0 && <section className="abschnitt"><div className="abschnitt-kopf"><h2>Geplant</h2><p className="leise klein">Erscheint automatisch zum angegebenen Zeitpunkt</p></div><div className="mliste">{spaeter.map(zeile)}</div></section>}
          {vorbei.length > 0 && <section className="abschnitt"><div className="abschnitt-kopf"><h2>Nicht mehr sichtbar</h2></div><div className="mliste">{vorbei.map(zeile)}</div></section>}
        </div>)}
      <MaterialSchublade id={offen} onZu={() => setOffen(null)} onGeaendert={neu} meinUnterricht={d.meinUnterricht} faecher={d.faecher} />
      <AusAblage offen={waehlen} zu={() => setWaehlen(false)} uid={uid} klasse={d.unterricht.klasse} fachId={d.unterricht.fach_id} fertig={neu} schon={new Set(d.eintraege.map((e) => e.id))} />
      {zieht && <AblegenHinweis ziel={`in Ihre Ablage, sichtbar für ${d.unterricht.klasse}`} />}
      {anzeige}
    </div>);
}

// Material aus der eigenen Ablage oder aus geteiltem Material suchen und freigeben
function AusAblage({ offen, zu, uid, klasse, fachId, fertig, schon }) {
  const [suche, setSuche] = useState(""); const [liste, setListe] = useState(null); const [wahl, setWahl] = useState([]); const [ab, setAb] = useState(""); const [hinweis, setHinweis] = useState("");
  const meld = useMeldung();
  useEffect(() => { if (!offen) return; setWahl([]); setAb(""); setHinweis(""); }, [offen]);
  useEffect(() => {
    if (!offen) return;
    const t = setTimeout(async () => {
      const p = new URLSearchParams({ bereich: "alle", ...(suche ? { suche } : { fach: fachId }) });
      try { setListe((await api(`/api/material?${p}`)).eintraege.filter((e) => !schon.has(e.id))); } catch { setListe([]); }
    }, 200);
    return () => clearTimeout(t);
  }, [offen, suche, fachId]);
  const freigeben = async () => {
    try { for (const mid of wahl) await api(`/api/material/${mid}/freigaben`, { methode: "POST", daten: { unterricht_ids: [uid], ab: ab || null, hinweis } }); meld(wahl.length === 1 ? `Für ${klasse} freigegeben.` : `${wahl.length} Einträge für ${klasse} freigegeben.`); zu(); fertig(); }
    catch (x) { meld(x.message, true); }
  };
  return (
    <Dialog offen={offen} titel={`Für ${klasse} freigeben`} onZu={zu}>
      <div className="stapel" style={{ gap: 14 }}>
        <div className="suchfeld"><Symbol.suche /><input type="search" value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="In Ablage und geteiltem Material suchen" autoFocus aria-label="Suchen" /></div>
        <div className="mliste" style={{ maxHeight: 340, overflow: "auto" }}>
          {liste === null ? <p className="leise" style={{ padding: 16 }}>Wird geladen …</p> : !liste.length ? <p className="leise" style={{ padding: 16 }}>{suche ? "Nichts gefunden." : "Kein weiteres Material in diesem Fach. Suchen Sie nach einem Titel."}</p> :
            liste.map((e) => <label key={e.id} className="mzeile" style={{ gridTemplateColumns: "auto auto minmax(0,1fr)" }}>
              <input type="checkbox" style={{ width: 18, minHeight: 0, accentColor: "var(--gruen)" }} checked={wahl.includes(e.id)} onChange={(ev) => setWahl(ev.target.checked ? [...wahl, e.id] : wahl.filter((x) => x !== e.id))} />
              <Etikett e={e} /><div style={{ minWidth: 0 }}><div className="titel"><span>{e.titel}</span></div><div className="meta"><span>{e.fach}</span>{!e.mein && <span>{e.besitzer}</span>}<span>{wann(e.geaendert_am)}</span></div></div>
            </label>)}
        </div>
        <div className="zwei">
          <label className="feld">Sichtbar ab<small>Leer: sofort</small><input type="datetime-local" value={ab} onChange={(e) => setAb(e.target.value)} /></label>
          <label className="feld">Hinweis<small>Optional</small><input value={hinweis} onChange={(e) => setHinweis(e.target.value)} maxLength={300} /></label>
        </div>
        <div className="reihe" style={{ justifyContent: "flex-end" }}><button className="knopf leise-knopf" onClick={zu}>Abbrechen</button><button className="knopf haupt-knopf" disabled={!wahl.length} onClick={freigeben}>{wahl.length > 1 ? `${wahl.length} freigeben` : "Freigeben"}</button></div>
      </div>
    </Dialog>);
}

function FuerKlasse({ d, kurz, uid, neu }) {
  return (
    <div>
      <Kopf d={d} kurz={kurz} uid={uid} lehrt={false} />
      <MaterialAnsicht eintraege={d.eintraege} neu={neu} leer="Für dieses Fach ist noch kein Material freigegeben." />
    </div>);
}
