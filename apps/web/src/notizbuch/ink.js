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


// Striche aus OneNote («exakt»): genau die gespeicherten Punkte, ohne Glätten. Die Dicke folgt der Regel von Windows-Tinte
// (Druck 0.5 = Nenndicke, linear dazu); Marker haben eine rechteckige Spitze. Rückgabe: Pfade gleicher Dicke.
const exaktCache = new Map();
export function exaktTeile(s) {
  const k = s.id + ":" + s.points.length;
  if (exaktCache.has(k)) return exaktCache.get(k);
  const p = s.points, f = (n) => n.toFixed(2);
  let teile;
  if (p.length === 1 || !s.pressure) {
    let d = `M${f(p[0][0])},${f(p[0][1])}`;
    for (let i = 1; i < p.length; i++) d += `L${f(p[i][0])},${f(p[i][1])}`;
    if (p.length === 1) d += `l0.01,0`;
    teile = [{ d, w: s.size }];
  } else {
    const gruppen = new Map();
    for (let i = 1; i < p.length; i++) {
      const w = Math.max(0.2, s.size * (p[i - 1][2] + p[i][2])); // Mittelwert der beiden Drücke × 2
      const q = Math.round(w * 4) / 4;
      gruppen.set(q, (gruppen.get(q) || "") + `M${f(p[i - 1][0])},${f(p[i - 1][1])}L${f(p[i][0])},${f(p[i][1])}`);
    }
    teile = [...gruppen].map(([w, d]) => ({ d, w }));
  }
  if (exaktCache.size > 4000) exaktCache.clear();
  exaktCache.set(k, teile);
  return teile;
}
