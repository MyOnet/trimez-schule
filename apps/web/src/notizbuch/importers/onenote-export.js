// Liest die ZIP-Datei von «OneNote-zu-RESCOOL.ps1»: aufbau.xml (Notizbücher, Abschnittsgruppen, Abschnitte mit Farben,
// Seiten mit Ebene, alles in der Reihenfolge von OneNote) und pro Seite das OneNote-XML mit Text, Tabellen, Tags, Bildern
// und Anhängen. Seiten mit Handschrift bringen zusätzlich ein PDF der ganzen Seite mit.
import JSZip from "jszip";
import { uid } from "../model.js";
import { sanitize, normalize } from "../sanitize.js";

const PT = 96 / 72; // OneNote misst in Punkten
export class ExportFehler extends Error {}

const kinder = (el, name) => (el ? [...el.children].filter((c) => c.localName === name) : []);
const kind = (el, name) => kinder(el, name)[0] || null;
const zahl = (v, alt = 0) => (v == null || v === "" || isNaN(Number(v)) ? alt : Number(v));
const farbe = (c, alt) => (/^#[0-9a-f]{6}$/i.test(c || "") ? c.toUpperCase() : alt);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function b64(s) { const bin = atob(String(s).replace(/\s/g, "")); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }

function tagVon(def, tag) {
  if (tag.hasAttribute("completed")) return { id: "todo", done: tag.getAttribute("completed") === "true" };
  const n = String(def && def.getAttribute("name") || "").toLowerCase();
  const passt = (...w) => w.some((x) => n.includes(x));
  const id = passt("wichtig", "important") ? "important" : passt("frage", "question") ? "question" : passt("kritisch", "critical") ? "critical"
    : passt("idee", "idea") ? "idea" : passt("definition") ? "definition" : passt("merk", "remember") ? "remember" : passt("hervorheb", "highlight") ? "highlight"
    : passt("kontakt", "contact") ? "contact" : passt("adress") ? "address" : passt("telefon", "phone") ? "phone" : passt("website", "webseite") ? "website"
    : passt("besprech", "discuss") ? "discuss" : passt("buch", "book") ? "book" : "important";
  return { id, done: false };
}

/** Ein Seiten-XML in Sheaf-Elemente umwandeln. hochladen(bytes, ext, name) → Kennung der Datei */
async function seiteLesen(doc, zip, hochladen, log, titel) {
  const page = doc.documentElement;
  const tagDefs = new Map(kinder(page, "TagDef").map((t) => [t.getAttribute("index"), t]));
  const stile = new Map(kinder(page, "QuickStyleDef").map((q) => [q.getAttribute("index"), q.getAttribute("name")]));
  const items = [];

  async function bild(img) {
    const data = kind(img, "Data");
    if (!data) return null;
    const ext = (img.getAttribute("format") || "png").toLowerCase().replace("jpeg", "jpg");
    try { return await hochladen(b64(data.textContent), ext, `bild.${ext}`); }
    catch (e) { log(`  ! Bild auf «${titel}»: ${e.message}`, true); return null; }
  }
  async function datei(f) {
    const pfad = f.getAttribute("rescoolDatei"), name = f.getAttribute("preferredName") || "anhang";
    const z = pfad && zip.file(pfad);
    if (!z) { log(`  ! Anhang «${name}» auf «${titel}» fehlt im Export`, true); return null; }
    try { const bytes = await z.async("uint8array"); return { id: await hochladen(bytes, (name.split(".").pop() || "bin"), name), name, size: bytes.length }; }
    catch (e) { log(`  ! Anhang «${name}» auf «${titel}»: ${e.message}`, true); return null; }
  }

  // Inhalt einer Gliederung (OEChildren) als HTML; Listen und Einzüge bleiben erhalten
  async function block(children) {
    const oes = kinder(children, "OE");
    let html = "", liste = null;
    const zu = () => { if (liste) { html += `</${liste}>`; liste = null; } };
    for (const oe of oes) {
      const l = kind(oe, "List");
      const art = l ? (kind(l, "Number") ? "ol" : "ul") : null;
      let inhalt = "";
      for (const t of kinder(oe, "Tag")) {
        const g = tagVon(tagDefs.get(t.getAttribute("index")), t);
        inhalt += `<span class="tg" data-tag="${g.id}" contenteditable="false"${g.done ? ' data-done="1"' : ""}></span>`;
      }
      for (const c of oe.children) {
        if (c.localName === "T") inhalt += c.textContent;
        else if (c.localName === "Image") { const id = await bild(c); if (id) { const w = zahl(kind(c, "Size") && kind(c, "Size").getAttribute("width")) * PT; inhalt += `<img data-asset="${id}"${w ? ` width="${Math.round(w)}"` : ""} alt="${esc(c.getAttribute("alt") || "")}">`; } }
        else if (c.localName === "Table") inhalt += await tabelle(c);
        else if (c.localName === "InsertedFile") { const d = await datei(c); if (d) inhalt += `<a href="#" data-datei="${d.id}">📎 ${esc(d.name)}</a>`; }
        else if (c.localName === "InkWord" || c.localName === "InkParagraph") inhalt += "";
      }
      const unter = kind(oe, "OEChildren");
      const stil = stile.get(oe.getAttribute("quickStyleIndex")) || "p";
      const tag = /^h[1-6]$/.test(stil) ? stil : stil === "code" ? "pre" : stil === "cite" ? "p" : "p";
      const ausrichtung = oe.getAttribute("alignment"), st = ausrichtung && ausrichtung !== "left" ? ` style="text-align:${ausrichtung}"` : "";
      if (art) {
        if (liste !== art) { zu(); html += `<${art}>`; liste = art; }
        html += `<li${st}>${inhalt || "<br>"}${unter ? await block(unter) : ""}</li>`;
      } else {
        zu();
        html += `<${tag}${st}>${inhalt || "<br>"}</${tag}>`;
        if (unter) html += `<div style="margin-left:28px">${await block(unter)}</div>`;
      }
    }
    zu();
    return html;
  }
  async function tabelle(t) {
    let h = '<table class="q-table"><tbody>';
    for (const r of kinder(t, "Row")) {
      h += "<tr>";
      for (const c of kinder(r, "Cell")) { const s = c.getAttribute("shadingColor"); h += `<td${s && s !== "none" ? ` style="background-color:${s}"` : ""}>${await block(kind(c, "OEChildren")) || "<br>"}</td>`; }
      h += "</tr>";
    }
    return h + "</tbody></table>";
  }
  const ort = (el) => { const p = kind(el, "Position"), s = kind(el, "Size"); return { x: zahl(p && p.getAttribute("x"), 36) * PT, y: zahl(p && p.getAttribute("y"), 86) * PT, w: s ? zahl(s.getAttribute("width")) * PT : 0, h: s ? zahl(s.getAttribute("height")) * PT : 0 }; };

  for (const el of page.children) {
    if (el.localName === "Outline") {
      const o = ort(el), w = Math.round(Math.max(160, o.w || 560));
      const roh = await block(kind(el, "OEChildren"));
      // Anhänge mitten im Text: als eigene Elemente neben die Notiz
      [...roh.matchAll(/data-datei="([^"]+)"[^>]*>📎 ([^<]*)</g)].forEach((x, k) => items.push({ id: uid(), type: "file", x: Math.round(o.x) + w + 16, y: Math.round(o.y) + k * 64, asset: x[1], name: x[2] }));
      const html = sanitize(roh);
      if (html.replace(/<[^>]+>/g, "").trim() || /<img|class="tg"|<table/.test(html)) items.push({ id: uid(), type: "text", x: Math.round(o.x), y: Math.round(o.y), w, h: o.h ? Math.round(o.h) : undefined, html });
    } else if (el.localName === "Image") {
      const id = await bild(el); if (!id) continue;
      const o = ort(el); items.push({ id: uid(), type: "image", x: Math.round(o.x), y: Math.round(o.y), w: Math.round(o.w || 320), h: o.h ? Math.round(o.h) : null, asset: id, alt: el.getAttribute("alt") || "" });
    } else if (el.localName === "InsertedFile") {
      const d = await datei(el); if (!d) continue;
      const o = ort(el); items.push({ id: uid(), type: "file", x: Math.round(o.x), y: Math.round(o.y), asset: d.id, name: d.name, size: d.size });
    }
  }
  const settings = kind(page, "PageSettings");
  const bg = {};
  if (settings) {
    const c = settings.getAttribute("color"); if (farbe(c)) bg.color = farbe(c);
    const rl = kind(settings, "RuleLines");
    if (rl && rl.getAttribute("visible") === "true") bg.rule = kind(rl, "Vertical") ? "grid" : "college";
  }
  return { items: normalize(items).items, bg };
}

let pdfjs = null;
async function pdfBilder(bytes, hochladen) {
  if (!pdfjs) {
    pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  }
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const pg = await doc.getPage(i), vp = pg.getViewport({ scale: 1.5 });
    const c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height;
    await pg.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    out.push({ id: await hochladen(blob, "png", `handschrift-${i}.png`), w: 720, h: Math.round(vp.height * 720 / vp.width) });
  }
  return out;
}

