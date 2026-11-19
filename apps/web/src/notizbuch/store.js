// Zustand des Kursnotizbuchs. Aufbau (Bereiche, Abschnitte, Seitenliste) kommt vom Server; Seiteninhalte werden
// beim Öffnen geladen, lokal bearbeitet und kurz danach gespeichert (mit Versionsnummer gegen Überschreiben).
import { produce, setAutoFreeze } from "immer";
import { useSyncExternalStore } from "react";
import { api } from "../api.js";
import { pageText, uid as neueId } from "./model.js";

setAutoFreeze(false);

const LS = "rescool-notizbuch";
const gespeichert = (() => { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } })();

let state = {
  uid: null, buch: null, fehler: null,
  sel: { bereich: null, secId: null, pageId: null },
  seiten: {},
  settings: { zoom: 1, fullPage: false, darkPages: true, ...(gespeichert.settings || {}) },
  ui: { mode: "type", pen: { color: "#1D2130", size: 3 }, hl: { color: "#FFE94D", size: 14 }, panel: null, tab: "home", toast: null, saved: true, focusTitle: 0, flash: null, contentRev: 0, theme: "light" },
};
const subs = new Set();
export const get = () => state;
export const subscribe = (f) => { subs.add(f); return () => subs.delete(f); };
export const useStore = (sel) => useSyncExternalStore(subscribe, () => sel(state));
export function set(recipe) {
  const next = produce(state, recipe);
  if (next === state) return;
  const settingsGeaendert = next.settings !== state.settings;
  state = next;
  if (settingsGeaendert) try { localStorage.setItem(LS, JSON.stringify({ settings: state.settings, letzte: gespeichert.letzte })); } catch { /* privat */ }
  subs.forEach((f) => f());
}
export const ui = (patch) => set((s) => { Object.assign(s.ui, typeof patch === "function" ? patch(s.ui) : patch); });
export const setting = (patch) => set((s) => { Object.assign(s.settings, patch); });
let toastTimer;
export function toast(text, kind = "info", ms = 3400) {
  clearTimeout(toastTimer);
  ui({ toast: { text, kind, id: neueId() } });
  toastTimer = setTimeout(() => ui({ toast: null }), ms);
}

/* ---------- Aufbau ---------- */
export const bereichKey = (b) => (b.bereich === "schueler" ? `schueler:${b.besitzer_id}` : b.bereich);
export const curBereich = (s = state) => (s.buch ? s.buch.bereiche.find((b) => bereichKey(b) === s.sel.bereich) || null : null);
export function walk(list, fn, depth = 0, parent = null) {
  for (let i = 0; i < list.length; i++) {
    const n = list[i];
    if (fn(n, list, i, depth, parent)) return true;
    if (n.art === "gruppe" && walk(n.kinder, fn, depth + 1, n)) return true;
  }
  return false;
}
export function findNode(id, s = state) {
  if (!s.buch) return null;
  for (const b of s.buch.bereiche) {
    let out = null;
    walk(b.abschnitte, (n, list, i, depth, parent) => { if (n.id === id) { out = { node: n, list, i, bereich: b, parent }; return true; } return false; });
    if (out) return out;
  }
  return null;
}
export const allSections = (b) => { const out = []; if (b) walk(b.abschnitte, (n) => { if (n.art === "abschnitt") out.push(n); }); return out; };
export const curSec = (s = state) => { const f = s.sel.secId && findNode(s.sel.secId, s); return f && f.node.art === "abschnitt" ? f.node : null; };
export const curMeta = (s = state) => { const sec = curSec(s); return sec ? sec.seiten.find((p) => p.id === s.sel.pageId) || null : null; };
export const curPage = (s = state) => (s.sel.pageId ? s.seiten[s.sel.pageId] || null : null);
export const schreibbar = (s = state) => { const b = curBereich(s); return !!(b && b.schreiben); };

