// Small building blocks: popovers, menus, dialogs, color swatches, inline rename.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/** A floating panel next to an anchor rect ({x, y} for context menus). Closes on outside click and Escape. */
export function Pop({ at, onClose, children, className = "", keep }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: -9999, top: -9999 });
  useLayoutEffect(() => {
    const el = ref.current; if (!el || !at) return;
    const r = el.getBoundingClientRect(), W = innerWidth, H = innerHeight;
    let left = at.x ?? at.left, top = at.y ?? at.bottom + 6;
    if (left + r.width > W - 8) left = Math.max(8, (at.right ?? left) - r.width);
    if (top + r.height > H - 8) top = Math.max(8, (at.top ?? top) - r.height - 6);
    setPos({ left, top });
  }, [at]);
  useEffect(() => {
    const down = (e) => { if (ref.current && !ref.current.contains(e.target) && !(keep && keep(e))) onClose(); };
    const key = (e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    const t = setTimeout(() => document.addEventListener("pointerdown", down, true));
    document.addEventListener("keydown", key, true);
    return () => { clearTimeout(t); document.removeEventListener("pointerdown", down, true); document.removeEventListener("keydown", key, true); };
  }, [onClose]);
  return createPortal(<div ref={ref} className={"sheaf-portal pop " + className} style={pos} onContextMenu={(e) => e.preventDefault()}>{children}</div>, document.body);
}

/** Menu items: [{ label, icon, onClick, kbd, danger, disabled } | "-" | { head }] */
export function Menu({ at, items, onClose }) {
  const [hl, setHl] = useState(-1);
  const real = items.filter((x) => x && x !== "-" && !x.head && !x.disabled);
  useEffect(() => {
    const key = (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setHl((h) => (h + (e.key === "ArrowDown" ? 1 : -1) + real.length) % real.length); }
      if (e.key === "Enter" && real[hl]) { e.preventDefault(); onClose(); real[hl].onClick(); }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  });
  return <Pop at={at} onClose={onClose}>
    {items.filter(Boolean).map((it, i) => it === "-" ? <div key={i} className="sep" /> : it.head ? <div key={i} className="mh">{it.head}</div> : it.render ? <div key={i}>{it.label && <div className="mh">{it.label}</div>}{it.render}</div> :
      <button key={i} className={"mi" + (it.danger ? " danger" : "") + (real[hl] === it ? " hl" : "")} disabled={it.disabled} onClick={() => { onClose(); it.onClick(); }}>
        {it.icon ? <it.icon /> : it.swatch ? <span className="book sm" style={{ "--c": it.swatch }} /> : <span style={{ width: 16 }} />}{it.label}{it.kbd && <span className="k">{it.kbd}</span>}
      </button>)}
  </Pop>;
}

/** Hook for right-click menus: const [menu, open] = useMenu(); open(e, items) */
export function useMenu() {
  const [m, setM] = useState(null);
  const open = (e, items) => { e.preventDefault(); e.stopPropagation(); setM({ at: { x: e.clientX, y: e.clientY }, items }); };
  const openAt = (rect, items) => setM({ at: rect, items });
  const el = m && <Menu at={m.at} items={m.items} onClose={() => setM(null)} />;
  return [el, open, openAt];
}

export function Dialog({ title, onClose, children, foot, wide, icon }) {
  useEffect(() => {
    const k = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [onClose]);
  return createPortal(<div className="sheaf-portal veil" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className={"dialog" + (wide ? " wide" : "")} role="dialog" aria-label={title}>
      <div className="dlg-head">{icon}<h2>{title}</h2><button className="ib" onClick={onClose} aria-label="Schliessen"><X /></button></div>
      <div className="dlg-body">{children}</div>
      {foot && <div className="dlg-foot">{foot}</div>}
    </div>
  </div>, document.body);
}

let confirmFn = null;
/** await confirm({ title, text, ok, danger }) */
export const confirm = (o) => new Promise((res) => confirmFn && confirmFn(o, res));
export function ConfirmHost() {
  const [c, setC] = useState(null);
  useEffect(() => { confirmFn = (o, res) => setC({ ...o, res }); return () => { confirmFn = null; }; }, []);
  if (!c) return null;
  const done = (v) => { c.res(v); setC(null); };
  return <Dialog title={c.title} onClose={() => done(false)} foot={<>
    <button className="btn" onClick={() => done(false)}>Abbrechen</button>
    <button className={"btn primary"} style={c.danger ? { background: "var(--danger)", borderColor: "var(--danger)", color: "#fff" } : null} autoFocus onClick={() => done(true)}>{c.ok || "OK"}</button>
  </>}><p style={{ margin: 0 }}>{c.text}</p></Dialog>;
}

let promptFn = null;
export const ask = (o) => new Promise((res) => promptFn && promptFn(o, res));
export function PromptHost() {
  const [c, setC] = useState(null); const [v, setV] = useState("");
  useEffect(() => { promptFn = (o, res) => { setV(o.value || ""); setC({ ...o, res }); }; return () => { promptFn = null; }; }, []);
  if (!c) return null;
  const done = (val) => { c.res(val); setC(null); };
  return <Dialog title={c.title} onClose={() => done(null)} foot={<>
    <button className="btn" onClick={() => done(null)}>Abbrechen</button>
    <button className="btn primary" onClick={() => done(v.trim() || null)}>{c.ok || "OK"}</button>
  </>}>
    {c.text && <p style={{ marginTop: 0 }} className="muted">{c.text}</p>}
    <input className="field" autoFocus value={v} placeholder={c.placeholder} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") done(v.trim() || null); }} onFocus={(e) => e.target.select()} />
  </Dialog>;
}

export function Swatches({ colors, value, onPick, none }) {
  return <div className="swatches">
    {none && <button className="sw none" aria-pressed={!value} title="None" onClick={() => onPick("")} />}
    {colors.map((c) => { const v = c.v ?? c; return <button key={v || "none"} className={"sw" + (v ? "" : " none")} style={{ "--c": v }} aria-pressed={value === v} title={c.name || v} onClick={() => onPick(v)} />; })}
  </div>;
}

export function Rename({ value, onDone }) {
  const [v, setV] = useState(value);
  const ref = useRef(null);
  useEffect(() => { ref.current && (ref.current.focus(), ref.current.select()); }, []);
  const finish = (ok) => onDone(ok && v.trim() ? v.trim() : null);
  return <input ref={ref} className="rename" value={v} onChange={(e) => setV(e.target.value)} onClick={(e) => e.stopPropagation()}
    onBlur={() => finish(true)} onKeyDown={(e) => { if (e.key === "Enter") finish(true); if (e.key === "Escape") finish(false); e.stopPropagation(); }} />;
}
