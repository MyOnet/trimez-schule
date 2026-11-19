// Seitenleisten rechts: Suche, Aufgaben und Tags, Papierkorb. Alles über den Server, nur was man lesen darf.
import { useEffect, useRef, useState } from "react";
import { FileText, Folder, Layers, RotateCcw, Search as SearchIcon, Tags, Trash2, X } from "lucide-react";
import * as S from "./store.js";
import { escapeHtml, fmtShort, TAG, TAGS } from "./model.js";
import { api } from "../api.js";

function Panel({ title, onClose, children, head }) {
  return <aside className="panel">
    <div className="panel-head"><h3>{title}</h3>{head}<button className="ib" onClick={onClose} aria-label="Schliessen"><X /></button></div>
    <div className="panel-body scroll">{children}</div>
  </aside>;
}
const go = (pageId, query) => { S.selectPage(pageId); S.ui({ flash: { pageId, query, t: Date.now() } }); };
const wo = (buch, t) => {
  if (t.bereich !== "schueler") return { bibliothek: "Bibliothek", gemeinsam: "Zusammenarbeit", lehrkraefte: "Lehrpersonen" }[t.bereich];
  const b = buch.bereiche.find((x) => x.besitzer_id === t.besitzer_id);
  return b ? b.name : "Eigener Bereich";
};
function snippet(text, words) {
  const low = text.toLowerCase(); const i = words.length ? low.indexOf(words[0].toLowerCase()) : -1;
  const start = Math.max(0, i - 50);
  let s = escapeHtml((start ? "… " : "") + text.slice(start, start + 170));
  for (const w of words) if (w) s = s.replace(new RegExp(escapeHtml(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), (m) => `<mark>${m}</mark>`);
  return s;
}

export function SuchePanel({ uid, onClose }) {
  const [q, setQ] = useState(""); const [res, setRes] = useState(null);
  const buch = S.useStore((s) => s.buch);
  const ref = useRef(null);
  useEffect(() => { ref.current && ref.current.focus(); }, []);
  useEffect(() => {
    if (!q.trim()) { setRes(null); return; }
    const t = setTimeout(async () => { await S.speichern(); try { setRes((await api(`/api/notizbuch/${uid}/suche?q=${encodeURIComponent(q)}`)).treffer); } catch (e) { S.toast(e.message, "error"); } }, 250);
    return () => clearTimeout(t);
  }, [q, uid]);
  const words = q.trim().split(/\s+/).filter(Boolean);
  return <Panel title="Suchen" onClose={onClose}>
    <div style={{ padding: "0 6px 10px" }}>
      <div className="search-box" style={{ width: "100%", background: "var(--desk)", borderColor: "var(--line)" }}>
        <SearchIcon /><input ref={ref} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Im ganzen Notizbuch suchen" style={{ border: 0, outline: 0, background: "none", flex: 1, color: "var(--ink)", minHeight: 0, padding: 0 }}
          onKeyDown={(e) => { if (e.key === "Enter" && res && res[0]) go(res[0].id, words[0]); if (e.key === "Escape") onClose(); }} />
      </div>
    </div>
    {!q && <div className="empty-note"><SearchIcon />Durchsucht Titel und Text aller Seiten, die Sie öffnen dürfen.<br /><span className="small">Kürzel: Ctrl+E</span></div>}
    {res && <div className="small muted" style={{ padding: "0 10px 6px" }}>{res.length ? `${res.length} Seite${res.length === 1 ? "" : "n"}` : "Nichts gefunden"}</div>}
    {(res || []).map((t) => <button key={t.id} className="res" onClick={() => go(t.id, words[0])}>
      <span className="where"><i style={{ "--c": t.farbe }} />{wo(buch, t)} › {t.abschnitt} · {fmtShort(t.geaendert_am)}</span>
      <b>{t.titel || "Seite ohne Titel"}</b>
      <span className="snip" dangerouslySetInnerHTML={{ __html: snippet((t.text || "").replace(/\s+/g, " "), words) }} />
    </button>)}
  </Panel>;
}

export function TagsPanel({ uid, onClose }) {
  const [list, setList] = useState(null); const [offen, setOffen] = useState(true); const [nur, setNur] = useState("");
  const buch = S.useStore((s) => s.buch);
  useEffect(() => {
    (async () => {
      await S.speichern();
      try {
        const d = await api(`/api/notizbuch/${uid}/tags`);
        const out = [], div = document.createElement("div");
        for (const p of d.seiten) for (const html of p.html) {
          div.innerHTML = String(html).replace(/<img[^>]*>/g, "");
          div.querySelectorAll(".tg").forEach((t) => { const id = t.dataset.tag; if (TAG[id]) out.push({ id, done: t.dataset.done === "1", text: (t.parentElement.textContent || "").trim() || "(ohne Text)", p }); });
        }
        setList(out);
      } catch (e) { S.toast(e.message, "error"); setList([]); }
    })();
  }, [uid]);
  if (!list) return <Panel title="Aufgaben und Tags" onClose={onClose}><p className="small muted" style={{ padding: 10 }}>Wird geladen …</p></Panel>;
  const shown = list.filter((x) => (!offen || !TAG[x.id].box || !x.done) && (!nur || x.id === nur));
  const groups = TAGS.map((t) => ({ t, rows: shown.filter((x) => x.id === t.id) })).filter((g) => g.rows.length);
  return <Panel title="Aufgaben und Tags" onClose={onClose}>
    <div className="chips">
      <button className="chip" aria-pressed={offen} onClick={() => setOffen(!offen)}>Erledigte ausblenden</button>
      {TAGS.filter((t) => list.some((x) => x.id === t.id)).map((t) => <button key={t.id} className="chip" aria-pressed={nur === t.id} onClick={() => setNur(nur === t.id ? "" : t.id)}>{t.name}</button>)}
    </div>
    {!groups.length && <div className="empty-note"><Tags />{list.length ? "Alles erledigt." : "Noch keine Tags. Setzen Sie den Cursor in eine Zeile und drücken Sie Ctrl+1 für eine Aufgabe."}</div>}
    {groups.map(({ t, rows }) => <div key={t.id} style={{ marginBottom: 10 }}>
      <div className="mh" style={{ display: "flex", alignItems: "center", gap: 6 }}>{t.name}<span className="kbd" style={{ marginLeft: 0 }}>{rows.length}</span></div>
      {rows.map((r, i) => <button key={i} className="res" onClick={() => go(r.p.id, r.text.slice(0, 40))}>
        <span style={{ display: "flex", alignItems: "flex-start", gap: 2 }}>
          <span className="tg" data-tag={r.id} data-done={r.done ? "1" : undefined} style={t.mark ? { width: 12, height: 12, margin: "4px 8px 0 0", background: t.mark } : { flexShrink: 0, marginTop: 1 }} />
          <span style={{ textDecoration: r.done ? "line-through" : "none", color: r.done ? "var(--muted)" : undefined }}>{r.text.slice(0, 140)}</span>
        </span>
        <span className="where" style={{ marginTop: 3 }}><i style={{ "--c": r.p.farbe }} />{wo(buch, r.p)} › {r.p.abschnitt} › {r.p.titel || "Seite ohne Titel"}</span>
      </button>)}
    </div>)}
  </Panel>;
}

export function PapierkorbPanel({ uid, onClose }) {
  const [d, setD] = useState(null);
  const laden = () => api(`/api/notizbuch/${uid}/papierkorb`).then(setD).catch((e) => S.toast(e.message, "error"));
  useEffect(() => { laden(); }, [uid]);
  const zurueck = async (daten) => { try { await api("/api/notizbuch/wiederherstellen", { methode: "POST", daten }); S.toast("Wiederhergestellt", "ok"); await S.laden(uid); laden(); } catch (e) { S.toast(e.message, "error"); } };
  const leer = d && !d.abschnitte.length && !d.seiten.length;
  return <Panel title="Papierkorb" onClose={onClose}>
    <p className="small muted" style={{ margin: "0 10px 10px" }}>Gelöschte Abschnitte und Seiten bleiben 30 Tage hier.</p>
    {leer && <div className="empty-note"><Trash2 />Der Papierkorb ist leer.</div>}
    {d && d.abschnitte.map((a) => <div key={a.id} className="res" style={{ display: "flex", gap: 10, alignItems: "center", cursor: "default" }}>
      {a.art === "gruppe" ? <Folder style={{ width: 18, height: 18, color: "var(--muted)" }} /> : <Layers style={{ width: 18, height: 18, color: "var(--muted)" }} />}
      <span style={{ flex: 1, minWidth: 0 }}><b>{a.name}</b><span className="where">{a.art === "gruppe" ? "Gruppe" : "Abschnitt"} · gelöscht {fmtShort(a.geloescht_am)}</span></span>
      <button className="ib" title="Wiederherstellen" onClick={() => zurueck({ abschnitt_id: a.id })}><RotateCcw /></button>
    </div>)}
    {d && d.seiten.map((s) => <div key={s.id} className="res" style={{ display: "flex", gap: 10, alignItems: "center", cursor: "default" }}>
      <FileText style={{ width: 18, height: 18, color: "var(--muted)" }} />
      <span style={{ flex: 1, minWidth: 0 }}><b>{s.titel || "Seite ohne Titel"}</b><span className="where">aus {s.abschnitt} · gelöscht {fmtShort(s.geloescht_am)}</span></span>
      <button className="ib" title="Wiederherstellen" onClick={() => zurueck({ seite_id: s.id })}><RotateCcw /></button>
    </div>)}
  </Panel>;
}