export async function laden(uid, behalten = true) {
  try {
    const buch = await api(`/api/notizbuch/${uid}`);
    set((s) => { s.uid = uid; s.buch = buch; s.fehler = null; });
    if (!buch.erlaubt) return buch;
    if (behalten && state.sel.bereich && curBereich()) { // Auswahl gilt noch?
      if (!curSec()) waehleBereich(state.sel.bereich);
      else if (!curMeta()) waehleAbschnitt(state.sel.secId);
      return buch;
    }
    const l = (gespeichert.letzte || {})[uid];
    const f = l && l.secId && findNode(l.secId);
    if (f) { set((s) => { s.sel.bereich = bereichKey(f.bereich); }); waehleAbschnitt(l.secId, l.pageId); }
    else {
      const start = buch.bereiche.find((b) => b.bereich === "schueler" && b.besitzer_id && buch.rolle === "sch") || buch.bereiche[0];
      waehleBereich(bereichKey(start));
    }
    return buch;
  } catch (e) { set((s) => { s.fehler = e; }); throw e; }
}

function merke() {
  gespeichert.letzte = { ...(gespeichert.letzte || {}), [state.uid]: { secId: state.sel.secId, pageId: state.sel.pageId } };
  try { localStorage.setItem(LS, JSON.stringify({ settings: state.settings, letzte: gespeichert.letzte })); } catch { /* privat */ }
}

export function waehleBereich(key) {
  set((s) => { s.sel.bereich = key; s.sel.secId = null; s.sel.pageId = null; });
  const sec = allSections(curBereich())[0];
  if (sec) waehleAbschnitt(sec.id);
}
export function waehleAbschnitt(secId, pageId) {
  const f = findNode(secId); if (!f || f.node.art !== "abschnitt") return;
  const p = f.node.seiten.find((x) => x.id === pageId) || f.node.seiten[0];
  set((s) => { s.sel.bereich = bereichKey(f.bereich); s.sel.secId = secId; s.sel.pageId = p ? p.id : null; });
  if (p) seiteOeffnen(p.id);
  merke();
}
export function selectPage(pageId) {
  for (const b of state.buch.bereiche) for (const sec of allSections(b)) if (sec.seiten.some((p) => p.id === pageId)) {
    set((s) => { s.sel.bereich = bereichKey(b); s.sel.secId = sec.id; s.sel.pageId = pageId; });
    seiteOeffnen(pageId); merke(); return;
  }
}

/* ---------- Seiteninhalt ---------- */
const zuSheaf = (d, meta) => ({ id: d.id, title: d.titel, level: d.ebene, created: d.erstellt_am, modified: d.geaendert_am,
  bg: (d.inhalt && d.inhalt.bg) || {}, items: (d.inhalt && d.inhalt.items) || [], strokes: (d.inhalt && d.inhalt.strokes) || [], version: d.version, schreiben: d.schreiben, sec: d.abschnitt_id });
export async function seiteOeffnen(id, neu = false) {
  if (state.seiten[id] && !neu) return;
  try {
    const d = await api(`/api/notizbuch/seiten/${id}`);
    set((s) => { s.seiten[id] = zuSheaf(d); });
    if (neu) ui((u) => ({ contentRev: u.contentRev + 1 }));
  } catch (e) { toast(e.message, "error"); }
}

