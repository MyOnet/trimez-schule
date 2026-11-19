// Shapes of the data and small helpers.
//
// Notebook { id, name, color, created, modified, source?, sections: [Section | Group] }
// Group    { id, kind: "group", name, children: [Section | Group], open }
// Section  { id, kind: "section", name, color, pages: [Page] }
// Page     { id, title, level (0–2), created, modified, bg: { color, rule }, items: [Item], strokes: [Stroke] }
// Item     text:  { id, type: "text",  x, y, w, html }
//          image: { id, type: "image", x, y, w, h, asset, alt }
//          file:  { id, type: "file",  x, y, asset, name, size }
// Stroke   { id, tool: "pen" | "highlighter", color, size, points: [[x, y, pressure]] }

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
export const now = () => new Date().toISOString();

export const COLORS = [
  { name: "Poppy", v: "#E5484D" }, { name: "Tangerine", v: "#F2994A" }, { name: "Mustard", v: "#E8B931" },
  { name: "Fern", v: "#4FAE6A" }, { name: "Lagoon", v: "#21A69A" }, { name: "Sky", v: "#3E8EED" },
  { name: "Indigo", v: "#5B5BE0" }, { name: "Plum", v: "#9B55D1" }, { name: "Rose", v: "#DE5FA2" },
  { name: "Slate", v: "#7C889C" }, { name: "Walnut", v: "#A57E57" }, { name: "Graphite", v: "#4A5263" },
];
export const pickColor = (i) => COLORS[((i % COLORS.length) + COLORS.length) % COLORS.length].v;

export const PAGE_COLORS = [
  { name: "Keine", v: "" }, { name: "Nebel", v: "#EEF3FB" }, { name: "Minze", v: "#EAF6EE" }, { name: "Butter", v: "#FBF6E2" },
  { name: "Rosa", v: "#FBECEE" }, { name: "Flieder", v: "#F2EEFB" }, { name: "Sand", v: "#F4F0EA" }, { name: "Wolke", v: "#F1F2F4" },
];
export const RULES = [
  { id: "", name: "Keine Linien" }, { id: "narrow", name: "Eng liniert" }, { id: "college", name: "Liniert" },
  { id: "wide", name: "Weit liniert" }, { id: "grid-s", name: "Kariert klein" }, { id: "grid", name: "Kariert" }, { id: "dots", name: "Punkteraster" },
];

export const TEXT_COLORS = ["#1D2130", "#5B6478", "#E5484D", "#E2761C", "#C79A08", "#2F9A50", "#14918A", "#2F6FDB", "#5B4BD5", "#9441C7", "#C93E87", "#FFFFFF"];
export const HIGHLIGHTS = ["#FFF06A", "#B7F5A4", "#9FE7F5", "#FFC2E2", "#FFD39A", "#D9CCFF"];
export const INK_COLORS = ["#1D2130", "#2F5BEA", "#E5484D", "#2F9A50", "#E2761C", "#9441C7", "#14918A", "#FFFFFF"];
export const HL_COLORS = ["#FFE94D", "#7CF28C", "#5ED8FF", "#FF8FD0", "#FFB45E"];

export const FONTS = [
  { name: "Atkinson", css: "'Atkinson Hyperlegible Next Variable', system-ui, sans-serif" },
  { name: "Bricolage", css: "'Bricolage Grotesque Variable', system-ui, sans-serif" },
  { name: "Calibri", css: "Calibri, Carlito, 'Segoe UI', sans-serif" },
  { name: "Arial", css: "Arial, Helvetica, sans-serif" },
  { name: "Georgia", css: "Georgia, serif" },
  { name: "Times New Roman", css: "'Times New Roman', Times, serif" },
  { name: "Comic Sans", css: "'Comic Sans MS', 'Comic Neue', cursive" },
  { name: "Consolas", css: "Consolas, 'Courier New', monospace" },
];
export const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];

