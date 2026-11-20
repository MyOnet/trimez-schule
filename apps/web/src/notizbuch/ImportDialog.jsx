// Importieren: aus OneNote (in der Lernumgebung direkt vom Computer, sonst Export-ZIP oder Microsoft-Konto der Schule)
// oder aus exportierten Dateien.
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronRight, CloudDownload, FileUp, Laptop, LogIn, RefreshCw, TriangleAlert } from "lucide-react";
import * as S from "./store.js";
import { Dialog } from "./ui.jsx";
import { api } from "../api.js";
import { listNotebooks, importNotebooks, Cancelled } from "./importers/graph.js";
import { ACCEPT, filesToPages } from "./importers/files.js";
import { exportLesen, exportAufbau, exportImportieren, seitenZahl } from "./importers/onenote-export.js";
import { saveAsset } from "./dateien.js";
import { pageText } from "./model.js";

/** Die Lernumgebung bereitet OneNote auf diesem Computer schon bei der Installation vor (nur Windows) */
const lokal = () => (typeof window !== "undefined" && window.trimezLernumgebung && window.trimezLernumgebung.onenote) || null;
/** Der vorbereitete Export als Ordner, Datei für Datei gelesen (wie eine ZIP-Datei für den Import) */
async function lokalerOrdner() {
  const lu = lokal();
  const liste = new Set(await lu.dateien());
  const dec = new TextDecoder();
  return { file: (pfad) => (liste.has(pfad) ? { async: async (art) => { const b = await lu.lesen(pfad); return art === "string" ? dec.decode(b) : b; } } : null) };
}
/** Nur die angehakten Teile (aus: Kennungen, die nicht übernommen werden sollen) */
const auswahl = (liste, aus) => liste.filter((k) => !aus.has(k.id)).map((k) => (k.kinder ? { ...k, kinder: auswahl(k.kinder, aus) } : k));

function schreibbareBereiche(buch) { return buch.bereiche.filter((b) => b.schreiben && (b.bereich !== "schueler" || buch.rolle === "sch")); }

