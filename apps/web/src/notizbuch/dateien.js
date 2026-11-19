// Bilder und Anhänge im Kursnotizbuch: liegen auf dem Server, im Abschnitt, in dem sie eingefügt wurden.
import { hochladen } from "../api.js";
import { get } from "./store.js";

const LU = typeof window !== "undefined" ? window.trimezLernumgebung : undefined;
const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", pdf: "application/pdf" };

/** Speichert Daten (Blob, File, Uint8Array) im aktuellen Abschnitt (oder abschnittId) und gibt die Kennung zurück. */
export async function saveAsset(data, ext, name, abschnittId) {
  ext = String(ext || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").replace(/^jpeg$/, "jpg").slice(0, 8) || "bin";
  const ziel = abschnittId || get().sel.secId;
  if (!ziel) throw new Error("Kein Abschnitt gewählt.");
  const blob = data instanceof Blob ? data : new Blob([data], { type: MIME[ext] || "application/octet-stream" });
  const dateiname = name && /\.[a-z0-9]{1,8}$/i.test(name) ? name : `${name || "bild"}.${ext}`;
  const f = await hochladen(`/api/notizbuch/abschnitte/${ziel}/dateien`, new File([blob], dateiname, { type: blob.type }));
  return f.id;
}
export const assetUrl = (id) => (id ? `/api/notizbuch/dateien/${id}?ansicht=1` : "");
export function openAsset(id) {
  const a = document.createElement("a"); a.href = `/api/notizbuch/dateien/${id}`; a.rel = "noopener"; document.body.appendChild(a); a.click(); a.remove();
  return Promise.resolve();
}
export function openUrl(url) {
  if (LU && LU.seiteOeffnen) return LU.seiteOeffnen(url);
  window.open(url, "_blank", "noopener");
  return Promise.resolve();
}
export const printPage = () => Promise.resolve(window.print());

// OneNote über den Server von RESCOOL (der Zugangsschlüssel bleibt dort)
import { api } from "../api.js";
export const graphGet = (url) => api(`/api/onenote/graph?url=${encodeURIComponent(url)}`);
export const graphAsset = (url, ext, abschnittId, name) => api("/api/onenote/datei", { methode: "POST", daten: { url, ext, abschnitt_id: abschnittId, name } });
