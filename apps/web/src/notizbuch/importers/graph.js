// Import from OneNote through Microsoft Graph: notebooks, section groups, sections, pages (with subpage levels),
// text with formatting and tags, pictures, attached files and ink.
import { graphAsset, graphGet } from "../dateien.js";
import { newGroup, newPage, pickColor, uid, now } from "../model.js";
import { htmlToItems, normalize } from "../sanitize.js";
import { inkmlToStrokes } from "./inkml.js";

const G = "https://graph.microsoft.com/v1.0/me/onenote";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Cancelled extends Error {}
const neuGruppe = (name) => ({ art: "gruppe", name });

async function call(fn, signal, log) {
  for (let attempt = 0; ; attempt++) {
    if (signal && signal.aborted) throw new Cancelled("Cancelled");
    const r = await fn();
    if (r.status === 429 || r.status === 503 || r.status === 504 || r.status === 502) {
      if (attempt >= 7) return r;
      const wait = Math.min(120, r.retry_after || 2 ** attempt * 2);
      log && log(`Microsoft bremst, warte ${wait} s …`);
      await sleep(wait * 1000);
      continue;
    }
    return r;
  }
}
async function json(url, signal, log) {
  const r = await call(() => graphGet(url), signal, log);
  if (r.status < 200 || r.status >= 300) {
    let msg = r.body; try { const j = JSON.parse(r.body); msg = j.error && j.error.message || msg; } catch { /* text */ }
    throw new Error(`${r.status}: ${String(msg).slice(0, 200)}`);
  }
  return JSON.parse(r.body);
}
async function all(url, signal, log) {
  const out = [];
  for (let next = url; next;) { const j = await json(next, signal, log); out.push(...(j.value || [])); next = j["@odata.nextLink"]; }
  return out;
}

export async function listNotebooks(signal) {
  const nbs = await all(`${G}/notebooks?$select=id,displayName,createdDateTime,lastModifiedDateTime,isShared&$orderby=displayName&$top=100`, signal);
  return nbs.map((n) => ({ id: n.id, name: n.displayName, modified: n.lastModifiedDateTime, shared: n.isShared }));
}

// Microsoft's interface does not say in which order the section tabs are arranged. New sections are added at the end
// in OneNote, so the creation date comes closest. Like in OneNote, section groups follow the sections.
const byCreated = (a, b) => String(a.createdDateTime || "").localeCompare(String(b.createdDateTime || "")) || String(a.displayName).localeCompare(String(b.displayName));
async function tree(kind, id, signal, log) {
  const sections = (await all(`${G}/${kind}/${id}/sections?$select=id,displayName,createdDateTime&$top=100`, signal, log)).sort(byCreated);
  const groups = (await all(`${G}/${kind}/${id}/sectionGroups?$select=id,displayName,createdDateTime&$top=100`, signal, log)).sort(byCreated);
  const out = sections.map((s) => ({ kind: "section", gid: s.id, name: s.displayName }));
  for (const g of groups) out.push({ kind: "group", gid: g.id, name: g.displayName, children: await tree("sectionGroups", g.id, signal, log) });
  return out;
}

function splitMultipart(body, ctype) {
  const b = (ctype.match(/boundary="?([^";]+)"?/i) || [])[1];
  if (!b) return { html: body, inkml: null };
  let html = "", inkml = null;
  for (const part of body.split("--" + b)) {
    const k = part.search(/\r?\n\r?\n/); if (k < 0) continue;
    const h = part.slice(0, k).toLowerCase(), content = part.slice(k).replace(/^\r?\n\r?\n/, "").replace(/\r?\n$/, "");
    if (h.includes("text/html")) html = content;
    else if (h.includes("inkml")) inkml = content;
  }
  return { html, inkml };
}

const extFromType = (t) => (t || "").split("/")[1]?.replace("jpeg", "jpg").replace("svg+xml", "svg").replace(/[^a-z0-9]/g, "") || "";