/** Inhalt der ZIP-Datei: Notizbücher als Baum, ohne Seiteninhalt */
export async function exportLesen(file) {
  let zip;
  try { zip = await JSZip.loadAsync(file); } catch { throw new ExportFehler("Das ist keine ZIP-Datei von «OneNote zu RESCOOL»."); }
  const a = zip.file("aufbau.xml");
  if (!a) throw new ExportFehler("In der ZIP-Datei fehlt aufbau.xml. Bitte die Datei verwenden, die «OneNote zu RESCOOL» erstellt hat.");
  const doc = new DOMParser().parseFromString(await a.async("string"), "application/xml");
  const knoten = (el) => {
    const out = [];
    for (const c of el.children) {
      if (c.localName === "SectionGroup" && c.getAttribute("isRecycleBin") !== "true") out.push({ art: "gruppe", name: c.getAttribute("name"), kinder: knoten(c) });
      if (c.localName === "Section" && c.getAttribute("isInRecycleBin") !== "true" && c.getAttribute("locked") !== "true")
        out.push({ art: "abschnitt", name: c.getAttribute("name"), farbe: farbe(c.getAttribute("color"), null),
          seiten: kinder(c, "Page").filter((p) => p.getAttribute("isInRecycleBin") !== "true" && p.getAttribute("rescoolDatei")).map((p) => ({
            titel: p.getAttribute("name") || "", ebene: Math.max(0, Math.min(2, zahl(p.getAttribute("pageLevel"), 1) - 1)),
            erstellt: p.getAttribute("dateTime"), geaendert: p.getAttribute("lastModifiedTime"), datei: p.getAttribute("rescoolDatei") })) });
    }
    return out;
  };
  const buecher = kinder(doc.documentElement, "Notebook").map((n) => ({ name: n.getAttribute("nickname") || n.getAttribute("name"), farbe: farbe(n.getAttribute("color"), null), kinder: knoten(n) }));
  let seiten = 0; const z = (l) => l.forEach((k) => { if (k.seiten) seiten += k.seiten.length; if (k.kinder) z(k.kinder); });
  buecher.forEach((b) => z(b.kinder));
  return { zip, buecher, seiten };
}

