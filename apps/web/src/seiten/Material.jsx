// Material: Ablage der Lehrperson. Ordner links, Suche oben, Dateien einfach auf die Seite ziehen.
// Ein Klick öffnet die Schublade rechts: Vorschau, Teilen, Freigabe für Klassen, Versionen.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, hochladen } from "../api.js";
import { useLaden, Laden, Dialog, useMeldung, Symbol, Etikett, groesse, wann, datumCH } from "../ui.jsx";

const ARTEN = [["", "Alle Arten"], ["pdf", "PDF"], ["word", "Word"], ["folien", "Präsentation"], ["tabelle", "Tabelle"], ["bild", "Bild"], ["video", "Video"], ["audio", "Audio"], ["link", "Link"], ["text", "Text"]];
const SICHT = { privat: "Nur ich", fachgruppe: "Fachgruppe", schule: "Ganze Schule" };

/* ---------- Hochladen mit Fortschritt (auch für die Klassenansicht) ---------- */
export function useHochladen(nachher) {
  const [liste, setListe] = useState([]);
  const meld = useMeldung();
  const start = useCallback(async (dateien, felder) => {
    const neu = [...dateien].map((d, i) => ({ k: Date.now() + "-" + i, name: d.name, p: 0, datei: d }));
    setListe((l) => [...l.filter((x) => x.p < 1 && !x.fehler), ...neu]);
    let ok = 0;
    await Promise.all(neu.map(async (u) => {
      try { await hochladen("/api/material", u.datei, felder, (p) => setListe((l) => l.map((x) => (x.k === u.k ? { ...x, p: Math.min(p, 0.97) } : x)))); ok++; setListe((l) => l.map((x) => (x.k === u.k ? { ...x, p: 1 } : x))); }
      catch (e) { setListe((l) => l.map((x) => (x.k === u.k ? { ...x, fehler: e.message } : x))); }
    }));
    if (ok) { meld(ok === 1 ? "Hochgeladen." : `${ok} Dateien hochgeladen.`); nachher && nachher(); }
    setTimeout(() => setListe((l) => l.filter((x) => x.fehler || x.p < 1)), 2500);
  }, [nachher, meld]);
  const anzeige = liste.length ? (
    <div className="uploads" role="status" aria-live="polite">
      <div className="zwischen"><b className="klein">Hochladen</b>{liste.some((x) => x.fehler) && <button className="knopf leise-knopf klein-knopf" onClick={() => setListe([])}>Schliessen</button>}</div>
      {liste.map((u) => <div key={u.k} className={"u" + (u.fehler ? " fehler" : "")}><span>{u.name}</span><span>{u.fehler ? "" : u.p >= 1 ? "fertig" : `${Math.round(u.p * 100)} %`}</span>{u.fehler ? <small style={{ gridColumn: "1/-1" }}>{u.fehler}</small> : <div className="balken"><i style={{ width: `${u.p * 100}%` }} /></div>}</div>)}
    </div>) : null;
  return { start, anzeige };
}
// Dateien auf die ganze Seite ziehen
export function useAblegen(aktiv, beiDateien) {
  const [zieht, setZieht] = useState(false);
  useEffect(() => {
    if (!aktiv) return;
    let tiefe = 0;
    const istDatei = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
    const rein = (e) => { if (!istDatei(e)) return; tiefe++; setZieht(true); };
    const raus = (e) => { if (!istDatei(e)) return; tiefe = Math.max(0, tiefe - 1); if (!tiefe) setZieht(false); };
    const ueber = (e) => { if (istDatei(e)) e.preventDefault(); };
    const ab = (e) => { if (!istDatei(e)) return; e.preventDefault(); tiefe = 0; setZieht(false); if (e.dataTransfer.files.length) beiDateien(e.dataTransfer.files); };
    window.addEventListener("dragenter", rein); window.addEventListener("dragleave", raus); window.addEventListener("dragover", ueber); window.addEventListener("drop", ab);
    return () => { window.removeEventListener("dragenter", rein); window.removeEventListener("dragleave", raus); window.removeEventListener("dragover", ueber); window.removeEventListener("drop", ab); };
  }, [aktiv, beiDateien]);
  return zieht;
}
export const AblegenHinweis = ({ ziel }) => <div className="ablegen"><div><Symbol.hoch /><b>Loslassen zum Hochladen</b><span className="leise">{ziel}</span></div></div>;

