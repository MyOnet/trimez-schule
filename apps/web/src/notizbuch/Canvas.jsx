// The page: title and date, free-form note boxes, pictures, attachments and ink.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { strokePath } from "./ink.js";
import { Minus, Plus } from "lucide-react";
import * as S from "./store.js";
import { assetUrl, openAsset, openUrl, saveAsset } from "./dateien.js";
import { dehydrate, hydrate, sanitize } from "./sanitize.js";
import { fmtDate, fmtSize, fmtTime, TAGS, uid } from "./model.js";
import { tableTab, toggleTag, cmd } from "./editor.js";
import { useMenu } from "./ui.jsx";
import { ask } from "./ui.jsx";

const EMPTY = "<p><br></p>";
const isEmptyHtml = (el) => !el.textContent.replace(/ /g, " ").trim() && !el.querySelector("img, table, .tg, hr");
const extOf = (n) => (String(n).match(/\.([a-z0-9]{1,8})$/i) || [, ""])[1].toLowerCase();
const IMG_EXT = /^(png|jpe?g|gif|webp|bmp|svg)$/;

export default function Canvas({ page, sec }) {
  const zoom = S.useStore((s) => s.settings.zoom);
  const mode = S.useStore((s) => s.ui.mode);
  const theme = S.useStore((s) => s.ui.theme);
  const darkPages = S.useStore((s) => s.settings.darkPages !== false);
  const rev = S.useStore((s) => s.ui.contentRev || 0);
  const flash = S.useStore((s) => s.ui.flash);
  const focusTitle = S.useStore((s) => s.ui.focusTitle);
  const [born, setBorn] = useState(null);
  const [selected, setSelected] = useState(null);
  const [active, setActive] = useState(null);
  const surface = useRef(null), scroller = useRef(null), titleRef = useRef(null);
  const ro = page.schreiben === false;
  const lastClick = useRef({ x: 48, y: 30 });
  const [menu, openMenu] = useMenu();

  const pos = (e) => { const r = surface.current.getBoundingClientRect(); return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom }; };

  // A new page gets its title focused
  useEffect(() => { if (focusTitle && titleRef.current && !page.title) titleRef.current.focus(); }, [focusTitle, page.id]);
  useEffect(() => { setSelected(null); setBorn(null); scroller.current && (scroller.current.scrollTop = 0); }, [page.id]);

  const newNote = (x, y, html = EMPTY) => {
    const it = { id: uid(), type: "text", x: Math.max(0, Math.round(x - 8)), y: Math.max(0, Math.round(y - 14)), w: 520, html };
    S.addItem(page.id, it);
    setBorn(it.id);
    return it;
  };

  const onSurfaceDown = (e) => {
    if (e.button !== 0) return;
    if (e.target !== surface.current) return;
    setSelected(null);
    if (mode !== "type" || ro) return;
    const p = pos(e); lastClick.current = p;
    e.preventDefault();
    newNote(p.x, p.y);
  };

  // Delete selected picture/file, paste outside a note box
  useEffect(() => {
    const key = (e) => {
      const t = e.target, editing = t.closest && (t.closest(".ed") || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      if (editing) return;
      if (selected && !ro && (e.key === "Delete" || e.key === "Backspace")) { e.preventDefault(); S.removeItem(page.id, selected); setSelected(null); }
    };
    const paste = async (e) => {
      const t = e.target, editing = t.closest && (t.closest(".ed") || /^(INPUT|TEXTAREA)$/.test(t.tagName));
      if (editing || !surface.current || ro) return;
      const files = [...(e.clipboardData && e.clipboardData.files || [])];
      e.preventDefault();
      if (files.length) { await dropFiles(files, lastClick.current); return; }
      const html = e.clipboardData.getData("text/html"), text = e.clipboardData.getData("text/plain");
      if (html) newNote(lastClick.current.x, lastClick.current.y, sanitize(html) || EMPTY);
      else if (text) newNote(lastClick.current.x, lastClick.current.y, text.split(/\r?\n/).map((l) => `<p>${l.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])) || "<br>"}</p>`).join(""));
    };
    document.addEventListener("keydown", key); document.addEventListener("paste", paste);
    return () => { document.removeEventListener("keydown", key); document.removeEventListener("paste", paste); };
  }, [selected, page.id, zoom]);

  const dropFiles = async (files, p) => {
    let y = p.y;
    for (const f of files) {
      const ext = extOf(f.name) || (f.type.split("/")[1] || "bin");
      let name;
      try { name = await saveAsset(f, ext, f.name); } catch (e) { S.toast(`${f.name}: ${e.message}`, "error", 5000); continue; }
      if (IMG_EXT.test(ext) || f.type.startsWith("image/")) {
        const dim = await imageSize(assetUrl(name));
        const w = Math.min(dim.w || 400, 640), h = dim.w ? Math.round(dim.h * w / dim.w) : null;
        S.addItem(page.id, { id: uid(), type: "image", x: Math.round(p.x), y: Math.round(y), w, h, asset: name, alt: f.name });
        y += (h || 300) + 16;
      } else {
        S.addItem(page.id, { id: uid(), type: "file", x: Math.round(p.x), y: Math.round(y), asset: name, name: f.name, size: f.size });
        y += 70;
      }
    }
  };
  useEffect(() => {
    const h = (e) => {
      let y = 30; for (const it of page.items) y = Math.max(y, it.y + (it.h || 80));
      dropFiles(e.detail, lastClick.current.y > 30 ? lastClick.current : { x: 48, y: y + 24 });
    };
    window.addEventListener("sheaf:files", h);
    return () => window.removeEventListener("sheaf:files", h);
  });
  const onDrop = async (e) => {
    if (!e.dataTransfer || !e.dataTransfer.files.length) return;
    e.preventDefault(); e.stopPropagation();
    if (ro) { S.toast("Hier dürfen Sie nur lesen.", "info"); return; }
    await dropFiles([...e.dataTransfer.files], pos(e));
  };

  // Search: highlight matches and scroll to the first one
  useEffect(() => {
    if (!flash || flash.pageId !== page.id || !surface.current) return;
    const t = setTimeout(() => {
      const q = flash.query.toLowerCase(); if (!q) return;
      const ranges = []; let first = null;
      surface.current.querySelectorAll(".ed").forEach((ed) => {
        const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) {
          const v = n.nodeValue.toLowerCase(); let i = v.indexOf(q);
          while (i >= 0) { const r = new Range(); r.setStart(n, i); r.setEnd(n, i + q.length); ranges.push(r); if (!first) first = n.parentElement; i = v.indexOf(q, i + q.length); }
        }
      });
      if (window.CSS && CSS.highlights && window.Highlight) CSS.highlights.set("sheaf-find", new Highlight(...ranges));
      if (first) first.scrollIntoView({ block: "center", behavior: "smooth" });
      else if (flash.query && titleRef.current) titleRef.current.scrollIntoView({ block: "center" });
    }, 120);
    const clear = setTimeout(() => { if (window.CSS && CSS.highlights) CSS.highlights.delete("sheaf-find"); }, 6000);
    return () => { clearTimeout(t); clearTimeout(clear); };
  }, [flash, page.id]);

  const extent = useMemo(() => {
    let w = 0, h = 0;
    for (const it of page.items) { w = Math.max(w, it.x + (it.w || 280)); h = Math.max(h, it.y + (it.h || 200)); }
    for (const s of page.strokes) for (const p of s.points) { if (p[0] > w) w = p[0]; if (p[1] > h) h = p[1]; }
    return { w: w + 240, h: h + 420 };
  }, [page.items, page.strokes]);

  const itemMenu = (e, it) => openMenu(e, [
    { label: "Nach vorne", onClick: () => { S.removeItem(page.id, it.id); S.addItem(page.id, { ...it }, false); } },
    { label: "Nach hinten", onClick: () => S.itemToBack(page.id, it.id) },
    { label: "Duplizieren", onClick: () => S.addItem(page.id, { ...JSON.parse(JSON.stringify(it)), id: uid(), x: it.x + 24, y: it.y + 24 }) },
    it.type === "image" && { label: "Bildbeschreibung …", onClick: async () => { const v = await ask({ title: "Bild beschreiben", value: it.alt, text: "Wird von Bildschirmlesern vorgelesen und von der Suche gefunden." }); if (v != null) S.updateItem(page.id, it.id, { alt: v }, true); } },
    it.type !== "text" && { label: "Öffnen", onClick: () => openAsset(it.asset, it.name || it.alt || "bild") },
    "-",
    { label: "Löschen", danger: true, onClick: () => S.removeItem(page.id, it.id) },
  ]);

  const dark = theme === "dark" && darkPages;
  return <div className="stage" data-mode={mode}>
    <div className="stage-scroll scroll" ref={scroller} onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); e.stopPropagation(); } }} onDrop={onDrop}>
      <div className="paper-wrap">
        <div className={"paper page-anim" + (dark ? " dark-page" : "")} key={page.id} data-rule={page.bg && page.bg.rule || undefined}
          style={{ zoom, background: page.bg && page.bg.color || undefined, minWidth: `calc(${100 / zoom}% )`, width: extent.w, minHeight: `calc(${100 / zoom}%)` }}>
          <header className="page-head" style={{ "--sec": sec.color }}>
            <input ref={titleRef} className="page-title" value={page.title} placeholder="Seite ohne Titel" readOnly={ro} spellCheck
              onChange={(e) => S.updatePage(page.id, { title: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter" || (e.key === "ArrowDown")) { e.preventDefault(); const first = page.items.find((x) => x.type === "text"); if (first) { const ed = surface.current.querySelector(`[data-id="${first.id}"] .ed`); ed && ed.focus(); } else newNote(56, 30); } }} />
            <div className="page-date"><span>{fmtDate(page.created)}</span><span>{fmtTime(page.created)}</span></div>
          </header>
          <div className="surface" ref={surface} onPointerDown={onSurfaceDown} style={{ minHeight: extent.h }}>
            {page.items.map((it) => it.type === "text"
              ? <TextNote key={it.id + ":" + rev} it={it} pageId={page.id} zoom={zoom} ro={ro} born={born === it.id} active={active === it.id} setActive={setActive} onMenu={itemMenu} />
              : it.type === "image"
                ? <Picture key={it.id} it={it} pageId={page.id} zoom={zoom} ro={ro} on={selected === it.id} select={setSelected} onMenu={itemMenu} />
                : <FileChip key={it.id} it={it} pageId={page.id} zoom={zoom} ro={ro} on={selected === it.id} select={setSelected} onMenu={itemMenu} />)}
            <Ink page={page} mode={ro ? "type" : mode} zoom={zoom} surface={surface} />
          </div>
        </div>
      </div>
    </div>
    <div className="zoom">
      <button className="ib" title="Verkleinern (Ctrl −)" onClick={() => S.setting({ zoom: Math.max(0.5, +(zoom - 0.1).toFixed(2)) })}><Minus /></button>
      <span title="Zurück auf 100 %" onClick={() => S.setting({ zoom: 1 })}>{Math.round(zoom * 100)}%</span>
      <button className="ib" title="Vergrössern (Ctrl +)" onClick={() => S.setting({ zoom: Math.min(2.5, +(zoom + 0.1).toFixed(2)) })}><Plus /></button>
    </div>
    {menu}
  </div>;
}

function imageSize(src) {
  return new Promise((res) => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => res({}); i.src = src; });
}

/** Moving with the grip, resizing with a handle. */
function useDrag(onMove, onEnd) {
  return useCallback((e) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const sx = e.clientX, sy = e.clientY; let moved = false;
    const mv = (ev) => { const dx = ev.clientX - sx, dy = ev.clientY - sy; if (Math.abs(dx) + Math.abs(dy) > 2) moved = true; onMove(dx, dy, ev); };
    const up = (ev) => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); onEnd(ev.clientX - sx, ev.clientY - sy, moved); };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  }, [onMove, onEnd]);
}

