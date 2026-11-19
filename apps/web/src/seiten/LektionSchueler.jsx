// Lektion für Schülerinnen und Schüler: was die Lehrperson gerade zeigt, erlaubte Seiten, Material der Klasse.
// Meldet alle paar Sekunden, dass die Seite offen ist (und ob sie im Vordergrund ist). In der Lernumgebung übernimmt die App
// mit derselben Antwort die erlaubten Seiten.
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api.js";
import { Laden, Symbol, useLaden } from "../ui.jsx";
import { MaterialAnsicht } from "./MeinMaterial.jsx";
import Taschenrechner from "./pruefung/Taschenrechner.jsx";

const PdfAnsicht = lazy(() => import("./PdfAnsicht.jsx"));
const LU = typeof window !== "undefined" ? window.trimezLernumgebung : undefined; // nur in der App vorhanden
const INLINE = /^(application\/pdf|image\/|text\/plain|audio\/|video\/)/;

export default function LektionSchueler() {
  const { kurz, lid } = useParams();
  const [d, setD] = useState(null); const [fehler, setFehler] = useState(null); const [netz, setNetz] = useState(true);
  const [rechner, setRechner] = useState(false);
  const gesehen = useRef(0);
  useEffect(() => {
    let aus = false;
    const puls = async () => {
      try {
        const x = await api(`/api/lektionen/${lid}?puls=1&sichtbar=${document.visibilityState === "visible" && document.hasFocus() ? 1 : 0}&nr=${gesehen.current}`);
        if (aus) return;
        setD(x); setNetz(true);
        // Neuer Anstoss: gleich bestätigen, dass er angezeigt wird
        if (x.anstoss && x.anstoss.nr > gesehen.current) { gesehen.current = x.anstoss.nr; setTimeout(puls, 300); }
      } catch (e) { if (!aus) { if (e.status) setFehler(e); else setNetz(false); } }
    };
    puls();
    const t = setInterval(puls, 4000);
    const sofort = () => puls();
    document.addEventListener("visibilitychange", sofort); window.addEventListener("focus", sofort); window.addEventListener("blur", sofort);
    return () => { aus = true; clearInterval(t); document.removeEventListener("visibilitychange", sofort); window.removeEventListener("focus", sofort); window.removeEventListener("blur", sofort); };
  }, [lid]);
  // Lernumgebung: Während die Lektion sie verlangt, lässt sich die App nicht schliessen; angehalten: Hilfsmittel-Fenster zu
  useEffect(() => {
    if (!LU || !d) return;
    LU.status(!d.beendet && d.lernumgebung.pflicht).catch(() => {});
    if (d.angehalten && LU.hilfsmittelSchliessen) LU.hilfsmittelSchliessen().catch(() => {});
  }, [d && d.beendet, d && d.lernumgebung && d.lernumgebung.pflicht, d && d.angehalten]);
  useEffect(() => () => { if (LU) LU.status(false).catch(() => {}); }, []);

  if (!d) return <Laden zustand={{ daten: null, fehler }}>{() => null}</Laden>;
  const seiteOeffnen = (url) => { if (LU) LU.seiteOeffnen(url).catch((x) => alert(String(x))); else window.open(url, "_blank", "noopener"); };

  return <div className="lk-schueler">
    <div className="kopf">
      <div>
        <div className="pfad"><Link to={`/s/${kurz}/`}>Übersicht</Link></div>
        <h1 style={{ display: "flex", gap: 14, alignItems: "center" }}><span className="punkt" style={{ background: d.farbe, width: 14, height: 14, borderRadius: 4 }} />{d.fach} {d.klasse}</h1>
        <p className="leise" style={{ margin: "4px 0 0" }}>{d.beendet ? "Die Lektion ist beendet." : `Lektion bei ${d.lehrperson}`}{!netz && <span className="lk-offline"> Keine Verbindung, wird wieder versucht …</span>}</p>
      </div>
    </div>

    {d.beendet ? <div className="leer"><b>Die Lektion ist beendet</b><span>Das Material der Klasse finden Sie weiterhin unter Material.</span>
      <div className="reihe"><Link className="knopf" to={`/s/${kurz}/unterricht/${d.unterricht_id}/material`}>Zum Material</Link>{LU && <button className="knopf" onClick={() => LU.beenden().catch((x) => alert(String(x)))}>Lernumgebung schliessen</button>}</div></div> : <>
      {d.lernumgebung.pflicht && !LU && <div className="hinweis" style={{ marginBottom: 18 }}><span><b>Ihre Lehrperson möchte, dass Sie die Lernumgebung verwenden.</b> Öffnen Sie die App «RESCOOL Lernumgebung» und melden Sie sich dort an. <Link to={`/s/${kurz}/lernumgebung`}>So geht es</Link></span></div>}

      {d.anstoss ? <Anstoss a={d.anstoss} seiteOeffnen={seiteOeffnen} /> :
        <div className="lk-warten"><Symbol.lektion /><div><b>Noch nichts gezeigt</b><span>Wenn Ihre Lehrperson etwas an alle sendet, erscheint es hier.</span></div></div>}

      {(d.rechner || d.notizbuch || d.seiten.length > 0) && <section className="abschnitt">
        <div className="abschnitt-kopf"><h2>Erlaubt in dieser Lektion</h2></div>
        <div className="lk-erlaubt">
          {d.seiten.map((s) => <button key={s.url} className="lk-seite" onClick={() => seiteOeffnen(s.url)}><Symbol.oeffnen /><span><b>{s.titel}</b><small>{s.url.replace(/^https:\/\//, "")}</small></span></button>)}
          {d.rechner && <button className="lk-seite" aria-pressed={rechner} onClick={() => setRechner(!rechner)}><Symbol.plus /><span><b>Taschenrechner</b><small>wissenschaftlich</small></span></button>}
          {d.notizbuch && <Link className="lk-seite" to={`/s/${kurz}/notizbuch/${d.unterricht_id}`}><Symbol.notizbuch /><span><b>Kursnotizbuch</b><small>{d.fach} {d.klasse}</small></span></Link>}
        </div>
      </section>}

      <KlassenMaterial uid={d.unterricht_id} />
    </>}

    {rechner && d.rechner && !d.beendet && <Taschenrechner zu={() => setRechner(false)} />}
    {d.angehalten && !d.beendet && <div className="lk-halt" role="alertdialog" aria-labelledby="lk-halt-t">
      <Symbol.anhalten />
      <b id="lk-halt-t">Bitte nach vorne schauen</b>
      <span>{d.lehrperson} hat die Bildschirme angehalten. Es geht gleich weiter.</span>
    </div>}
  </div>;
}

function Anstoss({ a, seiteOeffnen }) {
  const [m, setM] = useState(null); const [f, setF] = useState(null);
  useEffect(() => { setM(null); setF(null); if (a.art === "material") api(`/api/material/${a.material_id}`).then(setM).catch(setF); }, [a.nr]);
  const kopf = <div className="lk-gezeigt-kopf"><span>Von Ihrer Lehrperson, {new Date(a.zeit).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })}</span><b>{a.titel}</b></div>;
  if (a.art === "seite") return <div className="lk-gezeigt">{kopf}<div className="reihe"><button className="knopf haupt-knopf" onClick={() => seiteOeffnen(a.url)}><Symbol.oeffnen />Seite öffnen</button><span className="leise klein">{a.url.replace(/^https:\/\//, "")}</span></div></div>;
  if (f) return <div className="lk-gezeigt">{kopf}<div className="hinweis fehler">{f.message}</div></div>;
  if (!m) return <div className="lk-gezeigt">{kopf}<p className="leise">Wird geladen …</p></div>;
  const datei = `/api/material/${m.id}/datei`;
  return <div className="lk-gezeigt">
    {kopf}
    {m.hinweis && <div className="hinweis">{m.hinweis}</div>}
    {m.typ === "text" ? <div className="textinhalt">{m.inhalt}</div>
      : m.typ === "link" ? <div className="reihe"><button className="knopf haupt-knopf" onClick={() => seiteOeffnen(m.url)}><Symbol.oeffnen />Öffnen</button><span className="leise klein">{m.host}</span></div>
      : INLINE.test(m.mime || "") ? <>
          {m.mime.startsWith("image/") ? <img className="lk-bild" src={`${datei}?ansicht=1`} alt={m.titel} />
            : m.mime.startsWith("video/") ? <video className="lk-bild" src={`${datei}?ansicht=1`} controls />
            : m.mime.startsWith("audio/") ? <audio src={`${datei}?ansicht=1`} controls />
            : m.mime === "application/pdf" ? <div className="lk-rahmen"><Suspense fallback={<p className="leise">PDF wird geladen …</p>}><PdfAnsicht src={`${datei}?ansicht=1`} titel={m.titel} /></Suspense></div>
            : <iframe className="lk-rahmen" src={`${datei}?ansicht=1`} title={m.titel} />}
          {!LU && <div className="reihe"><a className="knopf" href={datei}>Herunterladen</a></div>}
        </>
      : LU ? <p className="leise">Diese Datei lässt sich in der Lernumgebung nicht anzeigen (möglich sind PDF, Bilder, Ton, Video und Text).</p>
      : <div className="reihe"><a className="knopf haupt-knopf" href={datei}>{m.dateiname || "Datei"} herunterladen</a></div>}
  </div>;
}

function KlassenMaterial({ uid }) {
  const z = useLaden(`/api/unterricht/${uid}/material`);
  if (!z.daten || !z.daten.eintraege.length) return null;
  return <section className="abschnitt">
    <div className="abschnitt-kopf"><h2>Material der Klasse</h2></div>
    <MaterialAnsicht eintraege={z.daten.eintraege} neu={z.neu} leer="" />
  </section>;
}