/* ---------- Eine Zeile ---------- */
export function MaterialZeile({ e, onClick, aktiv, rechts, ziehbar, unten }) {
  const meta = [e.fach, e.typ === "datei" ? [e.seiten ? `${e.seiten} ${e.seiten === 1 ? "Seite" : "Seiten"}` : null, groesse(e.groesse)].filter(Boolean).join(", ") : e.typ === "link" ? e.host : "Text",
    !e.mein && e.besitzer ? e.besitzer : null, e.version > 1 ? `Version ${e.version}` : null].filter(Boolean);
  return (
    <button className="mzeile" onClick={onClick} aria-current={aktiv ? "true" : undefined} draggable={ziehbar || undefined}
      onDragStart={ziehbar ? (ev) => { ev.dataTransfer.setData("application/x-material", e.id); ev.dataTransfer.effectAllowed = "move"; } : undefined}>
      <Etikett e={e} />
      <div style={{ minWidth: 0 }}>
        <div className="titel"><span>{e.titel}</span>{e.neu && <span className="neu-chip">Neu</span>}</div>
        <div className="meta">{meta.map((m, i) => <span key={i}>{m}</span>)}
          {(e.freigaben || []).map((f) => <span key={f.id} className={"kl-chip" + (new Date(f.ab) > new Date() ? " spaeter" : "")} title={new Date(f.ab) > new Date() ? `Sichtbar ab ${datumCH(f.ab)}` : "Für die Klasse freigegeben"}>{f.klasse}</span>)}
          {e.sichtbarkeit && e.sichtbarkeit !== "privat" && e.mein && <span className="chip" style={{ padding: "0 8px", fontSize: ".74rem" }}>{SICHT[e.sichtbarkeit]}</span>}
        </div>
        {e.auszug && <div className="auszug" dangerouslySetInnerHTML={{ __html: markieren(e.auszug) }} />}
        {unten}
      </div>
      {rechts !== undefined ? rechts : <span className="wann">{wann(e.geaendert_am)}</span>}
    </button>
  );
}
// Treffer aus dem Server («…») sicher hervorheben: erst alles maskieren, dann nur die Markierung einsetzen
const markieren = (t) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])).replace(/«/g, "<mark>").replace(/»/g, "</mark>");