const TextNote = memo(function TextNote({ it, pageId, zoom, born, active, setActive, onMenu, ro }) {
  const box = useRef(null), ed = useRef(null), last = useRef(it.html), timer = useRef(null);
  useLayoutEffect(() => {
    ed.current.innerHTML = hydrate(it.html || EMPTY); last.current = it.html;
    if (born) { ed.current.focus(); placeCaretEnd(ed.current); }
  }, []);
  useEffect(() => { // changed from outside (undo, import)
    if (it.html !== last.current && document.activeElement !== ed.current) { ed.current.innerHTML = hydrate(it.html || EMPTY); last.current = it.html; }
  }, [it.html]);
  const save = () => {
    clearTimeout(timer.current);
    if (!ed.current) return;
    const html = dehydrate(ed.current.innerHTML);
    if (html !== last.current) { last.current = html; S.updateItem(pageId, it.id, { html }); }
  };
  const onInput = () => { clearTimeout(timer.current); timer.current = setTimeout(save, 350); };
  useEffect(() => () => { clearTimeout(timer.current); }, []);

  const move = useDrag(
    (dx, dy) => { box.current.style.transform = `translate(${dx / zoom}px, ${dy / zoom}px)`; },
    (dx, dy, moved) => { box.current.style.transform = ""; if (moved) S.updateItem(pageId, it.id, { x: Math.max(0, Math.round(it.x + dx / zoom)), y: Math.max(0, Math.round(it.y + dy / zoom)) }, true); else ed.current.focus(); });
  const resize = useDrag(
    (dx) => { box.current.style.width = Math.max(120, it.w + dx / zoom) + "px"; },
    (dx, dy, moved) => { if (moved) S.updateItem(pageId, it.id, { w: Math.max(120, Math.round(it.w + dx / zoom)) }, true); });

  const onBlur = () => {
    save(); setActive(null);
    setTimeout(() => { if (ed.current && document.activeElement !== ed.current && isEmptyHtml(ed.current)) S.removeItem(pageId, it.id, false); }, 0);
  };
  const onClick = (e) => {
    const tg = e.target.closest(".tg");
    if (tg && /^(todo|p1|p2)$/.test(tg.dataset.tag)) {
      if (tg.dataset.done === "1") delete tg.dataset.done; else tg.dataset.done = "1";
      tg.animate([{ transform: "scale(.8)" }, { transform: "scale(1.12)" }, { transform: "scale(1)" }], { duration: 260, easing: "ease-out" });
      save(); return;
    }
    const a = e.target.closest("a[href]");
    if (a && (e.ctrlKey || e.metaKey)) { e.preventDefault(); openUrl(a.href).catch(() => {}); }
  };
  const onKeyDown = (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === "Tab") { e.preventDefault(); if (!tableTab(e)) document.execCommand(e.shiftKey ? "outdent" : "indent"); return; }
    if (e.key === "Escape") { ed.current.blur(); return; }
    if (mod && !e.shiftKey && !e.altKey && /^[0-9]$/.test(e.key)) {
      e.preventDefault();
      if (e.key === "0") { import("./editor.js").then((m) => m.clearTags()); return; }
      const t = TAGS.find((x) => x.key === e.key); if (t) toggleTag(t.id); return;
    }
    if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); ask({ title: "Link einfügen", placeholder: "https://", value: "https://" }).then((u) => { if (u) cmd("createLink", /^[a-z]+:/i.test(u) ? u : "https://" + u, false); }); return; }
    if (mod && e.key === ".") { e.preventDefault(); document.execCommand("insertUnorderedList"); return; }
    if (mod && e.key === "/") { e.preventDefault(); document.execCommand("insertOrderedList"); return; }
    if (mod && e.shiftKey && e.key.toLowerCase() === "x") { e.preventDefault(); document.execCommand("strikeThrough"); return; }
    if (mod && e.altKey && /^[1-3]$/.test(e.key)) { e.preventDefault(); document.execCommand("formatBlock", false, `<h${e.key}>`); return; }
  };
  const onPaste = async (e) => {
    const files = [...(e.clipboardData.files || [])].filter((f) => f.type.startsWith("image/"));
    e.preventDefault(); e.stopPropagation();
    if (files.length) {
      for (const f of files) { const n = await saveAsset(f, f.type.split("/")[1]); document.execCommand("insertHTML", false, `<img data-asset="${n}" src="${assetUrl(n)}" alt="">`); }
      return;
    }
    const html = e.clipboardData.getData("text/html");
    if (html) {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const imgs = [...doc.querySelectorAll("img")];
      for (const img of imgs) {
        const src = img.getAttribute("src") || "";
        if (/^(data|blob):/.test(src)) {
          try { const b = await (await fetch(src)).blob(); img.setAttribute("data-asset", await saveAsset(b, b.type.split("/")[1] || "png")); } catch { /* skip */ }
        }
      }
      const clean = hydrate(sanitize(doc.body.innerHTML));
      if (clean) { document.execCommand("insertHTML", false, clean); return; }
    }
    const text = e.clipboardData.getData("text/plain");
    if (text) document.execCommand("insertText", false, text);
  };

  return <div ref={box} data-id={it.id} className={"note" + (born ? " born" : "") + (active ? " active" : "")} style={{ left: it.x, top: it.y, width: it.w }}
    onContextMenu={(e) => { if (!ro && e.target.closest(".grip")) onMenu(e, it); }}>
    {!ro && <div className="grip" onPointerDown={move} title="Ziehen zum Verschieben, Rechtsklick für mehr" />}
    <div ref={ed} className="ed" contentEditable={!ro} suppressContentEditableWarning spellCheck
      onInput={onInput} onBlur={onBlur} onFocus={() => setActive(it.id)} onClick={onClick} onKeyDown={onKeyDown} onPaste={onPaste}
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); e.stopPropagation(); } }}
      onDrop={async (e) => {
        const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
        if (!files.length) return;
        e.preventDefault(); e.stopPropagation();
        ed.current.focus();
        const r = document.caretRangeFromPoint && document.caretRangeFromPoint(e.clientX, e.clientY);
        if (r) { const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
        for (const f of files) { const n = await saveAsset(f, f.type.split("/")[1]); document.execCommand("insertHTML", false, `<img data-asset="${n}" src="${assetUrl(n)}" alt="">`); }
      }} />
    {!ro && <div className="rz" onPointerDown={resize} />}
  </div>;
});

