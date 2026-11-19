// Prüfungsmodus für Schülerinnen und Schüler: ohne Menü, mit Zeit, laufendem Speichern und Abgabe mit Quittung.
// Antworten gehen sofort in eine Warteschlange (auch im Browser gespeichert) und werden gesendet, sobald das Netz da ist.
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../api.js";
import { Dialog, Marke } from "../../ui.jsx";
import Pruefungsblatt from "./Pruefungsblatt.jsx";
import Taschenrechner from "./Taschenrechner.jsx";

const LU = typeof window !== "undefined" ? window.trimezLernumgebung : undefined; // nur in der App vorhanden

const ablage = { lesen: (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } }, schreiben: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }, weg: (k) => { try { localStorage.removeItem(k); } catch {} } };
const istBeantwortet = (w) => w !== undefined && w !== null && w !== "" && !(Array.isArray(w) && !w.some((x) => x !== "" && x != null)) && !(typeof w === "object" && !Array.isArray(w) && !Object.values(w).some(Boolean));

export default function Pruefungsmodus() {
  const { kurz, vid } = useParams(); const nav = useNavigate();
  const [d, setD] = useState(null); const [fehler, setFehler] = useState(null);
  const laden = useCallback(async () => {
    try { setD(await api(`/api/versuche/${vid}`)); }
    catch (e) { if (e.status === 401) nav(`/s/${kurz}/anmelden`); else setFehler(e); }
  }, [vid, kurz, nav]);
  useEffect(() => { laden(); }, [laden]);
  // Der App melden, ob gerade geschrieben wird (dann lässt sie sich nicht schliessen)
  useEffect(() => { if (LU && d) LU.status(d.status === "laeuft").catch(() => {}); }, [d]);
  if (fehler && fehler.feld === "lernumgebung") return <LernumgebungNoetig text={fehler.message} kurz={kurz} />;
  if (fehler) return <div className="pm-voll"><div className="hinweis fehler">{fehler.message}</div></div>;
  if (!d) return <div className="pm-voll"><p className="leise">Prüfung wird geladen …</p></div>;
  if (d.status === "abgegeben") return <Quittung d={d} kurz={kurz} vid={vid} />;
  return <Schreiben d={d} vid={vid} neuLaden={laden} />;
}

