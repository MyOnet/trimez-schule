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
async function seiteLesen(doc, zip, hochladen, log, titel, tinte) {
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
  // Handschrift: Striche an den Ort und in die Grösse, die OneNote für die Zeichnung angibt
  const strokes = [];
  if (tinte && tinte.length) {
    const knoten = new Map([...doc.getElementsByTagNameNS("*", "*")].filter((e) => e.hasAttribute("rescoolTinte")).map((e) => [Number(e.getAttribute("rescoolTinte")), e]));
    const proGliederung = new Map(); // Tinte in Textblöcken ohne eigene Position: an den Anfang des Blocks
    for (const t of tinte) {
      const el = knoten.get(t.knoten); if (!el || !t.striche || !t.striche.length) continue;
      let box = kind(el, "Position") ? ort(el) : null, sx = 1, sy = 1, ox, oy;
      if (box && t.w > 0 && t.h > 0 && box.w > 0 && box.h > 0) { sx = box.w / t.w; sy = box.h / t.h; if (sx < 0.5 || sx > 2 || sy < 0.5 || sy > 2) sx = sy = 1; }
      if (box) { ox = box.x; oy = box.y; }
      else {
        let o = el.parentElement; while (o && o.localName !== "Outline") o = o.parentElement;
        const g = o ? ort(o) : { x: 48, y: 120 };
        const vorher = proGliederung.get(o) || 0;
        ox = g.x; oy = g.y + vorher; proGliederung.set(o, vorher + t.h + 4);
      }
      for (const st of t.striche) {
        const punkte = String(st.punkte || "").split(";").filter(Boolean).map((q) => { const [x, y, p] = q.split(",").map(Number); return [+(ox + (x - t.x) * sx).toFixed(2), +(oy + (y - t.y) * sy).toFixed(2), isNaN(p) ? 0.5 : p]; });
        if (!punkte.length) continue;
        const marker = !!st.marker;
        strokes.push({ id: uid(), tool: marker ? "highlighter" : "pen", exakt: true, color: st.farbe || "#000000", deckung: st.deckung ?? 1,
          size: Math.max(0.2, (marker ? Math.max(st.breite, st.hoehe) : st.breite) * (sx + sy) / 2), pressure: !!st.druck && !marker, spitze: st.spitze, points: punkte });
      }
    }
  }
  const settings = kind(page, "PageSettings");
  const bg = {};
  if (settings) {
    const c = settings.getAttribute("color"); if (farbe(c)) bg.color = farbe(c);
    const rl = kind(settings, "RuleLines");
    if (rl && rl.getAttribute("visible") === "true") bg.rule = kind(rl, "Vertical") ? "grid" : "college";
  }
  const n = normalize(items, strokes);
  return { items: n.items, strokes: n.strokes, bg };
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
  return exportAufbau(zip);
}

/**
 * Aufbau aus einer ZIP-Datei oder einem Ordner (Lernumgebung: Export auf diesem Computer). zip braucht nur file(pfad) → { async(art) } | null.
 * Seiten ohne Datei (noch nicht exportiert) stehen mit bereit=false im Baum: Reihenfolge und Ebenen stimmen so auch bei einem Teilimport.
 */
