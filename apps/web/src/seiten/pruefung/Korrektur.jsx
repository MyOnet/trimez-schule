// Korrektur: automatisch Bewertetes prüfen, Freitexte bewerten (nach Aufgabe oder nach Person),
// dann ins Notenbuch übernehmen und an die Klasse zurückgeben.
import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../../api.js";
import { useLaden, Laden, useMeldung, Note, Verteilung } from "../../ui.jsx";
import { lueckenLesen, fmtNote, notenStufe } from "@schule/shared";
import Formatiert from "./Formatiert.jsx";

const fmtP = (p) => (p == null ? "–" : String(Math.round(p * 100) / 100));

export default function Korrektur() {
  const { pid } = useParams();
  const z = useLaden(`/api/pruefungen/${pid}/korrektur`);
  return <Laden zustand={z}>{(d) => <Ansicht d={d} neu={z.neu} />}</Laden>;
}

function Ansicht({ d, neu }) {
  const { kurz, pid } = useParams(); const meld = useMeldung();
  const [sp, setSp] = useSearchParams();
  const ansicht = sp.get("ansicht") || "uebersicht";
  const aufgaben = d.teile.filter((t) => t.typ !== "abschnitt");
  const nr = new Map(aufgaben.map((t, k) => [t.id, k + 1]));
  const mit = d.schueler.filter((s) => s.versuch);
  const offenTotal = mit.reduce((a, s) => a + s.offen, 0);
  const setze = (x) => { const n = new URLSearchParams(sp); for (const [k, v] of Object.entries(x)) v ? n.set(k, v) : n.delete(k); setSp(n); };
  const noten = mit.map((s) => s.note).filter((n) => n != null);
  const schnitt = noten.length ? Math.round((noten.reduce((a, b) => a + b, 0) / noten.length) * 100) / 100 : null;
  const verteilung = { ungenuegend: 0, knapp: 0, gut: 0, sehrgut: 0 }; for (const n of noten) verteilung[notenStufe(n)]++;

  const tun = async (fn, text) => { try { const r = await fn(); if (text) meld(text); neu(); return r; } catch (e) { meld(e.message, true); } };
  return (
    <div>
      <div className="kopf">
        <div><div className="pfad"><Link to={`/s/${kurz}/pruefungen`}>Prüfungen</Link><span aria-hidden="true">/</span><span>{d.pruefung.fach} {d.pruefung.klasse}</span></div>
          <h1>Korrektur: {d.pruefung.titel}</h1></div>
        <div className="reihe">
          {d.bewertung ? <Link className="knopf" to={`/s/${kurz}/unterricht/${d.pruefung.unterricht_id}/noten`}>Im Notenbuch ({d.bewertung.status === "freigegeben" ? "freigegeben" : "Entwurf"})</Link> : null}
          {(!d.bewertung || d.bewertung.status !== "freigegeben") && <button className="knopf" disabled={offenTotal > 0} title={offenTotal ? "Zuerst alles korrigieren" : ""} onClick={() => tun(() => api(`/api/pruefungen/${pid}/notenbuch`, { methode: "POST" }), d.bewertung ? "Im Notenbuch aktualisiert." : "Ins Notenbuch übernommen (als Entwurf).")}>{d.bewertung ? "Notenbuch aktualisieren" : "Ins Notenbuch übernehmen"}</button>}
          {d.pruefung.status === "zurueckgegeben"
            ? <button className="knopf status-knopf bereit" onClick={() => tun(() => api(`/api/pruefungen/${pid}/zurueckgeben`, { methode: "POST", daten: { zurueckziehen: true } }), "Die Klasse sieht die Korrektur nicht mehr.")}>✓ Zurückgegeben</button>
            : <button className="knopf haupt-knopf" disabled={offenTotal > 0 || d.pruefung.status !== "beendet"} onClick={() => { if (confirm("Korrektur an die Klasse zurückgeben? Alle sehen dann ihre Prüfung mit Punkten und Kommentaren.")) tun(() => api(`/api/pruefungen/${pid}/zurueckgeben`, { methode: "POST" }), "Zurückgegeben."); }}>An die Klasse zurückgeben</button>}
        </div>
      </div>

      <div className="korr-zahlen">
        <div className="kennzahl"><b>{mit.length}</b><span>von {d.schueler.length} geschrieben</span></div>
        <div className="kennzahl"><b>{offenTotal}</b><span>{offenTotal === 1 ? "Antwort offen" : "Antworten offen"}</span></div>
        <div className="kennzahl"><b>{schnitt != null ? fmtNote(schnitt) : "–"}</b><span>Notenschnitt{d.schluessel ? "" : " (kein Notenschlüssel)"}</span></div>
        <div className="kennzahl" style={{ alignContent: "center" }}><Verteilung v={verteilung} /><span>Verteilung</span></div>
      </div>

      <nav className="reiter" aria-label="Ansicht">
        {[["uebersicht", "Übersicht"], ["aufgabe", "Nach Aufgabe"], ["person", "Nach Person"]].map(([k, t]) => <a key={k} href="#" aria-current={ansicht === k ? "page" : undefined} onClick={(e) => { e.preventDefault(); setze({ ansicht: k }); }}>{t}</a>)}
      </nav>

      {ansicht === "uebersicht" && <Uebersicht d={d} setze={setze} />}
      {ansicht === "aufgabe" && <NachAufgabe d={d} aufgaben={aufgaben} nr={nr} tid={sp.get("teil") || (aufgaben.find((t) => mit.some((s) => s.teile[t.id].offen)) || aufgaben[0]).id} setze={setze} neu={neu} />}
      {ansicht === "person" && <NachPerson d={d} aufgaben={aufgaben} nr={nr} sid={sp.get("person") || (mit.find((s) => s.offen) || mit[0] || {}).id} setze={setze} neu={neu} />}
    </div>);
}