// Note tags. "box" tags have a check box that can be ticked; "mark" tags color the whole paragraph.
export const TAGS = [
  { id: "todo", name: "Aufgabe", key: "1", box: true },
  { id: "important", name: "Wichtig", key: "2" },
  { id: "question", name: "Frage", key: "3" },
  { id: "remember", name: "Merken", key: "4", mark: "#FFF3A6" },
  { id: "definition", name: "Definition", key: "5", mark: "#C9F2CF" },
  { id: "highlight", name: "Hervorheben", key: "6", mark: "#FFE07A" },
  { id: "contact", name: "Kontakt", key: "7" },
  { id: "address", name: "Adresse", key: "8" },
  { id: "phone", name: "Telefon", key: "9" },
  { id: "idea", name: "Idee" },
  { id: "critical", name: "Kritisch" },
  { id: "website", name: "Website besuchen" },
  { id: "discuss", name: "Besprechen" },
  { id: "book", name: "Buch lesen" },
  { id: "p1", name: "Aufgabe Priorität 1", box: true },
  { id: "p2", name: "Aufgabe Priorität 2", box: true },
];
export const TAG = Object.fromEntries(TAGS.map((t) => [t.id, t]));

export const newPage = (title = "", level = 0) => ({ id: uid(), title, level, created: now(), modified: now(), bg: { color: "", rule: "" }, items: [], strokes: [] });
export const newSection = (name, color) => ({ id: uid(), kind: "section", name, color, pages: [newPage()] });
export const newGroup = (name) => ({ id: uid(), kind: "group", name, children: [], open: true });
export const newNotebook = (name, color) => ({ id: uid(), name, color, created: now(), modified: now(), sections: [newSection("New Section 1", pickColor(5))] });

/** Walks a section tree; fn(node, parentList, index, depth). Stops when fn returns true. */
export function walk(list, fn, depth = 0) {
  for (let i = 0; i < list.length; i++) {
    const n = list[i];
    if (fn(n, list, i, depth)) return true;
    if (n.kind === "group" && walk(n.children, fn, depth + 1)) return true;
  }
  return false;
}
export function findNode(nb, id) {
  let out = null;
  if (nb) walk(nb.sections, (n, list, i) => { if (n.id === id) { out = { node: n, list, i }; return true; } return false; });
  return out;
}
export const allSections = (nb) => { const s = []; if (nb) walk(nb.sections, (n) => { if (n.kind === "section") s.push(n); }); return s; };

/** Plain text of a page's notes (for search and previews). */
const scratch = typeof document !== "undefined" ? document.createElement("div") : null;
export function pageText(page) {
  if (page._t && page._tm === page.modified) return page._t;
  const parts = [];
  for (const it of page.items) {
    if (it.type === "text" && scratch) { scratch.innerHTML = it.html.replace(/<img[^>]*>/gi, " ").replace(/<\/(p|li|h\d|div|tr|blockquote|pre)>|<br\s*\/?>/gi, (m) => m + "\n").replace(/<\/t[dh]>/gi, (m) => m + " "); parts.push(scratch.textContent || ""); }
    else if (it.type === "file") parts.push(it.name);
    else if (it.type === "image" && it.alt) parts.push(it.alt);
  }
  const t = parts.join("\n").replace(/ /g, " ");
  Object.defineProperty(page, "_t", { value: t, writable: true, configurable: true, enumerable: false });
  Object.defineProperty(page, "_tm", { value: page.modified, writable: true, configurable: true, enumerable: false });
  return t;
}

export const fmtDate = (iso, opts) => new Date(iso).toLocaleDateString("de-CH", opts || { weekday: "long", day: "numeric", month: "long", year: "numeric" });
export const fmtTime = (iso) => new Date(iso).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
export const fmtShort = (iso) => {
  const d = new Date(iso), t = new Date();
  if (d.toDateString() === t.toDateString()) return fmtTime(iso);
  return d.toLocaleDateString("de-CH", d.getFullYear() === t.getFullYear() ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
};
export const fmtSize = (n) => (n == null ? "" : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