export default function ImportDialog({ uid, kurz, start, onClose }) {
  const buch = S.useStore((s) => s.buch);
  const aktuell = S.useStore(S.curBereich);
  const ziele = schreibbareBereiche(buch);
  const vorgabe = (start && start.ziel && ziele.find((b) => S.bereichKey(b) === start.ziel)) || (aktuell && aktuell.schreiben && ziele.includes(aktuell) ? aktuell : null) || ziele.find((b) => b.bereich === (buch.rolle === "lp" ? "bibliothek" : "schueler")) || ziele[0];
  const [ziel, setZiel] = useState(vorgabe ? S.bereichKey(vorgabe) : null);
  const [view, setView] = useState("start");
  const [run, setRun] = useState(null);
  const [status, setStatus] = useState(null);
  const [over, setOver] = useState(false);
  const fileRef = useRef(null), zipRef = useRef(null), gestartet = useRef(false);
  const zielB = ziele.find((b) => S.bereichKey(b) === ziel);

  useEffect(() => { api("/api/onenote/status").then(setStatus).catch(() => setStatus({ verbunden: false, moeglich: false })); }, []);
  // Zurück von Microsoft: gleich alles importieren
  useEffect(() => {
    if (gestartet.current || !start || !status) return;
    if (start.onenote === "1" && status.verbunden && zielB) { gestartet.current = true; history.replaceState(null, "", location.pathname); microsoft(); }
    if (start.onenote === "fehler") { gestartet.current = true; history.replaceState(null, "", location.pathname); }
  }, [status]);

  const zielDaten = () => { const [bereich, besitzer_id] = ziel.split(":"); return { bereich, besitzer_id: besitzer_id || undefined }; };
  const erstellen = (d) => api(`/api/notizbuch/${uid}/abschnitte`, { methode: "POST", daten: { ...zielDaten(), ...d } });
  const seitenSpeichern = (aid, seiten) => api(`/api/notizbuch/abschnitte/${aid}/seiten-import`, { methode: "POST", daten: { seiten } });

  function verbinden() {
    location.href = `/api/onenote/verbinden?zurueck=${encodeURIComponent(`/s/${kurz}/notizbuch/${uid}?ziel=${ziel}`)}`;
  }
  async function microsoft() {
    const ctrl = new AbortController();
    const r = { kind: "ms", lines: [], prog: { phase: "Verbinden", done: 0, total: 0, text: "" }, stats: null, error: null, cancel: () => ctrl.abort() };
    const bump = () => setRun({ ...r });
    setRun(r); setView("run");
    try {
      const liste = await listNotebooks(ctrl.signal);
      if (!liste.length) throw new Error("In Ihrem Microsoft-Konto gibt es keine OneNote-Notizbücher.");
      r.stats = await importNotebooks(liste, {
        signal: ctrl.signal, erstellen, seitenSpeichern, pageText,
        progress: (p) => { r.prog = p; bump(); },
        log: (t, bad) => { r.lines = [...r.lines.slice(-400), { t, bad }]; bump(); },
      });
    } catch (e) { r.error = e instanceof Cancelled ? "Abgebrochen. Was schon übernommen war, bleibt erhalten." : String(e.message || e); }
    await S.laden(uid); S.waehleBereich(ziel);
    setRun({ ...r }); setView("done");
  }
  async function oneNoteExport(file) {
    const r = { kind: "ms", lines: [], prog: { phase: "Export lesen", done: 0, total: 0, text: file.name }, stats: null, error: null };
    const bump = () => setRun({ ...r });
    setRun(r); setView("run");
    try {
      const ex = await exportLesen(file);
      r.lines.push({ t: `${ex.buecher.length} Notizbuch${ex.buecher.length === 1 ? "" : "er"}, ${ex.seiten} Seiten gefunden` }); bump();
      r.stats = await exportImportieren(ex, {
        erstellen, seitenSpeichern, pageText, hochladen: (bytes, ext, name, aid) => saveAsset(bytes, ext, name, aid),
        progress: (p) => { r.prog = p; bump(); }, log: (t, bad) => { r.lines = [...r.lines.slice(-400), { t, bad }]; bump(); },
      });
    } catch (e) { r.error = String(e.message || e); }
    await S.laden(uid); S.waehleBereich(ziel);
    setRun({ ...r }); setView("done");
  }
  async function vomComputer(ex, aus) {
    const r = { kind: "ms", lines: [], prog: { phase: "Vorbereiten", done: 0, total: 0, text: "" }, stats: null, error: null };
    const ctrl = new AbortController(); r.cancel = () => ctrl.abort();
    const bump = () => setRun({ ...r });
    setRun(r); setView("run");
    try {
      const { bereich, besitzer_id } = zielDaten();
      const { seiten: vorhanden } = await api(`/api/notizbuch/${uid}/quellen?bereich=${bereich}${besitzer_id ? `&besitzer_id=${besitzer_id}` : ""}`);
      r.stats = await exportImportieren({ zip: ex.zip, buecher: auswahl(ex.buecher, aus) }, {
        erstellen, seitenSpeichern, pageText, vorhanden, signal: ctrl.signal, hochladen: (bytes, ext, name, aid) => saveAsset(bytes, ext, name, aid),
        progress: (p) => { r.prog = p; bump(); }, log: (t, bad) => { r.lines = [...r.lines.slice(-400), { t, bad }]; bump(); },
      });
      r.rest = ex.fertig ? 0 : ex.seiten - ex.bereit;
    } catch (e) { r.error = String(e.message || e); }
    await S.laden(uid); S.waehleBereich(ziel);
    setRun({ ...r }); setView("done");
  }
  async function dateien(files) {
    const r = { kind: "files", lines: [], prog: { phase: "Dateien lesen", done: 0, total: files.length, text: "" }, stats: null, error: null };
    setRun(r); setView("run");
    try {
      const name = `Import ${new Date().toLocaleDateString("de-CH")}`;
      const sec = await erstellen({ art: "abschnitt", name, farbe: "#21A69A", ohneSeite: true });
      const { pages, errors } = await filesToPages(files, (text, i, n) => { r.prog = { phase: "Dateien lesen", text, done: i, total: n }; setRun({ ...r }); }, sec.id);
      errors.forEach((t) => r.lines.push({ t, bad: true }));
      if (pages.length) await seitenSpeichern(sec.id, pages.map((p) => ({ titel: p.title, ebene: 0, inhalt: { items: p.items, strokes: p.strokes, bg: p.bg || {} }, text: pageText(p) })));
      else await api(`/api/notizbuch/abschnitte/${sec.id}`, { methode: "DELETE" });
      r.stats = { pages: pages.length, failed: errors.length };
      await S.laden(uid); if (pages.length) S.waehleAbschnitt(sec.id);
    } catch (e) { r.error = String(e.message || e); }
    setRun({ ...r }); setView("done");
  }

  const busy = view === "run";
  return <Dialog wide title={view === "done" ? "Import fertig" : "Importieren"} onClose={() => { if (!busy) onClose(); else if (run && run.cancel) run.cancel(); }}
    icon={<CloudDownload style={{ width: 22, height: 22, color: "var(--accent)" }} />}>
    {view === "start" && <div>
      {!ziele.length ? <p>Hier dürfen Sie nichts ablegen.</p> : <>
        <label className="ziel">Ablegen in
          <select className="sel" value={ziel || ""} onChange={(e) => setZiel(e.target.value)}>
            {ziele.map((b) => <option key={S.bereichKey(b)} value={S.bereichKey(b)}>{b.name}</option>)}
          </select>
        </label>
        {lokal() && <DiesesGeraet los={vomComputer} />}
        <div className="imp-cards" style={lokal() ? { gridTemplateColumns: "1fr" } : undefined}>
          {!lokal() && <div className="imp-card">
            <h3><CloudDownload />Aus OneNote</h3>
            <p>Übernimmt alle Ihre Notizbücher <b>genau wie in OneNote</b>: Abschnittsgruppen, Abschnitte mit ihren Farben, Seiten und Unterseiten in derselben Reihenfolge, dazu Text, Tabellen, Tags, Bilder und Anhänge.</p>
            <ol className="steps small">
              <li><a href="/OneNote-zu-RESCOOL.ps1" download>Programm «OneNote zu RESCOOL» herunterladen</a></li>
              <li>In PowerShell starten (OneNote-App muss installiert sein):<br /><code>powershell -ExecutionPolicy Bypass -File "$HOME\Downloads\OneNote-zu-RESCOOL.ps1"</code></li>
              <li>Die ZIP-Datei, die auf dem Desktop entsteht, hier wählen.</li>
            </ol>
            <button className="btn primary big" onClick={() => zipRef.current.click()}><FileUp />OneNote-Export hochladen (.zip)</button>
            <input ref={zipRef} type="file" accept=".zip" hidden onChange={(e) => { if (e.target.files[0]) oneNoteExport(e.target.files[0]); }} />
            {status && status.moeglich && <button className="btn" style={{ justifyContent: "center" }} onClick={() => (status.verbunden ? microsoft() : verbinden())}><LogIn />Stattdessen über das Microsoft-Konto der Schule</button>}
          </div>}
          <div className="imp-card">
            <h3><FileUp />Aus Dateien</h3>
            <p>In OneNote <b>Datei › Exportieren</b>, Abschnitt oder Seite als <b>Word-Dokument</b>, <b>Webseite in einer Datei (.mht)</b> oder <b>PDF</b>. Jede Datei wird eine Seite.</p>
            <div className={"drop" + (over ? " over" : "")} onClick={() => fileRef.current.click()}
              onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) dateien([...e.dataTransfer.files]); }}>
              <FileUp /><b>Dateien hierher ziehen</b><div className="small muted">oder klicken · .docx .mht .pdf .html .md .txt, Bilder</div>
            </div>
            <input ref={fileRef} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { if (e.target.files.length) dateien([...e.target.files]); }} />
          </div>
        </div>
      </>}
    </div>}
    {view === "run" && <Laufend run={run} />}
    {view === "done" && <Fertig run={run} onClose={onClose} />}
  </Dialog>;
}

