// Gemeinsame Bausteine der Oberfläche
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { notenStufe, fmtNote } from "@schule/shared";

/* ---------- Meldungen ---------- */
const MeldungCtx = createContext(() => {});
export function MeldungAnbieter({ children }) {
  const [m, setM] = useState(null);
  // aktion: { text, fn } z. B. «Rückgängig»
  const zeige = useCallback((text, fehler = false, aktion = null) => { setM({ text, fehler, aktion, k: Date.now() }); }, []);
  useEffect(() => { if (!m) return; const t = setTimeout(() => setM(null), m.fehler ? 6000 : m.aktion ? 5000 : 3000); return () => clearTimeout(t); }, [m]);
  return <MeldungCtx.Provider value={zeige}>{children}{m && <div className={"meldung" + (m.fehler ? " fehler" : "")} role={m.fehler ? "alert" : "status"}>{m.text}{m.aktion && <button onClick={() => { m.aktion.fn(); setM(null); }}>{m.aktion.text}</button>}</div>}</MeldungCtx.Provider>;
}
export const useMeldung = () => useContext(MeldungCtx);

/* ---------- Daten laden ---------- */
export function useLaden(pfad, abh = []) {
  const [s, setS] = useState({ daten: null, fehler: null, laedt: true });
  const neu = useCallback(async () => {
    if (!pfad) return;
    setS((x) => ({ ...x, laedt: true }));
    try { setS({ daten: await api(pfad), fehler: null, laedt: false }); } catch (e) { setS({ daten: null, fehler: e, laedt: false }); }
  }, [pfad]);
  useEffect(() => { neu(); }, [neu, ...abh]);
  return { ...s, neu };
}

export function Laden({ zustand, children }) {
  if (zustand.fehler) return <div className="hinweis fehler" role="alert">{zustand.fehler.message}</div>;
  if (!zustand.daten) return <p className="leise" aria-live="polite">Wird geladen …</p>;
  return children(zustand.daten);
}

/* ---------- Dialog ---------- */
export function Dialog({ offen, titel, onZu, children, fuss }) {
  const ref = useRef(null);
  useEffect(() => { const d = ref.current; if (!d) return; if (offen && !d.open) d.showModal(); if (!offen && d.open) d.close(); }, [offen]);
  return (
    <dialog ref={ref} onClose={onZu} aria-labelledby="dlg-titel">
      <div className="dialog-kopf"><h2 id="dlg-titel">{titel}</h2></div>
      <div className="dialog-inhalt">{offen && children}</div>
      {fuss && <div className="dialog-fuss">{fuss}</div>}
    </dialog>
  );
}

/* ---------- Formularfeld ---------- */
export function Feld({ label, hilfe, fehler, ...rest }) {
  const id = rest.id || "f-" + (rest.name || label).replace(/\W/g, "");
  return (
    <label className="feld" htmlFor={id}>
      {label}{hilfe && <small>{hilfe}</small>}
      {rest.type === "select" ? <select id={id} {...rest} type={undefined} aria-invalid={!!fehler}>{rest.children}</select> : <input id={id} {...rest} aria-invalid={!!fehler} />}
      {fehler && <span className="feld-fehler">{fehler}</span>}
    </label>
  );
}

