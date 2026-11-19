// Text mit **fett**, *kursiv*, Formeln in $…$ (KaTeX) und Zeilenumbrüchen, sicher als HTML
import katex from "katex";
import "katex/dist/katex.min.css";

const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function inline(s) {
  return esc(s).replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>").replace(/\n/g, "<br>");
}
export function formatieren(text) {
  const s = String(text || "");
  let out = "", rest = s, m;
  const re = /\$\$([^$]+)\$\$|\$([^$\n]+)\$/g; let letzte = 0;
  while ((m = re.exec(s))) {
    out += inline(s.slice(letzte, m.index));
    try { out += katex.renderToString(m[1] || m[2], { displayMode: !!m[1], throwOnError: false, strict: "ignore", trust: false, output: "htmlAndMathml" }); }
    catch { out += esc(m[0]); }
    letzte = m.index + m[0].length;
  }
  return out + inline(s.slice(letzte));
}
export default function Formatiert({ text, als = "div", className }) {
  const T = als;
  return <T className={className} dangerouslySetInnerHTML={{ __html: formatieren(text) }} />;
}
export const hatFormat = (t) => /\$|\*/.test(String(t || ""));