function Schreiben({ d, vid, neuLaden }) {
  const SCHL = `versuch:${vid}`;
  const gemerkt = ablage.lesen(SCHL);
  const [antworten, setAntworten] = useState(() => ({ ...d.antworten, ...(gemerkt && gemerkt.antworten) }));
  const warte = useRef((gemerkt && gemerkt.warte) || []);
  const seq = useRef(Math.max(d.seq, gemerkt ? gemerkt.seq : 0));
  const [zustand, setZustand] = useState({ art: "ok", zeit: null }); // ok | sendet | offline
  const [endet, setEndet] = useState(d.endet_am ? new Date(d.endet_am).getTime() : null);
  const versatz = useRef(new Date(d.jetzt).getTime() - Date.now());
  const [jetzt, setJetzt] = useState(Date.now());
  const [abgeben, setAbgeben] = useState(false);
  const [verlassen, setVerlassen] = useState(false);
  const [pos, setPos] = useState(d.position || 0);
  const [rechner, setRechner] = useState(false); const [hilfe, setHilfe] = useState(false); const [notiz, setNotiz] = useState(false);
  const e = d.pruefung.einstellungen;
  const seiteOeffnen = (url) => { setHilfe(false); if (LU) LU.seiteOeffnen(url).catch((x) => alert(String(x))); else window.open(url, "_blank", "noopener"); };
  const einzeln = d.pruefung.einstellungen.rueckwaerts === false;
  const aufgaben = d.teile.filter((t) => t.typ !== "abschnitt");

  const merken = () => ablage.schreiben(SCHL, { seq: seq.current, warte: warte.current, antworten });
  const senden = useCallback(async () => {
    if (!warte.current.length) return;
    const paket = warte.current.slice(0, 100);
    setZustand((z) => ({ ...z, art: "sendet" }));
    try {
      const r = await api(`/api/versuche/${vid}/antworten`, { methode: "POST", daten: { eintraege: paket } });
      warte.current = warte.current.filter((e) => e.seq > r.seq);
      if (r.endet_am) setEndet(new Date(r.endet_am).getTime());
      versatz.current = new Date(r.jetzt).getTime() - Date.now();
      setZustand({ art: warte.current.length ? "sendet" : "ok", zeit: new Date() });
    } catch (e) {
      if (e.status === 409 && e.feld === "konfig") { neuLaden(); return; } // Einstellungen geändert: neu laden, Antworten bleiben in der Warteschlange
      if (e.status === 409) { ablage.weg(SCHL); neuLaden(); return; } // abgegeben (Zeit oder Lehrperson)
      if (e.status === 403 && e.feld === "lernumgebung") { neuLaden(); return; }
      if (e.status === 0) setZustand((z) => ({ ...z, art: "offline" }));
      else setZustand((z) => ({ ...z, art: "fehler", text: e.message }));
    }
  }, [vid, neuLaden]);
  useEffect(() => { merken(); }, [antworten]);
  useEffect(() => { const t = setInterval(senden, 2500); return () => clearInterval(t); }, [senden]);
  useEffect(() => { const t = setInterval(() => setJetzt(Date.now()), 1000); return () => clearInterval(t); }, []);
  // Zeit und Status regelmässig abgleichen (Zuschlag, Ende durch die Lehrperson)
  useEffect(() => {
    const t = setInterval(async () => {
      try { const n = await api(`/api/versuche/${vid}`); if (n.status === "abgegeben") { ablage.weg(SCHL); neuLaden(); } else { setEndet(n.endet_am ? new Date(n.endet_am).getTime() : null); versatz.current = new Date(n.jetzt).getTime() - Date.now(); } } catch {}
    }, 20000);
    return () => clearInterval(t);
  }, [vid]);
  // Fenster verlassen wird gemeldet (höchstens alle 5 Sekunden)
  useEffect(() => {
    let zuletzt = 0;
    const melden = (art) => { if (Date.now() - zuletzt < 5000) return; zuletzt = Date.now(); setVerlassen(true); api(`/api/versuche/${vid}/warnung`, { methode: "POST", daten: { art } }).catch(() => {}); };
    const sicht = () => { if (document.visibilityState === "hidden") melden("fokus"); };
    // Wechsel ins eingebettete Notizbuch ist kein Verlassen
    const blur = () => setTimeout(() => { const a = document.activeElement; if (a && a.tagName === "IFRAME" && a.closest(".pm-notizbuch")) return; melden("fokus"); }, 0);
    const online = () => { api(`/api/versuche/${vid}/warnung`, { methode: "POST", daten: { art: "offline", detail: "Verbindung war unterbrochen" } }).catch(() => {}); senden(); };
    const weg = (e) => { if (warte.current.length) { e.preventDefault(); e.returnValue = ""; } };
    document.addEventListener("visibilitychange", sicht); window.addEventListener("blur", blur); window.addEventListener("online", online); window.addEventListener("beforeunload", weg);
    return () => { document.removeEventListener("visibilitychange", sicht); window.removeEventListener("blur", blur); window.removeEventListener("online", online); window.removeEventListener("beforeunload", weg); };
  }, [vid, senden]);

  const setAntwort = (tid, wert) => {
    setAntworten((a) => ({ ...a, [tid]: wert }));
    seq.current += 1;
    // pro Aufgabe nur die neueste Eingabe in der Warteschlange behalten
    warte.current = [...warte.current.filter((e) => e.teil_id !== tid), { seq: seq.current, teil_id: tid, wert, zeit: new Date().toISOString() }].sort((a, b) => a.seq - b.seq);
    clearTimeout(setAntwort.t); setAntwort.t = setTimeout(senden, 700);
  };
  const rest = endet ? Math.max(0, endet - (jetzt + versatz.current)) : null;
  const min = rest != null ? Math.floor(rest / 60000) : null, sek = rest != null ? Math.floor((rest % 60000) / 1000) : null;
  const beantwortet = aufgaben.filter((t) => istBeantwortet(antworten[t.id])).length;

  // Ohne Zurückblättern: eine Aufgabe nach der anderen (mit dem Abschnitt davor)
  let sichtbar = d.teile;
  if (einzeln) {
    const ziel = aufgaben[Math.min(pos, aufgaben.length - 1)];
    const k = d.teile.indexOf(ziel); let start = k; while (start > 0 && d.teile[start - 1].typ === "abschnitt") start--;
    sichtbar = d.teile.slice(start, k + 1);
  }
  const weiter = async () => { await senden(); const n = pos + 1; setPos(n); api(`/api/versuche/${vid}/weiter`, { methode: "POST", daten: { position: n } }).catch(() => {}); window.scrollTo(0, 0); };

  return (
    <div className="pm">
      <header className="pm-leiste">
        <div className="pm-titel"><span className="wappen klein"><Marke /></span><div><b>{d.pruefung.titel}</b><span>{d.pruefung.fach} {d.pruefung.klasse}</span></div></div>
        {rest != null && <div className={"pm-zeit" + (rest < 5 * 60000 ? " knapp" : "")} role="timer" aria-live={rest < 60000 ? "assertive" : "off"} aria-label={`Noch ${min} Minuten`}>{String(min).padStart(2, "0")}:{String(sek).padStart(2, "0")}<small>verbleibend</small></div>}
        <div className="pm-status" aria-live="polite">{zustand.art === "offline" ? <span className="offline">Keine Verbindung. Ihre Antworten sind auf diesem Gerät gesichert und werden gesendet, sobald das Netz zurück ist.</span>
          : zustand.art === "fehler" ? <span className="offline">{zustand.text}</span> : zustand.art === "sendet" ? "Wird gespeichert …" : zustand.zeit ? `Gespeichert ${zustand.zeit.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "Bereit"}</div>
        {(e.rechner || e.notizbuch || (e.seiten && e.seiten.length > 0)) && <div className="pm-hilfe">
          {e.rechner && <button className="knopf klein-knopf" onClick={() => setRechner(!rechner)} aria-pressed={rechner}>Taschenrechner</button>}
          {e.notizbuch && <button className="knopf klein-knopf" onClick={() => setNotiz(!notiz)} aria-pressed={notiz}>Notizbuch</button>}
          {e.seiten && e.seiten.length > 0 && <><button className="knopf klein-knopf" onClick={() => setHilfe(!hilfe)} aria-expanded={hilfe}>Erlaubte Seiten</button>
            {hilfe && <div className="pm-seiten" role="menu">{e.seiten.map((x) => <button key={x.url} role="menuitem" onClick={() => seiteOeffnen(x.url)}><b>{x.titel}</b><span>{x.url.replace(/^https:\/\//, "")}</span></button>)}</div>}</>}
        </div>}
        {LU && <span className="pm-lu" title={`Lernumgebung ${LU.version}`}>gesperrt</span>}
        <button className="knopf haupt-knopf" onClick={() => { senden(); setAbgeben(true); }}>Abgeben</button>
      </header>
      {rechner && <Taschenrechner zu={() => setRechner(false)} />}
      {notiz && e.notizbuch && <div className="pm-notizbuch" role="dialog" aria-label="Kursnotizbuch">
        <div className="pm-notizbuch-kopf"><b>Kursnotizbuch</b><button className="knopf klein-knopf" onClick={() => setNotiz(false)}>Schliessen</button></div>
        <iframe src={`/s/${kurz}/notizbuch/${e.unterricht_id}?eingebettet=1`} title="Kursnotizbuch" />
      </div>}
      {verlassen && <div className="pm-warnung" role="alert"><span>Sie haben das Prüfungsfenster verlassen. Das wird der Lehrperson angezeigt.</span><button className="knopf klein-knopf" onClick={() => setVerlassen(false)}>Verstanden</button></div>}
      <div className="pm-koerper">
        {!einzeln && <nav className="pm-navi" aria-label="Aufgaben">
          {aufgaben.map((t, k) => <button key={t.id} className={istBeantwortet(antworten[t.id]) ? "ja" : ""} onClick={() => document.getElementById("blatt-" + t.id)?.scrollIntoView({ behavior: "smooth", block: "start" })} aria-label={`Aufgabe ${k + 1}${istBeantwortet(antworten[t.id]) ? ", beantwortet" : ""}`}>{k + 1}</button>)}
          <span className="pm-navi-zahl">{beantwortet} von {aufgaben.length}</span>
        </nav>}
        <main className="pm-blatt">
          <Pruefungsblatt p={{ ...d.pruefung, einstellungen: { ...d.pruefung.einstellungen, mischen: false } }} teile={sichtbar} alleTeile={d.teile} antworten={antworten} setAntwort={setAntwort} schluessel={vid}
            kopf={einzeln ? <p className="leise klein" style={{ marginTop: 12 }}>Aufgabe {Math.min(pos + 1, aufgaben.length)} von {aufgaben.length}. Zurückblättern ist bei dieser Prüfung nicht möglich.</p> : null} />
          {einzeln && <div className="reihe" style={{ justifyContent: "flex-end", maxWidth: 860, margin: "18px auto" }}>
            {pos < aufgaben.length - 1 ? <button className="knopf haupt-knopf" onClick={() => { if (confirm("Zur nächsten Aufgabe? Sie können danach nicht mehr zurück.")) weiter(); }}>Nächste Aufgabe</button>
              : <button className="knopf haupt-knopf" onClick={() => { senden(); setAbgeben(true); }}>Prüfung abgeben</button>}
          </div>}
        </main>
      </div>
      <AbgabeDialog offen={abgeben} zu={() => setAbgeben(false)} aufgaben={aufgaben} antworten={antworten} vid={vid} senden={senden} warte={warte} fertig={() => { ablage.weg(SCHL); neuLaden(); }} />
    </div>);
}

function AbgabeDialog({ offen, zu, aufgaben, antworten, vid, senden, warte, fertig }) {
  const [laeuft, setLaeuft] = useState(false); const [fehler, setFehler] = useState("");
  const offenListe = aufgaben.map((t, k) => (istBeantwortet(antworten[t.id]) ? null : k + 1)).filter(Boolean);
  const los = async () => {
    setLaeuft(true); setFehler("");
    try {
      await senden();
      if (warte.current.length) throw new Error("Es sind noch nicht alle Antworten gespeichert. Bitte die Verbindung prüfen und nochmals versuchen.");
      await api(`/api/versuche/${vid}/abgeben`, { methode: "POST" }); fertig();
    } catch (e) { setFehler(e.message); setLaeuft(false); }
  };
  return <Dialog offen={offen} titel="Prüfung abgeben?" onZu={zu}>
    <div className="stapel" style={{ gap: 14 }}>
      {fehler && <div className="hinweis fehler" role="alert">{fehler}</div>}
      <p>Sie haben <b>{aufgaben.length - offenListe.length} von {aufgaben.length}</b> Aufgaben beantwortet.</p>
      {offenListe.length > 0 && <p className="hinweis">Noch ohne Antwort: Aufgabe {offenListe.join(", ")}</p>}
      <p className="leise klein">Nach der Abgabe können Sie nichts mehr ändern. Sie erhalten eine Quittung.</p>
      <div className="reihe" style={{ justifyContent: "flex-end" }}><button className="knopf leise-knopf" onClick={zu}>Weiterschreiben</button><button className="knopf haupt-knopf" onClick={los} disabled={laeuft}>{laeuft ? "Wird abgegeben …" : "Jetzt abgeben"}</button></div>
    </div>
  </Dialog>;
}

function Quittung({ d, kurz }) {
  const q = d.quittung, nav = useNavigate();
  const teile = (q.hash || "").slice(0, 16).match(/.{4}/g) || [];
  return (
    <div className="pm-voll">
      <div className="quittung">
        <div className="quittung-haken" aria-hidden="true"><svg viewBox="0 0 48 48" width="48" height="48"><path d="M12 25l8 8 16-18" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /></svg></div>
        <h1>Abgegeben</h1>
        <p className="leise">{d.pruefung.titel}, {d.pruefung.fach} {d.pruefung.klasse}</p>
        <dl>
          <div><dt>Zeit</dt><dd>{new Date(q.abgegeben_am).toLocaleString("de-CH", { dateStyle: "medium", timeStyle: "medium" })}</dd></div>
          <div><dt>Beantwortet</dt><dd>{q.beantwortet} von {q.aufgaben} Aufgaben</dd></div>
          <div><dt>Art</dt><dd>{q.abgabe_art === "zeit" ? "automatisch bei Zeitablauf" : q.abgabe_art === "lehrperson" ? "von der Lehrperson eingezogen" : "selbst abgegeben"}</dd></div>
          <div><dt>Prüfnummer</dt><dd className="quittung-hash">{teile.join(" ")}</dd></div>
        </dl>
        <p className="leise klein">Mit der Prüfnummer lässt sich nachweisen, dass genau diese Antworten angekommen sind.</p>
        <button className="knopf" onClick={() => nav(`/s/${kurz}/`)}>Zur Übersicht</button>
      </div>
    </div>);
}

// Prüfung verlangt die Lernumgebung, die Seite läuft aber im normalen Browser (oder in einer veralteten App)
function LernumgebungNoetig({ text, kurz }) {
  const nav = useNavigate();
  return (
    <div className="pm-voll">
      <div className="quittung" style={{ textAlign: "left", justifyItems: "start" }}>
        <span className="wappen"><Marke /></span>
        <h1 style={{ fontSize: "1.5rem" }}>Diese Prüfung braucht die Lernumgebung</h1>
        <p>{text}</p>
        <ol className="schritte">
          <li>RESCOOL Lernumgebung installieren (einmalig, ohne Administratorrechte).</li>
          <li>Lernumgebung öffnen und mit Ihrem Konto anmelden.</li>
          <li>Auf der Übersicht den Code von der Tafel eingeben.</li>
        </ol>
        <div className="reihe"><button className="knopf haupt-knopf" onClick={() => nav(`/s/${kurz}/lernumgebung`)}>Zur Lernumgebung</button><button className="knopf" onClick={() => nav(`/s/${kurz}/`)}>Zur Übersicht</button></div>
      </div>
    </div>);
}