/* ---------- Symbole (eigene, schlichte Linien) ---------- */
const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };
export const Symbol = {
  start: () => <svg viewBox="0 0 24 24" {...P}><path d="M4 11l8-6 8 6v8a1 1 0 0 1-1 1h-4v-5H9v5H5a1 1 0 0 1-1-1z" /></svg>,
  jahr: () => <svg viewBox="0 0 24 24" {...P}><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></svg>,
  klasse: () => <svg viewBox="0 0 24 24" {...P}><circle cx="9" cy="9" r="3" /><circle cx="17" cy="10" r="2.4" /><path d="M3.5 19c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5M14.5 15.2c2.3-.4 4.4.8 5.2 3.3" /></svg>,
  fach: () => <svg viewBox="0 0 24 24" {...P}><path d="M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" /><path d="M5 17a3 3 0 0 1 3-3h10" /></svg>,
  person: () => <svg viewBox="0 0 24 24" {...P}><circle cx="12" cy="8" r="3.5" /><path d="M5 20c1-4 3.8-6 7-6s6 2 7 6" /></svg>,
  unterricht: () => <svg viewBox="0 0 24 24" {...P}><rect x="3" y="5" width="18" height="12" rx="1.5" /><path d="M8 21h8M12 17v4" /></svg>,
  import: () => <svg viewBox="0 0 24 24" {...P}><path d="M12 3v12M7 10l5 5 5-5M4 19h16" /></svg>,
  protokoll: () => <svg viewBox="0 0 24 24" {...P}><path d="M7 3h8l4 4v14H7z" /><path d="M15 3v4h4M10 12h6M10 16h6" /></svg>,
  konto: () => <svg viewBox="0 0 24 24" {...P}><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>,
  aus: () => <svg viewBox="0 0 24 24" {...P}><path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" /></svg>,
  noten: () => <svg viewBox="0 0 24 24" {...P}><rect x="4" y="3.5" width="16" height="17" rx="2" /><path d="M8 8h3M8 12h8M8 16h5" /><path d="M15 7.5l1 1 2-2.2" /></svg>,
  muendlich: () => <svg viewBox="0 0 24 24" {...P}><path d="M5 5h14v10H10l-4 4v-4H5z" /><path d="M9 9.5h6M9 12h3.5" /></svg>,
  drucken: () => <svg viewBox="0 0 24 24" {...P}><path d="M7 9V4h10v5M7 17H5v-6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6h-2" /><rect x="7" y="14" width="10" height="6" rx="1" /></svg>,
  plus: () => <svg viewBox="0 0 24 24" {...P}><path d="M12 5v14M5 12h14" /></svg>,
  material: () => <svg viewBox="0 0 24 24" {...P}><path d="M4 7.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9.5a2 2 0 0 0-2-2h-6.5L9.5 5H6a2 2 0 0 0-2 2.5z" /><path d="M8 13h8M8 16.5h5" /></svg>,
  suche: () => <svg viewBox="0 0 24 24" {...P}><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg>,
  ordner: () => <svg viewBox="0 0 24 24" {...P}><path d="M3.5 7.5V18a1.5 1.5 0 0 0 1.5 1.5h14a1.5 1.5 0 0 0 1.5-1.5V9a1.5 1.5 0 0 0-1.5-1.5h-7L10 5H5a1.5 1.5 0 0 0-1.5 1.5z" /></svg>,
  gruppe: () => <svg viewBox="0 0 24 24" {...P}><circle cx="8" cy="9" r="2.6" /><circle cx="16" cy="9" r="2.6" /><path d="M3.5 18.5c.6-2.6 2.4-4 4.5-4s3.9 1.4 4.5 4M11.5 18.5c.6-2.6 2.4-4 4.5-4s3.9 1.4 4.5 4" /></svg>,
  schule: () => <svg viewBox="0 0 24 24" {...P}><path d="M3 10l9-5 9 5M5 10v9h14v-9M10 19v-5h4v5" /></svg>,
  papierkorb: () => <svg viewBox="0 0 24 24" {...P}><path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13" /></svg>,
  hoch: () => <svg viewBox="0 0 24 24" {...P}><path d="M12 16V4M7 9l5-5 5 5M4 20h16" /></svg>,
  link: () => <svg viewBox="0 0 24 24" {...P}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></svg>,
  text: () => <svg viewBox="0 0 24 24" {...P}><path d="M6 4h9l3 3v13H6z" /><path d="M9 10h6M9 13.5h6M9 17h4" /></svg>,
  schliessen: () => <svg viewBox="0 0 24 24" {...P}><path d="M6 6l12 12M18 6L6 18" /></svg>,
  oeffnen: () => <svg viewBox="0 0 24 24" {...P}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>,
  pruefung: () => <svg viewBox="0 0 24 24" {...P}><path d="M6 3.5h12v17H6z" /><path d="M9 8h6M9 12h6M9 16h3" /><path d="M14.5 16.5l1.2 1.2 2.3-2.6" /></svg>,
  lektion: () => <svg viewBox="0 0 24 24" {...P}><rect x="3" y="4" width="18" height="12" rx="1.5" /><path d="M7 20l3-4M17 20l-3-4M8 9.5l2.5 2 5-4.5" /></svg>,
  anhalten: () => <svg viewBox="0 0 24 24" {...P}><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>,
  senden: () => <svg viewBox="0 0 24 24" {...P}><path d="M4 12l16-7-6 16-3-6.5z" /><path d="M11 14.5L20 5" /></svg>,
  menu: () => <svg viewBox="0 0 24 24" {...P} width="22" height="22"><path d="M4 7h16M4 12h16M4 17h16" /></svg>,
  notizbuch: () => <svg viewBox="0 0 24 24" {...P}><path d="M6 3.5h11a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6z" /><path d="M6 3.5v17M3.5 7.5H6M3.5 12H6M3.5 16.5H6M10 8h5.5M10 11.5h4" /></svg>,
};

