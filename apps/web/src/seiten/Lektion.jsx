// Unterrichtsmodus für die Lehrperson: Lektion starten, sehen wer dabei ist, Bildschirme anhalten, allen etwas zeigen, Seiten freigeben.
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api.js";
import { Dialog, Laden, Symbol, Etikett, useMeldung, wann } from "../ui.jsx";
import { UnterrichtReiter } from "./UnterrichtMaterial.jsx";

const uhrzeit = (d) => new Date(d).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
const WARN = { prozess: "verbotenes Programm", vm: "virtuelle Maschine", debugger: "Debugger", aufnahme: "Aufnahme", bildschirm: "zweiter Bildschirm", sperre: "Sperre verlassen", fremder_code: "fremder Code" };

export default function Lektion() {
  const { kurz, uid } = useParams();
  const [d, setD] = useState(null); const [fehler, setFehler] = useState(null);
  const laden = async () => { try { setD(await api(`/api/unterricht/${uid}/lektion`)); } catch (e) { setFehler(e); } };
  useEffect(() => { setD(null); laden(); }, [uid]);
  return <Laden zustand={{ daten: d, fehler }}>{(d) => {
    const u = d.unterricht;
    return <div>
      <div className="kopf">
        <div>
          <div className="pfad"><Link to={`/s/${kurz}/`}>Übersicht</Link><span aria-hidden="true">/</span><Link to={`/s/${kurz}/klassen/${u.klasse_id}`}>Klasse {u.klasse}</Link></div>
          <h1 style={{ display: "flex", gap: 14, alignItems: "center" }}><span className="punkt" style={{ background: u.farbe, width: 14, height: 14, borderRadius: 4 }} />{u.fach} {u.klasse}{u.gruppe ? `, ${u.gruppe}` : ""}</h1>
        </div>
      </div>
      <UnterrichtReiter kurz={kurz} uid={uid} />
      {d.lektion ? <Laufend lid={d.lektion.id} uid={uid} kurz={kurz} beendet={laden} /> : <Starten uid={uid} vorlage={d.vorlage} klasse={u.klasse} gestartet={laden} />}
    </div>;
  }}</Laden>;
}

