import { createContext, useContext, useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Link, NavLink, Navigate, useParams, useNavigate, useLocation, Outlet } from "react-router-dom";
import { api } from "./api.js";
import { MeldungAnbieter, Symbol, Marke, Wortmarke, initialen } from "./ui.jsx";
import { TEXTE } from "@schule/shared";
import Anmelden from "./seiten/Anmelden.jsx";
import ZweiterFaktor from "./seiten/ZweiterFaktor.jsx";
import Uebersicht from "./seiten/Uebersicht.jsx";
import Schuljahre from "./seiten/Schuljahre.jsx";
import Faecher from "./seiten/Faecher.jsx";
import Klassen, { KlasseDetail } from "./seiten/Klassen.jsx";
import Personen from "./seiten/Personen.jsx";
import UnterrichtSeite from "./seiten/Unterricht.jsx";
import Import from "./seiten/Import.jsx";
import Protokoll from "./seiten/Protokoll.jsx";
import Konto from "./seiten/Konto.jsx";
import Notenbuch from "./seiten/Notenbuch.jsx";
import Muendlich from "./seiten/Muendlich.jsx";
import MeineNoten from "./seiten/MeineNoten.jsx";
import Material from "./seiten/Material.jsx";
import MeinMaterial from "./seiten/MeinMaterial.jsx";
import UnterrichtMaterial from "./seiten/UnterrichtMaterial.jsx";
import Pruefungen from "./seiten/pruefung/Pruefungen.jsx";
import PruefungEditor from "./seiten/pruefung/PruefungEditor.jsx";
import PruefungVorschau from "./seiten/pruefung/Vorschau.jsx";
import Umwandlung from "./seiten/pruefung/Umwandlung.jsx";
import Pruefungsmodus from "./seiten/pruefung/Pruefungsmodus.jsx";
import Aufsicht from "./seiten/pruefung/Aufsicht.jsx";
import Korrektur from "./seiten/pruefung/Korrektur.jsx";
import Ergebnis from "./seiten/pruefung/Ergebnis.jsx";
import LernumgebungSeite from "./seiten/Lernumgebung.jsx";
import Lektion from "./seiten/Lektion.jsx";
import LektionSchueler from "./seiten/LektionSchueler.jsx";
import Auftraege, { AuftragDetail } from "./seiten/Auftraege.jsx";
import Raeume, { Raum } from "./seiten/Raum.jsx";
import Mitteilungen, { Glocke } from "./seiten/Mitteilungen.jsx";
import Formulare, { Formular, FormularOeffentlich } from "./seiten/Formulare.jsx";
import Kalender from "./seiten/Kalender.jsx";
import Absenzen, { SchuelerAbsenzen } from "./seiten/Absenzen.jsx";
import Ablage, { Laufwerk } from "./seiten/Ablage.jsx";
import Zeugnisse from "./seiten/Zeugnisse.jsx";
import Matura, { MaturaDetail } from "./seiten/Matura.jsx";
import Eltern from "./seiten/Eltern.jsx";
import { lazy, Suspense } from "react";
const Notizbuecher = lazy(() => import("./notizbuch/Notizbuecher.jsx"));
const NotizbuchSeite = lazy(() => import("./notizbuch/Notizbuch.jsx"));
const Spaeter = ({ children }) => <Suspense fallback={<p className="leise">Wird geladen …</p>}>{children}</Suspense>;

const N = TEXTE.nav;
const IchCtx = createContext(null);
export const useIch = () => useContext(IchCtx);