// RESCOOL-Zeichen: ein «R» in Königsblau, darunter ein Strich Leuchtmarker
export const Marke = ({ gross }) => (
  <svg width={gross ? 40 : 32} height={gross ? 40 : 32} viewBox="0 0 32 32" aria-hidden="true">
    <rect width="32" height="32" rx="9" fill="#2C3FC4" />
    <path d="M7.5 23.5c5-1.3 12-1.7 17.5-.9" stroke="#FFE14D" strokeWidth="4.2" strokeLinecap="round" fill="none" />
    <path d="M11 21V9h5.6a3.9 3.9 0 0 1 0 7.8H11m5.2 0L20.8 21" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </svg>
);
export const Wortmarke = () => <span className="wortmarke"><Marke />RESCOOL</span>;

/* ---------- Noten-Anzeige ---------- */
export function Note({ wert, gross, titel }) {
  const st = notenStufe(wert == null ? null : Number(wert));
  return <span className={`note ${st}${gross ? " gross" : ""}`} title={titel}>{wert == null ? "–" : fmtNote(wert)}</span>;
}
// Streifen: wie viele Schülerinnen und Schüler in welcher Notenstufe
export function Verteilung({ v }) {
  const total = v ? v.ungenuegend + v.knapp + v.gut + v.sehrgut : 0;
  if (!total) return <div className="verteilung" aria-hidden="true" />;
  const t = `${v.sehrgut} sehr gut, ${v.gut} gut, ${v.knapp} knapp genügend, ${v.ungenuegend} ungenügend`;
  return <div className="verteilung" role="img" aria-label={t} title={t}>{["ungenuegend", "knapp", "gut", "sehrgut"].map((k) => v[k] ? <span key={k} className={k} style={{ flex: v[k] }} /> : null)}</div>;
}
export const initialen = (p) => `${(p.vorname || "")[0] || ""}${(p.nachname || "")[0] || ""}`.toUpperCase();

export const datumCH = (d) => (d ? new Date(d).toLocaleDateString("de-CH") : "");
export const zeitCH = (d) => (d ? new Date(d).toLocaleString("de-CH", { dateStyle: "short", timeStyle: "short" }) : "");

/* ---------- Material ---------- */
const KURZ = { link: "LINK", text: "TEXT" };
export function Etikett({ e, gross }) {
  const ext = e.typ === "datei" && e.dateiname ? e.dateiname.split(".").pop().toUpperCase().slice(0, 4) : KURZ[e.typ] || "";
  return <span className={`etikett ${e.art || e.typ}${gross ? " gross" : ""}`} aria-hidden="true">{ext}</span>;
}
export const groesse = (b) => (b == null ? "" : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1).replace(".0", "")} MB`);
export function wann(d) {
  if (!d) return "";
  const t = new Date(d), jetzt = new Date(), tage = Math.round((new Date(jetzt.toDateString()) - new Date(t.toDateString())) / 864e5);
  if (tage === 0) return "heute"; if (tage === 1) return "gestern"; if (tage === -1) return "morgen";
  if (tage > 1 && tage < 7) return `vor ${tage} Tagen`;
  if (tage < -1 && tage > -7) return `in ${-tage} Tagen`;
  return t.toLocaleDateString("de-CH", { day: "numeric", month: "short", ...(t.getFullYear() !== jetzt.getFullYear() ? { year: "numeric" } : {}) });
}
