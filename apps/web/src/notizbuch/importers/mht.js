// Reads MHT/MHTML files ("Single File Web Page", which OneNote can export) into HTML plus embedded files.

function decodeQP(str) {
  const s = str.replace(/=\r?\n/g, "");
  const bytes = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "=" && /^[0-9A-Fa-f]{2}$/.test(s.substr(i + 1, 2))) { bytes.push(parseInt(s.substr(i + 1, 2), 16)); i += 2; }
    else { const code = s.charCodeAt(i); if (code < 256) bytes.push(code); else bytes.push(...new TextEncoder().encode(c)); }
  }
  return new Uint8Array(bytes);
}
function decodeB64(str) {
  const bin = atob(str.replace(/[^A-Za-z0-9+/=]/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function headers(block) {
  const h = {}; let lastKey = null;
  for (const line of block.split(/\r?\n/)) {
    if (/^\s/.test(line) && lastKey) { h[lastKey] += " " + line.trim(); continue; }
    const i = line.indexOf(":"); if (i < 0) continue;
    lastKey = line.slice(0, i).trim().toLowerCase(); h[lastKey] = line.slice(i + 1).trim();
  }
  return h;
}
const param = (v, k) => { const m = String(v || "").match(new RegExp(`${k}\\s*=\\s*"?([^";]+)"?`, "i")); return m ? m[1] : null; };

/** @returns { html, title, parts: [{ type, location, cid, bytes }] } */
export function parseMht(buffer) {
  // MIME headers and bodies are ASCII-safe after decoding; read as Latin-1 to keep bytes intact
  const text = new TextDecoder("latin1").decode(buffer);
  const split = text.search(/\r?\n\r?\n/);
  const top = headers(text.slice(0, split));
  const boundary = param(top["content-type"], "boundary");
  const parts = [];
  if (!boundary) {
    parts.push({ h: top, body: text.slice(split).replace(/^\r?\n\r?\n/, "") });
  } else {
    const chunks = text.split("--" + boundary);
    for (const c of chunks.slice(1)) {
      if (c.startsWith("--")) break;
      const s = c.replace(/^\r?\n/, ""); const k = s.search(/\r?\n\r?\n/);
      if (k < 0) continue;
      parts.push({ h: headers(s.slice(0, k)), body: s.slice(k).replace(/^\r?\n\r?\n/, "").replace(/\r?\n$/, "") });
    }
  }
  const out = []; let html = null, title = "";
  for (const p of parts) {
    const enc = (p.h["content-transfer-encoding"] || "").toLowerCase();
    const type = (p.h["content-type"] || "text/html").split(";")[0].trim().toLowerCase();
    const bytes = enc === "base64" ? decodeB64(p.body) : enc === "quoted-printable" ? decodeQP(p.body) : Uint8Array.from(p.body, (ch) => ch.charCodeAt(0) & 255);
    const loc = p.h["content-location"] || "", cid = (p.h["content-id"] || "").replace(/[<>]/g, "");
    if (type === "text/html" && html === null) {
      const cs = param(p.h["content-type"], "charset") || "utf-8";
      let dec; try { dec = new TextDecoder(cs); } catch { dec = new TextDecoder("utf-8"); }
      html = dec.decode(bytes);
      // the page may declare its own charset in a meta tag
      const meta = html.match(/<meta[^>]+charset=["']?([\w-]+)/i);
      if (meta && meta[1].toLowerCase() !== cs.toLowerCase()) { try { html = new TextDecoder(meta[1]).decode(bytes); } catch { /* keep */ } }
      const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i); if (t) title = t[1].replace(/<[^>]+>/g, "").trim();
    } else out.push({ type, location: loc, cid, bytes });
  }
  return { html: html || "", title, parts: out };
}
