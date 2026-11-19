// Importieren: aus OneNote über das Microsoft-Konto der Schule (alles auf einmal) oder aus exportierten Dateien.
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, CloudDownload, FileUp, LogIn, TriangleAlert } from "lucide-react";
import * as S from "./store.js";
import { Dialog } from "./ui.jsx";
import { api } from "../api.js";
import { listNotebooks, importNotebooks, Cancelled } from "./importers/graph.js";
import { ACCEPT, filesToPages } from "./importers/files.js";
import { pageText } from "./model.js";

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
  const fileRef = useRef(null), gestartet = useRef(false);
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
        <div className="imp-cards">
          <div className="imp-card">
            <h3><LogIn />Aus OneNote</h3>
            <p>Holt alle Ihre OneNote-Notizbücher auf einmal: Abschnittsgruppen, Abschnitte, Seiten und Unterseiten in derselben Reihenfolge, mit Formatierung, Tags, Bildern, Anhängen und Handschrift.</p>
            {status && !status.moeglich && <div className="small" style={{ color: "var(--danger)" }}><TriangleAlert style={{ width: 14, height: 14, verticalAlign: -2 }} /> Microsoft 365 ist für Ihre Schule noch nicht verbunden. Nutzen Sie solange den Datei-Import.</div>}
            <p className="small muted">Sie melden sich mit Ihrem Schulkonto an. RESCOOL liest Ihre Notizen nur für diesen Import; OneNote bleibt unverändert.</p>
            <button className="btn primary big" disabled={!status || !status.moeglich} onClick={() => (status.verbunden ? microsoft() : verbinden())}><CloudDownload />Alles aus OneNote importieren</button>
          </div>
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
      : <div className="acct"><CheckCircle2 style={{ color: "var(--ok)" }} /><b>{run.kind === "ms" ? "Ihre OneNote-Notizbücher sind da." : `${s.pages} Seite${s.pages === 1 ? "" : "n"} übernommen.`}</b></div>}
    {run.kind === "ms" && run.stats && <div className="big-num" style={{ marginTop: 14 }}>
      {[["Notizbücher", s.notebooks], ["Abschnitte", s.sections], ["Seiten", s.pages], ["Bilder", s.images], ["Anhänge", s.files], ["Striche", s.ink]].map(([l, v]) => <div key={l}><b>{v}</b><span>{l}</span></div>)}
    </div>}
    {probleme.length > 0 && <><p className="small" style={{ margin: "12px 0 6px" }}><b>{probleme.length} Hinweis{probleme.length === 1 ? "" : "e"}:</b></p>
      <div className="log scroll">{probleme.map((l, i) => <div key={i} className="err">{l.t}</div>)}</div></>}
    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}><button className="btn primary" onClick={onClose}>Fertig</button></div>
  </div>;
}
