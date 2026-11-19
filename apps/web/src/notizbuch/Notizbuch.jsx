// Kursnotizbuch eines Unterrichts: Bereiche, Abschnitte (mit Gruppen), Seiten, Werkzeugleiste und das Blatt.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { BookOpen, ChevronLeft, ChevronRight, CloudDownload, Lock, MoreHorizontal, Search, Users, Recycle, Tags, ShieldCheck, Eye } from "lucide-react";
import * as S from "./store.js";
import { Abschnitte, Seiten } from "./Leiste.jsx";
import Ribbon, { doUndo } from "./Ribbon.jsx";
import Canvas from "./Canvas.jsx";
import { SuchePanel, TagsPanel, PapierkorbPanel } from "./Panels.jsx";
import ImportDialog from "./ImportDialog.jsx";
import { ConfirmHost, PromptHost, useMenu } from "./ui.jsx";
import { api } from "../api.js";
import { useIch } from "../App.jsx";
import "./notizbuch.css";

const TABS = [["home", "Start"], ["insert", "Einfügen"], ["draw", "Zeichnen"], ["view", "Ansicht"]];
const BEREICH_SYMBOL = { bibliothek: BookOpen, gemeinsam: Users, lehrkraefte: ShieldCheck, schueler: Eye };

function useTheme() {
  useLayoutEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => { const t = document.documentElement.dataset.thema === "hell" ? "light" : mq.matches ? "dark" : "light"; if (S.get().ui.theme !== t) S.ui({ theme: t }); };
    apply(); mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
}

function Tabs() {
  const tab = S.useStore((s) => s.ui.tab);
  const refs = useRef({}); const [line, setLine] = useState({ left: 0, width: 0 });
  useLayoutEffect(() => { const b = refs.current[tab]; if (b) setLine({ left: b.offsetLeft + 10, width: b.offsetWidth - 20 }); }, [tab]);
  return <div className="tabs" role="tablist">
    {TABS.map(([k, l]) => <button key={k} ref={(el) => { refs.current[k] = el; }} role="tab" aria-selected={tab === k} onMouseDown={(e) => e.preventDefault()}
      onClick={() => S.ui((u) => ({ tab: k, mode: k === "draw" ? (u.mode === "type" ? "pen" : u.mode) : "type" }))}>{l}</button>)}
    <span className="ink-line" style={line} />
  </div>;
}