/** OneNote auf diesem Computer: vorbereitet von der Lernumgebung, mit einem Klick übernehmen */
function DiesesGeraet({ los }) {
  const [stand, setStand] = useState(null);
  const [ex, setEx] = useState(null);
  const [fehlerText, setFehlerText] = useState(null);
  const [aus, setAus] = useState(() => new Set());
  const [auf, setAuf] = useState(() => new Set());
  const geladen = useRef(0);
  const [runde, setRunde] = useState(0);
  useEffect(() => {
    let weg = false, t = null;
    const pruefen = async () => {
      try {
        const st = await lokal().stand();
        if (weg) return;
        setStand(st);
        // Aufbau (neu) lesen, wenn er sich geändert hat
        if (st.vorhanden && st.zeit !== geladen.current) {
          geladen.current = st.zeit;
          try { const e = await exportAufbau(await lokalerOrdner()); if (!weg) setEx(e); } catch (e) { if (!weg) setFehlerText(String(e.message || e)); }
        }
        if (st.laeuft) t = setTimeout(pruefen, 3000);
      } catch (e) { if (!weg) setFehlerText(String(e.message || e)); }
    };
    pruefen();
    return () => { weg = true; clearTimeout(t); };
  }, [runde]);
  const neuStarten = async () => { try { setFehlerText(null); await lokal().starten(); setTimeout(() => setRunde((n) => n + 1), 1500); setStand({ ...stand, laeuft: true, prozent: 0, text: "Wird gestartet …" }); } catch (e) { setFehlerText(String(e.message || e)); } };
  if (!stand) return null;
  if (!stand.moeglich) return null;
  const wahl = ex ? auswahl(ex.buecher, aus) : [];
  const anzahl = wahl.reduce((n, b) => n + seitenZahl(b, true), 0);
  const umschalten = (id) => setAus((a) => { const n = new Set(a); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const klappen = (id) => setAuf((a) => { const n = new Set(a); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const fehlgeschlagen = !stand.laeuft && !stand.vorhanden;
  const zeile = (k, tiefe) => {
    const alle = seitenZahl(k), bereit = seitenZahl(k, true), offen = auf.has(k.id), an = !aus.has(k.id);
    return <div key={k.id}>
      <div className="lok-zeile" style={{ paddingLeft: 8 + tiefe * 20 }}>
        {k.kinder ? <button className={"ib lok-pfeil" + (offen ? " offen" : "")} onClick={() => klappen(k.id)} aria-label={offen ? "Zuklappen" : "Aufklappen"}><ChevronRight /></button> : <span className="lok-pfeil" />}
        <label><input type="checkbox" checked={an} onChange={() => umschalten(k.id)} /><i className="lok-farbe" style={{ background: k.farbe || "var(--line)" }} />{k.name}</label>
        <span className="lok-zahl">{bereit === alle ? `${alle} Seite${alle === 1 ? "" : "n"}` : `${bereit} von ${alle} Seiten bereit`}</span>
      </div>
      {k.kinder && offen && an && k.kinder.map((c) => zeile(c, tiefe + 1))}
    </div>;
  };
  return <div className="imp-card lok">
    <h3><Laptop />OneNote auf diesem Computer</h3>
    {fehlgeschlagen && <>
      <p>{stand.text && stand.text !== "FEHLER" && stand.text !== "FERTIG" ? stand.text : "Ihre OneNote-Notizbücher sind auf diesem Computer noch nicht vorbereitet."}</p>
      <button className="btn" style={{ alignSelf: "flex-start" }} onClick={neuStarten}><RefreshCw />Jetzt vorbereiten</button>
    </>}
    {stand.laeuft && <div>
      <div className="progress"><i style={{ width: Math.max(3, stand.prozent) + "%" }} /></div>
      <div className="small muted lok-text">{ex ? "Weitere Seiten werden vorbereitet: " : "Wird vorbereitet: "}{stand.text || "OneNote wird gelesen …"}</div>
    </div>}
    {fehlerText && <p className="small" style={{ color: "var(--danger)" }}>{fehlerText}</p>}
    {ex && <>
      <p className="small muted" style={{ margin: 0 }}>
        {ex.buecher.length} Notizbuch{ex.buecher.length === 1 ? "" : "er"}, {ex.bereit === ex.seiten ? `${ex.seiten} Seiten` : `${ex.bereit} von ${ex.seiten} Seiten bereit (die zuletzt bearbeiteten zuerst)`}.
        {" "}Aufbau, Reihenfolge, Farben und Handschrift wie in OneNote. Bereits Übernommenes wird nicht doppelt angelegt.
      </p>
      <div className="lok-baum scroll">{ex.buecher.map((b) => zeile(b, 0))}</div>
      <button className="btn primary big" disabled={!anzahl} onClick={() => los(ex, aus)}><CloudDownload />{anzahl ? `${anzahl} Seite${anzahl === 1 ? "" : "n"} übernehmen` : "Nichts ausgewählt"}</button>
    </>}
  </div>;
}

function Laufend({ run }) {
  const logRef = useRef(null);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [run.lines.length]);
  const p = run.prog, pct = p.total ? Math.round((p.done / p.total) * 100) : 4;
  return <div>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}><b>{p.phase}</b><span className="muted small" style={{ fontVariantNumeric: "tabular-nums" }}>{p.total ? `${p.done} von ${p.total}` : ""}</span></div>
    <div className="progress"><i style={{ width: pct + "%" }} /></div>
    <div className="small muted" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 10 }}>{p.text}</div>
    {run.lines.length > 0 && <div className="log scroll" ref={logRef}>{run.lines.map((l, i) => <div key={i} className={l.bad ? "err" : ""}>{l.t}</div>)}</div>}
    {run.cancel && <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}><button className="btn" onClick={run.cancel}>Abbrechen</button></div>}
  </div>;
}

