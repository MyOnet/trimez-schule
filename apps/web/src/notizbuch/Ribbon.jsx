// The toolbar under the tabs: Home, Insert, Draw, View.
import { useEffect, useRef, useState } from "react";
import {
  AlignCenter, AlignLeft, AlignRight, Bold, Calendar, CheckSquare, ChevronDown, Clock, Eraser, Eye, Highlighter, Image, IndentDecrease, IndentIncrease,
  Italic, Link2, List, ListOrdered, Maximize2, Minimize2, Minus, MousePointer2, Moon, Paperclip, PenLine, Plus, Printer, Redo2, RemoveFormatting,
  Strikethrough, Subscript, Sun, Superscript, Table, Tag, Trash2, Type, Underline, Undo2, Baseline, Highlighter as Marker, Monitor, Grid3x3,
} from "lucide-react";
import * as S from "./store.js";
import * as E from "./editor.js";
import { assetUrl, printPage, saveAsset } from "./dateien.js";
import { FONTS, HIGHLIGHTS, HL_COLORS, INK_COLORS, PAGE_COLORS, RULES, SIZES, TAGS, TEXT_COLORS } from "./model.js";
import { ask, confirm, Pop, Swatches, useMenu } from "./ui.jsx";

const keep = (e) => e.preventDefault(); // keep the text selection when clicking toolbar buttons
function B({ icon: I, label, on, title, onClick, disabled, children }) {
  return <button className={"ib" + (label ? " lbl" : "")} aria-pressed={on ? "true" : undefined} title={title} disabled={disabled} onMouseDown={keep} onClick={onClick}>{I && <I />}{label}{children}</button>;
}
function PopBtn({ icon, label, title, children, width }) {
  const [at, setAt] = useState(null); const ref = useRef(null);
  return <>
    <button ref={ref} className={"ib" + (label ? " lbl" : "")} title={title} onMouseDown={keep} onClick={() => setAt(at ? null : ref.current.getBoundingClientRect())}>{icon}{label}<ChevronDown style={{ width: 12, height: 12, marginLeft: -2 }} /></button>
    {at && <Pop at={at} onClose={() => setAt(null)}><div onMouseDown={(e) => { if (e.target.tagName !== "INPUT") e.preventDefault(); }} style={{ width }}>{children(() => setAt(null))}</div></Pop>}
  </>;
}

function useFormat() {
  const [f, setF] = useState(E.formatState());
  useEffect(() => {
    let raf = 0;
    const up = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setF(E.formatState())); };
    document.addEventListener("selectionchange", up); document.addEventListener("input", up, true);
    return () => { document.removeEventListener("selectionchange", up); document.removeEventListener("input", up, true); };
  }, []);
  return f;
}

export function doUndo(redo) {
  const ed = document.activeElement && document.activeElement.closest && document.activeElement.closest(".ed");
  if (ed) { document.execCommand(redo ? "redo" : "undo"); return; }
  const id = S.get().sel.pageId; if (id) S.undo(id, redo);
}

/** Pictures and files from the toolbar: inline in the note being edited, else as items on the page. */
async function insertFiles(files, inline) {
  const ed = E.activeEditor();
  if (inline && ed && document.activeElement === ed) {
    for (const f of files) {
      if (!f.type.startsWith("image/")) continue;
      const n = await saveAsset(f, f.name.split(".").pop(), f.name);
      E.insertHtml(`<img data-asset="${n}" src="${assetUrl(n)}" alt="">`);
    }
    return;
  }
  window.dispatchEvent(new CustomEvent("sheaf:files", { detail: files }));
}

export default function Ribbon() {
  const tab = S.useStore((s) => s.ui.tab);
  return <div className="ribbon">
    <div className="ribbon-in" key={tab}>
      {tab === "home" && <Home />}
      {tab === "insert" && <Insert />}
      {tab === "draw" && <Draw />}
      {tab === "view" && <View />}
    </div>
  </div>;
}

function UndoGroup() {
  return <div className="grp">
    <B icon={Undo2} title="Rückgängig (Ctrl+Z)" onClick={() => doUndo(false)} />
    <B icon={Redo2} title="Wiederholen (Ctrl+Y)" onClick={() => doUndo(true)} />
  </div>;
}