function Bereich() {
  const { kurz } = useParams();
  const nav = useNavigate();
  const ort = useLocation();
  const [ich, setIch] = useState(undefined);
  const [rechte, setRechte] = useState({});
  const [menu, setMenu] = useState(false);
  const laden = async () => {
    try { const d = await api("/api/ich"); setIch(d); setRechte(await api("/api/rechte")); }
    catch (e) { if (e.status === 401) nav(`/s/${kurz}/anmelden`, { replace: true }); else setIch(null); }
  };
  useEffect(() => { laden(); }, [kurz]);
  useEffect(() => setMenu(false), [ort.pathname]);
  if (ich === undefined) return <p className="leise" style={{ padding: 32 }}>Wird geladen …</p>;
  if (ich === null) return <div className="haupt"><div className="hinweis fehler">Der Server ist gerade nicht erreichbar. Bitte Seite neu laden.</div></div>;
  if (ich.schule.kurzname !== kurz) return <Navigate to={`/s/${ich.schule.kurzname}/`} replace />;
  if (ich.zweiterFaktor.einrichtenPflicht && !ort.pathname.endsWith("/zweiter-faktor")) return <Navigate to={`/s/${kurz}/zweiter-faktor`} replace />;

  const b = `/s/${kurz}`;
  const L = (to, text, Sym, end) => <NavLink className="nav-link" to={to} end={end}><Sym />{text}</NavLink>;
  const abmelden = async () => { await api("/api/abmelden", { methode: "POST" }).catch(() => {}); nav(`/s/${kurz}/anmelden`); };
  const verwalten = rechte["klasse.verwalten"];
  const schueler = ich.rollen.includes("schueler") && ich.rollen.length === 1;
  const nurEltern = ich.rollen.includes("eltern") && ich.rollen.length === 1;
  const voll = /\/notizbuch\/[0-9a-f-]{36}/.test(ort.pathname);
  const eingebettet = new URLSearchParams(ort.search).get("eingebettet") === "1";
  const breit = /\/(noten|umwandlung\/[^/]+)$/.test(ort.pathname) || /\/pruefungen\/[^/]+(\/(aufsicht|korrektur))?$/.test(ort.pathname);
  if (eingebettet) return <IchCtx.Provider value={{ ...ich, rechte, neu: laden }}><main className="haupt voll eingebettet"><Outlet /></main></IchCtx.Provider>;
  return (
    <IchCtx.Provider value={{ ...ich, rechte, neu: laden }}>
      <div className="mobil-kopf">
        <button className="knopf leise-knopf" aria-label="Menü öffnen" aria-expanded={menu} onClick={() => setMenu(!menu)}><Symbol.menu /></button>
        <b>{ich.schule.name.replace(/ \(Testschule\)$/, "")}</b>
      </div>
      {menu && <div className="nav-schleier" onClick={() => setMenu(false)} aria-hidden="true" />}
      <div className="geruest">
        <nav className={"tafel" + (menu ? " offen" : "")} aria-label="Hauptnavigation">
          <div className="marke"><Wortmarke /><span className="schule-name">{ich.schule.name.replace(/ \(Testschule\)$/, "")}</span></div>
          {!ich.zweiterFaktor.einrichtenPflicht && <>
            {L(`${b}/`, N.start, Symbol.start, true)}
            <Glocke kurz={kurz} />
            {nurEltern ? <>
              {L(`${b}/kalender`, "Kalender", Symbol.kalender)}
              {rechte.matura && L(`${b}/matura`, "Maturaarbeit", Symbol.matura)}
            </> : schueler ? <>
              {L(`${b}/kalender`, "Kalender", Symbol.kalender)}
              {L(`${b}/auftraege`, "Aufträge", Symbol.auftrag)}
              {L(`${b}/raum`, "Klassenräume", Symbol.raum)}
              {L(`${b}/notizbuch`, "Notizbücher", Symbol.notizbuch)}
              {L(`${b}/material`, "Material", Symbol.material)}
              {L(`${b}/formulare`, "Formulare", Symbol.formular)}
              {L(`${b}/ablage`, "Ablage", Symbol.ablage)}
              {L(`${b}/meine-noten`, "Meine Noten", Symbol.noten)}
              {L(`${b}/absenzen`, "Absenzen", Symbol.absenz)}
              {rechte.matura && L(`${b}/matura`, "Maturaarbeit", Symbol.matura)}
              {L(`${b}/lernumgebung`, "Lernumgebung", Symbol.unterricht)}
            </> : <>
              {L(`${b}/kalender`, "Kalender", Symbol.kalender)}
              {ich.unterrichtet && L(`${b}/auftraege`, "Aufträge", Symbol.auftrag)}
              {ich.unterrichtet && L(`${b}/raum`, "Klassenräume", Symbol.raum)}
              {ich.unterrichtet && L(`${b}/notizbuch`, "Notizbücher", Symbol.notizbuch)}
              {rechte["material.erstellen"] && L(`${b}/material`, "Material", Symbol.material)}
              {rechte["pruefung.verwalten"] && L(`${b}/pruefungen`, "Prüfungen", Symbol.pruefung)}
              {rechte["formular.verwalten"] && L(`${b}/formulare`, "Formulare", Symbol.formular)}
              {L(`${b}/ablage`, "Ablage", Symbol.ablage)}
              {(ich.unterrichtet || rechte.absenzen) && L(`${b}/absenzen`, "Absenzen", Symbol.absenz)}
              {L(`${b}/klassen`, N.klassen, Symbol.klasse)}
              {L(`${b}/unterricht`, ich.rechte?.["unterricht.verwalten"] || verwalten ? N.unterricht : "Mein Unterricht", Symbol.unterricht)}
              {rechte.zeugnisse && L(`${b}/zeugnisse`, "Zeugnisse", Symbol.zeugnis)}
              {rechte.matura && L(`${b}/matura`, "Maturaarbeiten", Symbol.matura)}
            </>}
            {verwalten && <>
              <div className="nav-gruppe">Verwaltung</div>
              {L(`${b}/personen`, N.personen, Symbol.person)}
              {L(`${b}/faecher`, N.faecher, Symbol.fach)}
              {L(`${b}/schuljahre`, N.schuljahre, Symbol.jahr)}
              {L(`${b}/import`, N.import, Symbol.import)}
            </>}
            {rechte["protokoll.lesen"] && L(`${b}/protokoll`, N.protokoll, Symbol.protokoll)}
          </>}
          <div className="tafel-fuss">
            <div className="ich"><span className="avatar" aria-hidden="true">{initialen(ich.person)}</span><div><b>{ich.person.vorname} {ich.person.nachname}</b><span>{ich.rollen.map((r) => TEXTE.rollen[r]).join(", ")}</span></div></div>
            {L(`${b}/konto`, N.konto, Symbol.konto)}
            <button className="nav-link" onClick={abmelden}><Symbol.aus />{N.abmelden}</button>
          </div>
        </nav>
        <main className={"haupt" + (breit ? " breit" : "") + (voll ? " voll" : "")} id="inhalt">{schueler && <LektionImHintergrund kurz={kurz} />}<Outlet /></main>
      </div>
    </IchCtx.Provider>
  );
}