/**
 * Legt die gewählten Notizbücher im Ziel an: jedes Notizbuch als Gruppe, darin Gruppen, Abschnitte (mit Farbe) und Seiten
 * (mit Ebene) in der Reihenfolge von OneNote.
 */
export async function exportImportieren({ zip, buecher }, { erstellen, seitenSpeichern, hochladen, pageText, progress, log, signal }) {
  const stats = { notebooks: 0, sections: 0, pages: 0, images: 0, files: 0, ink: 0, failed: 0 };
  let total = 0; const z = (l) => l.forEach((k) => { if (k.seiten) total += k.seiten.length; if (k.kinder) z(k.kinder); });
  buecher.forEach((b) => z(b.kinder));
  let done = 0, f = 0;
  const FARBEN = ["#3E8EED", "#4FAE6A", "#E8B931", "#E5484D", "#9B55D1", "#21A69A", "#F2994A", "#DE5FA2", "#5B5BE0", "#A57E57"];
  const bau = async (liste, eltern, pfad) => {
    for (const k of liste) {
      if (signal && signal.aborted) throw new Error("Abgebrochen. Was schon übernommen war, bleibt erhalten.");
      if (k.art === "gruppe") { const g = await erstellen({ art: "gruppe", name: k.name, eltern_id: eltern, offen: false }); await bau(k.kinder, g.id, `${pfad} › ${k.name}`); continue; }
      const sec = await erstellen({ art: "abschnitt", name: k.name, eltern_id: eltern, farbe: k.farbe || FARBEN[f++ % FARBEN.length], ohneSeite: true });
      log(`  › ${pfad} › ${k.name}`);
      const fertig = [];
      for (const s of k.seiten) {
        progress({ phase: "Seiten übernehmen", text: `${pfad} › ${k.name} › ${s.titel || "Ohne Titel"}`, done, total });
        const hoch = async (bytes, ext, name) => { const id = await hochladen(bytes, ext, name, sec.id); if (/^(png|jpg|gif|webp)$/.test(ext)) stats.images++; else stats.files++; return id; };
        let items = [], bg = {};
        try {
          const xml = await zip.file(s.datei).async("string");
          ({ items, bg } = await seiteLesen(new DOMParser().parseFromString(xml, "application/xml"), zip, hoch, log, s.titel));
          const pdf = zip.file(s.datei.replace(/\.xml$/, ".pdf"));
          if (pdf) {
            let y = 24; for (const it of items) y = Math.max(y, it.y + (it.h || 120));
            items.push({ id: uid(), type: "text", x: 48, y: y + 24, w: 560, html: "<p><b>Originalseite mit Handschrift</b></p>" });
            for (const b of await pdfBilder(await pdf.async("uint8array"), hoch)) { items.push({ id: uid(), type: "image", x: 48, y: y + 64, w: b.w, h: b.h, asset: b.id, alt: "Originalseite aus OneNote", printout: true }); y += b.h + 16; }
            stats.ink++;
          }
        } catch (e) { stats.failed++; log(`  ✗ «${s.titel || "Ohne Titel"}»: ${e.message}`, true); }
        const p = { title: s.titel, items, strokes: [], bg };
        fertig.push({ titel: s.titel, ebene: s.ebene, erstellt_am: s.erstellt, geaendert_am: s.geaendert, inhalt: { items, strokes: [], bg }, text: pageText(p) });
        done++; stats.pages++;
      }
      fertig.forEach((p, i) => { p.ebene = Math.min(p.ebene, i === 0 ? 0 : fertig[i - 1].ebene + 1); });
      for (let i = 0; i < fertig.length; i += 25) await seitenSpeichern(sec.id, fertig.slice(i, i + 25));
      if (!fertig.length) await seitenSpeichern(sec.id, [{ titel: "", ebene: 0, inhalt: { items: [], strokes: [] }, text: "" }]);
      stats.sections++;
    }
  };
  for (const b of buecher) {
    log(`Notizbuch «${b.name}»`);
    const g = await erstellen({ art: "gruppe", name: b.name, eltern_id: null, offen: true });
    await bau(b.kinder, g.id, b.name);
    stats.notebooks++;
  }
  return stats;
}
