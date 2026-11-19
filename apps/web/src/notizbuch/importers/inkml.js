// Reads OneNote ink (InkML from the OneNote API) into Sheaf strokes.
import { uid } from "../model.js";

/** Converts InkML coordinates to page pixels. OneNote uses himetric (1/1000 cm) unless the file says otherwise. */
function scaleFor(doc) {
  const ch = [...doc.getElementsByTagNameNS("*", "channel")].find((c) => c.getAttribute("name") === "X");
  const units = ch && (ch.getAttribute("units") || "").toLowerCase();
  if (units === "cm") return 96 / 2.54;
  if (units === "mm") return 96 / 25.4;
  if (units === "in") return 96;
  if (units === "dev" || units === "px") return 1;
  return 96 / 2540; // himetric
}

function parseTrace(text, nch) {
  const pts = []; const last = new Array(nch).fill(0), vel = new Array(nch).fill(0), mode = new Array(nch).fill("!");
  for (const raw of text.split(",")) {
    const toks = raw.trim().match(/[!'"]?\s*-?[\d.]+(?:[eE][-+]?\d+)?/g);
    if (!toks) continue;
    const p = [];
    toks.slice(0, nch).forEach((tk, i) => {
      const t = tk.replace(/\s/g, "");
      if (/^[!'"]/.test(t)) mode[i] = t[0];
      const v = parseFloat(t.replace(/^[!'"]/, ""));
      if (mode[i] === "!") { vel[i] = v - last[i]; last[i] = v; }
      else if (mode[i] === "'") { vel[i] = v; last[i] += v; }
      else { vel[i] += v; last[i] += vel[i]; }
      p.push(last[i]);
    });
    pts.push(p);
  }
  return pts;
}

export function inkmlToStrokes(xml) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) return [];
  const sc = scaleFor(doc);
  const brushes = {};
  for (const b of doc.getElementsByTagNameNS("*", "brush")) {
    const props = {};
    for (const p of b.getElementsByTagNameNS("*", "brushProperty")) props[p.getAttribute("name")] = { v: p.getAttribute("value"), u: p.getAttribute("units") };
    const w = props.width ? parseFloat(props.width.v) * (props.width.u === "cm" ? 96 / 2.54 : props.width.u === "mm" ? 96 / 25.4 : sc) : 2;
    const tr = props.transparency ? parseFloat(props.transparency.v) : 0;
    const tip = props.tip ? props.tip.v : "";
    b.id = b.getAttribute("xml:id") || b.getAttributeNS("http://www.w3.org/XML/1998/namespace", "id");
    brushes[b.id] = { color: props.color ? props.color.v : "#000000", size: Math.max(1, w), hl: tr > 0 || tip === "rectangle" || (props.rasterOp && /mask/i.test(props.rasterOp.v)) };
  }
  // channel count from the first trace format (X, Y, sometimes F = force)
  const fmt = doc.getElementsByTagNameNS("*", "traceFormat")[0];
  const chans = fmt ? [...fmt.getElementsByTagNameNS("*", "channel")].map((c) => c.getAttribute("name")) : ["X", "Y"];
  const fIdx = chans.indexOf("F");
  const fMax = fIdx >= 0 ? parseFloat([...fmt.getElementsByTagNameNS("*", "channel")][fIdx].getAttribute("max")) || 32767 : 0;
  const strokes = [];
  for (const t of doc.getElementsByTagNameNS("*", "trace")) {
    const bref = (t.getAttribute("brushRef") || "").replace(/^#/, "");
    const br = brushes[bref] || { color: "#000000", size: 2, hl: false };
    const pts = parseTrace(t.textContent, Math.max(2, chans.length)).map((p) => [+(p[0] * sc).toFixed(1), +(p[1] * sc).toFixed(1), fIdx >= 0 ? Math.max(0.1, Math.min(1, p[fIdx] / fMax)) : 0.5]);
    if (!pts.length) continue;
    strokes.push({ id: uid(), tool: br.hl ? "highlighter" : "pen", color: br.color, size: +br.size.toFixed(2), pressure: fIdx >= 0, points: pts.length === 1 ? [pts[0], [pts[0][0] + 0.1, pts[0][1] + 0.1, pts[0][2]]] : pts });
  }
  return strokes;
}