// In der Lernumgebung: Die laufende Lektion gilt auf jeder Seite, nicht erst auf der Lektionsseite.
// Der regelmässige Abruf liefert der App die erlaubten Seiten (und meldet der Lehrperson, dass man dabei ist).
// Endet die Lektion, holt ein letzter Abruf «beendet», damit die App die Seiten wieder sperrt.
function LektionImHintergrund({ kurz }) {
  const lu = typeof window !== "undefined" ? window.trimezLernumgebung : undefined;
  const ort = useLocation();
  const [l, setL] = useState(null);
  useEffect(() => {
    if (!lu) return;
    let aus = false, letzte = null;
    const pruefen = async () => {
      try {
        const d = await api("/api/meine-lektionen");
        const jetzt = d.laufend[0] || null;
        if (aus) return;
        setL(jetzt);
        // Auf einer Lektionsseite fragt die Seite selbst ab; sonst würden zwei Lektionen abwechselnd die erlaubten Seiten setzen
        if (jetzt && !/\/lektion\/[0-9a-f-]{36}/.test(location.pathname)) await api(`/api/lektionen/${jetzt.id}?puls=1&sichtbar=${document.hasFocus() ? 1 : 0}`);
        if (!jetzt && letzte) await api(`/api/lektionen/${letzte}`);
        letzte = jetzt ? jetzt.id : null;
      } catch { /* nächster Versuch in ein paar Sekunden */ }
    };
    pruefen(); const t = setInterval(pruefen, 5000);
    return () => { aus = true; clearInterval(t); };
  }, []);
  if (!lu || !l || ort.pathname.includes(`/lektion/${l.id}`)) return null;
  return <Link className="lektion-leiste" to={`/s/${kurz}/lektion/${l.id}`}><b>Lektion läuft: {l.fach} bei {l.lp_vorname} {l.lp_nachname}</b><span>Zur Lektion</span></Link>;
}

