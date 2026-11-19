// Material für Schülerinnen und Schüler: alles Freigegebene, nach Fach, mit Suche. «Neu» bis zum ersten Öffnen.
import { lazy, Suspense, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api.js";
import { useLaden, Laden, Dialog, Symbol, Etikett, groesse, wann } from "../ui.jsx";

const INLINE = /^(application\/pdf|image\/(png|jpeg|gif|webp)|video\/(mp4|webm)|audio\/|text\/plain)/;
const adresse = (e) => e.typ === "link" ? `/api/material/${e.id}/oeffnen` : `/api/material/${e.id}/datei${INLINE.test(e.mime || "") ? "?ansicht=1" : ""}`;

const PdfAnsicht = lazy(() => import("./PdfAnsicht.jsx"));
const LU = typeof window !== "undefined" ? window.trimezLernumgebung : undefined; // nur in der Lernumgebung

/** Liste zum Öffnen. Dateien und Links öffnen in einem neuen Tab, Texte in einem Fenster.
 *  In der Lernumgebung gibt es keine neuen Tabs: Dateien erscheinen in einer Ansicht über der Seite, Links im Fenster für erlaubte Seiten. */
export function MaterialAnsicht({ eintraege, neu, leer, fachZeigen }) {
  const [gelesen, setGelesen] = useState(new Set());
  const [text, setText] = useState(null);
  const [datei, setDatei] = useState(null);
  const inLu = async (e) => {
    geoeffnet(e);
    if (e.typ === "datei") return setDatei(e);
    try {
      const m = await api(`/api/material/${e.id}`);
      await LU.seiteOeffnen(m.url);
    } catch { alert("Diese Seite ist in der Lernumgebung nicht freigegeben. Ihre Lehrperson kann sie für die Lektion erlauben."); }
  };
  const geoeffnet = (e) => { setGelesen((g) => new Set(g).add(e.id)); };
  if (!eintraege.length) return <div className="leer"><b>Noch nichts da</b><span>{leer}</span></div>;
  return <>
    <div className="mliste">
      {eintraege.map((e) => {
        const meta = [fachZeigen ? e.fach : null, e.typ === "datei" ? [e.seiten ? `${e.seiten} ${e.seiten === 1 ? "Seite" : "Seiten"}` : null, groesse(e.groesse)].filter(Boolean).join(", ") : e.typ === "link" ? e.host : "Text", `seit ${wann(e.ab)}`].filter(Boolean);
        const inhalt = <>
          <Etikett e={e} />
          <div style={{ minWidth: 0 }}>
            <div className="titel"><span>{e.titel}</span>{e.neu && !gelesen.has(e.id) && <span className="neu-chip">Neu</span>}</div>
            <div className="meta">{meta.map((m, i) => <span key={i}>{m}</span>)}</div>
            {e.hinweis && <div className="klein" style={{ marginTop: 4, color: "var(--text2)" }}>«{e.hinweis}»</div>}
            {e.auszug && <div className="auszug" dangerouslySetInnerHTML={{ __html: e.auszug.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])).replace(/«/g, "<mark>").replace(/»/g, "</mark>") }} />}
          </div>
          <span className="leise" aria-hidden="true">{e.typ === "text" ? <Symbol.text /> : <Symbol.oeffnen />}</span>
        </>;
        if (LU && e.typ !== "text") return <button key={e.id} className="mzeile" style={{ gridTemplateColumns: "auto minmax(0,1fr) auto" }} onClick={() => inLu(e)}>{inhalt}</button>;
        return e.typ === "text"
          ? <button key={e.id} className="mzeile" style={{ gridTemplateColumns: "auto minmax(0,1fr) auto" }} onClick={() => { setText(e.id); geoeffnet(e); }}>{inhalt}</button>
          : <a key={e.id} className="mzeile" style={{ gridTemplateColumns: "auto minmax(0,1fr) auto", textDecoration: "none" }} href={adresse(e)} target="_blank" rel="noopener noreferrer" onClick={() => geoeffnet(e)}>{inhalt}</a>;
      })}
    </div>
    <TextFenster id={text} zu={() => { setText(null); neu && neu(); }} />
    {datei && <DateiAnsicht e={datei} zu={() => { setDatei(null); neu && neu(); }} />}
  </>;
}