function Uebersicht({ d, setze }) {
  return <div className="tabelle-huelle">
    <table className="tabelle">
      <thead><tr><th>Name</th><th className="zahl">Punkte</th><th className="zahl">Note</th><th>Offen</th><th>Abgabe</th></tr></thead>
      <tbody>{d.schueler.map((s) => <tr key={s.id} className={s.versuch ? "klickbar" : "fehlt"} onClick={() => s.versuch && setze({ ansicht: "person", person: s.id })}>
        <th scope="row"><b>{s.nachname}</b> {s.vorname}</th>
        {s.versuch ? <>
          <td className="zahl">{fmtP(s.punkte)} / {fmtP(d.total)}</td>
          <td className="zahl"><Note wert={s.note} /></td>
          <td>{s.offen ? <span className="chip gelb">{s.offen} offen</span> : <span className="chip gruen">fertig</span>}</td>
          <td className="leise klein">{s.versuch.abgabe_art === "zeit" ? "Zeitablauf" : s.versuch.abgabe_art === "lehrperson" ? "eingezogen" : s.versuch.status === "laeuft" ? "schreibt noch" : "selbst"}</td>
        </> : <td colSpan={4} className="leise">nicht geschrieben (im Notenbuch: abwesend)</td>}
      </tr>)}</tbody>
    </table>
  </div>;
}