/* ---------- Erlaubte Seiten bearbeiten ---------- */
// Adresse prüfen und vereinheitlichen: { seite } oder { fehler }
function seiteLesen(url, titel) {
  let a = url.trim(); if (!a) return {};
  if (!/^[a-z]+:\/\//i.test(a)) a = "https://" + a;
  let x; try { x = new URL(a); } catch { return { fehler: "Das ist keine gültige Adresse." }; }
  if (x.protocol !== "https:") return { fehler: "Nur Adressen mit https:// sind möglich." };
  return { seite: { url: x.origin + x.pathname.replace(/\/$/, ""), titel: titel.trim() || x.hostname.replace(/^www\./, "") } };
}
// Mit einer eingetippten, aber noch nicht hinzugefügten Adresse zusammenführen (sonst ginge sie beim Speichern verloren)
const mitEntwurf = (seiten, entwurf) => (entwurf && !seiten.some((s) => s.url === entwurf.url) ? [...seiten, entwurf] : seiten);

export function SeitenListe({ seiten, setSeiten, onEntwurf }) {
  const [url, setUrl] = useState(""); const [titel, setTitel] = useState(""); const [f, setF] = useState("");
  useEffect(() => { if (onEntwurf) onEntwurf(seiteLesen(url, titel).seite || null); }, [url, titel]);
  const dazu = (e) => {
    e.preventDefault(); setF("");
    const r = seiteLesen(url, titel);
    if (r.fehler) return setF(r.fehler);
    if (!r.seite) return;
    if (seiten.some((s) => s.url === r.seite.url)) return setF("Diese Seite ist schon erlaubt.");
    setSeiten([...seiten, r.seite]); setUrl(""); setTitel("");
  };
  return <div className="stapel" style={{ gap: 10 }}>
    {seiten.length ? <ul className="lk-seiten">{seiten.map((s) => <li key={s.url}><div><b>{s.titel}</b><span>{s.url.replace(/^https:\/\//, "")}</span></div>
      <button type="button" className="knopf leise-knopf klein-knopf" onClick={() => setSeiten(seiten.filter((x) => x.url !== s.url))} aria-label={`${s.titel} entfernen`}><Symbol.schliessen /></button></li>)}</ul>
      : <p className="leise klein" style={{ margin: 0 }}>Noch keine. Ohne erlaubte Seiten zeigt die Lernumgebung nur RESCOOL (Material, Aufträge).</p>}
    <form className="lk-seite-neu" onSubmit={dazu}>
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="www.duden.de" aria-label="Adresse" aria-invalid={!!f} />
      <input value={titel} onChange={(e) => setTitel(e.target.value)} placeholder="Name (optional)" aria-label="Name der Seite" maxLength={80} />
      <button className="knopf" disabled={!url.trim()}>Erlauben</button>
    </form>
    {f && <span className="feld-fehler">{f}</span>}
    <p className="leise klein" style={{ margin: 0 }}>Eine Adresse erlaubt auch alles darunter: «www.geogebra.org/calculator» erlaubt den Rechner von GeoGebra, aber nicht den Rest der Seite.</p>
  </div>;
}

/* ---------- Noch keine Lektion ---------- */
function Starten({ uid, vorlage, klasse, gestartet }) {
  const [seiten, setSeiten] = useState(vorlage.seiten || []); const [rechner, setRechner] = useState(!!vorlage.rechner); const [lu, setLu] = useState(!!vorlage.lernumgebung);
  const [nb, setNb] = useState(vorlage.notizbuch !== false);
  const [laeuft, setLaeuft] = useState(false); const [entwurf, setEntwurf] = useState(null); const meld = useMeldung();
  const starten = async () => {
    setLaeuft(true);
    try { await api(`/api/unterricht/${uid}/lektion`, { methode: "POST", daten: { seiten: mitEntwurf(seiten, entwurf), rechner, lernumgebung: lu, notizbuch: nb } }); }
    catch (x) { if (x.status !== 409) { meld(x.message, true); setLaeuft(false); return; } }
    gestartet();
  };
  return <div className="lk-start">
    <div className="lk-start-tafel">
      <Symbol.lektion />
      <h2>Lektion mit {klasse}</h2>
      <p>Während der Lektion sehen Sie, wer dabei ist. Sie können allen ein Material oder eine Seite zeigen und die Bildschirme anhalten, wenn alle nach vorne schauen sollen.</p>
      <p>In der Lernumgebung sind nur die Seiten offen, die Sie hier erlauben. Im normalen Browser lässt sich das nicht durchsetzen; Sie sehen aber, wer im Browser arbeitet.</p>
    </div>
    <div className="lk-start-form">
      <section className="stapel" style={{ gap: 10 }}>
        <h3>Erlaubte Seiten</h3>
        <SeitenListe seiten={seiten} setSeiten={setSeiten} onEntwurf={setEntwurf} />
      </section>
      <label className="haken"><input type="checkbox" checked={rechner} onChange={(e) => setRechner(e.target.checked)} /><span><b>Taschenrechner</b><small>Wissenschaftlicher Rechner auf der Lektionsseite</small></span></label>
      <label className="haken"><input type="checkbox" checked={nb} onChange={(e) => setNb(e.target.checked)} /><span><b>Kursnotizbuch</b><small>Die Klasse kann das Notizbuch dieses Fachs öffnen. Alle anderen Notizbücher sind während der Lektion zu.</small></span></label>
      <label className="haken"><input type="checkbox" checked={lu} onChange={(e) => setLu(e.target.checked)} /><span><b>Lernumgebung verlangen</b><small>Wer im Browser ist, wird markiert und sieht einen Hinweis, die Lernumgebung zu öffnen.</small></span></label>
      <div className="reihe" style={{ justifyContent: "flex-end" }}><button className="knopf haupt-knopf gross-knopf" onClick={starten} disabled={laeuft}>Lektion starten</button></div>
    </div>
  </div>;
}

/* ---------- Lektion läuft ---------- */
function Laufend({ lid, uid, kurz, beendet }) {
  const [d, setD] = useState(null); const [fehler, setFehler] = useState(null);
  const [senden, setSenden] = useState(false); const [seitenOffen, setSeitenOffen] = useState(false);
  const meld = useMeldung();
  const laden = async () => { try { setD(await api(`/api/lektionen/${lid}/uebersicht`)); } catch (e) { setFehler(e); } };
  useEffect(() => { laden(); const t = setInterval(laden, 3000); return () => clearInterval(t); }, [lid]);
  useEffect(() => { if (d && !d.lektion.laeuft) beendet(); }, [d]);
  const tun = async (fn, text) => { try { await fn(); if (text) meld(text); await laden(); } catch (x) { meld(x.message, true); } };
  if (!d) return <Laden zustand={{ daten: null, fehler }}>{() => null}</Laden>;
  const l = d.lektion;
  if (!l.laeuft) return null;
  const t = d.schueler.map((s) => s.teilnahme);
  const dabei = t.filter((x) => x && x.online).length, app = t.filter((x) => x && x.online && x.modus === "gesperrt").length;
  const gesehen = l.anstoss ? t.filter((x) => x && x.online && x.gesehen).length : 0;
  const aendern = (daten, text) => tun(() => api(`/api/lektionen/${lid}`, { methode: "PUT", daten }), text);

  return <div>
    <div className={"lk-leiste" + (l.angehalten ? " angehalten" : "")}>
      <div className="lk-stand">
        <span>Lektion seit {uhrzeit(l.gestartet_am)}</span>
        <b>{dabei} von {d.schueler.length} dabei</b>
        <small>{app} in der Lernumgebung, {dabei - app} im Browser{l.lernumgebung ? ", Lernumgebung verlangt" : ""}</small>
      </div>
      <div className="lk-knoepfe">
        <button className={"knopf lk-anhalten" + (l.angehalten ? " aktiv" : "")} aria-pressed={l.angehalten} onClick={() => aendern({ angehalten: !l.angehalten }, l.angehalten ? "Bildschirme wieder frei." : "Bildschirme angehalten.")}>
          <Symbol.anhalten />{l.angehalten ? "Bildschirme freigeben" : "Bildschirme anhalten"}</button>
        <button className="knopf" onClick={() => setSenden(true)}><Symbol.senden />An alle senden</button>
        <button className="knopf" onClick={() => setSeitenOffen(true)}><Symbol.link />Seiten ({l.seiten.length})</button>
        <button className="knopf lk-ende" onClick={() => { if (confirm("Lektion beenden? Die Lernumgebung zeigt danach wieder alles von RESCOOL, die erlaubten Seiten sind zu.")) tun(async () => { await api(`/api/lektionen/${lid}/beenden`, { methode: "POST" }); beendet(); }, "Lektion beendet."); }}>Beenden</button>
      </div>
    </div>

    {l.anstoss && <div className="lk-anstoss">
      <span className="lk-anstoss-art">{l.anstoss.art === "seite" ? <Symbol.link /> : <Symbol.material />}</span>
      <div><span>Alle sehen gerade</span><b>{l.anstoss.titel}</b></div>
      <span className="oeffnungen"><span>{gesehen} von {dabei} haben es offen</span><span className="balken"><i style={{ width: `${dabei ? (100 * gesehen) / dabei : 0}%` }} /></span></span>
      <button className="knopf leise-knopf klein-knopf" onClick={() => tun(() => api(`/api/lektionen/${lid}/anstoss`, { methode: "POST", daten: { art: "keiner" } }), "Zurückgenommen.")}>Zurücknehmen</button>
    </div>}

    <ul className="lk-kacheln" aria-label="Schülerinnen und Schüler">
      {d.schueler.map((s) => {
        const x = s.teilnahme, online = x && x.online;
        const zustand = !x ? "fehlt" : !online ? "weg" : x.modus === "gesperrt" ? "app" : "browser";
        const flags = [];
        if (online && !x.sichtbar) flags.push(<span key="h" className="lk-flag">anderes Fenster</span>);
        if (online && l.anstoss && !x.gesehen) flags.push(<span key="g" className="lk-flag">noch nicht offen</span>);
        if (online && l.lernumgebung && x.modus !== "gesperrt") flags.push(<span key="l" className="lk-flag">ohne Lernumgebung</span>);
        if (x && x.warnungen > 0) flags.push(<span key="w" className="warn-chip" title={`Zuletzt ${uhrzeit(x.warnung_zuletzt)}`}>{x.warnungen}× {WARN[x.warnung_art] || x.warnung_art}</span>);
        return <li key={s.id} className={"lk-kachel " + zustand}>
          <b>{s.vorname} {s.nachname}</b>
          <span className="lk-wie">{zustand === "fehlt" ? "noch nicht da" : zustand === "weg" ? `weg, ${wann(x.letzte_aktivitaet)}` : zustand === "app" ? `Lernumgebung, ${x.plattform === "macos" ? "Mac" : "Windows"}` : "Browser"}</span>
          {flags.length > 0 && <span className="lk-flags">{flags}</span>}
        </li>;
      })}
    </ul>
    <p className="leise klein" style={{ marginTop: 12 }}>Aktualisiert sich alle paar Sekunden. «Anderes Fenster» heisst: Die Lektionsseite ist nicht im Vordergrund (anderer Tab oder anderes Programm). In der Lernumgebung sind andere Programme und Seiten gesperrt; im Browser lässt sich das nur anzeigen.</p>

    <Senden offen={senden} zu={() => setSenden(false)} lid={lid} uid={uid} fertig={(text) => { setSenden(false); meld(text); laden(); }} />
    <SeitenDialog offen={seitenOffen} zu={() => setSeitenOffen(false)} l={l} speichern={(daten) => { setSeitenOffen(false); aendern(daten, "Gespeichert. Die Lernumgebung übernimmt es in wenigen Sekunden."); }} />
  </div>;
}

function SeitenDialog({ offen, zu, l, speichern }) {
  const [seiten, setSeiten] = useState(l.seiten); const [rechner, setRechner] = useState(l.rechner); const [lu, setLu] = useState(l.lernumgebung);
  const [nb, setNb] = useState(l.notizbuch !== false);
  const [entwurf, setEntwurf] = useState(null);
  useEffect(() => { if (offen) { setSeiten(l.seiten); setRechner(l.rechner); setLu(l.lernumgebung); setNb(l.notizbuch !== false); } }, [offen]);
  return <Dialog offen={offen} titel="Seiten und Werkzeuge" onZu={zu}>
    <div className="stapel" style={{ gap: 16 }}>
      <SeitenListe seiten={seiten} setSeiten={setSeiten} onEntwurf={setEntwurf} />
      <label className="haken"><input type="checkbox" checked={rechner} onChange={(e) => setRechner(e.target.checked)} /><span><b>Taschenrechner</b></span></label>
      <label className="haken"><input type="checkbox" checked={nb} onChange={(e) => setNb(e.target.checked)} /><span><b>Kursnotizbuch</b></span></label>
      <label className="haken"><input type="checkbox" checked={lu} onChange={(e) => setLu(e.target.checked)} /><span><b>Lernumgebung verlangen</b></span></label>
      <div className="reihe" style={{ justifyContent: "flex-end" }}><button className="knopf leise-knopf" onClick={zu}>Abbrechen</button><button className="knopf haupt-knopf" onClick={() => speichern({ seiten: mitEntwurf(seiten, entwurf), rechner, lernumgebung: lu, notizbuch: nb })}>Speichern</button></div>
    </div>
  </Dialog>;
}

// An alle senden: Material der Klasse, aus der Ablage oder eine Adresse
function Senden({ offen, zu, lid, uid, fertig }) {
  const [art, setArt] = useState("material"); const [liste, setListe] = useState(null); const [suche, setSuche] = useState("");
  const [url, setUrl] = useState(""); const [titel, setTitel] = useState(""); const [f, setF] = useState("");
  useEffect(() => { if (offen) { setF(""); setUrl(""); setTitel(""); setSuche(""); } }, [offen]);
  useEffect(() => {
    if (!offen || art !== "material") return;
    const t = setTimeout(async () => {
      try {
        if (!suche) { const d = await api(`/api/unterricht/${uid}/material`); setListe(d.eintraege.filter((e) => e.aktiv).map((e) => ({ ...e, klasse: true }))); }
        else setListe((await api(`/api/material?${new URLSearchParams({ bereich: "alle", suche })}`)).eintraege);
      } catch { setListe([]); }
    }, suche ? 200 : 0);
    return () => clearTimeout(t);
  }, [offen, art, suche, uid]);
  const schicken = async (daten, text) => { setF(""); try { await api(`/api/lektionen/${lid}/anstoss`, { methode: "POST", daten }); fertig(text); } catch (x) { setF(x.message); } };
  return <Dialog offen={offen} titel="An alle senden" onZu={zu}>
    <div className="stapel" style={{ gap: 14 }}>
      <div className="umschalter" role="tablist">
        <button role="tab" aria-selected={art === "material"} onClick={() => setArt("material")}>Material</button>
        <button role="tab" aria-selected={art === "seite"} onClick={() => setArt("seite")}>Seite im Internet</button>
      </div>
      {art === "material" ? <>
        <div className="suchfeld"><Symbol.suche /><input type="search" value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="Leer: Material der Klasse. Suchen: auch in der Ablage" aria-label="Material suchen" /></div>
        <div className="mliste" style={{ maxHeight: 340, overflow: "auto" }}>
          {liste === null ? <p className="leise" style={{ padding: 16 }}>Wird geladen …</p> : !liste.length ? <p className="leise" style={{ padding: 16 }}>{suche ? "Nichts gefunden." : "Für diese Klasse ist noch nichts freigegeben. Suchen Sie in Ihrer Ablage."}</p> :
            liste.map((e) => <button key={e.id} className="mzeile" style={{ gridTemplateColumns: "auto minmax(0,1fr) auto" }} onClick={() => schicken({ art: "material", material_id: e.id }, `«${e.titel}» an alle gesendet.`)}>
              <Etikett e={e} /><div style={{ minWidth: 0, textAlign: "left" }}><div className="titel"><span>{e.titel}</span></div><div className="meta"><span>{e.klasse ? "für die Klasse freigegeben" : "wird für die Klasse freigegeben"}</span>{e.fach && <span>{e.fach}</span>}</div></div>
              <span className="leise"><Symbol.senden /></span></button>)}
        </div>
      </> : <form className="stapel" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); let a = url.trim(); if (!/^[a-z]+:\/\//i.test(a)) a = "https://" + a; schicken({ art: "seite", url: a, titel }, "Seite an alle gesendet."); }}>
        <label className="feld">Adresse<input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="de.wikipedia.org/wiki/Gottfried_Keller" autoFocus /></label>
        <label className="feld">Name<small>Optional</small><input value={titel} onChange={(e) => setTitel(e.target.value)} maxLength={80} /></label>
        <p className="leise klein" style={{ margin: 0 }}>Die Seite wird zugleich für die Lektion erlaubt.</p>
        <div className="reihe" style={{ justifyContent: "flex-end" }}><button className="knopf haupt-knopf" disabled={!url.trim()}>Senden</button></div>
      </form>}
      {f && <div className="hinweis fehler">{f}</div>}
    </div>
  </Dialog>;
}