/* ---------- Speichern ---------- */
const dirty = new Set(); let timer = null;
function vormerken(id) {
  dirty.add(id); clearTimeout(timer);
  if (state.ui.saved) ui({ saved: false });
  timer = setTimeout(speichern, 800);
}
export async function speichern() {
  clearTimeout(timer);
  const ids = [...dirty]; dirty.clear();
  for (const id of ids) {
    const p = state.seiten[id]; if (!p) continue;
    try {
      const r = await api(`/api/notizbuch/seiten/${id}`, { methode: "PUT", daten: { titel: p.title, inhalt: { items: p.items, strokes: p.strokes, bg: p.bg }, text: pageText(p), version: p.version } });
      set((s) => { if (s.seiten[id]) { s.seiten[id].version = r.version; s.seiten[id].modified = r.geaendert_am; } metaAendern(s, id, { titel: p.title, geaendert_am: r.geaendert_am, vorschau: pageText(p).replace(/\s+/g, " ").slice(0, 120) }); });
    } catch (e) {
      if (e.status === 409) { toast("Jemand anderes hat diese Seite gerade geändert. Sie sehen jetzt den neuesten Stand.", "error", 5000); await seiteOeffnen(id, true); }
      else { dirty.add(id); toast("Nicht gespeichert: " + e.message, "error"); }
    }
  }
  if (!dirty.size) ui({ saved: true });
}
if (typeof window !== "undefined") window.addEventListener("beforeunload", (e) => { if (dirty.size) { speichern(); e.preventDefault(); } });
function metaAendern(s, id, patch) {
  if (!s.buch) return;
  for (const b of s.buch.bereiche) walk(b.abschnitte, (n) => { if (n.seiten) { const m = n.seiten.find((x) => x.id === id); if (m) { Object.assign(m, patch); return true; } } return false; });
}
function editPage(id, fn) {
  set((s) => { const p = s.seiten[id]; if (!p) return; fn(p); p.modified = new Date().toISOString(); });
  vormerken(id);
}
export const findPage = (id) => (state.seiten[id] ? { page: state.seiten[id] } : null);
export function updatePage(id, patch) {
  editPage(id, (p) => Object.assign(p, patch));
  if (patch.title !== undefined) set((s) => metaAendern(s, id, { titel: patch.title }));
}

/* ---------- Rückgängig (Anordnung, Bilder, Tinte) ---------- */
const history = new Map();
const snap = (p) => JSON.stringify({ items: p.items, strokes: p.strokes, bg: p.bg });
export function checkpoint(id) {
  const p = state.seiten[id]; if (!p) return;
  const h = history.get(id) || { past: [], future: [] };
  const sn = snap(p);
  if (h.past[h.past.length - 1] !== sn) h.past.push(sn);
  if (h.past.length > 100) h.past.shift();
  h.future = []; history.set(id, h);
}
export function undo(id, redo = false) {
  const h = history.get(id), p = state.seiten[id];
  if (!h || !p) return false;
  const from = redo ? h.future : h.past, to = redo ? h.past : h.future;
  if (!from.length) return false;
  to.push(snap(p));
  const d = JSON.parse(from.pop());
  editPage(id, (x) => { x.items = d.items; x.strokes = d.strokes; x.bg = d.bg; });
  ui((u) => ({ contentRev: u.contentRev + 1 }));
  return true;
}
export function addItem(id, item, hist = true) { if (hist) checkpoint(id); editPage(id, (p) => { p.items.push(item); }); }
export function updateItem(id, itemId, patch, hist = false) { if (hist) checkpoint(id); editPage(id, (p) => { const it = p.items.find((x) => x.id === itemId); if (it) Object.assign(it, patch); }); }
export function removeItem(id, itemId, hist = true) { if (hist) checkpoint(id); editPage(id, (p) => { p.items = p.items.filter((x) => x.id !== itemId); }); }
export function itemToBack(id, itemId) { checkpoint(id); editPage(id, (p) => { const i = p.items.findIndex((x) => x.id === itemId); if (i > 0) { const [x] = p.items.splice(i, 1); p.items.unshift(x); } }); }
export function addStroke(id, stroke) { checkpoint(id); editPage(id, (p) => { p.strokes.push(stroke); }); }
export function removeStrokes(id, ids, hist = true) {
  if (!ids.length) return; if (hist) checkpoint(id);
  const del = new Set(ids); editPage(id, (p) => { p.strokes = p.strokes.filter((x) => !del.has(x.id)); });
}
export function setBg(id, patch) { checkpoint(id); editPage(id, (p) => { p.bg = { ...(p.bg || {}), ...patch }; }); }

/* ---------- Aufbau ändern (Server, danach neu laden) ---------- */
const neu = () => laden(state.uid);
async function tun(fn, ok) {
  try { const r = await fn(); await neu(); if (ok) toast(ok, "ok"); return r; }
  catch (e) { toast(e.message, "error"); return null; }
}
const bereichDaten = (key) => { const [bereich, besitzer_id] = key.split(":"); return { bereich, besitzer_id: besitzer_id || undefined }; };