function Fertig({ run, onClose }) {
  const s = run.stats || {};
  const probleme = run.lines.filter((l) => l.bad);
  return <div>
    {run.error ? <div className="acct" style={{ background: "color-mix(in srgb, var(--danger) 12%, transparent)" }}><TriangleAlert style={{ color: "var(--danger)" }} />{run.error}</div>
      : <div className="acct"><CheckCircle2 style={{ color: "var(--ok)" }} /><b>{run.kind === "ms" ? (s.pages === 0 && s.skipped > 0 ? "Alles ist schon übernommen, nichts hat sich geändert." : "Ihre OneNote-Notizbücher sind da.") : `${s.pages} Seite${s.pages === 1 ? "" : "n"} übernommen.`}</b></div>}
    {run.rest > 0 && <p className="small" style={{ marginTop: 10 }}>{run.rest} weitere Seite{run.rest === 1 ? " wird" : "n werden"} noch vorbereitet. Später nochmals <b>Importieren</b> wählen: Dann kommt nur dazu, was noch fehlt.</p>}
    {s.skipped > 0 && <p className="small muted" style={{ marginTop: 6 }}>{s.skipped} Seite{s.skipped === 1 ? " war" : "n waren"} schon da und {s.skipped === 1 ? "blieb" : "blieben"} unverändert.</p>}
    {run.kind === "ms" && run.stats && run.stats.pages > 0 && <div className="big-num" style={{ marginTop: 14 }}>
      {[["Notizbücher", s.notebooks], ["Abschnitte", s.sections], ["Seiten", s.pages], ["Bilder", s.images], ["Anhänge", s.files], ["Striche", s.ink]].map(([l, v]) => <div key={l}><b>{v}</b><span>{l}</span></div>)}
    </div>}
    {probleme.length > 0 && <><p className="small" style={{ margin: "12px 0 6px" }}><b>{probleme.length} Hinweis{probleme.length === 1 ? "" : "e"}:</b></p>
      <div className="log scroll">{probleme.map((l, i) => <div key={i} className="err">{l.t}</div>)}</div></>}
    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}><button className="btn primary" onClick={onClose}>Fertig</button></div>
  </div>;
}
