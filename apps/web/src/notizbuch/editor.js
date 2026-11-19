// Text formatting inside note boxes. Remembers the last selection so toolbar buttons and menus can act on it.
import { TAG } from "./model.js";

let saved = null; // { range, ed }
export const activeEditor = () => (saved && saved.ed.isConnected ? saved.ed : null);

if (typeof document !== "undefined") {
  document.addEventListener("selectionchange", () => {
    const s = document.getSelection();
    if (!s || !s.rangeCount) return;
    const r = s.getRangeAt(0);
    const node = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
    const ed = node && node.closest && node.closest(".ed");
    if (ed) saved = { range: r.cloneRange(), ed };
  });
  try { document.execCommand("defaultParagraphSeparator", false, "p"); } catch { /* old engine */ }
}

export function restore() {
  // the live selection wins while the caret is in a note (selectionchange can lag behind fast typing)
  const cur = document.getSelection();
  if (cur && cur.rangeCount) {
    const r = cur.getRangeAt(0);
    const n = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
    const ed = n && n.closest && n.closest(".ed");
    if (ed && document.activeElement === ed) { saved = { range: r.cloneRange(), ed }; return true; }
  }
  if (!saved || !saved.ed.isConnected) return false;
  const s = document.getSelection();
  if (document.activeElement !== saved.ed) saved.ed.focus({ preventScroll: true });
  s.removeAllRanges(); s.addRange(saved.range);
  return true;
}
const changed = (ed) => ed && ed.dispatchEvent(new Event("input", { bubbles: true }));

export function cmd(name, value = null, css = true) {
  if (!restore()) return false;
  document.execCommand("styleWithCSS", false, css);
  document.execCommand(name, false, value);
  changed(saved.ed);
  return true;
}

export function fontSize(pt) {
  if (!restore()) return;
  document.execCommand("styleWithCSS", false, false);
  document.execCommand("fontSize", false, "7");
  saved.ed.querySelectorAll('font[size="7"]').forEach((f) => {
    const s = document.createElement("span"); s.style.fontSize = pt + "pt";
    while (f.firstChild) s.appendChild(f.firstChild);
    f.replaceWith(s);
    s.querySelectorAll("span").forEach((x) => { x.style.fontSize = ""; if (!x.getAttribute("style")) x.removeAttribute("style"); });
  });
  changed(saved.ed);
}

export function block(tag) {
  cmd("formatBlock", `<${tag}>`);
}
export function clearFormat() {
  if (!restore()) return;
  document.execCommand("removeFormat");
  document.execCommand("unlink");
  document.execCommand("formatBlock", false, "<p>");
  changed(saved.ed);
}

function currentBlock() {
  if (!saved) return null;
  const ed = saved.ed; let n = saved.range.startContainer;
  if (n.nodeType === 3) n = n.parentElement;
  let b = n.closest("li, p, h1, h2, h3, h4, h5, h6, blockquote, pre, td, th, div");
  if (b && b.tagName === "TD" || b && b.tagName === "TH") { const inner = n.closest("p, li"); if (inner && b.contains(inner)) b = inner; }
  if (!b || !ed.contains(b) || b === ed) {
    restore(); document.execCommand("formatBlock", false, "<p>");
    const s = document.getSelection(); n = s.anchorNode; if (n && n.nodeType === 3) n = n.parentElement;
    b = n && n.closest("p, li, h1, h2, h3, h4, h5, h6, div");
    if (b === ed) return null;
  }
  return b;
}

/** Puts a tag in front of the current paragraph, or removes it if it is already there. */
export function toggleTag(id) {
  if (!restore() || !TAG[id]) return;
  const b = currentBlock(); if (!b) return;
  const there = [...b.children].find((c) => c.classList.contains("tg") && c.dataset.tag === id);
  if (there) there.remove();
  else {
    const s = document.createElement("span");
    s.className = "tg"; s.dataset.tag = id; s.setAttribute("contenteditable", "false");
    const emptyLine = !b.textContent.replace(/\u00a0/g, "").trim();
    const keepRange = saved.range.cloneRange();
    b.insertBefore(s, b.firstChild);
    const sel = document.getSelection(); sel.removeAllRanges();
    if (emptyLine) {
      // empty line: put the caret right after the tag
      b.querySelectorAll(":scope > br").forEach((x) => x.remove());
      const t = document.createTextNode("\u200b"); b.appendChild(t);
      const r = document.createRange(); r.setStart(t, 1); r.collapse(true); sel.addRange(r);
    } else sel.addRange(keepRange);
  }
  changed(saved.ed);
}
export function clearTags() {
  if (!restore()) return;
  const b = currentBlock(); if (!b) return;
  b.querySelectorAll(":scope > .tg").forEach((t) => t.remove());
  changed(saved.ed);
}

