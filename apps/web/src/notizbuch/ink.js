// Ink strokes as smooth, pressure-sensitive outlines.
import { getStroke } from "perfect-freehand";

const pathCache = new Map();
export function strokePath(s) {
  const k = s.id + ":" + s.points.length;
  if (pathCache.has(k)) return pathCache.get(k);
  const hl = s.tool === "highlighter";
  const pts = getStroke(s.points, { size: s.size, thinning: hl ? 0 : 0.55, smoothing: 0.55, streamline: 0.45, simulatePressure: !s.pressure && !hl, last: true, start: { cap: !hl }, end: { cap: !hl } });
  const d = outline(pts);
  if (pathCache.size > 4000) pathCache.clear();
  pathCache.set(k, d);
  return d;
}
function outline(pts) {
  if (!pts.length) return "";
  const avg = (a, b) => (a + b) / 2;
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)} Q`;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    d += `${a[0].toFixed(1)},${a[1].toFixed(1)} ${avg(a[0], b[0]).toFixed(1)},${avg(a[1], b[1]).toFixed(1)} `;
  }
  return d + "Z";
}