async function page(meta, signal, log, stats, abschnittId) {
  const r = await call(() => graphGet(`${G}/pages/${meta.id}/content?includeinkML=true`), signal, log);
  const p = newPage(meta.title || "", Math.max(0, Math.min(2, meta.level || 0)));
  p.created = meta.createdDateTime || now(); p.modified = meta.lastModifiedDateTime || p.created;
  if (r.status < 200 || r.status >= 300) {
    log(`  ✗ «${meta.title || "Ohne Titel"}» liess sich nicht lesen (${r.status})`, true); stats.failed++;
    p.items = [{ id: uid(), type: "text", x: 48, y: 24, w: 560, html: `<p><span class="tg" data-tag="critical" contenteditable="false"></span>Diese Seite liess sich nicht aus OneNote übernehmen (Fehler ${r.status}). Öffnen Sie sie in OneNote, um den Inhalt zu sehen.</p>` }];
    return p;
  }
  const { html, inkml } = splitMultipart(r.body, r.content_type);
  const doc = new DOMParser().parseFromString(html, "text/html");
  // pictures and attachments: download first, then convert
  const imgs = [...doc.querySelectorAll("img")];
  for (const img of imgs) {
    const url = img.getAttribute("data-fullres-src") || img.getAttribute("src");
    if (!url || !url.startsWith("https://graph.microsoft.com/")) continue;
    const t = img.getAttribute("data-fullres-src-type") || img.getAttribute("data-src-type");
    const a = await call(() => graphAsset(url, extFromType(t), abschnittId, img.getAttribute("alt") || "bild"), signal, log);
    if (a.name) { img.setAttribute("data-asset", a.name); stats.images++; } else log(`  ! ein Bild auf «${meta.title}» fehlt (${a.fehler || a.status})`, true);
  }
  for (const ob of [...doc.querySelectorAll("object[data]")]) {
    const url = ob.getAttribute("data"), name = ob.getAttribute("data-attachment") || "attachment";
    if (!url.startsWith("https://graph.microsoft.com/")) continue;
    const a = await call(() => graphAsset(url, (name.match(/\.([a-z0-9]{1,8})$/i) || [, ""])[1], abschnittId, name), signal, log);
    if (a.name) { ob.setAttribute("data-asset", a.name); stats.files++; } else log(`  ! Anhang «${name}» auf «${meta.title}» nicht übernommen${a.fehler ? ": " + a.fehler : ""}`, true);
  }
  const bodyStyle = doc.body.getAttribute("style") || "";
  const font = (bodyStyle.match(/font-family\s*:\s*([^;]+)/i) || [])[1], size = (bodyStyle.match(/font-size\s*:\s*([^;]+)/i) || [])[1];
  let items = htmlToItems(doc.body, {
    images: (img) => img.getAttribute("data-asset"),
    objects: (ob) => ob.getAttribute("data-asset") ? { id: uid(), type: "file", asset: ob.getAttribute("data-asset"), name: ob.getAttribute("data-attachment") || "attachment", size: null } : null,
  });
  if (font || size) {
    const st = [font && `font-family:${font.trim()}`, size && `font-size:${size.trim()}`].filter(Boolean).join(";");
    items = items.map((it) => it.type === "text" ? { ...it, html: `<div style="${st}">${it.html}</div>` } : it);
  }
  let strokes = [];
  if (inkml) { try { strokes = inkmlToStrokes(inkml); stats.ink += strokes.length; } catch { log(`  ! Handschrift auf «${meta.title}» nicht lesbar`, true); } }
  ({ items, strokes } = normalize(items, strokes));
  p.items = items; p.strokes = strokes;
  return p;
}

