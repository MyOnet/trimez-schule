// Cleans HTML from imports and the clipboard, and turns imported pages into note boxes.
import { assetUrl } from "./dateien.js";
import { TAG, uid } from "./model.js";

const TAGS_OK = new Set("p div span br b strong i em u s strike del ins sub sup h1 h2 h3 h4 h5 h6 ul ol li table thead tbody tfoot tr td th colgroup col a img blockquote pre code hr cite mark label small big caption".split(" "));
const DROP = new Set("script style iframe object embed noscript template head title meta link svg math form input button select textarea video audio canvas frame frameset applet base xml".split(" "));
const STYLE_OK = new Set(["color", "background-color", "background", "font-family", "font-size", "font-weight", "font-style", "text-decoration", "text-decoration-line", "text-align", "margin-left", "padding-left", "text-indent", "vertical-align", "list-style-type", "width", "border", "border-color", "border-width", "border-style", "border-collapse", "white-space"]);

function cleanStyle(st, tag) {
  const out = [];
  for (const part of String(st || "").split(";")) {
    const i = part.indexOf(":"); if (i < 0) continue;
    const k = part.slice(0, i).trim().toLowerCase(); let v = part.slice(i + 1).trim();
    if (!STYLE_OK.has(k) || /url\(|expression|javascript:/i.test(v)) continue;
    if (k === "width" && !/^(td|th|table|col)$/.test(tag)) continue;
    if (k === "background") { const m = v.match(/#[0-9a-f]{3,8}|rgba?\([^)]*\)/i); if (!m) continue; out.push(`background-color:${m[0]}`); continue; }
    if (k === "font-family") v = v.replace(/["]/g, "'");
    out.push(`${k}:${v}`);
  }
  return out.join(";");
}

/** opts.images(img) → returns asset name or null for an <img>; default: keep data-asset only. */
export function cleanNode(src, doc, opts = {}) {
  if (src.nodeType === 3) return doc.createTextNode(src.nodeValue);
  if (src.nodeType !== 1) return null;
  let tag = src.tagName.toLowerCase();
  if (DROP.has(tag)) return null;
  if (tag === "font") tag = "span";
  if (tag === "body" || tag === "html" || tag === "center" || tag === "section" || tag === "article" || tag === "main" || tag === "header" || tag === "footer" || tag === "nav" || tag === "aside" || tag === "figure" || tag === "figcaption") tag = "div";
  if (!TAGS_OK.has(tag)) {
    // unknown wrapper: keep its children
    const frag = doc.createDocumentFragment();
    src.childNodes.forEach((c) => { const n = cleanNode(c, doc, opts); if (n) frag.appendChild(n); });
    return frag;
  }
  const el = doc.createElement(tag);
  // OneNote tags (Graph: data-tag="to-do:completed,important")
  const dt = src.getAttribute("data-tag");
  if (src.classList && src.classList.contains("tg") && dt && TAG[dt]) {
    el.className = "tg"; el.setAttribute("data-tag", dt); el.setAttribute("contenteditable", "false");
    if (src.getAttribute("data-done") === "1") el.setAttribute("data-done", "1");
    return el;
  }
  let st = cleanStyle(src.getAttribute("style"), tag);
  if (src.tagName.toLowerCase() === "font") {
    const c = src.getAttribute("color"), f = src.getAttribute("face");
    if (c) st += `;color:${c}`; if (f) st += `;font-family:${f}`;
  }
  if (st) el.setAttribute("style", st);
  if (tag === "a") {
    const h = src.getAttribute("href") || "";
    if (/^(https?:|mailto:|onenote:)/i.test(h)) el.setAttribute("href", h);
  }
  if (tag === "td" || tag === "th") for (const a of ["colspan", "rowspan"]) if (src.getAttribute(a)) el.setAttribute(a, src.getAttribute(a));
  if (tag === "table") el.className = "q-table";
  if (tag === "img") {
    const name = src.getAttribute("data-asset") || (opts.images ? opts.images(src) : null);
    if (!name) return null;
    el.setAttribute("data-asset", name);
    const w = parseFloat(src.getAttribute("width")) || parseFloat(src.style && src.style.width);
    if (w) el.setAttribute("width", String(Math.round(w)));
    if (src.getAttribute("alt")) el.setAttribute("alt", src.getAttribute("alt"));
  }
  src.childNodes.forEach((c) => { const n = cleanNode(c, doc, opts); if (n) el.appendChild(n); });
  const tags = dt ? mapGraphTags(dt) : [];
  if (tags.length && /^(p|li|h[1-6]|div|span)$/.test(tag)) {
    for (const t of tags.reverse()) {
      const s = doc.createElement("span"); s.className = "tg"; s.setAttribute("data-tag", t.id); s.setAttribute("contenteditable", "false");
      if (t.done) s.setAttribute("data-done", "1");
      el.insertBefore(s, el.firstChild);
    }
  }
  return el;
}

const GRAPH_TAGS = {
  "to-do": "todo", "important": "important", "question": "question", "remember-for-later": "remember", "definition": "definition",
  "highlight": "highlight", "contact": "contact", "address": "address", "phone-number": "phone", "idea": "idea", "critical": "critical",
  "website-to-visit": "website", "discuss-with-person-a": "discuss", "discuss-with-person-b": "discuss", "discuss-with-manager": "discuss",
  "book-to-read": "book", "to-do-priority-1": "p1", "to-do-priority-2": "p2",
};
export function mapGraphTags(v) {
  return String(v).split(",").map((x) => x.trim()).filter(Boolean).map((x) => {
    const [name, state] = x.split(":");
    const id = GRAPH_TAGS[name];
    return id ? { id, done: state === "completed" } : null;
  }).filter(Boolean);
}

export function sanitize(html, opts) {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}`, "text/html");
  const out = document.createElement("div");
  doc.body.childNodes.forEach((c) => { const n = cleanNode(c, document, opts); if (n) out.appendChild(n); });
  return out.innerHTML;
}

/** Stored HTML has <img data-asset> without src; add the src for display. */
export const hydrate = (html) => String(html || "").replace(/<img\b([^>]*?)\bdata-asset="([^"]+)"([^>]*)>/gi, (m, a, name, b) => `<img${a.replace(/\ssrc="[^"]*"/i, "")}data-asset="${name}" src="${assetUrl(name)}"${b.replace(/\ssrc="[^"]*"/i, "")}>`);
export const dehydrate = (html) => String(html || "").replace(/\u200b/g, "").replace(/<img\b[^>]*>/gi, (m) => (/data-asset=/.test(m) ? m.replace(/\ssrc="[^"]*"/i, "") : m));

/** Asset names used by a page. */
export function pageAssets(page) {
  const s = new Set();
  for (const it of page.items) {
    if (it.asset) s.add(it.asset);
    if (it.type === "text") for (const m of it.html.matchAll(/data-asset="([^"]+)"/g)) s.add(m[1]);
  }
  return [...s];
}

const px = (v) => {
  if (!v) return null;
  const n = parseFloat(v); if (isNaN(n)) return null;
  if (/pt$/.test(v)) return n * 96 / 72;
  if (/in$/.test(v)) return n * 96;
  if (/cm$/.test(v)) return n * 96 / 2.54;
  if (/mm$/.test(v)) return n * 96 / 25.4;
  return n;
};

/**
 * Turns the body of an imported page into items.
 * Absolutely positioned blocks (OneNote) keep their place; everything else flows downwards in one box.
 * opts.images(img) → asset name | null; opts.objects(el) → item | null for attachments.
 */
export function htmlToItems(body, opts = {}) {
  const items = []; let flow = null; let y = 24;
  const flushFlow = () => {
    if (!flow) return;
    const html = flow.innerHTML.trim();
    if (html && (flow.textContent.trim() || /<img|<table|class="tg"/.test(html))) {
      items.push({ id: uid(), type: "text", x: 48, y, w: 640, html });
      y += Math.max(60, estimateHeight(flow)) + 24;
    }
    flow = null;
  };
  const absPos = (el) => {
    const st = el.getAttribute && el.getAttribute("style") || "";
    if (!/position\s*:\s*absolute/i.test(st)) return null;
    const get = (k) => { const m = st.match(new RegExp(`(?:^|;)\\s*${k}\\s*:\\s*([^;]+)`, "i")); return m ? px(m[1].trim()) : null; };
    return { x: get("left") ?? 48, y: get("top") ?? y, w: get("width") };
  };
  for (const child of [...body.childNodes]) {
    const tag = child.nodeType === 1 ? child.tagName.toLowerCase() : "";
    const pos = tag ? absPos(child) : null;
    if (tag === "img") {
      flushFlow();
      const name = opts.images && opts.images(child);
      if (name) {
        const w = px(child.getAttribute("width")) || px(child.style.width) || 320;
        const h = px(child.getAttribute("height")) || px(child.style.height) || null;
        const p = pos || { x: 48, y };
        items.push({ id: uid(), type: "image", x: p.x, y: p.y, w: Math.round(w), h: h ? Math.round(h) : null, asset: name, alt: child.getAttribute("alt") || "" });
        if (!pos) y += (h || w * 0.6) + 24;
      }
      continue;
    }
    if (tag === "object" || (tag === "div" && child.querySelector && child.children.length === 1 && child.firstElementChild.tagName === "OBJECT" && !child.textContent.trim())) {
      flushFlow();
      const ob = tag === "object" ? child : child.firstElementChild;
      const it = opts.objects && opts.objects(ob);
      if (it) { const p = pos || absPos(ob) || { x: 48, y }; items.push({ ...it, x: p.x, y: p.y }); if (!pos) y += 70; }
      continue;
    }
    if (pos) {
      flushFlow();
      // standalone pictures inside a positioned div become picture items
      const kids = [...child.children];
      if (kids.length === 1 && kids[0].tagName === "IMG" && !child.textContent.trim()) {
        const name = opts.images && opts.images(kids[0]);
        if (name) {
          const w = px(kids[0].getAttribute("width")) || pos.w || 320, h = px(kids[0].getAttribute("height"));
          items.push({ id: uid(), type: "image", x: pos.x, y: pos.y, w: Math.round(w), h: h ? Math.round(h) : null, asset: name, alt: kids[0].getAttribute("alt") || "" });
        }
        continue;
      }
      const holder = document.createElement("div");
      // attachments inside a box become their own items next to it
      child.querySelectorAll && child.querySelectorAll("object").forEach((ob, k) => {
        const it = opts.objects && opts.objects(ob);
        if (it) items.push({ ...it, x: pos.x, y: pos.y + 4 + k * 64 });
        ob.remove();
      });
      child.childNodes.forEach((c) => { const n = cleanNode(c, document, opts); if (n) holder.appendChild(n); });
      if (holder.innerHTML.trim()) items.push({ id: uid(), type: "text", x: Math.round(pos.x), y: Math.round(pos.y), w: Math.round(Math.max(160, pos.w || 560)), html: holder.innerHTML });
      continue;
    }
    if (!flow) flow = document.createElement("div");
    const n = cleanNode(child, document, opts); if (n) flow.appendChild(n);
  }
  flushFlow();
  return items;
}

function estimateHeight(el) {
  const text = el.textContent || "";
  const lines = Math.ceil(text.length / 80) + el.querySelectorAll("p,li,h1,h2,h3,tr,br,div").length;
  return lines * 22 + el.querySelectorAll("img").length * 200;
}

/** OneNote places content below its title area; move everything up so the page starts near the top. */
export function normalize(items, strokes = []) {
  const ys = items.map((i) => i.y).concat(strokes.flatMap((s) => s.points.map((q) => q[1])));
  const xs = items.map((i) => i.x).concat(strokes.flatMap((s) => s.points.map((q) => q[0])));
  const dy = ys.length ? Math.max(0, Math.min(...ys) - 24) : 0, dx = xs.length ? Math.max(0, Math.min(...xs) - 48) : 0;
  if (!dx && !dy) return { items, strokes };
  return {
    items: items.map((i) => ({ ...i, x: Math.round(i.x - dx), y: Math.round(i.y - dy) })),
    strokes: strokes.map((s) => ({ ...s, points: s.points.map((q) => [+(q[0] - dx).toFixed(1), +(q[1] - dy).toFixed(1), q[2]]) })),
  };
}