/* ---------- Seite ---------- */
export default function Material() {
  const [sp, setSp] = useSearchParams(); const { kurz } = useParams();
  const bereich = sp.get("bereich") || "meine", ordner = sp.get("ordner") || "", fach = sp.get("fach") || "", art = sp.get("art") || "";
  const [suche, setSuche] = useState(sp.get("suche") || ""); const [s2, setS2] = useState(suche);
  useEffect(() => { const t = setTimeout(() => setS2(suche), 220); return () => clearTimeout(t); }, [suche]);
  const pfad = `/api/material?${new URLSearchParams(Object.entries({ bereich: s2 && bereich === "meine" ? "meine" : bereich, ordner, fach, art, suche: s2 }).filter(([, v]) => v))}`;
  const z = useLaden(pfad);
  const [offen, setOffen] = useState(null);
  const [neu, setNeu] = useState(null); // "ordner" | "link" | "text"
  const meld = useMeldung();
  const suchfeld = useRef(null); const dateiwahl = useRef(null);
  const setze = (x) => { const n = new URLSearchParams(sp); for (const [k, v] of Object.entries(x)) v ? n.set(k, v) : n.delete(k); setSp(n); };
  const { start, anzeige } = useHochladen(z.neu);
  const darfHoch = bereich === "meine";
  const zieht = useAblegen(darfHoch, useCallback((f) => start(f, { ordner_id: ordner }), [start, ordner]));

  useEffect(() => {
    const h = (e) => { if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); suchfeld.current?.focus(); } };
    document.addEventListener("keydown", h); return () => document.removeEventListener("keydown", h);
  }, []);

  const verschieben = async (mid, oid) => {
    try { await api(`/api/material/${mid}`, { methode: "PUT", daten: { ordner_id: oid || null } }); meld("Verschoben."); z.neu(); } catch (x) { meld(x.message, true); }
  };

  return (
    <div>
      <div className="kopf">
        <div><h1>Material</h1></div>
        <div className="reihe material-aktionen">
          <button className="knopf leise-knopf" onClick={() => setNeu("ordner")}><Symbol.ordner />Neuer Ordner</button>
          <button className="knopf" onClick={() => setNeu("link")}><Symbol.link />Link</button>
          <button className="knopf" onClick={() => setNeu("text")}><Symbol.text />Text</button>
          <button className="knopf haupt-knopf" onClick={() => dateiwahl.current.click()}><Symbol.hoch />Hochladen</button>
          <input ref={dateiwahl} type="file" multiple hidden onChange={(e) => { if (e.target.files.length) { if (bereich !== "meine") setze({ bereich: "", ordner: "" }); start(e.target.files, { ordner_id: bereich === "meine" ? ordner : "" }); } e.target.value = ""; }} />
        </div>
      </div>

      <Laden zustand={z}>{(d) => {
        const kinder = (pid) => d.ordner.filter((o) => (o.eltern_id || "") === (pid || ""));
        const weg = []; for (let o = d.ordner.find((x) => x.id === ordner); o; o = d.ordner.find((x) => x.id === o.eltern_id)) weg.unshift(o);
        const baum = (pid, tiefe) => kinder(pid).map((o) => (
          <div key={o.id} style={{ display: "contents" }}>
            <OrdnerLink o={o} tiefe={tiefe} aktiv={bereich === "meine" && ordner === o.id && !s2} onClick={() => { setSuche(""); setze({ bereich: "", ordner: o.id }); }} onAblegen={(mid) => verschieben(mid, o.id)} />
            {tiefe < 2 && (weg.some((w) => w.id === o.id)) && baum(o.id, tiefe + 1)}
          </div>));
        const titel = s2 ? `Suche: «${s2}»` : bereich === "fachgruppe" ? "Geteilt in der Fachgruppe" : bereich === "schule" ? "Für die ganze Schule" : bereich === "papierkorb" ? "Papierkorb" : null;
        return (
          <div className="ablage">
            <nav className="ablage-nav" aria-label="Ablage">
              <OrdnerLink wurzel aktiv={bereich === "meine" && !ordner && !s2} anzahl={d.zahlen.meine} onClick={() => { setSuche(""); setze({ bereich: "", ordner: "" }); }} onAblegen={(mid) => verschieben(mid, null)} />
              {baum(null, 1)}
              <h3>Geteilt</h3>
              <button className="ablage-link" aria-current={bereich === "fachgruppe" ? "true" : undefined} onClick={() => { setSuche(""); setze({ bereich: "fachgruppe", ordner: "" }); }}><Symbol.gruppe />Fachgruppe<span className="n">{d.zahlen.fachgruppe}</span></button>
              <button className="ablage-link" aria-current={bereich === "schule" ? "true" : undefined} onClick={() => { setSuche(""); setze({ bereich: "schule", ordner: "" }); }}><Symbol.schule />Ganze Schule<span className="n">{d.zahlen.schule}</span></button>
              <h3>Meine Klassen</h3>
              {d.meinUnterricht.map((u) => <Link key={u.id} className="ablage-link" to={`/s/${kurz}/unterricht/${u.id}/material`}><span className="punkt" style={{ background: u.farbe }} />{u.klasse} {u.fach}</Link>)}
              <div style={{ height: 10 }} />
              <button className="ablage-link" aria-current={bereich === "papierkorb" ? "true" : undefined} onClick={() => { setSuche(""); setze({ bereich: "papierkorb", ordner: "" }); }}><Symbol.papierkorb />Papierkorb<span className="n">{d.zahlen.papierkorb || ""}</span></button>
            </nav>

            <div>
              <div className="werkzeugleiste">
                <div className="suchfeld"><Symbol.suche /><input ref={suchfeld} type="search" value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="Titel, Schlagwort oder Text im Dokument" aria-label="Material suchen" /><kbd aria-hidden="true">/</kbd></div>
                <select value={fach} onChange={(e) => setze({ fach: e.target.value })} aria-label="Fach"><option value="">Alle Fächer</option>{d.faecher.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
                <select value={art} onChange={(e) => setze({ art: e.target.value })} aria-label="Art">{ARTEN.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
              </div>

              {titel ? <h2 style={{ fontSize: "1.15rem", marginBottom: 14 }}>{titel}</h2> : (
                <div className="pfad" style={{ fontSize: ".95rem", marginBottom: 14 }}>
                  <button className="knopf leise-knopf klein-knopf" style={{ padding: "0 6px" }} onClick={() => setze({ ordner: "" })}>Meine Ablage</button>
                  {weg.map((o) => <span key={o.id} className="reihe" style={{ gap: 6 }}><span aria-hidden="true">/</span><button className="knopf leise-knopf klein-knopf" style={{ padding: "0 6px" }} onClick={() => setze({ ordner: o.id })}>{o.name}</button></span>)}
                  {ordner && <OrdnerMenue o={weg[weg.length - 1]} neu={z.neu} weg={() => setze({ ordner: weg.length > 1 ? weg[weg.length - 2].id : "" })} />}
                </div>)}

              {bereich === "meine" && !s2 && kinder(ordner).length > 0 && <div className="ordner-reihe">
                {kinder(ordner).map((o) => <OrdnerKachel key={o.id} o={o} onClick={() => setze({ ordner: o.id })} onAblegen={(mid) => verschieben(mid, o.id)} />)}
              </div>}

              {d.eintraege.length ? (
                <div className="mliste">{d.eintraege.map((e) => <MaterialZeile key={e.id} e={e} aktiv={offen === e.id} onClick={() => setOffen(e.id)} ziehbar={e.mein && bereich === "meine"} />)}</div>
              ) : <Leer bereich={bereich} suche={s2} ordner={ordner} waehlen={() => dateiwahl.current.click()} />}
              {d.eintraege.length >= 300 && <p className="leise klein" style={{ marginTop: 10 }}>Es werden die ersten 300 Einträge gezeigt. Grenzen Sie die Suche ein.</p>}
            </div>

            <MaterialSchublade id={offen} onZu={() => setOffen(null)} onGeaendert={z.neu} meinUnterricht={d.meinUnterricht} faecher={d.faecher} ordner={d.ordner} />
            <NeuDialog art={neu} zu={() => setNeu(null)} ordner={bereich === "meine" ? ordner : ""} faecher={d.faecher} meineFaecher={d.meineFaecher} fertig={(m) => { z.neu(); if (m && m.id) setOffen(m.id); }} />
          </div>);
      }}</Laden>
      {zieht && <AblegenHinweis ziel="in Ihre Ablage" />}
      {anzeige}
    </div>
  );
}

function Leer({ bereich, suche, ordner, waehlen }) {
  if (suche) return <div className="leer"><b>Nichts gefunden</b><span>Versuchen Sie ein anderes Wort oder suchen Sie in einem anderen Bereich.</span></div>;
  if (bereich === "papierkorb") return <div className="leer"><b>Der Papierkorb ist leer</b><span>Gelöschtes Material landet hier und lässt sich wiederherstellen.</span></div>;
  if (bereich !== "meine") return <div className="leer"><b>Noch nichts geteilt</b><span>Wenn Kolleginnen und Kollegen Material teilen, erscheint es hier.</span></div>;
  return <div className="leer"><Etikett e={{ typ: "datei", art: "pdf", dateiname: ".pdf" }} gross /><b>{ordner ? "Dieser Ordner ist leer" : "Ihre Ablage ist leer"}</b><span>Ziehen Sie Dateien hierher oder wählen Sie sie aus. PDF, Word, PowerPoint, Excel, Bilder, Audio und Video bis 50 MB.</span><button className="knopf haupt-knopf" onClick={waehlen}><Symbol.hoch />Dateien wählen</button></div>;
}

// Ordner in der Navigation; Material lässt sich darauf ziehen
function OrdnerLink({ o, wurzel, tiefe = 0, aktiv, anzahl, onClick, onAblegen }) {
  const [ziel, setZiel] = useState(false);
  return (
    <button className={"ablage-link" + (tiefe === 1 ? " tief" : tiefe >= 2 ? " tiefer" : "") + (ziel ? " ziel" : "")} aria-current={aktiv ? "true" : undefined} onClick={onClick}
      onDragOver={(e) => { if ([...e.dataTransfer.types].includes("application/x-material")) { e.preventDefault(); setZiel(true); } }} onDragLeave={() => setZiel(false)}
      onDrop={(e) => { setZiel(false); const id = e.dataTransfer.getData("application/x-material"); if (id) { e.preventDefault(); e.stopPropagation(); onAblegen(id); } }}>
      {wurzel ? <Symbol.material /> : <Symbol.ordner />}{wurzel ? "Meine Ablage" : o.name}{anzahl != null ? <span className="n">{anzahl}</span> : o && o.anzahl ? <span className="n">{o.anzahl}</span> : null}
    </button>);
}
function OrdnerKachel({ o, onClick, onAblegen }) {
  const [ziel, setZiel] = useState(false);
  return (
    <button className={"ordner-kachel" + (ziel ? " ziel" : "")} onClick={onClick}
      onDragOver={(e) => { if ([...e.dataTransfer.types].includes("application/x-material")) { e.preventDefault(); setZiel(true); } }} onDragLeave={() => setZiel(false)}
      onDrop={(e) => { setZiel(false); const id = e.dataTransfer.getData("application/x-material"); if (id) { e.preventDefault(); e.stopPropagation(); onAblegen(id); } }}>
      <span className="etikett ordner" aria-hidden="true" /><span><b>{o.name}</b><small>{o.anzahl === 1 ? "1 Eintrag" : `${o.anzahl} Einträge`}</small></span>
    </button>);
}
function OrdnerMenue({ o, neu, weg }) {
  const meld = useMeldung();
  if (!o) return null;
  const umbenennen = async () => { const n = prompt("Neuer Name des Ordners", o.name); if (!n || n === o.name) return; try { await api(`/api/ordner/${o.id}`, { methode: "PUT", daten: { name: n } }); neu(); } catch (x) { meld(x.message, true); } };
  const loeschen = async () => { if (!confirm(`Ordner «${o.name}» löschen? Der Inhalt bleibt erhalten und wandert eine Ebene nach oben.`)) return; try { await api(`/api/ordner/${o.id}`, { methode: "DELETE" }); meld("Ordner gelöscht."); weg(); neu(); } catch (x) { meld(x.message, true); } };
  return <span className="reihe" style={{ marginLeft: 8, gap: 2 }}><button className="knopf leise-knopf klein-knopf" onClick={umbenennen}>Umbenennen</button><button className="knopf leise-knopf klein-knopf gefahr" onClick={loeschen}>Ordner löschen</button></span>;
}

/* ---------- Neu: Ordner, Link, Text ---------- */
function NeuDialog({ art, zu, ordner, faecher, meineFaecher, fertig }) {
  const [f, setF] = useState({}); const [fehler, setFehler] = useState("");
  useEffect(() => { setF({ fach_id: meineFaecher.length === 1 ? meineFaecher[0] : "" }); setFehler(""); }, [art]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const senden = async (e) => {
    e.preventDefault(); setFehler("");
    try {
      if (art === "ordner") { await api("/api/ordner", { methode: "POST", daten: { name: f.name, eltern_id: ordner || null } }); fertig(); }
      else fertig(await api("/api/material", { methode: "POST", daten: { typ: art, titel: f.titel, url: f.url, inhalt: f.inhalt, fach_id: f.fach_id || null, ordner_id: ordner || null } }));
      zu();
    } catch (x) { setFehler(x.message); }
  };
  const T = { ordner: "Neuer Ordner", link: "Link hinzufügen", text: "Text schreiben" };
  return (
    <Dialog offen={!!art} titel={T[art] || ""} onZu={zu}>
      <form className="formular" onSubmit={senden}>
        {fehler && <div className="hinweis fehler" role="alert">{fehler}</div>}
        {art === "ordner" && <label className="feld">Name<input value={f.name || ""} onChange={set("name")} required maxLength={80} autoFocus placeholder="z. B. Lyrik" /></label>}
        {art === "link" && <><label className="feld">Adresse<small>Auch Links aus OneDrive, SharePoint, YouTube oder Moodle</small><input type="url" value={f.url || ""} onChange={set("url")} required autoFocus placeholder="https://" /></label>
          <label className="feld">Titel<small>Leer lassen, dann wird die Adresse verwendet</small><input value={f.titel || ""} onChange={set("titel")} maxLength={160} /></label></>}
        {art === "text" && <><label className="feld">Titel<input value={f.titel || ""} onChange={set("titel")} required maxLength={160} autoFocus placeholder="z. B. Hausaufgabe bis Freitag" /></label>
          <label className="feld">Text<textarea value={f.inhalt || ""} onChange={set("inhalt")} rows={8} /></label></>}
        {art !== "ordner" && <label className="feld">Fach<select value={f.fach_id || ""} onChange={set("fach_id")}><option value="">Ohne Fach</option>{faecher.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
        <div className="reihe" style={{ justifyContent: "flex-end" }}><button type="button" className="knopf leise-knopf" onClick={zu}>Abbrechen</button><button className="knopf haupt-knopf">{art === "ordner" ? "Anlegen" : "Speichern"}</button></div>
      </form>
    </Dialog>
  );
}

/* ---------- Schublade: Details eines Materials ---------- */
export function MaterialSchublade({ id, onZu, onGeaendert, meinUnterricht = [], faecher = [], ordner = [] }) {
  const ref = useRef(null);
  const [d, setD] = useState(null); const [fehler, setFehler] = useState("");
  const meld = useMeldung();
  const laden = useCallback(async () => { if (!id) return; try { setD(await api(`/api/material/${id}`)); setFehler(""); } catch (x) { setFehler(x.message); } }, [id]);
  useEffect(() => { setD(null); laden(); }, [laden]);
  useEffect(() => { const dl = ref.current; if (!dl) return; if (id && !dl.open) dl.showModal(); if (!id && dl.open) dl.close(); }, [id]);
  const geaendert = async (text) => { if (text) meld(text); await laden(); onGeaendert && onGeaendert(); };
  const tun = async (fn, text) => { try { await fn(); await geaendert(text); } catch (x) { meld(x.message, true); } };

  return (
    <dialog ref={ref} className="schublade" onClose={onZu} aria-labelledby="sch-titel" onClick={(e) => { if (e.target === ref.current) ref.current.close(); }}>
      {fehler && <div className="schublade-inhalt"><div className="hinweis fehler">{fehler}</div></div>}
      {id && d && <>
        <div className="schublade-kopf">
          <Etikett e={d} gross />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id="sch-titel">{d.titel}</h2>
            <p className="leise klein" style={{ marginTop: 4 }}>{[d.fach, d.typ === "datei" ? d.dateiname : d.typ === "link" ? d.host : null, d.mein ? null : d.besitzer, `geändert ${wann(d.geaendert_am)}`].filter(Boolean).join(", ")}</p>
          </div>
          <button className="knopf leise-knopf klein-knopf" onClick={() => ref.current.close()} aria-label="Schliessen"><Symbol.schliessen /></button>
        </div>
        <div className="schublade-inhalt">
          {d.geloescht_am && <div className="hinweis">Im Papierkorb. Die Klassen sehen dieses Material nicht mehr.</div>}
          <Vorschau d={d} />
          {d.darfBearbeiten && !d.geloescht_am && <Bearbeiten d={d} faecher={faecher} ordner={ordner} gespeichert={() => geaendert("Gespeichert.")} />}
          {!d.geloescht_am && <Freigaben d={d} meinUnterricht={meinUnterricht} tun={tun} />}
          {d.typ === "datei" && d.versionen && <Versionen d={d} tun={tun} />}
          {d.darfBearbeiten && <section className="reihe">
            {d.geloescht_am ? <>
              <button className="knopf" onClick={() => tun(() => api(`/api/material/${d.id}/wiederherstellen`, { methode: "POST" }), "Wiederhergestellt.")}>Wiederherstellen</button>
              <button className="knopf leise-knopf gefahr" onClick={() => { if (confirm(`«${d.titel}» endgültig löschen? Das lässt sich nicht rückgängig machen.`)) tun(async () => { await api(`/api/material/${d.id}/endgueltig`, { methode: "DELETE" }); ref.current.close(); }, "Endgültig gelöscht."); }}>Endgültig löschen</button>
            </> : <button className="knopf leise-knopf gefahr" onClick={() => tun(async () => { await api(`/api/material/${d.id}`, { methode: "DELETE" }); ref.current.close(); }, "In den Papierkorb gelegt.")}><Symbol.papierkorb />In den Papierkorb</button>}
          </section>}
        </div>
      </>}
    </dialog>
  );
}

export function Vorschau({ d }) {
  if (d.typ === "text") return <div className="textinhalt">{d.inhalt || <span className="leise">Kein Text.</span>}</div>;
  if (d.typ === "link") return <div className="reihe"><a className="knopf haupt-knopf" href={`/api/material/${d.id}/oeffnen`} target="_blank" rel="noopener noreferrer"><Symbol.oeffnen />{d.host} öffnen</a></div>;
  const src = `/api/material/${d.id}/datei?ansicht=1&v=${d.version_id}`;
  return (
    <div className="stapel" style={{ gap: 10 }}>
      {d.mime === "application/pdf" && <div className="vorschau"><iframe src={src} title={`Vorschau ${d.titel}`} /></div>}
      {/^image\/(png|jpeg|gif|webp)$/.test(d.mime) && <div className="vorschau"><img src={src} alt="" /></div>}
      {/^video\/(mp4|webm)$/.test(d.mime) && <div className="vorschau"><video src={src} controls style={{ width: "100%" }} /></div>}
      {/^audio\//.test(d.mime) && <audio src={src} controls style={{ width: "100%" }} />}
      <div className="reihe">
        <a className="knopf" href={`/api/material/${d.id}/datei?v=${d.version_id}`}><Symbol.import />Herunterladen ({groesse(d.groesse)})</a>
        {/^(application\/pdf|image\/|video\/|audio\/|text\/plain)/.test(d.mime) && <a className="knopf leise-knopf" href={src} target="_blank" rel="noopener"><Symbol.oeffnen />In neuem Tab</a>}
      </div>
    </div>);
}

function Bearbeiten({ d, faecher, ordner, gespeichert }) {
  const [f, setF] = useState(null); const [fehler, setFehler] = useState("");
  useEffect(() => setF({ titel: d.titel, beschreibung: d.beschreibung, schlagworte: (d.schlagworte || []).join(", "), fach_id: d.fach_id || "", stufe: d.stufe || "", sichtbarkeit: d.sichtbarkeit, ordner_id: d.ordner_id || "", url: d.url || "", inhalt: d.inhalt || "" }), [d]);
  if (!f) return null;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const geaendert = ["titel", "beschreibung", "fach_id", "stufe", "sichtbarkeit", "ordner_id", "url", "inhalt"].some((k) => String(f[k] ?? "") !== String((k === "fach_id" || k === "ordner_id" || k === "stufe" || k === "url" || k === "inhalt" ? d[k] || "" : d[k]) ?? "")) || f.schlagworte !== (d.schlagworte || []).join(", ");
  const speichern = async (e) => { e.preventDefault(); setFehler(""); try { await api(`/api/material/${d.id}`, { methode: "PUT", daten: { ...f, fach_id: f.fach_id || null, ordner_id: f.ordner_id || null } }); gespeichert(); } catch (x) { setFehler(x.message); } };
  const pfadName = (o) => { const n = []; for (let x = o; x; x = ordner.find((y) => y.id === x.eltern_id)) n.unshift(x.name); return n.join(" / "); };
  return (
    <form className="formular" onSubmit={speichern}>
      <section>
        <h3>Teilen</h3>
        <div className="segment" role="radiogroup" aria-label="Wer sieht das Material">
          {Object.entries(SICHT).map(([k, t]) => <button type="button" key={k} role="radio" aria-checked={f.sichtbarkeit === k} aria-pressed={f.sichtbarkeit === k} onClick={() => setF({ ...f, sichtbarkeit: k })}>{t}</button>)}
        </div>
        <p className="leise klein" style={{ marginTop: 6 }}>{f.sichtbarkeit === "privat" ? "Nur Sie sehen es in der Ablage. Klassen sehen nur, was Sie freigeben." : f.sichtbarkeit === "fachgruppe" ? "Lehrpersonen der Fachgruppe finden es und können es für ihre Klassen freigeben." : "Alle Lehrpersonen der Schule finden es. Schülerinnen und Schüler sehen nur Freigegebenes."}</p>
      </section>
      {fehler && <div className="hinweis fehler" role="alert">{fehler}</div>}
      <label className="feld">Titel<input value={f.titel} onChange={set("titel")} required maxLength={160} /></label>
      {d.typ === "link" && <label className="feld">Adresse<input type="url" value={f.url} onChange={set("url")} required /></label>}
      {d.typ === "text" && <label className="feld">Text<textarea value={f.inhalt} onChange={set("inhalt")} rows={8} /></label>}
      <div className="zwei">
        <label className="feld">Fach<select value={f.fach_id} onChange={set("fach_id")}><option value="">Ohne Fach</option>{faecher.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label className="feld">Stufe<select value={f.stufe} onChange={set("stufe")}><option value="">Alle</option>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}. Klasse</option>)}</select></label>
      </div>
      <label className="feld">Ordner<select value={f.ordner_id} onChange={set("ordner_id")}><option value="">Meine Ablage (oberste Ebene)</option>{ordner.map((o) => <option key={o.id} value={o.id}>{pfadName(o)}</option>)}</select></label>
      <label className="feld">Schlagworte<small>Mit Komma getrennt, helfen beim Finden</small><input value={f.schlagworte} onChange={set("schlagworte")} placeholder="z. B. novelle, lektüre" /></label>
      <label className="feld">Beschreibung<textarea value={f.beschreibung} onChange={set("beschreibung")} rows={3} /></label>
      {geaendert && <div className="reihe"><button className="knopf haupt-knopf">Änderungen speichern</button></div>}
    </form>);
}

function Freigaben({ d, meinUnterricht, tun }) {
  const [form, setForm] = useState(false); const [wahl, setWahl] = useState([]); const [ab, setAb] = useState(""); const [bis, setBis] = useState(""); const [hinweis, setHinweis] = useState("");
  const schon = new Set((d.freigaben || []).map((f) => f.unterricht_id));
  const moeglich = meinUnterricht.filter((u) => !schon.has(u.id));
  // Passende Klassen zuerst: gleiches Fach
  const sortiert = [...moeglich].sort((a, b) => (b.fach_id === d.fach_id) - (a.fach_id === d.fach_id));
  useEffect(() => { setForm(false); setWahl([]); setAb(""); setBis(""); setHinweis(""); }, [d.id]);
  if (!d.freigaben) return null;
  const freigeben = () => tun(() => api(`/api/material/${d.id}/freigaben`, { methode: "POST", daten: { unterricht_ids: wahl, ab: ab || null, bis: bis || null, hinweis } }).then(() => setForm(false)), wahl.length === 1 ? "Für die Klasse freigegeben." : `Für ${wahl.length} Klassen freigegeben.`);
  return (
    <section>
      <div className="zwischen" style={{ marginBottom: 8 }}><h3 style={{ margin: 0 }}>Für Klassen freigegeben</h3>{!form && moeglich.length > 0 && <button className="knopf klein-knopf" onClick={() => { setForm(true); setWahl([]); }}><Symbol.plus />Freigeben</button>}</div>
      {d.freigaben.length ? <div className="liste-kompakt">
        {d.freigaben.map((f) => <div key={f.id}>
          <span><b>{f.klasse}</b> {f.fach}{f.gruppe ? ` ${f.gruppe}` : ""}<br /><small className="leise">{f.aktiv ? `seit ${datumCH(f.ab)}` : new Date(f.ab) > new Date() ? `sichtbar ab ${datumCH(f.ab)}` : `bis ${datumCH(f.bis)}, abgelaufen`}{f.bis && f.aktiv ? `, bis ${datumCH(f.bis)}` : ""}{f.hinweis ? `, «${f.hinweis}»` : ""}</small></span>
          <span className="reihe" style={{ gap: 12 }}>
            <span className="oeffnungen" title="Schülerinnen und Schüler, die es geöffnet haben"><span>{f.geoeffnet} von {f.schueler} geöffnet</span><span className="balken"><i style={{ width: `${f.schueler ? (100 * f.geoeffnet) / f.schueler : 0}%` }} /></span></span>
            {f.darfAendern && <button className="knopf leise-knopf klein-knopf" onClick={() => tun(() => api(`/api/freigaben/${f.id}`, { methode: "DELETE" }), "Freigabe entfernt.")}>Entfernen</button>}
          </span>
        </div>)}
      </div> : !form && <p className="leise klein">{moeglich.length ? "Noch für keine Klasse freigegeben." : "Sie haben keinen Unterricht, für den Sie es freigeben können."}</p>}
      {form && <div className="karte flach" style={{ padding: 16, display: "grid", gap: 14, background: "var(--flaeche2)" }}>
        <div className="wahl-chips" role="group" aria-label="Klassen">
          {sortiert.map((u) => <label key={u.id}><input type="checkbox" checked={wahl.includes(u.id)} onChange={(e) => setWahl(e.target.checked ? [...wahl, u.id] : wahl.filter((x) => x !== u.id))} />{u.klasse} {u.fach}{u.gruppe ? ` ${u.gruppe}` : ""}</label>)}
        </div>
        <div className="zwei">
          <label className="feld">Sichtbar ab<small>Leer: sofort</small><input type="datetime-local" value={ab} onChange={(e) => setAb(e.target.value)} /></label>
          <label className="feld">Sichtbar bis<small>Leer: ohne Ende</small><input type="datetime-local" value={bis} onChange={(e) => setBis(e.target.value)} /></label>
        </div>
        <label className="feld">Hinweis für die Klasse<input value={hinweis} onChange={(e) => setHinweis(e.target.value)} maxLength={300} placeholder="z. B. Bis Montag lesen" /></label>
        <div className="reihe" style={{ justifyContent: "flex-end" }}><button className="knopf leise-knopf" onClick={() => setForm(false)}>Abbrechen</button><button className="knopf haupt-knopf" disabled={!wahl.length} onClick={freigeben}>Freigeben</button></div>
      </div>}
    </section>);
}

function Versionen({ d, tun }) {
  const wahl = useRef(null);
  return (
    <section>
      <div className="zwischen" style={{ marginBottom: 8 }}><h3 style={{ margin: 0 }}>Versionen</h3>
        {d.darfBearbeiten && !d.geloescht_am && <><button className="knopf klein-knopf" onClick={() => wahl.current.click()}><Symbol.hoch />Neue Version</button>
          <input ref={wahl} type="file" hidden onChange={(e) => { const f = e.target.files[0]; e.target.value = ""; if (f) tun(() => hochladen(`/api/material/${d.id}/versionen`, f), "Neue Version hochgeladen. Freigegebene Klassen sehen sie sofort."); }} /></>}
      </div>
      <div className="liste-kompakt">
        {d.versionen.map((v) => <div key={v.id}>
          <span><b>Version {v.nr}</b>{v.id === d.version_id && <span className="kl-chip" style={{ marginLeft: 8 }}>aktuell</span>}<br /><small className="leise">{v.dateiname}, {groesse(v.groesse)}, {wann(v.erstellt_am)}{v.von ? `, ${v.von}` : ""}</small></span>
          <span className="reihe" style={{ gap: 4 }}>
            <a className="knopf leise-knopf klein-knopf" href={`/api/material/${d.id}/datei?v=${v.id}`}>Herunterladen</a>
            {d.darfBearbeiten && v.id !== d.version_id && <button className="knopf leise-knopf klein-knopf" onClick={() => tun(() => api(`/api/material/${d.id}/versionen/${v.id}/aktuell`, { methode: "POST" }), `Version ${v.nr} ist wieder aktuell.`)}>Wieder verwenden</button>}
          </span>
        </div>)}
      </div>
    </section>);
}