// Punkte und Kommentar für eine Antwort; speichert beim Verlassen des Feldes
function Bewerten({ s, t, neu, autoFokus }) {
  const meld = useMeldung();
  const e = s.teile[t.id];
  const [p, setP] = useState(e.manuell ? String(e.punkte) : ""); const [k, setK] = useState(e.kommentar || "");
  useEffect(() => { setP(e.manuell ? String(e.punkte) : ""); setK(e.kommentar || ""); }, [s.versuch.id, t.id, e.punkte, e.kommentar, e.manuell]);
  const speichern = async (punkte = p, kommentar = k) => {
    try { await api(`/api/versuche/${s.versuch.id}/korrektur/${t.id}`, { methode: "PUT", daten: { punkte: punkte === "" ? null : punkte, kommentar } }); neu(); }
    catch (x) { meld(x.message, true); }
  };
  const max = Number(t.punkte);
  return <div className={"bewerten" + (e.offen ? " offen" : "")}>
    <div className="bewerten-punkte">
      <label><span className="sr">Punkte</span><input inputMode="decimal" value={p} placeholder={e.auto != null ? fmtP(e.auto) : "?"} autoFocus={autoFokus}
        onChange={(x) => setP(x.target.value)} onBlur={() => { if (p !== (e.manuell ? String(e.punkte) : "")) speichern(); }} onKeyDown={(x) => { if (x.key === "Enter") x.target.blur(); }} aria-label={`Punkte für ${s.vorname} ${s.nachname}`} /></label>
      <span className="leise">/ {fmtP(max)}</span>
      <span className="schnell">{[0, max / 2, max].filter((v, i, a) => a.indexOf(v) === i).map((v) => <button key={v} type="button" className="knopf klein-knopf leise-knopf" onClick={() => { setP(String(v)); speichern(String(v)); }}>{fmtP(v)}</button>)}</span>
      {e.manuell && e.auto != null && <button type="button" className="knopf klein-knopf leise-knopf" onClick={() => { setP(""); speichern(""); }} title="Automatische Bewertung verwenden">automatisch ({fmtP(e.auto)})</button>}
    </div>
    <textarea value={k} onChange={(x) => setK(x.target.value)} onBlur={() => { if (k !== (e.kommentar || "")) speichern(); }} rows={1} placeholder="Kommentar für die Schülerin, den Schüler (optional)" aria-label="Kommentar" />
    <div className="leise klein">{e.offen ? (e.auto == null ? "Von Hand bewerten" : "Antwort weicht ab, bitte prüfen") : e.manuell ? "von Ihnen bewertet" : "automatisch bewertet"}</div>
  </div>;
}

function NachAufgabe({ d, aufgaben, nr, tid, setze, neu }) {
  const t = aufgaben.find((x) => x.id === tid) || aufgaben[0];
  const mit = d.schueler.filter((s) => s.versuch);
  const offenZuerst = [...mit].sort((a, b) => (b.teile[t.id].offen - a.teile[t.id].offen));
  return <div>
    <div className="aufgaben-chips">{aufgaben.map((x) => { const o = mit.filter((s) => s.teile[x.id].offen).length; return <button key={x.id} aria-pressed={x.id === t.id} onClick={() => setze({ teil: x.id })} className={o ? "offen" : ""}>{nr.get(x.id)}{o ? <small>{o}</small> : null}</button>; })}</div>
    <div className="karte" style={{ marginBottom: 16 }}>
      <div className="zwischen"><h2 style={{ fontSize: "1.1rem" }}>Aufgabe {nr.get(t.id)} <span className="leise">({fmtP(Number(t.punkte))} Punkte)</span></h2></div>
      {t.inhalt.frage && <Formatiert text={t.inhalt.frage} className="frage" />}
      <Loesung t={t} />
    </div>
    <div className="stapel" style={{ gap: 10 }}>
      {offenZuerst.map((s) => <div key={s.id} className="korr-antwort">
        <div className="korr-wer"><b>{s.nachname} {s.vorname}</b></div>
        <AntwortAnzeige t={t} wert={s.versuch.antworten[t.id]} />
        <Bewerten s={s} t={t} neu={neu} />
      </div>)}
    </div>
  </div>;
}

function NachPerson({ d, aufgaben, nr, sid, setze, neu }) {
  const mit = d.schueler.filter((s) => s.versuch);
  const k = Math.max(0, mit.findIndex((s) => s.id === sid)); const s = mit[k];
  if (!s) return <div className="leer"><b>Niemand hat die Prüfung geschrieben.</b></div>;
  return <div>
    <div className="zwischen" style={{ marginBottom: 14 }}>
      <select value={s.id} onChange={(e) => setze({ person: e.target.value })} style={{ width: "auto" }} aria-label="Person">{mit.map((x) => <option key={x.id} value={x.id}>{x.nachname} {x.vorname}{x.offen ? ` (${x.offen} offen)` : ""}</option>)}</select>
      <span className="reihe"><b>{fmtP(s.punkte)} / {fmtP(d.total)}</b><Note wert={s.note} gross />
        <button className="knopf klein-knopf" disabled={!k} onClick={() => setze({ person: mit[k - 1].id })}>← Vorherige</button>
        <button className="knopf klein-knopf" disabled={k === mit.length - 1} onClick={() => setze({ person: mit[k + 1].id })}>Nächste →</button></span>
    </div>
    <div className="stapel" style={{ gap: 10 }}>
      {aufgaben.map((t) => <div key={t.id} className="korr-antwort">
        <div className="korr-wer"><b>Aufgabe {nr.get(t.id)}</b> <Formatiert text={(t.inhalt.frage || "").slice(0, 160)} als="span" className="leise klein" /></div>
        <AntwortAnzeige t={t} wert={s.versuch.antworten[t.id]} />
        <Bewerten s={s} t={t} neu={neu} />
      </div>)}
    </div>
  </div>;
}