function placeCaretEnd(el) {
  const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
}

function Picture({ it, pageId, zoom, on, select, onMenu, ro }) {
  const box = useRef(null);
  const [ratio, setRatio] = useState(it.h ? it.h / it.w : null);
  const move = useDrag(
    (dx, dy) => { box.current.style.transform = `translate(${dx / zoom}px, ${dy / zoom}px)`; },
    (dx, dy, moved) => { box.current.style.transform = ""; if (moved) S.updateItem(pageId, it.id, { x: Math.max(0, Math.round(it.x + dx / zoom)), y: Math.max(0, Math.round(it.y + dy / zoom)) }, true); });
  const resize = useDrag(
    (dx) => { const w = Math.max(40, it.w + dx / zoom); box.current.style.width = w + "px"; if (ratio) box.current.style.height = w * ratio + "px"; },
    (dx, dy, moved) => { if (moved) { const w = Math.max(40, Math.round(it.w + dx / zoom)); S.updateItem(pageId, it.id, { w, h: ratio ? Math.round(w * ratio) : it.h }, true); } });
  return <div ref={box} className={"pic" + (on ? " on" : "") + (it.printout ? " printout" : "")} style={{ left: it.x, top: it.y, width: it.w, height: it.h || (ratio ? it.w * ratio : undefined) }}
    onPointerDown={(e) => { if (e.button === 0 && !ro) { select(it.id); move(e); } }} onContextMenu={(e) => { if (ro) return; select(it.id); onMenu(e, it); }}
    onDoubleClick={() => openAsset(it.asset, it.alt || "bild")}>
    <img src={assetUrl(it.asset)} alt={it.alt || ""} draggable={false}
      onLoad={(e) => { const r = e.target.naturalHeight / e.target.naturalWidth; if (!ratio || !it.h) { setRatio(r); if (!it.h) S.updateItem(pageId, it.id, { h: Math.round(it.w * r) }); } }} />
    {on && !ro && <div className="h" onPointerDown={resize} />}
  </div>;
}