export async function exportAufbau(zip) {
  const a = zip.file("aufbau.xml");
  if (!a) throw new ExportFehler("In der ZIP-Datei fehlt aufbau.xml. Bitte die Datei verwenden, die «OneNote zu RESCOOL» erstellt hat.");
  const doc = new DOMParser().parseFromString((await a.async("string")).replace(/^\uFEFF/, ""), "application/xml");
  const wurzel = doc.documentElement;
  const knoten = (el) => {
    const out = [];
    for (const c of el.children) {
      if (c.localName === "SectionGroup" && c.getAttribute("isRecycleBin") !== "true") out.push({ art: "gruppe", id: c.getAttribute("ID"), name: c.getAttribute("name"), kinder: knoten(c) });
      if (c.localName === "Section" && c.getAttribute("isInRecycleBin") !== "true" && c.getAttribute("locked") !== "true") {
        const seiten = kinder(c, "Page").filter((p) => p.getAttribute("isInRecycleBin") !== "true").map((p) => ({
          id: p.getAttribute("ID"), titel: p.getAttribute("name") || "", ebene: Math.max(0, Math.min(2, zahl(p.getAttribute("pageLevel"), 1) - 1)),
          erstellt: p.getAttribute("dateTime"), geaendert: p.getAttribute("lastModifiedTime"), datei: p.getAttribute("rescoolDatei"), bereit: !!p.getAttribute("rescoolDatei") }));
        // Ebenen wie in OneNote, aber nie tiefer als die Seite davor + 1
        seiten.forEach((p, i) => { p.ebene = Math.min(p.ebene, i === 0 ? 0 : seiten[i - 1].ebene + 1); p.reihenfolge = i + 1; });
        out.push({ art: "abschnitt", id: c.getAttribute("ID"), name: c.getAttribute("name"), farbe: farbe(c.getAttribute("color"), null), seiten });
      }
    }
    // Teilexport (Auswahl): Leeres weglassen
    if (wurzel.getAttribute("rescoolAuswahl") === "1") return out.filter((k) => (k.seiten ? k.seiten.some((p) => p.bereit) : k.kinder.length));
    return out;
  };
  const buecher = kinder(wurzel, "Notebook").map((n) => ({ art: "buch", id: n.getAttribute("ID"), name: n.getAttribute("nickname") || n.getAttribute("name"), farbe: farbe(n.getAttribute("color"), null), kinder: knoten(n) }))
    .filter((b) => wurzel.getAttribute("rescoolAuswahl") !== "1" || b.kinder.length);
  let seiten = 0, bereit = 0; const z = (l) => l.forEach((k) => { if (k.seiten) { seiten += k.seiten.length; bereit += k.seiten.filter((p) => p.bereit).length; } if (k.kinder) z(k.kinder); });
  buecher.forEach((b) => z(b.kinder));
  return { zip, buecher, seiten, bereit, fertig: wurzel.getAttribute("rescoolFertig") !== "0" };
}

/** Seiten zählen (alle oder nur bereite) in einem Teilbaum */
export function seitenZahl(k, nurBereit = false) {
  if (k.seiten) return nurBereit ? k.seiten.filter((p) => p.bereit).length : k.seiten.length;
  return (k.kinder || []).reduce((n, c) => n + seitenZahl(c, nurBereit), 0);
}

/**
 * Legt die gewählten Notizbücher im Ziel an: jedes Notizbuch als Gruppe, darin Gruppen, Abschnitte (mit Farbe) und Seiten
 * (mit Ebene) in der Reihenfolge von OneNote. Mit Herkunft (OneNote-Kennungen): Ein zweiter Import ergänzt nur, was fehlt
 * oder sich geändert hat (vorhanden: Herkunft → Änderungszeit der Seiten, die schon da sind).
 */
