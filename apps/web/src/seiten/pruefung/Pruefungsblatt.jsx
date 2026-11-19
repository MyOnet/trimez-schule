// Die Prüfung so, wie Schülerinnen und Schüler sie sehen. Wird in der Vorschau (Probelösen) und später
// in der Durchführung verwendet. Rechts am Rand: Punkte-Kästchen wie auf einem Prüfungsblatt.
import { useMemo } from "react";
import { lueckenLesen, mischen, bewerten, fmtNote } from "@schule/shared";
import Formatiert from "./Formatiert.jsx";

const BUCHST = "ABCDEFGHIJKL";
const fmtP = (p) => (p == null ? "–" : String(Math.round(p * 100) / 100).replace(".", "."));

export default function Pruefungsblatt({ p, teile, antworten, setAntwort, zeigeLoesung, auswertung, schluessel = "vorschau", kopf, nurLesen, alleTeile }) {
  // Nummern und Total immer über alle Teile (auch wenn nur ein Teil angezeigt wird)
  const alle = alleTeile || teile;
  let n = 0;
  const nrVon = new Map(alle.map((t, k) => [t.id || k, t.typ === "abschnitt" ? null : ++n]));
  const total = alle.reduce((a, t) => a + Number(t.punkte || 0), 0);
  return (
    <article className={"blatt" + (nurLesen ? " nur-lesen" : "")} aria-label={`Prüfung ${p.titel}`}>
      <header className="blatt-kopf">
        <div>
          <p className="blatt-fach">{p.fach} {p.klasse}{p.datum ? `, ${new Date(p.datum).toLocaleDateString("de-CH")}` : ""}{p.dauer_min ? `, ${p.dauer_min} Minuten` : ""}</p>
          <h1>{p.titel}</h1>
        </div>
        <div className="blatt-total"><span>Punkte</span><b>{auswertung ? `${fmtP(auswertung.punkte)} / ${fmtP(total)}` : `___ / ${fmtP(total)}`}</b>{auswertung && auswertung.note != null && <span className="blatt-note">Note {fmtNote(auswertung.note)}</span>}</div>
      </header>
      {kopf}
      {(p.einstellungen?.hinweise || p.einstellungen?.hilfsmittel) && <div className="blatt-hinweis">
        {p.einstellungen.hinweise && <Formatiert text={p.einstellungen.hinweise} />}
        {p.einstellungen.hilfsmittel && <p><b>Erlaubte Hilfsmittel:</b> {p.einstellungen.hilfsmittel}</p>}
      </div>}
      {teile.map((t, k) => t.typ === "abschnitt"
        ? <section key={t.id || k} className="blatt-abschnitt">{t.inhalt.titel && <h2>{t.inhalt.titel}</h2>}{t.inhalt.text && <Formatiert text={t.inhalt.text} className="lesetext" />}</section>
        : <Aufgabe key={t.id || k} t={t} nr={nrVon.get(t.id || k)} nurLesen={nurLesen} wert={antworten[t.id || k]} setWert={(v) => setAntwort(t.id || k, v)} zeigeLoesung={zeigeLoesung}
            ergebnis={auswertung ? auswertung.teile[t.id || k] : null} mischen={p.einstellungen?.mischen} schluessel={`${schluessel}:${t.id || k}`} />)}
    </article>
  );
}