const FILE_COLORS = { pdf: "#E5484D", doc: "#2F6FDB", docx: "#2F6FDB", xls: "#2F9A50", xlsx: "#2F9A50", csv: "#2F9A50", ppt: "#E2761C", pptx: "#E2761C", zip: "#7A8296", mp3: "#9441C7", wav: "#9441C7", m4a: "#9441C7", mp4: "#C93E87", txt: "#5B6478" };
function FileChip({ it, pageId, zoom, on, select, onMenu, ro }) {
  const box = useRef(null); const ext = extOf(it.name || it.asset);
  const move = useDrag(
    (dx, dy) => { box.current.style.transform = `translate(${dx / zoom}px, ${dy / zoom}px)`; },
    (dx, dy, moved) => { box.current.style.transform = ""; if (moved) S.updateItem(pageId, it.id, { x: Math.max(0, Math.round(it.x + dx / zoom)), y: Math.max(0, Math.round(it.y + dy / zoom)) }, true); });
  return <div ref={box} className={"file" + (on ? " on" : "")} style={{ left: it.x, top: it.y }} title="Doppelklick zum Öffnen"
    onPointerDown={(e) => { if (e.button === 0) { select(it.id); if (!ro) move(e); } }} onContextMenu={(e) => { if (ro) return; select(it.id); onMenu(e, it); }}
    onDoubleClick={() => openAsset(it.asset, it.name).catch((x) => S.toast(String(x), "error"))}>
    <span className="ic" style={{ "--fc": FILE_COLORS[ext] }}>{(ext || "file").toUpperCase().slice(0, 4)}</span>
    <span style={{ minWidth: 0 }}><b>{it.name}</b><small>{fmtSize(it.size)}{it.size != null ? " · " : ""}Doppelklick zum Öffnen</small></span>
  </div>;
}