export function insertHtml(html) { cmd("insertHTML", html, false); }
export function insertText(t) { cmd("insertText", t, false); }

export function insertTable(rows, cols) {
  const row = "<tr>" + "<td><br></td>".repeat(cols) + "</tr>";
  if (!restore()) return;
  const ed = saved.ed;
  document.execCommand("insertHTML", false, `<table class="q-table" data-new="1"><tbody>${row.repeat(rows)}</tbody></table><p><br></p>`);
  const t = ed.querySelector("table[data-new]");
  if (t) {
    t.removeAttribute("data-new");
    const r = document.createRange(); r.selectNodeContents(t.querySelector("td")); r.collapse(true);
    const s = document.getSelection(); s.removeAllRanges(); s.addRange(r);
  }
  changed(ed);
}
export function cellAtCaret() {
  if (!saved) return null;
  let n = saved.range.startContainer; if (n.nodeType === 3) n = n.parentElement;
  const td = n && n.closest("td, th");
  return td && saved.ed.contains(td) ? td : null;
}
export function tableOp(op) {
  const td = cellAtCaret(); if (!td) return;
  const tr = td.parentElement, table = td.closest("table"), idx = [...tr.children].indexOf(td);
  if (op === "rowBelow" || op === "rowAbove") {
    const n = tr.cloneNode(true); n.querySelectorAll("td, th").forEach((c) => { c.innerHTML = "<br>"; });
    tr.parentElement.insertBefore(n, op === "rowBelow" ? tr.nextSibling : tr);
  } else if (op === "colRight" || op === "colLeft") {
    table.querySelectorAll("tr").forEach((r) => { const c = r.children[idx]; if (!c) return; const n = document.createElement(c.tagName); n.innerHTML = "<br>"; r.insertBefore(n, op === "colRight" ? c.nextSibling : c); });
  } else if (op === "delRow") {
    if (table.querySelectorAll("tr").length <= 1) table.remove(); else tr.remove();
  } else if (op === "delCol") {
    if (tr.children.length <= 1) table.remove(); else table.querySelectorAll("tr").forEach((r) => r.children[idx] && r.children[idx].remove());
  } else if (op === "delTable") table.remove();
  else if (op === "header") {
    const first = table.querySelector("tr");
    [...first.children].forEach((c) => { const n = document.createElement(c.tagName === "TH" ? "td" : "th"); n.innerHTML = c.innerHTML; c.replaceWith(n); });
  }
  changed(saved.ed);
}

/** Tab inside a table moves between cells and adds a row at the end. Returns true if handled. */
export function tableTab(e) {
  const sel = document.getSelection(); if (!sel.rangeCount) return false;
  let n = sel.anchorNode; if (n && n.nodeType === 3) n = n.parentElement;
  const td = n && n.closest("td, th"); if (!td) return false;
  const cells = [...td.closest("table").querySelectorAll("td, th")];
  let i = cells.indexOf(td) + (e.shiftKey ? -1 : 1);
  if (i >= cells.length) { saved = { range: sel.getRangeAt(0).cloneRange(), ed: td.closest(".ed") }; tableOp("rowBelow"); i = cells.length; }
  const all = [...td.closest("table").querySelectorAll("td, th")];
  const t = all[Math.max(0, i)]; if (!t) return true;
  const r = document.createRange(); r.selectNodeContents(t); r.collapse(false);
  sel.removeAllRanges(); sel.addRange(r);
  return true;
}

export function formatState() {
  const q = (c) => { try { return document.queryCommandState(c); } catch { return false; } };
  let block = "p", inTable = false, font = "", size = "";
  if (saved && saved.ed.isConnected) {
    let n = saved.range.startContainer; if (n.nodeType === 3) n = n.parentElement;
    const b = n && n.closest("h1, h2, h3, h4, blockquote, pre, p, li");
    block = b ? b.tagName.toLowerCase() : "p";
    inTable = !!(n && n.closest("td, th"));
    if (n) { const cs = getComputedStyle(n); font = cs.fontFamily; size = Math.round(parseFloat(cs.fontSize) * 0.75 * 2) / 2; }
  }
  return {
    bold: q("bold"), italic: q("italic"), underline: q("underline"), strike: q("strikeThrough"), sub: q("subscript"), sup: q("superscript"),
    ul: q("insertUnorderedList"), ol: q("insertOrderedList"), left: q("justifyLeft"), center: q("justifyCenter"), right: q("justifyRight"),
    block, inTable, font, size, has: !!activeEditor(),
  };
}