function Loesung({ t }) {
  const l = t.loesung || {}, i = t.inhalt;
  let x = null;
  if (t.typ === "einfach") x = (i.optionen.find((o) => o.id === l.richtig) || {}).text;
  if (t.typ === "mehrfach") x = i.optionen.filter((o) => (l.richtig || []).includes(o.id)).map((o) => o.text).join("; ");
  if (t.typ === "kurz") x = (l.antworten || []).join(" oder ");
  if (t.typ === "zahl") x = `${l.wert}${l.toleranz ? ` (± ${l.toleranz})` : ""} ${i.einheit || ""}`;
  if (t.typ === "luecken") x = lueckenLesen(i.text).luecken.map((a) => a.join(" / ")).join(", ");
  if (t.typ === "zuordnung") x = i.paare.map((p) => `${p.links} → ${p.rechts}`).join("; ");
  if (t.typ === "reihenfolge") x = i.elemente.map((e) => e.text).join(" → ");
  if (t.typ === "freitext") x = l.erwartung;
  return x ? <div className="loesung-text" style={{ marginTop: 10 }}><b>{t.typ === "freitext" ? "Erwartung" : "Lösung"}:</b> <Formatiert text={x} als="span" /></div> : null;
}

// Antwort lesbar darstellen, richtig und falsch markiert
export function AntwortAnzeige({ t, wert }) {
  const i = t.inhalt, l = t.loesung || {};
  const leer = wert === undefined || wert === null || wert === "" || (Array.isArray(wert) && !wert.length);
  if (leer) return <div className="antwort leer">keine Antwort</div>;
  switch (t.typ) {
    case "einfach": { const o = i.optionen.find((x) => x.id === wert); return <div className={"antwort " + (wert === l.richtig ? "richtig" : "falsch")}>{o ? o.text : wert}</div>; }
    case "mehrfach": return <div className="antwort">{i.optionen.filter((o) => wert.includes(o.id)).map((o) => <span key={o.id} className={(l.richtig || []).includes(o.id) ? "richtig" : "falsch"}>{o.text}</span>)}</div>;
    case "luecken": { const { teile: st, luecken } = lueckenLesen(i.text); return <div className="antwort">{st.map((x, k) => x.luecke === undefined ? <span key={k}>{x.text}</span> : <mark key={k} className={luecken[x.luecke].some((a) => a.toLowerCase() === String(wert[x.luecke] || "").trim().toLowerCase()) ? "richtig" : "falsch"}>{wert[x.luecke] || "___"}</mark>)}</div>; }
    case "zuordnung": return <div className="antwort">{i.paare.map((p) => { const g = i.paare.find((x) => x.id === wert[p.id]); return <div key={p.id} className={wert[p.id] === p.id ? "richtig" : "falsch"}>{p.links} → {g ? g.rechts : "—"}</div>; })}</div>;
    case "reihenfolge": return <ol className="antwort">{wert.map((rid, k) => { const e = i.elemente.find((x) => x.id === rid); return <li key={rid} className={i.elemente[k] && i.elemente[k].id === rid ? "richtig" : "falsch"}>{e ? e.text : rid}</li>; })}</ol>;
    case "freitext": return <div className="antwort freitext-antwort">{String(wert)}</div>;
    default: return <div className="antwort">{String(wert)}{t.typ === "zahl" && i.einheit ? ` ${i.einheit}` : ""}</div>;
  }
}