// ---------- ink ----------
function Ink({ page, mode, zoom, surface }) {
  const pen = S.useStore((s) => s.ui.pen), hl = S.useStore((s) => s.ui.hl);
  const [live, setLive] = useState(null);
  const [ring, setRing] = useState(null);
  const drawing = mode === "pen" || mode === "highlighter";
  const live_ = drawing || mode === "eraser";
  const pt = (e) => { const r = surface.current.getBoundingClientRect(); return [+((e.clientX - r.left) / zoom).toFixed(1), +((e.clientY - r.top) / zoom).toFixed(1), e.pointerType === "pen" ? +(e.pressure || 0.5).toFixed(2) : 0.5]; };

  const erase = (p, r) => {
    const hit = [];
    for (const s of page.strokes) {
      const rr = r + s.size / 2;
      if (s.points.some((q) => Math.abs(q[0] - p[0]) < rr && Math.abs(q[1] - p[1]) < rr && Math.hypot(q[0] - p[0], q[1] - p[1]) < rr)) hit.push(s.id);
    }
    return hit;
  };

  const down = (e) => {
    if (!live_ || e.button !== 0) return;
    e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
    if (mode === "eraser") { S.checkpoint(page.id); const h = erase(pt(e), 10); S.removeStrokes(page.id, h, false); return; }
    const conf = mode === "pen" ? pen : hl;
    setLive({ id: uid(), tool: mode, color: conf.color, size: conf.size, pressure: e.pointerType === "pen", points: [pt(e)] });
  };
  const move = (e) => {
    if (mode === "eraser") {
      const p = pt(e); setRing({ x: p[0], y: p[1] });
      if (e.buttons & 1) S.removeStrokes(page.id, erase(p, 10), false);
      return;
    }
    if (!live) return;
    const evs = e.nativeEvent.getCoalescedEvents ? e.nativeEvent.getCoalescedEvents() : [e];
    setLive((l) => l && { ...l, points: [...l.points, ...evs.map(pt)] });
  };
  const up = () => {
    if (live && live.points.length > 0) {
      const s = { ...live, points: live.points.length === 1 ? [live.points[0], [live.points[0][0] + 0.1, live.points[0][1] + 0.1, live.points[0][2]]] : live.points };
      S.addStroke(page.id, s);
    }
    setLive(null);
  };

  const strokes = live ? [...page.strokes, live] : page.strokes;
  return <>
    <svg className={"ink" + (live_ ? " live" : "")} width="100%" height="100%" style={{ width: "100%", height: "100%" }}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={() => setRing(null)}>
      {strokes.map((s) => <path key={s.id} d={strokePath(s)} fill={s.color} className={s.tool === "highlighter" ? "ink-hl" : ""} opacity={s.tool === "highlighter" ? 0.45 : 1} />)}
    </svg>
    {mode === "eraser" && ring && <div className="eraser-ring" style={{ left: ring.x - 10, top: ring.y - 10, width: 20, height: 20 }} />}
  </>;
}
