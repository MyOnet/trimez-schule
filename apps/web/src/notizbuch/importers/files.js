// Turns files into pages: OneNote exports (Word, MHT, PDF), web pages, Markdown, text, pictures, anything else as attachment.
import { saveAsset as speichern, assetUrl } from "../dateien.js";
let ZIEL = null;
const saveAsset = (d, e, n) => speichern(d, e, n, ZIEL);
import { escapeHtml, newPage, uid } from "../model.js";
import { htmlToItems, normalize } from "../sanitize.js";
import { parseMht } from "./mht.js";

const ext = (n) => (String(n).match(/\.([a-z0-9]{1,8})$/i) || [, ""])[1].toLowerCase();
const base = (n) => String(n).replace(/\.[^.]+$/, "");
export const ACCEPT = ".docx,.mht,.mhtml,.html,.htm,.md,.markdown,.txt,.pdf,.png,.jpg,.jpeg,.gif,.webp,.bmp,.svg,.one,.onepkg,.onetoc2,*";

class ImportError extends Error {}

function bodyOf(html) {
  return new DOMParser().parseFromString(html, "text/html");
}
function imageSize(src) {
  return new Promise((res) => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => res({ w: 0, h: 0 }); i.src = src; });
}

/** Saves data: URIs in <img> and marks them with data-asset. resolve(src) can return bytes for other sources. */
async function internalize(doc, resolve) {
  for (const img of [...doc.querySelectorAll("img")]) {
    const src = img.getAttribute("src") || "";
    try {
      if (src.startsWith("data:")) {
        const b = await (await fetch(src)).blob();
        img.setAttribute("data-asset", await saveAsset(b, (b.type.split("/")[1] || "png").replace("svg+xml", "svg")));
      } else if (resolve) {
        const r = resolve(src);
        if (r) img.setAttribute("data-asset", await saveAsset(r.bytes, (r.type.split("/")[1] || ext(src) || "png").replace("svg+xml", "svg")));
      }
    } catch { /* skip broken image */ }
  }
}

function pageFrom(title, items, date) {
  const p = newPage(title);
  if (date) p.created = p.modified = date;
  p.items = items;
  return p;
}

async function fromHtml(html, title, resolve) {
  const doc = bodyOf(html);
  await internalize(doc, resolve);
  const t = title || (doc.querySelector("title") && doc.querySelector("title").textContent.trim()) || "";
  // OneNote web exports wrap content in absolute divs; plain pages flow
  const { items } = normalize(htmlToItems(doc.body, { images: (img) => img.getAttribute("data-asset") }));
  return pageFrom(t, items);
}