export async function addSection(elternId, name) {
  const b = curBereich(); if (!b) return null;
  const farben = ["#3E8EED", "#4FAE6A", "#E8B931", "#E5484D", "#9B55D1", "#21A69A", "#F2994A", "#DE5FA2", "#5B5BE0", "#A57E57"];
  const r = await tun(() => api(`/api/notizbuch/${state.uid}/abschnitte`, { methode: "POST", daten: { ...bereichDaten(bereichKey(b)), art: "abschnitt", name: name || `Abschnitt ${allSections(b).length + 1}`, farbe: farben[allSections(b).length % farben.length], eltern_id: elternId || null } }));
  if (r) waehleAbschnitt(r.id);
  return r;
}
export async function addGroup(name) {
  const b = curBereich(); if (!b) return null;
  return tun(() => api(`/api/notizbuch/${state.uid}/abschnitte`, { methode: "POST", daten: { ...bereichDaten(bereichKey(b)), art: "gruppe", name: name || "Neue Gruppe" } }));
}
export const updateNode = (id, patch) => {
  set((s) => { const f = findNode(id, s); if (f) Object.assign(f.node, patch); });
  return api(`/api/notizbuch/abschnitte/${id}`, { methode: "PUT", daten: { name: patch.name, farbe: patch.farbe, offen: patch.offen } }).catch((e) => { toast(e.message, "error"); neu(); });
};
export const deleteNode = (id) => tun(() => api(`/api/notizbuch/abschnitte/${id}`, { methode: "DELETE" }), "In den Papierkorb gelegt");
/** pos: before | after | inside */
export async function moveNode(id, targetId, pos) {
  const f = findNode(id), t = targetId && findNode(targetId);
  if (!f) return;
  let eltern = null, reihenfolge;
  if (!t) { const list = f.bereich.abschnitte; reihenfolge = (list.length ? Math.max(...list.map((x) => x.reihenfolge)) : 0) + 1; }
  else if (pos === "inside" && t.node.art === "gruppe") { eltern = t.node.id; const k = t.node.kinder; reihenfolge = (k.length ? Math.max(...k.map((x) => x.reihenfolge)) : 0) + 1; }
  else {
    eltern = t.parent ? t.parent.id : null;
    const list = t.list.filter((x) => x.id !== id), i = list.findIndex((x) => x.id === targetId);
    const a = pos === "after" ? list[i] : list[i - 1], b = pos === "after" ? list[i + 1] : list[i];
    reihenfolge = a && b ? (a.reihenfolge + b.reihenfolge) / 2 : a ? a.reihenfolge + 1 : b ? b.reihenfolge - 1 : 1;
  }
  await tun(() => api(`/api/notizbuch/abschnitte/${id}`, { methode: "PUT", daten: { eltern_id: eltern, reihenfolge } }));
}