function Aufgabe({ t, nr, wert, setWert: setze, zeigeLoesung, ergebnis, mischen: m, schluessel, nurLesen }) {
  const setWert = nurLesen ? () => {} : setze;
  const i = t.inhalt, l = t.loesung || {};
  const fragId = `f-${schluessel}`;
  let koerper = null;
  const optionen = useMemo(() => (m && i.optionen ? mischen(i.optionen, schluessel) : i.optionen || []), [i.optionen, m, schluessel]);
  switch (t.typ) {
    case "einfach": case "mehrfach": {
      const mehr = t.typ === "mehrfach", sel = mehr ? (Array.isArray(wert) ? wert : []) : wert;
      koerper = <div className="wahl" role={mehr ? "group" : "radiogroup"} aria-labelledby={fragId}>
        {mehr && <p className="leise klein">Mehrere Antworten können richtig sein.</p>}
        {optionen.map((o, k) => {
          const an = mehr ? sel.includes(o.id) : sel === o.id;
          const richtig = mehr ? (l.richtig || []).includes(o.id) : l.richtig === o.id;
          return <label key={o.id} className={"wahl-option" + (an ? " an" : "") + (zeigeLoesung && richtig ? " loesung" : "")}>
            <input type={mehr ? "checkbox" : "radio"} name={fragId} checked={!!an} disabled={nurLesen} onChange={(e) => setWert(mehr ? (e.target.checked ? [...sel, o.id] : sel.filter((x) => x !== o.id)) : o.id)} />
            <span className="wahl-buchst" aria-hidden="true">{BUCHST[k]}</span><Formatiert text={o.text} als="span" />
          </label>;
        })}
      </div>;
      break;
    }
    case "kurz": koerper = <><input className="antwort-feld" value={wert || ""} readOnly={nurLesen} onChange={(e) => setWert(e.target.value)} aria-labelledby={fragId} autoComplete="off" spellCheck={false} />
      {zeigeLoesung && <p className="loesung-text">Lösung: {(l.antworten || []).join(" oder ")}</p>}</>; break;
    case "zahl": koerper = <><span className="zahl-antwort"><input className="antwort-feld" inputMode="decimal" value={wert || ""} readOnly={nurLesen} onChange={(e) => setWert(e.target.value)} aria-labelledby={fragId} autoComplete="off" style={{ width: 180 }} />{i.einheit && <span>{i.einheit}</span>}</span>
      {zeigeLoesung && <p className="loesung-text">Lösung: {String(l.wert)}{l.toleranz ? ` (± ${l.toleranz})` : ""} {i.einheit}</p>}</>; break;
    case "luecken": {
      const { teile: stuecke, luecken } = lueckenLesen(i.text);
      const a = Array.isArray(wert) ? wert : [];
      koerper = <p className="luecken-text">{stuecke.map((s, k) => s.luecke === undefined ? <Formatiert key={k} text={s.text} als="span" /> :
        <input key={k} className="luecke" value={a[s.luecke] || ""} aria-label={`Lücke ${s.luecke + 1}`} autoComplete="off" spellCheck={false}
          readOnly={nurLesen} style={{ width: luecken[s.luecke][0] === "·" ? "13ch" : `${Math.max(8, Math.min(24, Math.max(...luecken[s.luecke].map((x) => x.length)) + 3))}ch` }}
          placeholder={zeigeLoesung ? luecken[s.luecke].join(" / ") : ""} onChange={(e) => { const n = [...a]; n[s.luecke] = e.target.value; while (n.length < luecken.length) n.push(""); setWert(n); }} />)}</p>;
      break;
    }
    case "zuordnung": {
      // Lehrerfassung: paare; Schülerfassung: links und gemischte rechts (ohne Zusammenhang)
      const links = i.links || (i.paare || []).map((x) => ({ id: x.id, text: x.links }));
      const rechts = i.rechts || mischen((i.paare || []).map((x) => ({ id: x.id, text: x.rechts })), schluessel + "r");
      const a = wert && typeof wert === "object" ? wert : {};
      koerper = <div className="zuordnung">{links.map((x) => <label key={x.id} className="zuordnung-zeile">
        <Formatiert text={x.text} als="span" />
        <select value={a[x.id] || ""} disabled={nurLesen} onChange={(e) => setWert({ ...a, [x.id]: e.target.value })}><option value="">wählen …</option>{rechts.map((r) => <option key={r.id} value={r.id}>{r.text}</option>)}</select>
        {zeigeLoesung && i.paare && <span className="loesung-text">{i.paare.find((p) => p.id === x.id).rechts}</span>}
      </label>)}</div>;
      break;
    }
    case "reihenfolge": {
      const e = i.elemente || [];
      const reihe = Array.isArray(wert) && wert.length === e.length ? wert : (t.loesung ? mischen(e, schluessel) : e).map((x) => x.id);
      const tausch = (k, d) => { const n = [...reihe]; [n[k], n[k + d]] = [n[k + d], n[k]]; setWert(n); };
      koerper = <ol className="reihenfolge">{reihe.map((rid, k) => { const x = e.find((y) => y.id === rid); return x && <li key={rid}>
        <span className="nr-kreis">{k + 1}</span><Formatiert text={x.text} als="span" />
        <span className="reihe" style={{ gap: 0, marginLeft: "auto", flexWrap: "nowrap" }}>
          {!nurLesen && <><button type="button" className="knopf leise-knopf klein-knopf" disabled={!k} onClick={() => tausch(k, -1)} aria-label={`${x.text} nach oben`}>↑</button>
          <button type="button" className="knopf leise-knopf klein-knopf" disabled={k === reihe.length - 1} onClick={() => tausch(k, 1)} aria-label={`${x.text} nach unten`}>↓</button></>}
        </span></li>; })}</ol>;
      if (zeigeLoesung && t.loesung) koerper = <>{koerper}<p className="loesung-text">Lösung: {e.map((x) => x.text).join(" → ")}</p></>;
      break;
    }
    case "freitext": {
      const w = String(wert || "").trim() ? String(wert).trim().split(/\s+/).length : 0;
      koerper = <><textarea className="freitext" rows={i.zeilen || 8} value={wert || ""} readOnly={nurLesen} onChange={(e) => setWert(e.target.value)} aria-labelledby={fragId} style={{ minHeight: `${(i.zeilen || 8) * 1.9 + 1}rem` }} />
        <div className="leise klein" style={{ textAlign: "right" }}>{w} {w === 1 ? "Wort" : "Wörter"}</div>
        {zeigeLoesung && l.erwartung && <div className="loesung-text"><b>Erwartung:</b> <Formatiert text={l.erwartung} als="span" /></div>}</>;
      break;
    }
  }
  return (
    <section id={t.id ? "blatt-" + t.id : undefined} className={"blatt-aufgabe" + (ergebnis ? (ergebnis.punkte == null ? " offen" : ergebnis.punkte >= Number(t.punkte) ? " voll" : ergebnis.punkte > 0 ? " teil" : " null") : "")}>
      <div className="blatt-nr" aria-hidden="true">{nr}</div>
      <div className="blatt-inhalt">
        <h3 id={fragId} className="sr">Aufgabe {nr}</h3>
        {i.frage && <Formatiert text={i.frage} className="frage" />}
        {koerper}
        {ergebnis && ergebnis.kommentar && <div className="kommentar-lp"><b>Kommentar:</b> {ergebnis.kommentar}</div>}
      </div>
      <div className="blatt-punkte" title={ergebnis && !ergebnis.automatisch ? "Von Hand bewerten" : undefined}>
        <span>{ergebnis ? (ergebnis.punkte == null ? "?" : fmtP(ergebnis.punkte)) : ""}</span><i>/ {fmtP(Number(t.punkte))}</i>
      </div>
    </section>);
}

/** Auswertung aller Teile; Note nur, wenn alles automatisch bewertet ist oder als Schätzung */
export function auswerten(teile, antworten) {
  const e = {}; let punkte = 0, offen = 0;
  teile.forEach((t, k) => { if (t.typ === "abschnitt") return; const r = bewerten(t, antworten[t.id || k]); e[t.id || k] = r; if (r.punkte == null) offen++; else punkte += r.punkte; });
  return { teile: e, punkte: Math.round(punkte * 100) / 100, offen };
}
