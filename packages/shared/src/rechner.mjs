// Taschenrechner für Prüfungen: rechnet Ausdrücke ohne eval (eigener Parser).
// Unterstützt + − × ÷ ^ %, Klammern, sin cos tan asin acos atan, sqrt, ln, log, abs, Konstanten pi und e, «ans».
// Winkel in Grad oder Bogenmass.

const FUNK = {
  sin: (x, g) => Math.sin(g ? (x * Math.PI) / 180 : x), cos: (x, g) => Math.cos(g ? (x * Math.PI) / 180 : x), tan: (x, g) => Math.tan(g ? (x * Math.PI) / 180 : x),
  asin: (x, g) => (g ? (Math.asin(x) * 180) / Math.PI : Math.asin(x)), acos: (x, g) => (g ? (Math.acos(x) * 180) / Math.PI : Math.acos(x)), atan: (x, g) => (g ? (Math.atan(x) * 180) / Math.PI : Math.atan(x)),
  sqrt: (x) => Math.sqrt(x), ln: (x) => Math.log(x), log: (x) => Math.log10(x), abs: (x) => Math.abs(x),
};
const KONST = { pi: Math.PI, "π": Math.PI, e: Math.E };

function zerlegen(s) {
  const t = []; let i = 0;
  s = String(s).replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-").replace(/√/g, "sqrt").replace(/,/g, ".").replace(/\s+/g, "");
  while (i < s.length) {
    const c = s[i];
    const zahl = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i));
    if (zahl && !(c === "e" || c === "E")) { t.push({ z: Number(zahl[0]) }); i += zahl[0].length; continue; }
    const wort = /^[a-zπ]+/i.exec(s.slice(i));
    if (wort) { const w = wort[0].toLowerCase(); if (Object.hasOwn(FUNK, w)) t.push({ f: w }); else if (Object.hasOwn(KONST, w)) t.push({ z: KONST[w] }); else if (w === "ans") t.push({ ans: true }); else throw new Error(`Unbekannt: ${wort[0]}`); i += w.length; continue; }
    if ("+-*/^()%!".includes(c)) { t.push({ o: c }); i++; continue; }
    throw new Error(`Unerwartetes Zeichen: ${c}`);
  }
  return t;
}

/** Rechnet einen Ausdruck. optionen: { grad: true (Standard), ans: letzte Antwort } */
export function rechnen(ausdruck, { grad = true, ans = 0 } = {}) {
  const t = zerlegen(ausdruck); let p = 0;
  const sieh = () => t[p], nimm = () => t[p++];
  const op = (o) => sieh() && sieh().o === o && (p++, true);
  // Grammatik: summe = produkt (± produkt)* ; produkt = vorzeichen ((*|/|implizit) vorzeichen)* ;
  //            vorzeichen = -vorzeichen | potenz ; potenz = nachsatz (^ vorzeichen)? ; nachsatz = atom (%|!)*
  // So gilt −2^2 = −4 und 2^−1 = 0.5 wie auf üblichen Taschenrechnern.
  function summe() { let v = produkt(); for (;;) { if (op("+")) v += produkt(); else if (op("-")) v -= produkt(); else return v; } }
  function produkt() {
    let v = vorzeichen();
    for (;;) {
      if (op("*")) v *= vorzeichen(); else if (op("/")) v /= vorzeichen();
      else if (sieh() && (sieh().z !== undefined || sieh().f || sieh().ans || sieh().o === "(")) v *= vorzeichen(); // 2pi, 3(4+1)
      else return v;
    }
  }
  function vorzeichen() { if (op("-")) return -vorzeichen(); if (op("+")) return vorzeichen(); return potenz(); }
  function potenz() { const b = nachsatz(); return op("^") ? b ** vorzeichen() : b; }
  function nachsatz() {
    let v = atom();
    for (;;) {
      if (op("%")) v /= 100;
      else if (op("!")) { if (v < 0 || v > 170 || !Number.isInteger(v)) throw new Error("Fakultät nur für ganze Zahlen 0 bis 170"); let r = 1; for (let k = 2; k <= v; k++) r *= k; v = r; }
      else return v;
    }
  }
  function atom() {
    const x = nimm();
    if (!x) throw new Error("Ausdruck unvollständig");
    if (x.z !== undefined) return x.z;
    if (x.ans) return ans;
    if (x.f) { const a = op("(") ? (() => { const v = summe(); if (!op(")")) throw new Error("Klammer fehlt"); return v; })() : vorzeichen(); return FUNK[x.f](a, grad); }
    if (x.o === "(") { const v = summe(); if (!op(")")) throw new Error("Klammer fehlt"); return v; }
    throw new Error("Ausdruck unvollständig");
  }
  const v = summe();
  if (p < t.length) throw new Error("Ausdruck ungültig");
  if (!Number.isFinite(v)) throw new Error(Number.isNaN(v) ? "Nicht definiert" : "Unendlich");
  return Math.abs(v) < 1e-12 ? 0 : Number(v.toPrecision(12));
}