// In der Lernumgebung: erlaubte Seiten als Tabs. Die App zeigt die fremde Seite unter dieser Leiste an,
// der Tab «RESCOOL» blendet sie aus. Nur erlaubte Seiten lassen sich öffnen (die App prüft jede Adresse).
function LernumgebungTabs() {
  const lu = typeof window !== "undefined" ? window.trimezLernumgebung : undefined;
  const [st, setSt] = useState({ tabs: [], aktiv: null });
  useEffect(() => {
    if (!lu || !lu.tabs) return;
    const laden = () => lu.tabs().then(setSt).catch(() => {});
    laden(); const t = setInterval(laden, 1500);
    window.addEventListener("trimez-tabs", laden);
    return () => { clearInterval(t); window.removeEventListener("trimez-tabs", laden); };
  }, []);
  const mit = !!lu && st.tabs.length > 0;
  useEffect(() => { document.body.classList.toggle("lu-mit-tabs", mit); }, [mit]);
  if (!mit) return null;
  const name = (u) => { try { const x = new URL(u); return (x.hostname.replace(/^www\./, "") + x.pathname.replace(/\/$/, "")).slice(0, 40); } catch { return u; } };
  const tun = (p) => p.then(setSt).catch((x) => alert(String(x)));
  return <nav className="lu-tabs" aria-label="Geöffnete Seiten">
    <button className={"lu-tab" + (!st.aktiv ? " aktiv" : "")} onClick={() => tun(lu.tabZeigen(null))}>RESCOOL</button>
    {st.tabs.map((t) => <span key={t.id} className={"lu-tab" + (st.aktiv === t.id ? " aktiv" : "")}>
      <button onClick={() => tun(lu.tabZeigen(t.id))} title={t.url}>{name(t.url)}</button>
      <button className="lu-tab-zu" aria-label={`${name(t.url)} schliessen`} onClick={() => tun(lu.tabSchliessen(t.id))}>×</button>
    </span>)}
  </nav>;
}