export async function exportImportieren({ zip, buecher }, { erstellen, seitenSpeichern, hochladen, pageText, progress, log, signal, vorhanden = {} }) {
  const stats = { notebooks: 0, sections: 0, pages: 0, images: 0, files: 0, ink: 0, failed: 0, skipped: 0 };
  const neuNoetig = (s) => s.bereit && !(s.id && vorhanden[s.id] && new Date(vorhanden[s.id]) >= new Date(s.geaendert || 0));
  let total = 0; const z = (l) => l.forEach((k) => { if (k.seiten) total += k.seiten.filter(neuNoetig).length; if (k.kinder) z(k.kinder); });
  buecher.forEach((b) => z(b.kinder));
  let done = 0, f = 0;
  const FARBEN = ["#3E8EED", "#4FAE6A", "#E8B931", "#E5484D", "#9B55D1", "#21A69A", "#F2994A", "#DE5FA2", "#5B5BE0", "#A57E57"];
  const bau = async (liste, eltern, pfad) => {
    for (const [stelle, k] of liste.entries()) {
      if (signal && signal.aborted) throw new Error("Abgebrochen. Was schon übernommen war, bleibt erhalten.");
      if (k.art === "gruppe") {
        if (!seitenZahl(k, true)) continue;
        const g = await erstellen({ art: "gruppe", name: k.name, eltern_id: eltern, offen: false, quelle: k.id, reihenfolge: stelle + 1 });
        await bau(k.kinder, g.id, `${pfad} › ${k.name}`); continue;
      }
      // Abschnitte ohne fertige Seiten kommen beim nächsten Durchgang
      if (k.seiten.length && !k.seiten.some((s) => s.bereit)) continue;
      const offen = k.seiten.filter(neuNoetig);
      if (k.seiten.length && !offen.length) { stats.skipped += k.seiten.filter((s) => s.bereit).length; continue; }
      const sec = await erstellen({ art: "abschnitt", name: k.name, eltern_id: eltern, farbe: k.farbe || FARBEN[f++ % FARBEN.length], ohneSeite: true, quelle: k.id, reihenfolge: stelle + 1 });
      log(`  › ${pfad} › ${k.name}`);
      const fertig = [];
      const senden = async () => { if (fertig.length) await seitenSpeichern(sec.id, fertig.splice(0)); };
      for (const s of offen) {
        progress({ phase: "Seiten übernehmen", text: `${pfad} › ${k.name} › ${s.titel || "Ohne Titel"}`, done, total });
        const hoch = async (bytes, ext, name) => { const id = await hochladen(bytes, ext, name, sec.id); if (/^(png|jpg|gif|webp)$/.test(ext)) stats.images++; else stats.files++; return id; };
        let items = [], strokes = [], bg = {};
        try {
          const xml = await zip.file(s.datei).async("string");
          const tj = zip.file(s.datei.replace(/\.xml$/, "-tinte.json"));
          const tinte = tj ? JSON.parse((await tj.async("string")).replace(/^\uFEFF/, "")) : null;
          ({ items, strokes, bg } = await seiteLesen(new DOMParser().parseFromString(xml.replace(/^\uFEFF/, ""), "application/xml"), zip, hoch, log, s.titel, tinte));
          if (strokes.length) stats.ink += strokes.length;
          const pdf = zip.file(s.datei.replace(/\.xml$/, ".pdf"));
          if (pdf) {
            let y = 24; for (const it of items) y = Math.max(y, it.y + (it.h || 120));
            items.push({ id: uid(), type: "text", x: 48, y: y + 24, w: 560, html: "<p><b>Originalseite</b> (ein Teil der Handschrift liess sich nicht als Striche lesen)</p>" });
            for (const b of await pdfBilder(await pdf.async("uint8array"), hoch)) { items.push({ id: uid(), type: "image", x: 48, y: y + 64, w: b.w, h: b.h, asset: b.id, alt: "Originalseite aus OneNote", printout: true }); y += b.h + 16; }
          }
        } catch (e) { stats.failed++; log(`  ✗ «${s.titel || "Ohne Titel"}»: ${e.message}`, true); }
        const p = { title: s.titel, items, strokes, bg };
        fertig.push({ titel: s.titel, ebene: s.ebene, reihenfolge: s.reihenfolge, quelle: s.id, erstellt_am: s.erstellt, geaendert_am: s.geaendert, inhalt: { items, strokes, bg }, text: pageText(p) });
        done++; stats.pages++;
        if (fertig.length >= 25) await senden();
      }
      await senden();
      if (!k.seiten.length && !sec.vorhanden) await seitenSpeichern(sec.id, [{ titel: "", ebene: 0, inhalt: { items: [], strokes: [] }, text: "" }]);
      stats.sections++;
    }
  };
  for (const b of buecher) {
    if (!seitenZahl(b, true)) continue;
    log(`Notizbuch «${b.name}»`);
    const g = await erstellen({ art: "gruppe", name: b.name, eltern_id: null, offen: true, quelle: b.id });
    const vorher = stats.pages;
    await bau(b.kinder, g.id, b.name);
    if (stats.pages > vorher || !g.vorhanden) stats.notebooks++;
  }
  return stats;
}