/**
 * Holt die gewählten Notizbücher in einen Bereich des Kursnotizbuchs: jedes OneNote-Notizbuch wird eine Gruppe,
 * darin dieselben Gruppen, Abschnitte und Seiten (mit Unterseiten und Reihenfolge).
 * ziel: { uid, bereich, besitzer_id }. erstellen(daten) legt Abschnitt/Gruppe an, seitenSpeichern(abschnittId, seiten) die Seiten.
 */
export async function importNotebooks(chosen, { signal, progress, log, ziel, erstellen, seitenSpeichern, pageText }) {
  const stats = { notebooks: 0, sections: 0, pages: 0, images: 0, files: 0, ink: 0, failed: 0 };
  const plans = []; let total = 0;
  for (const n of chosen) {
    progress({ phase: "Aufbau lesen", text: n.name, done: 0, total: 0 });
    log(`Notizbuch «${n.name}»`);
    const t = await tree("notebooks", n.id, signal, log);
    const secs = [];
    const collect = (list) => list.forEach((x) => (x.kind === "section" ? secs.push(x) : collect(x.children)));
    collect(t);
    for (const s of secs) {
      s.pages = (await all(`${G}/sections/${s.gid}/pages?pagelevel=true&$select=id,title,createdDateTime,lastModifiedDateTime,level,order&$top=100`, signal, log)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      total += s.pages.length;
      progress({ phase: "Aufbau lesen", text: `${n.name} › ${s.name}`, done: 0, total });
    }
    log(`  ${secs.length} Abschnitt${secs.length === 1 ? "" : "e"}, ${secs.reduce((a, s) => a + s.pages.length, 0)} Seiten`);
    plans.push({ n, t });
  }
  let done = 0, farbe = 0;
  const FARBEN = ["#3E8EED", "#4FAE6A", "#E8B931", "#E5484D", "#9B55D1", "#21A69A", "#F2994A", "#DE5FA2", "#5B5BE0", "#A57E57"];
  const build = async (list, elternId, pfad) => {
    for (const x of list) {
      if (signal && signal.aborted) throw new Cancelled("Abgebrochen");
      if (x.kind === "group") { const g = await erstellen({ art: "gruppe", name: x.name, eltern_id: elternId, offen: false }); await build(x.children, g.id, `${pfad} › ${x.name}`); continue; }
      const sec = await erstellen({ art: "abschnitt", name: x.name, eltern_id: elternId, farbe: FARBEN[farbe++ % FARBEN.length], ohneSeite: true });
      log(`  › ${x.name}`);
      const results = new Array(x.pages.length); let next = 0;
      const worker = async () => {
        while (next < x.pages.length) {
          const i = next++, meta = x.pages[i];
          progress({ phase: "Seiten übernehmen", text: `${pfad} › ${x.name} › ${meta.title || "Ohne Titel"}`, done, total });
          results[i] = await page(meta, signal, log, stats, sec.id);
          done++; stats.pages++;
          progress({ phase: "Seiten übernehmen", text: `${pfad} › ${x.name} › ${meta.title || "Ohne Titel"}`, done, total });
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      const seiten = results.filter(Boolean);
      seiten.forEach((p, k) => { p.level = Math.min(p.level, k === 0 ? 0 : seiten[k - 1].level + 1); });
      for (let k = 0; k < seiten.length; k += 25) {
        await seitenSpeichern(sec.id, seiten.slice(k, k + 25).map((p) => ({ titel: p.title, ebene: p.level, erstellt_am: p.created, geaendert_am: p.modified, inhalt: { items: p.items, strokes: p.strokes, bg: p.bg || {} }, text: pageText(p) })));
      }
      if (!seiten.length) await seitenSpeichern(sec.id, [{ titel: "", ebene: 0, inhalt: { items: [], strokes: [] }, text: "" }]);
      stats.sections++;
    }
  };
  for (const { n, t } of plans) {
    const g = await erstellen({ art: "gruppe", name: n.name, eltern_id: null, offen: true });
    await build(t, g.id, n.name);
    stats.notebooks++;
  }
  return stats;
}