export default function NotizbuchSeite() {
  const { kurz, uid } = useParams();
  const [such] = useSearchParams();
  const ich = useIch();
  useTheme();
  const buch = S.useStore((s) => (s.uid === uid ? s.buch : null));
  const fehler = S.useStore((s) => s.fehler);
  const page = S.useStore(S.curPage), sec = S.useStore(S.curSec), bereich = S.useStore(S.curBereich);
  const panel = S.useStore((s) => s.ui.panel), saved = S.useStore((s) => s.ui.saved), toast = S.useStore((s) => s.ui.toast);
  const full = S.useStore((s) => s.settings.fullPage);
  const [imp, setImp] = useState(such.get("onenote") ? { onenote: such.get("onenote"), ziel: such.get("ziel") } : null);
  const [menu, , openAt] = useMenu();
  const moreRef = useRef(null);

  useEffect(() => {
    S.set((s) => { if (s.uid !== uid) { s.uid = uid; s.buch = null; s.seiten = {}; s.sel = { bereich: null, secId: null, pageId: null }; } });
    S.laden(uid, false).catch(() => {});
    // Erlaubt oder gesperrt kann sich jederzeit ändern (Lektion, Prüfung): regelmässig nachfragen
    const t = setInterval(() => { if (document.visibilityState === "visible") S.speichern().then(() => S.laden(uid)).catch(() => {}); }, 20000);
    return () => { clearInterval(t); S.speichern(); };
  }, [uid]);

  // Geteilte Seiten: Änderungen anderer übernehmen, solange man selbst nicht schreibt
  useEffect(() => {
    if (!page || !bereich || bereich.bereich === "schueler" && buch && buch.rolle === "sch") return;
    const t = setInterval(async () => {
      if (!S.get().ui.saved || (document.activeElement && document.activeElement.closest && document.activeElement.closest(".ed"))) return;
      try {
        const d = await api(`/api/notizbuch/seiten/${page.id}`);
        if (d.version > (S.get().seiten[page.id] || {}).version) S.seiteOeffnen(page.id, true);
      } catch { /* später */ }
    }, 8000);
    return () => clearInterval(t);
  }, [page && page.id, bereich && bereich.bereich]);

  // Tastenkürzel
  useEffect(() => {
    const k = (e) => {
      const mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
      const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName), inEd = e.target.closest && e.target.closest(".ed");
      if (mod && !e.altKey && key === "n") { e.preventDefault(); if (S.schreibbar()) S.addPage({ after: true, sub: e.shiftKey }); return; }
      if (mod && (key === "e" || key === "f")) { e.preventDefault(); S.ui({ panel: "suche" }); return; }
      if (mod && key === "s") { e.preventDefault(); S.speichern(); return; }
      if (mod && e.altKey && (e.key === "]" || e.key === "[")) { e.preventDefault(); const p = S.curPage(); if (p && S.schreibbar()) S.setLevel(p.id, e.key === "]" ? 1 : -1); return; }
      if (mod && (e.key === "=" || e.key === "+")) { e.preventDefault(); S.setting({ zoom: Math.min(2.5, +(S.get().settings.zoom + 0.1).toFixed(2)) }); return; }
      if (mod && e.key === "-") { e.preventDefault(); S.setting({ zoom: Math.max(0.5, +(S.get().settings.zoom - 0.1).toFixed(2)) }); return; }
      if (e.key === "F11") { e.preventDefault(); S.setting({ fullPage: !S.get().settings.fullPage }); return; }
      if (mod && (e.key === "PageDown" || e.key === "PageUp")) {
        e.preventDefault(); const s = S.curSec(), p = S.curMeta(); if (!s || !p) return;
        const i = s.seiten.findIndex((x) => x.id === p.id) + (e.key === "PageDown" ? 1 : -1); if (s.seiten[i]) S.selectPage(s.seiten[i].id); return;
      }
      if (inField || inEd) return;
      if (mod && key === "z") { e.preventDefault(); doUndo(e.shiftKey); return; }
      if (mod && key === "y") { e.preventDefault(); doUndo(true); return; }
      if (e.key === "Escape") S.ui({ mode: "type", panel: null });
    };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, []);

  if (fehler && !buch) return <div className="haupt-innen"><div className="hinweis fehler">{fehler.message}</div></div>;
  if (!buch) return <p className="leise" style={{ padding: 32 }}>Notizbuch wird geladen …</p>;
  const u = buch.unterricht;
  if (!buch.erlaubt) return <div className="nb-gesperrt">
    <div className="nb-schloss" style={{ "--farbe": u.farbe }}><Lock /></div>
    <h1>{u.fach} {u.klasse}</h1>
    <p>{buch.grund}</p>
    <Link className="knopf" to={`/s/${kurz}/notizbuch`}>Zu den Notizbüchern</Link>
  </div>;

  const lp = buch.rolle === "lp";
  const more = () => openAt(moreRef.current.getBoundingClientRect(), [
    { label: "Aufgaben und Tags", icon: Tags, onClick: () => S.ui({ panel: "tags" }) },
    { label: "Papierkorb", icon: Recycle, onClick: () => S.ui({ panel: "papierkorb" }) },
  ]);
  const ro = page && page.schreiben === false;

  return <div className="sheaf nb-app" style={{ "--sec": sec ? sec.farbe : u.farbe }}>
    <header className="top">
      <div className="bar">
        <Link to={`/s/${kurz}/notizbuch`} className="nb-heft" title="Alle Notizbücher" style={{ "--c": u.farbe }}><span className="book" style={{ "--c": u.farbe }} /><b>{u.fach}</b><span className="muted">{u.klasse}</span></Link>
        <Tabs />
        <span className="grow" />
        {buch.modus === "pruefung" && <span className="nb-flag">Prüfung: nur eigener Bereich und Bibliothek</span>}
        {buch.modus === "lektion" && <span className="nb-flag ok">Lektion läuft</span>}
        {lp && <Erlaubnis uid={uid} an={!!u.notizbuch} />}
        <span className={"saved" + (saved ? "" : " busy")} title={saved ? "Alles gespeichert" : "Wird gespeichert …"}><i />{saved ? "Gespeichert" : "Speichert"}</span>
        <button className="search-box" onClick={() => S.ui({ panel: "suche" })}><Search /><span>Suchen</span><span className="kbd">Ctrl+E</span></button>
        {buch.modus !== "pruefung" && <button className="btn primary" onClick={() => setImp({})}><CloudDownload />Importieren</button>}
        <button ref={moreRef} className="ib" onClick={more} aria-label="Mehr"><MoreHorizontal /></button>
      </div>
      {!ro ? <Ribbon /> : <div className="ribbon"><span className="nur-lesen"><Eye />Hier können Sie lesen, aber nichts ändern.</span></div>}
    </header>
    <div className={"body" + (full ? " full" : "")}>
      <Abschnitte buch={buch} symbole={BEREICH_SYMBOL} />
      <Seiten />
      <div style={{ position: "relative", minWidth: 0, minHeight: 0, display: "flex" }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex" }}>
          {page && sec ? <Canvas key={sec.id} page={page} sec={{ ...sec, color: sec.farbe }} />
            : <div className="blank" style={{ flex: 1 }}>{bereich && !S.allSections(bereich).length ? <Leer bereich={bereich} /> : "Wählen Sie eine Seite."}</div>}
        </div>
        {panel === "suche" && <SuchePanel uid={uid} onClose={() => S.ui({ panel: null })} />}
        {panel === "tags" && <TagsPanel uid={uid} onClose={() => S.ui({ panel: null })} />}
        {panel === "papierkorb" && <PapierkorbPanel uid={uid} onClose={() => S.ui({ panel: null })} />}
      </div>
    </div>
    {imp && <ImportDialog uid={uid} kurz={kurz} start={imp} onClose={() => setImp(null)} ich={ich} />}
    {menu}
    <ConfirmHost /><PromptHost />
    {toast && <div key={toast.id} className={"toast " + toast.kind}>{toast.text}</div>}
  </div>;
}

function Leer({ bereich }) {
  return <div className="nb-leer">
    <b>{bereich.name} ist noch leer.</b>
    {bereich.schreiben ? <><span>Legen Sie den ersten Abschnitt an, oder holen Sie Ihre Notizen aus OneNote.</span>
      <button className="btn primary" onClick={() => S.addSection()}>Abschnitt anlegen</button></>
      : <span>Ihre Lehrperson hat hier noch nichts abgelegt.</span>}
  </div>;
}

function Erlaubnis({ uid, an }) {
  const [wert, setWert] = useState(an);
  useEffect(() => setWert(an), [an]);
  const umschalten = async () => {
    const neu = !wert; setWert(neu);
    try { await api(`/api/unterricht/${uid}/notizbuch`, { methode: "PUT", daten: { erlaubt: neu } }); S.toast(neu ? "Die Klasse kann das Notizbuch öffnen." : "Für die Klasse gesperrt. Sie selbst sehen weiterhin alles.", "ok"); S.laden(uid); }
    catch (e) { setWert(!neu); S.toast(e.message, "error"); }
  };
  return <button className={"schalter" + (wert ? " an" : "")} role="switch" aria-checked={wert} onClick={umschalten} title="Grundeinstellung. In Lektionen und Prüfungen legen Sie es dort fest.">
    <span className="knopf-schalter" /><span>{wert ? "Klasse darf öffnen" : "Für Klasse gesperrt"}</span>
  </button>;
}

export { ChevronLeft, ChevronRight };