function Home() {
  const f = useFormat();
  const font = FONTS.find((x) => f.font && f.font.toLowerCase().includes(x.name.toLowerCase())) || null;
  const style = { h1: "Überschrift 1", h2: "Überschrift 2", h3: "Überschrift 3", h4: "Überschrift 4", blockquote: "Zitat", pre: "Code" }[f.block] || "Normal";
  return <>
    <UndoGroup />
    <div className="grp">
      <select className="sel" style={{ width: 132 }} value={font ? font.css : ""} title="Schrift" onMouseDown={() => E.restore()} onChange={(e) => E.cmd("fontName", e.target.value)}>
        {!font && <option value="">{(f.font || "Schrift").split(",")[0].replace(/['"]/g, "")}</option>}
        {FONTS.map((x) => <option key={x.name} value={x.css}>{x.name}</option>)}
      </select>
      <select className="sel" style={{ width: 62 }} value={SIZES.includes(f.size) ? f.size : ""} title="Schriftgrösse" onChange={(e) => E.fontSize(+e.target.value)}>
        {!SIZES.includes(f.size) && <option value="">{f.size || ""}</option>}
        {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
    </div>
    <div className="grp">
      <B icon={Bold} on={f.bold} title="Fett (Ctrl+B)" onClick={() => E.cmd("bold")} />
      <B icon={Italic} on={f.italic} title="Kursiv (Ctrl+I)" onClick={() => E.cmd("italic")} />
      <B icon={Underline} on={f.underline} title="Unterstrichen (Ctrl+U)" onClick={() => E.cmd("underline")} />
      <B icon={Strikethrough} on={f.strike} title="Durchgestrichen (Ctrl+Shift+X)" onClick={() => E.cmd("strikeThrough")} />
      <B icon={Subscript} on={f.sub} title="Tiefgestellt" onClick={() => E.cmd("subscript")} />
      <B icon={Superscript} on={f.sup} title="Hochgestellt" onClick={() => E.cmd("superscript")} />
      <PopBtn icon={<Marker />} title="Textmarker">{(close) => <><div className="mh">Textmarker</div><Swatches colors={HIGHLIGHTS} none onPick={(c) => { E.cmd("hiliteColor", c || "transparent"); close(); }} /></>}</PopBtn>
      <PopBtn icon={<Baseline />} title="Schriftfarbe">{(close) => <><div className="mh">Schriftfarbe</div><Swatches colors={TEXT_COLORS} onPick={(c) => { E.cmd("foreColor", c); close(); }} /></>}</PopBtn>
    </div>
    <div className="grp">
      <B icon={List} on={f.ul} title="Aufzählung (Ctrl+.)" onClick={() => E.cmd("insertUnorderedList")} />
      <B icon={ListOrdered} on={f.ol} title="Nummerierung (Ctrl+/)" onClick={() => E.cmd("insertOrderedList")} />
      <B icon={IndentDecrease} title="Einzug verkleinern (Shift+Tab)" onClick={() => E.cmd("outdent")} />
      <B icon={IndentIncrease} title="Einzug vergrössern (Tab)" onClick={() => E.cmd("indent")} />
      <B icon={AlignLeft} on={f.left} title="Linksbündig" onClick={() => E.cmd("justifyLeft")} />
      <B icon={AlignCenter} on={f.center} title="Zentriert" onClick={() => E.cmd("justifyCenter")} />
      <B icon={AlignRight} on={f.right} title="Rechtsbündig" onClick={() => E.cmd("justifyRight")} />
    </div>
    <div className="grp">
      <PopBtn label={<span style={{ minWidth: 70, textAlign: "left" }}>{style}</span>} title="Formatvorlagen" width={220}>{(close) => [
        ["h1", "Überschrift 1", { font: "700 21px var(--serif)" }], ["h2", "Überschrift 2", { font: "700 17px var(--ui)" }], ["h3", "Überschrift 3", { font: "700 15px var(--ui)" }],
        ["p", "Normal", {}], ["blockquote", "Zitat", { fontStyle: "italic" }], ["pre", "Code", { fontFamily: "var(--mono)", fontSize: 12.5 }],
      ].map(([t, n, st]) => <button key={t} className="mi" onClick={() => { E.block(t); close(); }}><span style={st}>{n}</span>{t[0] === "h" && <span className="k">Ctrl+Alt+{t[1]}</span>}</button>)}</PopBtn>
    </div>
    <div className="grp">
      <B icon={CheckSquare} label="Aufgabe" title="Aufgabe mit Kästchen (Ctrl+1)" onClick={() => E.toggleTag("todo")} />
      <PopBtn icon={<Tag />} title="Tags" width={250}>{(close) => <>
        {TAGS.map((t) => <button key={t.id} className="mi" onClick={() => { E.toggleTag(t.id); close(); }}>
          <span className="tg" data-tag={t.id} style={t.mark ? { width: 18, height: 14, background: t.mark, margin: "0 0 0 -2px" } : { margin: "0 0 0 -2px" }} />{t.name}{t.key && <span className="k">Ctrl+{t.key}</span>}</button>)}
        <div className="sep" /><button className="mi" onClick={() => { E.clearTags(); close(); }}><Trash2 />Tags entfernen<span className="k">Ctrl+0</span></button>
      </>}</PopBtn>
    </div>
    <div className="grp"><B icon={RemoveFormatting} title="Formatierung löschen" onClick={() => E.clearFormat()} /></div>
  </>;
}

function Insert() {
  const f = useFormat();
  const pic = useRef(null), file = useRef(null);
  const [hover, setHover] = useState([0, 0]);
  const stamp = (o) => E.insertText(new Date().toLocaleString("de-CH", o));
  return <>
    <div className="grp">
      <PopBtn icon={<Table />} label="Tabelle" title="Tabelle einfügen">{(close) => <>
        <div className="mh">{hover[0] ? `Tabelle ${hover[1]} × ${hover[0]}` : "Tabelle einfügen"}</div>
        <div className="tbl-grid" onMouseLeave={() => setHover([0, 0])}>
          {Array.from({ length: 48 }, (_, i) => { const r = Math.floor(i / 8) + 1, c = (i % 8) + 1; return <i key={i} className={r <= hover[0] && c <= hover[1] ? "on" : ""} onMouseEnter={() => setHover([r, c])} onClick={() => { if (!E.activeEditor()) { S.toast("Klicken Sie zuerst in eine Notiz, dann die Tabelle einfügen.", "info"); close(); return; } E.insertTable(r, c); close(); }} />; })}
        </div>
      </>}</PopBtn>
    </div>
    {f.inTable && <div className="grp">
      <B label="Zeile oben" onClick={() => E.tableOp("rowAbove")} /><B label="Zeile unten" onClick={() => E.tableOp("rowBelow")} />
      <B label="Spalte links" onClick={() => E.tableOp("colLeft")} /><B label="Spalte rechts" onClick={() => E.tableOp("colRight")} />
      <B label="Kopfzeile" onClick={() => E.tableOp("header")} />
      <B label="Zeile löschen" onClick={() => E.tableOp("delRow")} /><B label="Spalte löschen" onClick={() => E.tableOp("delCol")} />
      <B icon={Trash2} title="Tabelle löschen" onClick={() => E.tableOp("delTable")} />
    </div>}
    <div className="grp">
      <B icon={Image} label="Bild" onClick={() => pic.current.click()} />
      <B icon={Paperclip} label="Datei" title="Datei an die Seite anhängen" onClick={() => file.current.click()} />
      <input ref={pic} type="file" accept="image/*" multiple hidden onChange={(e) => { insertFiles([...e.target.files], true); e.target.value = ""; }} />
      <input ref={file} type="file" multiple hidden onChange={(e) => { insertFiles([...e.target.files], false); e.target.value = ""; }} />
    </div>
    <div className="grp">
      <B icon={Link2} label="Link" title="Link einfügen (Ctrl+K)" onClick={async () => { const u = await ask({ title: "Link einfügen", placeholder: "https://", value: "https://" }); if (u) E.cmd("createLink", /^[a-z]+:/i.test(u) ? u : "https://" + u, false); }} />
      <B icon={Minus} label="Linie" title="Waagrechte Linie" onClick={() => E.insertHtml("<hr><p><br></p>")} />
    </div>
    <div className="grp">
      <B icon={Calendar} label="Datum" onClick={() => stamp({ day: "numeric", month: "long", year: "numeric" })} />
      <B icon={Clock} label="Zeit" onClick={() => stamp({ hour: "2-digit", minute: "2-digit" })} />
      <B label="Datum und Zeit" onClick={() => stamp({ day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })} />
    </div>
  </>;
}

function Draw() {
  const mode = S.useStore((s) => s.ui.mode), pen = S.useStore((s) => s.ui.pen), hl = S.useStore((s) => s.ui.hl);
  const page = S.useStore(S.curPage);
  const conf = mode === "highlighter" ? hl : pen;
  const setConf = (patch) => S.ui((u) => (mode === "highlighter" ? { hl: { ...u.hl, ...patch } } : { pen: { ...u.pen, ...patch } }));
  const sizes = mode === "highlighter" ? [8, 14, 22] : [1.5, 3, 6];
  return <>
    <UndoGroup />
    <div className="grp">
      <B icon={MousePointer2} label="Schreiben" on={mode === "type"} title="Schreiben und auswählen (Esc)" onClick={() => S.ui({ mode: "type" })} />
      <B icon={PenLine} label="Stift" on={mode === "pen"} onClick={() => S.ui({ mode: "pen" })} />
      <B icon={Highlighter} label="Marker" on={mode === "highlighter"} onClick={() => S.ui({ mode: "highlighter" })} />
      <B icon={Eraser} label="Radierer" on={mode === "eraser"} onClick={() => S.ui({ mode: "eraser" })} />
    </div>
    {(mode === "pen" || mode === "highlighter") && <>
      <div className="grp" style={{ gap: 5 }}>
        {(mode === "highlighter" ? HL_COLORS : INK_COLORS).map((c) => <button key={c} className="sw" style={{ "--c": c, width: 22, height: 22 }} aria-pressed={conf.color === c} title={c} onClick={() => setConf({ color: c })} />)}
      </div>
      <div className="grp">
        {sizes.map((s) => <button key={s} className="ib" aria-pressed={conf.size === s} title={`Dicke ${s}`} onClick={() => setConf({ size: s })}>
          <span style={{ width: 18, height: Math.max(2, mode === "highlighter" ? s / 2.2 : s * 1.4), borderRadius: 3, background: mode === "highlighter" ? conf.color : "currentColor" }} />
        </button>)}
      </div>
    </>}
    <div className="grp"><B icon={Trash2} label="Tinte löschen" disabled={!page || !page.strokes.length} onClick={async () => { if (await confirm({ title: "Alle Striche auf dieser Seite löschen?", text: "Mit Ctrl+Z lässt sich das rückgängig machen.", ok: "Löschen", danger: true })) S.removeStrokes(page.id, page.strokes.map((s) => s.id)); }} /></div>
  </>;
}

function View() {
  const page = S.useStore(S.curPage);
  const st = S.useStore((s) => s.settings);
  const [menu, , openAt] = useMenu();
  const ruleRef = useRef(null);
  return <>
    <div className="grp">
      <PopBtn icon={<span className="sw" style={{ "--c": page && page.bg && page.bg.color || "#fff", width: 16, height: 16 }} />} label="Seitenfarbe">{(close) => <Swatches colors={PAGE_COLORS} value={page && page.bg && page.bg.color || ""} onPick={(c) => { page && S.setBg(page.id, { color: c }); close(); }} />}</PopBtn>
      <button ref={ruleRef} className="ib lbl" onClick={() => openAt(ruleRef.current.getBoundingClientRect(), RULES.map((r) => ({ label: r.name + (page && (page.bg && page.bg.rule || "") === r.id ? "  ✓" : ""), onClick: () => page && S.setBg(page.id, { rule: r.id }) })))}><Grid3x3 />Linien<ChevronDown style={{ width: 12, height: 12 }} /></button>
    </div>
    <div className="grp">
      <B icon={Minus} title="Verkleinern" onClick={() => S.setting({ zoom: Math.max(0.5, +(st.zoom - 0.1).toFixed(2)) })} />
      <B label={`${Math.round(st.zoom * 100)}%`} title="Zurück auf 100 %" onClick={() => S.setting({ zoom: 1 })} />
      <B icon={Plus} title="Vergrössern" onClick={() => S.setting({ zoom: Math.min(2.5, +(st.zoom + 0.1).toFixed(2)) })} />
    </div>
    <div className="grp">
      <B icon={st.fullPage ? Minimize2 : Maximize2} label={st.fullPage ? "Listen zeigen" : "Ganze Seite"} title="Nur die Seite zeigen (F11)" onClick={() => S.setting({ fullPage: !st.fullPage })} />
    </div>
    <div className="grp">
      <B icon={Eye} label="Dunkle Seiten" on={st.darkPages !== false} title="Im dunklen Modus auch die Seiten dunkel zeigen" onClick={() => S.setting({ darkPages: st.darkPages === false })} />
    </div>
    <div className="grp"><B icon={Printer} label="Drucken / PDF" title="Seite drucken oder als PDF sichern" onClick={() => printPage()} /></div>
    {menu}
  </>;
}
export { Type };