// Datei in der Lernumgebung ansehen (PDF, Bilder, Ton, Video, Text). Herunterladen geht dort nicht.
export function DateiAnsicht({ e, zu }) {
  useEffect(() => { const k = (x) => { if (x.key === "Escape") zu(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, []);
  const src = `/api/material/${e.id}/datei?ansicht=1`, mime = e.mime || "";
  return <div className="datei-ansicht" role="dialog" aria-label={e.titel}>
    <div className="datei-ansicht-kopf"><b>{e.titel}</b><button className="knopf" onClick={zu} autoFocus>Schliessen</button></div>
    {mime.startsWith("image/") ? <div className="datei-ansicht-bild"><img src={src} alt={e.titel} /></div>
      : mime.startsWith("video/") ? <video src={src} controls />
      : mime.startsWith("audio/") ? <div style={{ padding: 24 }}><audio src={src} controls /></div>
      : mime === "application/pdf" ? <Suspense fallback={<p className="leise" style={{ padding: 24 }}>PDF wird geladen …</p>}><PdfAnsicht src={src} titel={e.titel} /></Suspense>
      : INLINE.test(mime) ? <iframe src={src} title={e.titel} />
      : <div className="leer" style={{ margin: 24 }}><b>Diese Datei lässt sich in der Lernumgebung nicht anzeigen</b><span>Möglich sind PDF, Bilder, Ton, Video und Text. Ihre Lehrperson kann die Datei als PDF bereitstellen.</span></div>}
  </div>;
}

function TextFenster({ id, zu }) {
  const [d, setD] = useState(null);
  useEffect(() => { setD(null); if (id) api(`/api/material/${id}`).then(setD).catch(() => setD({ titel: "Nicht gefunden", inhalt: "" })); }, [id]);
  return <Dialog offen={!!id} titel={d ? d.titel : ""} onZu={zu}>
    {d ? <div className="stapel" style={{ gap: 14 }}>{d.hinweis && <div className="hinweis">{d.hinweis}</div>}<div className="textinhalt">{d.inhalt}</div><div className="reihe" style={{ justifyContent: "flex-end" }}><button className="knopf" onClick={zu}>Schliessen</button></div></div> : <p className="leise">Wird geladen …</p>}
  </Dialog>;
}

export default function MeinMaterial() {
  const { kurz } = useParams();
  const [suche, setSuche] = useState(""); const [s2, setS2] = useState("");
  useEffect(() => { const t = setTimeout(() => setS2(suche), 220); return () => clearTimeout(t); }, [suche]);
  const z = useLaden(`/api/mein-material${s2 ? `?suche=${encodeURIComponent(s2)}` : ""}`);
  return (
    <div>
      <div className="kopf"><div><h1>Material</h1><p className="leise" style={{ marginTop: 6 }}>Alles, was Ihre Lehrpersonen für Sie freigegeben haben.</p></div></div>
      <div className="werkzeugleiste"><div className="suchfeld" style={{ maxWidth: 560 }}><Symbol.suche /><input type="search" value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="Titel oder Text im Dokument suchen" aria-label="Material suchen" /></div></div>
      <Laden zustand={z}>{(d) => !d.faecher.length
        ? <div className="leer"><b>{s2 ? "Nichts gefunden" : "Noch kein Material"}</b><span>{s2 ? "Versuchen Sie ein anderes Wort." : "Sobald eine Lehrperson etwas für Ihre Klasse freigibt, erscheint es hier."}</span></div>
        : <div className="stapel" style={{ gap: 30 }}>
          {d.faecher.map((f) => <section key={f.unterricht_id} className="abschnitt">
            <div className="abschnitt-kopf"><h2 style={{ display: "flex", gap: 10, alignItems: "center" }}><span className="punkt" style={{ background: f.farbe, width: 12, height: 12 }} />{f.fach}</h2>
              <Link className="leise klein" to={`/s/${kurz}/unterricht/${f.unterricht_id}/material`}>Alles in {f.fach}</Link></div>
            <MaterialAnsicht eintraege={s2 ? f.eintraege : f.eintraege.slice(0, 5)} neu={z.neu} />
          </section>)}
        </div>}</Laden>
    </div>);
}
