// Erlaubte Dateiarten und Textauszug für die Suche.
// Die Art wird aus der Endung bestimmt, nicht aus der Angabe des Browsers. Programme und Webseiten sind nicht erlaubt.
import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";
import JSZip from "jszip";

export const MAX_GROESSE = 50 * 1024 * 1024;
export const ARTEN = {
  pdf: ["application/pdf", "pdf"],
  doc: ["application/msword", "word"], docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "word"],
  odt: ["application/vnd.oasis.opendocument.text", "word"], rtf: ["application/rtf", "word"],
  ppt: ["application/vnd.ms-powerpoint", "folien"], pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "folien"],
  odp: ["application/vnd.oasis.opendocument.presentation", "folien"], key: ["application/x-iwork-keynote-sffkey", "folien"],
  xls: ["application/vnd.ms-excel", "tabelle"], xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "tabelle"],
  ods: ["application/vnd.oasis.opendocument.spreadsheet", "tabelle"], csv: ["text/csv", "tabelle"],
  txt: ["text/plain", "text"], md: ["text/markdown", "text"],
  png: ["image/png", "bild"], jpg: ["image/jpeg", "bild"], jpeg: ["image/jpeg", "bild"], gif: ["image/gif", "bild"], webp: ["image/webp", "bild"], heic: ["image/heic", "bild"],
  mp3: ["audio/mpeg", "audio"], m4a: ["audio/mp4", "audio"], wav: ["audio/wav", "audio"],
  mp4: ["video/mp4", "video"], mov: ["video/quicktime", "video"], webm: ["video/webm", "video"],
  zip: ["application/zip", "archiv"], ggb: ["application/vnd.geogebra.file", "sonstig"], epub: ["application/epub+zip", "sonstig"],
};
// Diese Arten darf der Browser direkt anzeigen (keine, die Skripte ausführen können: kein HTML, kein SVG)
export const INLINE = new Set(["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp", "audio/mpeg", "audio/mp4", "audio/wav", "video/mp4", "video/webm", "text/plain"]);

export function dateiart(dateiname) {
  const ext = String(dateiname || "").toLowerCase().split(".").pop();
  const a = ARTEN[ext];
  return a ? { ext, mime: a[0], art: a[1] } : null;
}
export const sauberName = (n) => String(n || "datei").normalize("NFC").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(-140);

// Prüft die ersten Bytes, damit z. B. ein umbenanntes Programm nicht als PDF durchgeht
export function inhaltPasst(ext, buf) {
  const h = buf.subarray(0, 8);
  const zip = h[0] === 0x50 && h[1] === 0x4b;
  if (h[0] === 0x4d && h[1] === 0x5a) return false; // Windows-Programm
  if (h[0] === 0x7f && h.toString("latin1", 1, 4) === "ELF") return false;
  if (ext === "pdf") return h.toString("latin1", 0, 5) === "%PDF-";
  if (["docx", "pptx", "xlsx", "odt", "odp", "ods", "zip", "ggb", "epub", "key"].includes(ext)) return zip;
  if (ext === "png") return h[0] === 0x89 && h.toString("latin1", 1, 4) === "PNG";
  if (["jpg", "jpeg"].includes(ext)) return h[0] === 0xff && h[1] === 0xd8;
  return true;
}

const MAX_TEXT = 200000;
const xmlText = (s) => s.replace(/<\/(a:p|w:p|text:p|si|row)>/g, " ").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");

/** Text aus der Datei für die Suche; Fehler sind nicht schlimm (dann bleibt nur der Titel durchsuchbar) */
export async function textAuszug(ext, buf) {
  try {
    if (ext === "pdf") {
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const { text, totalPages } = await extractText(pdf, { mergePages: true });
      return { text: String(text).replace(/\s+/g, " ").slice(0, MAX_TEXT), seiten: totalPages };
    }
    if (ext === "docx") return { text: (await mammoth.extractRawText({ buffer: buf })).value.replace(/\s+/g, " ").slice(0, MAX_TEXT) };
    if (["pptx", "xlsx", "odt", "odp", "ods"].includes(ext)) {
      const z = await JSZip.loadAsync(buf);
      const namen = Object.keys(z.files).filter((n) => /^(ppt\/slides\/slide\d+\.xml|ppt\/notesSlides\/.*\.xml|xl\/sharedStrings\.xml|content\.xml)$/.test(n))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      let t = ""; for (const n of namen) { t += " " + xmlText(await z.file(n).async("string")); if (t.length > MAX_TEXT) break; }
      const seiten = ext === "pptx" ? namen.filter((n) => /^ppt\/slides\//.test(n)).length || null : null;
      return { text: t.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT), seiten };
    }
    if (["txt", "md", "csv"].includes(ext)) return { text: buf.toString("utf8").slice(0, MAX_TEXT) };
  } catch { /* Datei beschädigt oder geschützt */ }
  return { text: "" };
}