// In der Lernumgebung: immer ein Weg hinaus (ausser während einer Prüfung; dann verweigert die App das Beenden ohnehin)
function LernumgebungSchliessen() {
  const ort = useLocation();
  const lu = typeof window !== "undefined" ? window.trimezLernumgebung : undefined;
  if (!lu || /\/pruefung\//.test(ort.pathname)) return null;
  return <button className="lu-schliessen" onClick={() => lu.beenden().catch((x) => alert(String(x)))}>Lernumgebung schliessen</button>;
}

export default function App() {
  return (
    <MeldungAnbieter>
      <BrowserRouter>
        <LernumgebungTabs />
        <LernumgebungSchliessen />
        <Routes>
          <Route path="/" element={<Start />} />
          <Route path="/s/:kurz/anmelden" element={<Anmelden />} />
          <Route path="/s/:kurz/pruefung/:vid" element={<Pruefungsmodus />} />
          <Route path="/f/:token" element={<FormularOeffentlich />} />
          <Route path="/s/:kurz" element={<Bereich />}>
            <Route index element={<StartSeite />} />
            <Route path="mitteilungen" element={<Mitteilungen />} />
            <Route path="auftraege" element={<Auftraege />} />
            <Route path="auftraege/:id" element={<AuftragDetail />} />
            <Route path="raum" element={<Raeume />} />
            <Route path="raum/:uid" element={<Raum />} />
            <Route path="formulare" element={<Formulare />} />
            <Route path="formulare/:id" element={<Formular />} />
            <Route path="kalender" element={<Kalender />} />
            <Route path="absenzen" element={<Absenzen />} />
            <Route path="absenzen/schueler/:sid" element={<SchuelerAbsenzen />} />
            <Route path="ablage" element={<Ablage />} />
            <Route path="ablage/:lw" element={<Laufwerk />} />
            <Route path="zeugnisse" element={<Zeugnisse />} />
            <Route path="matura" element={<Matura />} />
            <Route path="matura/:id" element={<MaturaDetail />} />
            <Route path="eltern" element={<Eltern />} />
            <Route path="zweiter-faktor" element={<ZweiterFaktor />} />
            <Route path="schuljahre" element={<Schuljahre />} />
            <Route path="faecher" element={<Faecher />} />
            <Route path="klassen" element={<Klassen />} />
            <Route path="klassen/:id" element={<KlasseDetail />} />
            <Route path="personen" element={<Personen />} />
            <Route path="unterricht" element={<UnterrichtSeite />} />
            <Route path="unterricht/:uid/noten" element={<Notenbuch />} />
            <Route path="unterricht/:uid/muendlich" element={<Muendlich />} />
            <Route path="meine-noten" element={<MeineNoten />} />
            <Route path="material" element={<MaterialStart />} />
            <Route path="unterricht/:uid/material" element={<UnterrichtMaterial />} />
            <Route path="unterricht/:uid/lektion" element={<Lektion />} />
            <Route path="lektion/:lid" element={<LektionSchueler />} />
            <Route path="pruefungen" element={<Pruefungen />} />
            <Route path="pruefungen/:pid" element={<PruefungEditor />} />
            <Route path="pruefungen/:pid/vorschau" element={<PruefungVorschau />} />
            <Route path="pruefungen/:pid/umwandlung/:uid" element={<Umwandlung />} />
            <Route path="pruefungen/:pid/aufsicht" element={<Aufsicht />} />
            <Route path="pruefungen/:pid/korrektur" element={<Korrektur />} />
            <Route path="ergebnis/:vid" element={<Ergebnis />} />
            <Route path="lernumgebung" element={<LernumgebungSeite />} />
            <Route path="notizbuch" element={<Spaeter><Notizbuecher /></Spaeter>} />
            <Route path="notizbuch/:uid" element={<Spaeter><NotizbuchSeite /></Spaeter>} />
            <Route path="import" element={<Import />} />
            <Route path="protokoll" element={<Protokoll />} />
            <Route path="konto" element={<Konto />} />
            <Route path="*" element={<div className="leer"><b>Diese Seite gibt es nicht.</b></div>} />
          </Route>
          <Route path="*" element={<Start />} />
        </Routes>
      </BrowserRouter>
    </MeldungAnbieter>
  );
}

// Eltern (ohne andere Rolle) starten bei ihren Kindern
function StartSeite() {
  const ich = useIch();
  return ich.rollen.length === 1 && ich.rollen[0] === "eltern" ? <Eltern /> : <Uebersicht />;
}

// Lehrpersonen: Ablage. Schülerinnen und Schüler: freigegebenes Material.
function MaterialStart() {
  const ich = useIch();
  return ich.rechte["material.erstellen"] ? <Material /> : <MeinMaterial />;
}

// Ohne Schule in der Adresse: Kurzname eingeben
function Start() {
  const nav = useNavigate();
  const [k, setK] = useState("");
  return (
    <div className="anmelde-seite">
      <AnmeldeTafel />
      <div className="anmelde-papier">
        <form className="anmelde-karte" onSubmit={(e) => { e.preventDefault(); if (k.trim()) nav(`/s/${k.trim().toLowerCase()}/anmelden`); }}>
          <h1 style={{ fontSize: "1.5rem" }}>Zu Ihrer Schule</h1>
          <p className="leise">Geben Sie den Kurznamen Ihrer Schule ein. Er steht in der Einladung.</p>
          <label className="feld">Kurzname der Schule<input value={k} onChange={(e) => setK(e.target.value)} placeholder="z. B. seeufer" autoCapitalize="none" autoFocus /></label>
          <button className="knopf haupt-knopf breit">Weiter</button>
        </form>
      </div>
    </div>
  );
}

export function AnmeldeTafel({ schule }) {
  return (
    <aside className="anmelde-tafel">
      <div className="reihe" style={{ gap: 12, color: "#fff" }}><span className="wortmarke" style={{ color: "#fff" }}><Marke />RESCOOL</span></div>
      <div className="stapel" style={{ gap: 18 }}>
        <p className="gross">Notizen, Material, Noten und Prüfungen. <em>An einem Ort.</em></p>
        <p>{schule ? `${schule.name.replace(/ \(Testschule\)$/, "")}.` : "Für Gymnasien in der Schweiz."} Daten in der Schweiz, Zugriff nur für Berechtigte, jede Änderung nachvollziehbar.</p>
      </div>
      <p className="unten klein" style={{ color: "#97A2CC" }}>RESCOOL</p>
    </aside>
  );
}