function markdown(md) {
  const inline = (s) => escapeHtml(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/__([^_]+)__/g, "<b>$1</b>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<i>$2</i>").replace(/~~([^~]+)~~/g, "<s>$1</s>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>');
  const out = []; let list = null, code = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const line of md.split(/\r?\n/)) {
    if (code !== null) { if (/^```/.test(line)) { out.push(`<pre>${escapeHtml(code)}</pre>`); code = null; } else code += (code ? "\n" : "") + line; continue; }
    if (/^```/.test(line)) { close(); code = ""; continue; }
    let m;
    if ((m = line.match(/^(#{1,4})\s+(.*)/))) { close(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); continue; }
    if ((m = line.match(/^\s*[-*+]\s+\[( |x|X)\]\s+(.*)/))) { close(); out.push(`<p><span class="tg" data-tag="todo" contenteditable="false"${m[1] !== " " ? ' data-done="1"' : ""}></span>${inline(m[2])}</p>`); continue; }
    if ((m = line.match(/^\s*[-*+]\s+(.*)/))) { if (list !== "ul") { close(); out.push("<ul>"); list = "ul"; } out.push(`<li>${inline(m[1])}</li>`); continue; }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== "ol") { close(); out.push("<ol>"); list = "ol"; } out.push(`<li>${inline(m[1])}</li>`); continue; }
    close();
    if ((m = line.match(/^>\s?(.*)/))) { out.push(`<blockquote>${inline(m[1])}</blockquote>`); continue; }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) { out.push("<hr>"); continue; }
    out.push(line.trim() ? `<p>${inline(line)}</p>` : "<p><br></p>");
  }
  close(); if (code !== null) out.push(`<pre>${escapeHtml(code)}</pre>`);
  return out.join("");
}

let pdfjs = null;
async function pdfPages(file, onStep) {
  if (!pdfjs) {
    pdfjs = await import("pdfjs-dist");
    const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
    pdfjs.GlobalWorkerOptions.workerSrc = worker;
  }
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  const items = []; let y = 90;
  const pdfName = await saveAsset(file, "pdf", file.name);
  items.push({ id: uid(), type: "file", x: 48, y: 20, asset: pdfName, name: file.name, size: file.size });
  for (let i = 1; i <= doc.numPages; i++) {
    onStep && onStep(`${file.name}: Seite ${i} von ${doc.numPages}`);
    const pg = await doc.getPage(i);
    const vp = pg.getViewport({ scale: 1.6 });
    const c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height;
    await pg.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    const name = await saveAsset(blob, "png");
    const w = 720, h = Math.round(vp.height * w / vp.width);
    items.push({ id: uid(), type: "image", x: 48, y, w, h, asset: name, alt: `${file.name}, Seite ${i}`, printout: true });
    y += h + 20;
  }
  return items;
}

/** One file → one page. onStep(text) reports progress for long files. */
export async function fileToPage(file, onStep) {
  const e = ext(file.name), title = base(file.name);
  if (["one", "onepkg", "onetoc2"].includes(e)) {
    throw new ImportError(`${file.name}: Das eigene .${e}-Format von OneNote ist geschlossen und lässt sich nicht zuverlässig lesen. Nutzen Sie «Aus OneNote importieren» oder exportieren Sie den Abschnitt in OneNote als Word-Dokument oder Webseite in einer Datei (.mht).`);
  }
  if (e === "docx") {
    const mammoth = (await import("mammoth/mammoth.browser.js")).default || (await import("mammoth/mammoth.browser.js"));
    const r = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() }, {
      convertImage: mammoth.images.imgElement(async (img) => {
        const buf = await img.read();
        const name = await saveAsset(buf, (img.contentType || "image/png").split("/")[1]);
        return { src: assetUrl(name), "data-asset": name };
      }),
      styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Quote'] => blockquote:fresh"],
    });
    const html = r.value.replace(/<img ([^>]*?)src="[^"]*"([^>]*?)data-asset="([^"]+)"/g, '<img $1data-asset="$3"$2');
    return fromHtml(`<body>${html}</body>`, title);
  }
  if (e === "mht" || e === "mhtml") {
    const m = parseMht(new Uint8Array(await file.arrayBuffer()));
    const find = (src) => {
      const s = decodeURIComponent(src || ""), bn = s.split(/[\\/]/).pop();
      return m.parts.find((p) => p.location === src || p.location === s || (p.cid && (src === "cid:" + p.cid)) || (bn && decodeURIComponent(p.location).split(/[\\/]/).pop() === bn));
    };
    return fromHtml(m.html, m.title || title, find);
  }
  if (e === "html" || e === "htm") return fromHtml(await file.text(), "");
  if (e === "md" || e === "markdown") return pageFrom(title, [{ id: uid(), type: "text", x: 48, y: 24, w: 680, html: markdown(await file.text()) }]);
  if (e === "txt" || file.type === "text/plain") {
    const t = await file.text();
    return pageFrom(title, [{ id: uid(), type: "text", x: 48, y: 24, w: 680, html: t.split(/\r?\n/).map((l) => `<p>${escapeHtml(l) || "<br>"}</p>`).join("") }]);
  }
  if (e === "pdf") return pageFrom(title, await pdfPages(file, onStep));
  if (/^(png|jpe?g|gif|webp|bmp|svg)$/.test(e) || file.type.startsWith("image/")) {
    const name = await saveAsset(file, e || file.type.split("/")[1], file.name);
    const d = await imageSize(assetUrl(name));
    const w = Math.min(d.w || 640, 760), h = d.w ? Math.round(d.h * w / d.w) : null;
    return pageFrom(title, [{ id: uid(), type: "image", x: 48, y: 24, w, h, asset: name, alt: file.name }]);
  }
  const name = await saveAsset(file, e || "bin", file.name);
  return pageFrom(title, [{ id: uid(), type: "file", x: 48, y: 24, asset: name, name: file.name, size: file.size }]);
}

/** Many files → pages, in order. Errors are collected, not thrown. */
export async function filesToPages(files, onStep, abschnittId) {
  ZIEL = abschnittId;
  const pages = [], errors = [];
  const list = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  for (let i = 0; i < list.length; i++) {
    onStep && onStep(`${list[i].name} wird gelesen`, i, list.length);
    try { pages.push(await fileToPage(list[i], (t) => onStep && onStep(t, i, list.length))); }
    catch (err) { errors.push(err instanceof ImportError ? err.message : `${list[i].name}: ${err.message || err}`); }
  }
  return { pages, errors };
}