export async function addPage(opts = {}) {
  const sec = curSec(); if (!sec) return null;
  const cur = curMeta();
  let ebene = 0, reihenfolge;
  const seiten = sec.seiten;
  if (opts.after && cur) {
    let i = seiten.findIndex((x) => x.id === cur.id) + 1;
    while (i < seiten.length && seiten[i].ebene > cur.ebene) i++;
    ebene = opts.sub ? Math.min(2, cur.ebene + 1) : cur.ebene;
    const a = seiten[i - 1], b = seiten[i];
    reihenfolge = b ? (a.reihenfolge + b.reihenfolge) / 2 : a.reihenfolge + 1;
  }
  try {
    const p = await api(`/api/notizbuch/abschnitte/${sec.id}/seiten`, { methode: "POST", daten: { titel: opts.title || "", ebene, reihenfolge } });
    await neu();
    set((s) => { s.sel.pageId = p.id; s.ui.focusTitle++; });
    await seiteOeffnen(p.id); merke();
    return p;
  } catch (e) { toast(e.message, "error"); return null; }
}
export async function deletePage(id) {
  await speichern();
  const sec = curSec(); const i = sec ? sec.seiten.findIndex((x) => x.id === id) : -1;
  await tun(() => api(`/api/notizbuch/seiten/${id}`, { methode: "DELETE" }), "Seite in den Papierkorb gelegt");
  const s2 = curSec();
  if (s2 && state.sel.pageId === id) { const n = s2.seiten[Math.min(Math.max(0, i), s2.seiten.length - 1)]; set((s) => { s.sel.pageId = n ? n.id : null; }); if (n) seiteOeffnen(n.id); }
}
export async function setLevel(id, delta) {
  const sec = curSec(); if (!sec) return;
  const i = sec.seiten.findIndex((x) => x.id === id); if (i < 0) return;
  const prev = i > 0 ? sec.seiten[i - 1].ebene : -1;
  const ebene = Math.max(0, Math.min(2, Math.min(prev + 1, sec.seiten[i].ebene + delta)));
  set((s) => { const m = curSec(s).seiten[i]; m.ebene = ebene; });
  if (state.seiten[id]) set((s) => { s.seiten[id].level = ebene; });
  await api(`/api/notizbuch/seiten/${id}/ort`, { methode: "PUT", daten: { ebene } }).catch((e) => toast(e.message, "error"));
}
/** Seite (mit Unterseiten) vor eine andere Seite oder ans Ende eines Abschnitts */
export async function movePage(id, toSecId, beforeId) {
  await speichern();
  const f = findNode(toSecId); if (!f) return;
  const von = curSec();
  const quelle = von && von.seiten.some((x) => x.id === id) ? von : allSections(findNode(state.sel.secId).bereich).find((x) => x.seiten.some((y) => y.id === id));
  const i = quelle.seiten.findIndex((x) => x.id === id);
  let n = 1; while (i + n < quelle.seiten.length && quelle.seiten[i + n].ebene > quelle.seiten[i].ebene) n++;
  const gruppe = quelle.seiten.slice(i, i + n);
  if (beforeId && gruppe.some((x) => x.id === beforeId)) return;
  const ziel = f.node.seiten.filter((x) => !gruppe.some((g) => g.id === x.id));
  const j = beforeId ? ziel.findIndex((x) => x.id === beforeId) : ziel.length;
  const a = ziel[j - 1], b = ziel[j];
  const start = a ? a.reihenfolge : (b ? b.reihenfolge - 1 : 0), ende = b ? b.reihenfolge : start + n + 1;
  const basis = toSecId !== quelle.id ? gruppe[0].ebene : 0;
  try {
    for (let k = 0; k < gruppe.length; k++) {
      const vorher = k === 0 ? (a ? a.ebene : -1) : gruppe[k - 1].ebene - basis;
      const ebene = Math.max(0, Math.min(gruppe[k].ebene - basis, vorher + 1));
      await api(`/api/notizbuch/seiten/${gruppe[k].id}/ort`, { methode: "PUT", daten: { abschnitt_id: toSecId, reihenfolge: start + (ende - start) * (k + 1) / (n + 1), ebene } });
    }
    await neu();
    if (toSecId !== quelle.id) toast(`Verschoben nach «${f.node.name}»`, "ok");
  } catch (e) { toast(e.message, "error"); neu(); }
}
export async function duplicatePage(id) {
  await speichern();
  const p = state.seiten[id]; if (!p) return;
  const sec = curSec(); const i = sec.seiten.findIndex((x) => x.id === id);
  const a = sec.seiten[i], b = sec.seiten[i + 1];
  try {
    const n = await api(`/api/notizbuch/abschnitte/${sec.id}/seiten`, { methode: "POST", daten: { titel: (p.title || "Ohne Titel") + " (Kopie)", ebene: a.ebene, reihenfolge: b ? (a.reihenfolge + b.reihenfolge) / 2 : a.reihenfolge + 1 } });
    await api(`/api/notizbuch/seiten/${n.id}`, { methode: "PUT", daten: { inhalt: { items: p.items, strokes: p.strokes, bg: p.bg }, text: pageText(p) } });
    await neu(); selectPage(n.id);
  } catch (e) { toast(e.message, "error"); }
}

/* ---------- Kleinigkeiten für die übernommenen Sheaf-Bausteine ---------- */
export const curNb = () => null;
export const notebooks = () => [];
