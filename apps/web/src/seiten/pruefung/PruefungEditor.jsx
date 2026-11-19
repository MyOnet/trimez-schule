// Prüfung bearbeiten: Gliederung links, alle Aufgaben als Karten rechts. Speichert automatisch.
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, hochladen } from "../../api.js";
import { useLaden, Laden, Dialog, useMeldung, Symbol, wann } from "../../ui.jsx";
import { TYPEN, neuerTeil } from "@schule/shared";
import TeilFormular from "./TeilFormular.jsx";
import Formatiert from "./Formatiert.jsx";

const fmtP = (p) => String(Math.round(Number(p || 0) * 100) / 100);

export default function PruefungEditor() {
  const { pid } = useParams();
  const z = useLaden(`/api/pruefungen/${pid}`);
  return <Laden zustand={z}>{(d) => <Editor d={d} neu={z.neu} />}</Laden>;
}

function Editor({ d, neu }) {
  const { kurz, pid } = useParams(); const nav = useNavigate(); const meld = useMeldung();
  const [p, setP] = useState(d);
  const [teile, setTeile] = useState(d.teile);
  const [speichert, setSpeichert] = useState(0);
  const [waehler, setWaehler] = useState(null); // nach_nr für neuen Teil
  const [bank, setBank] = useState(false); const [kopie, setKopie] = useState(false); const [einst, setEinst] = useState(false);
  const timer = useRef({}); const dateiwahl = useRef(null);
  useEffect(() => { setP(d); setTeile(d.teile); }, [d]);

  const kopfSpeichern = useCallback(async (x) => {
    setP((alt) => ({ ...alt, ...x }));
    try { const r = await api(`/api/pruefungen/${pid}`, { methode: "PUT", daten: x }); if (r.status) setP((alt) => ({ ...alt, status: r.status })); }
    catch (e) { meld(e.message, true); if (x.status) setP((alt) => ({ ...alt, status: "entwurf" })); }
  }, [pid, meld]);
  const teilAendern = (t) => {
    setTeile((ts) => ts.map((x) => (x.id === t.id ? { ...t, dirty: true } : x)));
    clearTimeout(timer.current[t.id]);
    timer.current[t.id] = setTimeout(async () => {
      setSpeichert((n) => n + 1);
      try { const r = await api(`/api/teile/${t.id}`, { methode: "PUT", daten: { teil: t } }); setTeile((ts) => ts.map((x) => (x.id === t.id ? { ...x, fehler: r.fehler, dirty: false } : x))); if (r.fehler) setP((alt) => ({ ...alt, status: "entwurf" })); }
      catch (e) { meld(e.message, true); } finally { setSpeichert((n) => n - 1); }
    }, 700);
  };
  const hinzufuegen = async (typ, nach) => {
    setWaehler(null);
    try { const t = await api(`/api/pruefungen/${pid}/teile`, { methode: "POST", daten: { teil: neuerTeil(typ), nach_nr: nach } }); await neu(); setTimeout(() => document.getElementById("teil-" + t.id)?.scrollIntoView({ behavior: "smooth", block: "center" }), 80); }
    catch (e) { meld(e.message, true); }
  };
  const verschieben = async (k, dlt) => {
    const n = [...teile]; [n[k], n[k + dlt]] = [n[k + dlt], n[k]];
    setTeile(n.map((t, i) => ({ ...t, nr: i + 1 })));
    try { await api(`/api/pruefungen/${pid}/reihenfolge`, { methode: "POST", daten: { ids: n.map((t) => t.id) } }); } catch (e) { meld(e.message, true); neu(); }
  };
  const loeschen = async (t) => {
    const leer = JSON.stringify(t.inhalt) === JSON.stringify(neuerTeil(t.typ).inhalt);
    if (!leer && !confirm("Diese Aufgabe löschen?")) return;
    try { await api(`/api/teile/${t.id}`, { methode: "DELETE" }); neu(); } catch (e) { meld(e.message, true); }
  };
  const inBank = async (t) => {
    try { await api("/api/aufgaben", { methode: "POST", daten: { teil: t, teil_id: t.id, fach_id: p.fach_id, geteilt: "privat" } }); meld("In Ihrer Aufgabenbank gespeichert."); setTeile((ts) => ts.map((x) => (x.id === t.id ? { ...x, aufgabe_id: "ja" } : x))); }
    catch (e) { meld(e.message, true); }
  };
  const ausDatei = async (f) => {
    meld("Datei wird gelesen und Aufgaben werden erkannt …");
    try { const u = await hochladen(`/api/pruefungen/${pid}/umwandlung`, f); nav(`/s/${kurz}/pruefungen/${pid}/umwandlung/${u.id}`); } catch (e) { meld(e.message, true); }
  };

  const gesperrt = !["entwurf", "bereit"].includes(p.status);
  const starten = async () => {
    if (!confirm(`«${p.titel}» jetzt für ${p.klasse} starten? Die Klasse kann dann mit einem Code beginnen. Aufgaben lassen sich danach nicht mehr ändern.`)) return;
    try { await api(`/api/pruefungen/${pid}/starten`, { methode: "POST" }); nav(`/s/${kurz}/pruefungen/${pid}/aufsicht`); } catch (e) { meld(e.message, true); }
  };
  let nr = 0;
  const nummern = teile.map((t) => (t.typ === "abschnitt" ? null : ++nr));
  const punkte = teile.reduce((a, t) => a + Number(t.punkte || 0), 0);
  const offen = teile.filter((t) => t.fehler).length;

  return (
    <div>
      <div className="kopf" style={{ alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 420px", minWidth: 0 }}>
          <div className="pfad"><Link to={`/s/${kurz}/pruefungen`}>Prüfungen</Link><span aria-hidden="true">/</span><span>{p.fach} {p.klasse}{p.gruppe ? ` ${p.gruppe}` : ""}</span></div>
          <input className="titel-eingabe" value={p.titel} onChange={(e) => setP({ ...p, titel: e.target.value })} onBlur={(e) => e.target.value.trim() && e.target.value !== d.titel && kopfSpeichern({ titel: e.target.value })} aria-label="Titel der Prüfung" />
          <div className="pmeta">
            <label>Datum<input type="date" value={p.datum || ""} onChange={(e) => kopfSpeichern({ datum: e.target.value || null })} /></label>
            <label>Dauer<input inputMode="numeric" value={p.dauer_min || ""} onChange={(e) => setP({ ...p, dauer_min: e.target.value })} onBlur={(e) => kopfSpeichern({ dauer_min: e.target.value })} style={{ width: 70 }} />Min.</label>
            <label>Notenschlüssel<select value={p.notenschluessel_id || ""} onChange={(e) => kopfSpeichern({ notenschluessel_id: e.target.value || null })}><option value="">keiner</option>{p.schluessel.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            <span className="pmeta-punkte"><b>{fmtP(punkte)}</b> Punkte</span>
            <button type="button" className={"chip" + (p.einstellungen?.modus === "lernumgebung" ? " gruen" : "")} onClick={() => setEinst(true)} style={{ border: 0, cursor: "pointer" }}>{p.einstellungen?.modus === "lernumgebung" ? "Lernumgebung" : "Im Browser"}{p.einstellungen?.rechner ? ", Rechner" : ""}{p.einstellungen?.seiten?.length ? `, ${p.einstellungen.seiten.length} Seiten` : ""}</button>
          </div>
        </div>
        <div className="reihe">
          <span className="leise klein" aria-live="polite" style={{ minWidth: 120, textAlign: "right" }}>{speichert > 0 || teile.some((t) => t.dirty) ? "Wird gespeichert …" : "Gespeichert"}</span>
          <Link className="knopf" to={`/s/${kurz}/pruefungen/${pid}/vorschau`}><Symbol.oeffnen />Vorschau</Link>
          {gesperrt ? <Link className="knopf haupt-knopf" to={`/s/${kurz}/pruefungen/${pid}/${p.status === "laeuft" ? "aufsicht" : "korrektur"}`}>{p.status === "laeuft" ? "Zur Aufsicht" : "Zur Korrektur"}</Link>
            : p.status === "bereit" ? <>
              <button className="knopf status-knopf bereit" onClick={() => kopfSpeichern({ status: "entwurf" })} title="Zurück auf Entwurf">✓ Bereit</button>
              <button className="knopf haupt-knopf" onClick={starten}>Prüfung starten</button></>
            : <button className="knopf haupt-knopf" onClick={() => kopfSpeichern({ status: "bereit" })} disabled={!!offen} title={offen ? "Zuerst alle Aufgaben vervollständigen" : ""}>Als bereit markieren</button>}
        </div>
      </div>
      {gesperrt && <div className="hinweis" style={{ marginBottom: 18 }}><span>{p.status === "laeuft" ? "Die Prüfung läuft." : "Die Prüfung wurde durchgeführt."} Aufgaben lassen sich nicht mehr ändern. Für eine neue Durchführung «Für andere Klasse kopieren» verwenden.</span></div>}
      {offen > 0 && !gesperrt && <div className="hinweis" style={{ marginBottom: 18 }}><span><b>{offen === 1 ? "Eine Aufgabe ist" : `${offen} Aufgaben sind`} noch unvollständig.</b> Sie sind rot markiert. Gespeichert wird trotzdem.</span></div>}

      <div className="editor">
        <nav className="gliederung" aria-label="Gliederung">
          {teile.map((t, k) => <button key={t.id} className={"gl-eintrag" + (t.typ === "abschnitt" ? " abschnitt" : "") + (t.fehler ? " fehlt" : "")}
            onClick={() => document.getElementById("teil-" + t.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}>
            <span className="gl-nr">{nummern[k] || "§"}</span>
            <span className="gl-text">{t.typ === "abschnitt" ? t.inhalt.titel || "Abschnitt" : (t.inhalt.frage || t.inhalt.text || TYPEN[t.typ].name).replace(/\\circ/g, "°").replace(/\\[a-zA-Z]+/g, "").replace(/[*$\\{}^]/g, "").slice(0, 60) || TYPEN[t.typ].name}</span>
            {t.typ !== "abschnitt" && <span className="gl-p">{fmtP(t.punkte)}</span>}
          </button>)}
          <div className="gl-aktionen">
            <button className="knopf klein-knopf" onClick={() => setWaehler({ nach: null })}><Symbol.plus />Aufgabe</button>
            <button className="knopf klein-knopf leise-knopf" onClick={() => setBank(true)}>Aus der Aufgabenbank</button>
            <button className="knopf klein-knopf leise-knopf" onClick={() => dateiwahl.current.click()}>Aus Word oder PDF</button>
            <input ref={dateiwahl} type="file" accept=".docx,.pdf" hidden onChange={(e) => { const f = e.target.files[0]; e.target.value = ""; if (f) ausDatei(f); }} />
            <button className="knopf klein-knopf leise-knopf" onClick={() => setEinst(true)}>Hinweise und Einstellungen</button>
            <button className="knopf klein-knopf leise-knopf" onClick={() => setKopie(true)}>Für andere Klasse kopieren</button>
            <button className="knopf klein-knopf leise-knopf gefahr" onClick={async () => { if (confirm(`Prüfung «${p.titel}» löschen?`)) { await api(`/api/pruefungen/${pid}`, { methode: "DELETE" }); meld("Prüfung gelöscht."); nav(`/s/${kurz}/pruefungen`); } }}>Prüfung löschen</button>
          </div>
        </nav>

        <fieldset className="teile" disabled={gesperrt}>
          {!teile.length && <div className="leer"><b>Noch keine Aufgaben</b><span>Fügen Sie die erste Aufgabe hinzu, holen Sie Aufgaben aus der Aufgabenbank oder übernehmen Sie eine bestehende Prüfung aus Word oder PDF.</span>
            <div className="reihe"><button className="knopf haupt-knopf" onClick={() => setWaehler({ nach: null })}><Symbol.plus />Aufgabe hinzufügen</button><button className="knopf" onClick={() => dateiwahl.current.click()}>Aus Word oder PDF</button></div></div>}
          {teile.map((t, k) => <div key={t.id}>
            <section id={"teil-" + t.id} className={"teil-karte" + (t.typ === "abschnitt" ? " abschnitt" : "") + (t.fehler ? " fehlt" : "")} aria-label={nummern[k] ? `Aufgabe ${nummern[k]}` : "Abschnitt"}>
              <header className="teil-kopf">
                <span className="teil-nr">{nummern[k] ? `Aufgabe ${nummern[k]}` : "Abschnitt"}</span>
                <span className="chip">{TYPEN[t.typ].name}</span>
                {TYPEN[t.typ].punkte && <label className="punkte-feld"><input inputMode="decimal" value={t.punkte} onChange={(e) => teilAendern({ ...t, punkte: e.target.value })} aria-label="Punkte" />Punkte</label>}
                <span className="reihe" style={{ gap: 0, marginLeft: "auto" }}>
                  <button className="knopf leise-knopf klein-knopf" disabled={!k} onClick={() => verschieben(k, -1)} aria-label="nach oben">↑</button>
                  <button className="knopf leise-knopf klein-knopf" disabled={k === teile.length - 1} onClick={() => verschieben(k, 1)} aria-label="nach unten">↓</button>
                  {t.typ !== "abschnitt" && !t.fehler && <button className="knopf leise-knopf klein-knopf" onClick={() => inBank(t)} title="In der Aufgabenbank speichern, um sie wiederzuverwenden">{t.aufgabe_id ? "In der Bank ✓" : "In die Aufgabenbank"}</button>}
                  <button className="knopf leise-knopf klein-knopf gefahr" onClick={() => loeschen(t)} aria-label="Aufgabe löschen"><Symbol.papierkorb /></button>
                </span>
              </header>
              {t.fehler && <p className="teil-fehler" role="status">{t.fehler}</p>}
              <TeilFormular teil={t} setTeil={teilAendern} />
            </section>
            <div className="einfuegen"><button onClick={() => setWaehler({ nach: t.nr })} aria-label={`Nach ${nummern[k] ? "Aufgabe " + nummern[k] : "dem Abschnitt"} einfügen`}><Symbol.plus /></button></div>
          </div>)}
        </fieldset>
      </div>

      <TypWaehler offen={!!waehler} zu={() => setWaehler(null)} waehlen={(typ) => hinzufuegen(typ, waehler.nach)} />
      <Aufgabenbank offen={bank} zu={() => setBank(false)} pid={pid} fachId={p.fach_id} fertig={neu} />
      <Kopieren offen={kopie} zu={() => setKopie(false)} p={p} />
      <Einstellungen offen={einst} zu={() => setEinst(false)} p={p} speichern={kopfSpeichern} />
    </div>);
}

function TypWaehler({ offen, zu, waehlen }) {
  return <Dialog offen={offen} titel="Was für eine Aufgabe?" onZu={zu}>
    <div className="typ-raster">
      {Object.entries(TYPEN).map(([k, t]) => <button key={k} className="typ-kachel" onClick={() => waehlen(k)}><TypBild typ={k} /><b>{t.name}</b><span>{t.beschreibung}</span></button>)}
    </div>
  </Dialog>;
}
// Kleine Skizze pro Typ, aus Linien (keine Bilder)
function TypBild({ typ }) {
  const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" };
  const s = {
    abschnitt: <><path d="M6 8h20" {...P} strokeWidth="2.4" /><path d="M6 14h28M6 19h26M6 24h22" {...P} /></>,
    einfach: <><circle cx="9" cy="9" r="3.2" {...P} /><circle cx="9" cy="9" r="1.4" fill="currentColor" /><circle cx="9" cy="18" r="3.2" {...P} /><circle cx="9" cy="27" r="3.2" {...P} /><path d="M16 9h16M16 18h12M16 27h14" {...P} /></>,
    mehrfach: <><rect x="6" y="6" width="6" height="6" rx="1.5" {...P} /><path d="M7.5 9l1.5 1.5 2.5-3" {...P} /><rect x="6" y="15" width="6" height="6" rx="1.5" {...P} /><path d="M7.5 18l1.5 1.5 2.5-3" {...P} /><rect x="6" y="24" width="6" height="6" rx="1.5" {...P} /><path d="M16 9h16M16 18h12M16 27h14" {...P} /></>,
    kurz: <><path d="M6 10h24" {...P} /><rect x="6" y="17" width="22" height="9" rx="2" {...P} /></>,
    zahl: <><path d="M6 10h24" {...P} /><rect x="6" y="17" width="14" height="9" rx="2" {...P} /><path d="M10 21.5h6M24 21.5h6" {...P} /></>,
    luecken: <><path d="M6 11h7M23 11h11M6 22h12M28 22h6" {...P} /><path d="M14 13h8M19 24h8" {...P} strokeWidth="2.6" /></>,
    zuordnung: <><path d="M6 9h8M6 18h8M6 27h8M26 9h8M26 18h8M26 27h8" {...P} /><path d="M15 9l10 18M15 18l10-9M15 27l10-9" {...P} strokeDasharray="2 2.5" /></>,
    reihenfolge: <><path d="M12 8h20M12 18h20M12 28h20" {...P} /><path d="M6 6v24M3.5 27l2.5 3 2.5-3" {...P} /></>,
    freitext: <><path d="M6 8h22" {...P} /><rect x="6" y="13" width="28" height="18" rx="2" {...P} /><path d="M10 19h20M10 24h16" {...P} opacity=".5" /></>,
  }[typ];
  return <svg viewBox="0 0 40 36" width="40" height="36" aria-hidden="true">{s}</svg>;
}

function Aufgabenbank({ offen, zu, pid, fachId, fertig }) {
  const [suche, setSuche] = useState(""); const [liste, setListe] = useState(null); const [wahl, setWahl] = useState([]); const meld = useMeldung();
  useEffect(() => { if (offen) setWahl([]); }, [offen]);
  useEffect(() => {
    if (!offen) return;
    const t = setTimeout(async () => { try { setListe(await api(`/api/aufgaben?${new URLSearchParams(suche ? { suche } : fachId ? { fach: fachId } : {})}`)); } catch { setListe([]); } }, 200);
    return () => clearTimeout(t);
  }, [offen, suche, fachId]);
  const einfuegen = async () => { try { await api(`/api/pruefungen/${pid}/aus-bank`, { methode: "POST", daten: { aufgabe_ids: wahl } }); meld(wahl.length === 1 ? "Aufgabe eingefügt." : `${wahl.length} Aufgaben eingefügt.`); zu(); fertig(); } catch (e) { meld(e.message, true); } };
  return <Dialog offen={offen} titel="Aus der Aufgabenbank" onZu={zu}>
    <div className="stapel" style={{ gap: 14 }}>
      <div className="suchfeld"><Symbol.suche /><input type="search" value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="Aufgaben suchen" aria-label="Aufgaben suchen" autoFocus /></div>
      <div className="mliste" style={{ maxHeight: 380, overflow: "auto" }}>
        {liste === null ? <p className="leise" style={{ padding: 16 }}>Wird geladen …</p> : !liste.length ? <p className="leise" style={{ padding: 16 }}>Keine Aufgaben gefunden. Speichern Sie Aufgaben mit «In die Aufgabenbank», um sie wiederzuverwenden.</p> :
          liste.map((a) => <label key={a.id} className="mzeile" style={{ gridTemplateColumns: "auto minmax(0,1fr) auto" }}>
            <input type="checkbox" style={{ width: 18, minHeight: 0, accentColor: "var(--gruen)" }} checked={wahl.includes(a.id)} onChange={(e) => setWahl(e.target.checked ? [...wahl, a.id] : wahl.filter((x) => x !== a.id))} />
            <div style={{ minWidth: 0 }}><Formatiert text={(a.inhalt.frage || a.inhalt.titel || a.inhalt.text || "").slice(0, 200)} className="titel" /><div className="meta"><span>{TYPEN[a.typ].name}</span>{a.fach && <span>{a.fach}</span>}{!a.mein && <span>{a.besitzer}</span>}{a.schlagworte.length > 0 && <span>{a.schlagworte.join(", ")}</span>}</div></div>
            <span className="leise klein">{String(a.punkte)} P.</span>
          </label>)}
      </div>
      <div className="reihe" style={{ justifyContent: "flex-end" }}><button className="knopf leise-knopf" onClick={zu}>Abbrechen</button><button className="knopf haupt-knopf" disabled={!wahl.length} onClick={einfuegen}>{wahl.length > 1 ? `${wahl.length} einfügen` : "Einfügen"}</button></div>
    </div>
  </Dialog>;
}

function Kopieren({ offen, zu, p }) {
  const { kurz } = useParams(); const nav = useNavigate(); const meld = useMeldung();
  const [liste, setListe] = useState([]); const [ziel, setZiel] = useState("");
  useEffect(() => { if (offen) api("/api/pruefungen").then((d) => { const l = d.meinUnterricht.filter((u) => u.id !== p.unterricht_id); setListe(l); setZiel(l[0] ? l[0].id : ""); }); }, [offen]);
  const los = async () => { try { const n = await api(`/api/pruefungen/${p.id}/kopieren`, { methode: "POST", daten: { unterricht_id: ziel } }); meld("Kopie angelegt."); zu(); nav(`/s/${kurz}/pruefungen/${n.id}`); } catch (e) { meld(e.message, true); } };
  return <Dialog offen={offen} titel="Für andere Klasse kopieren" onZu={zu}>
    <div className="formular">
      <p className="leise">Die Kopie ist unabhängig: Änderungen wirken sich nicht auf diese Prüfung aus.</p>
      {liste.length ? <label className="feld">Klasse<select value={ziel} onChange={(e) => setZiel(e.target.value)}>{liste.map((u) => <option key={u.id} value={u.id}>{u.klasse} {u.fach}</option>)}</select></label> : <p>Sie haben keinen anderen Unterricht.</p>}
      <div className="reihe" style={{ justifyContent: "flex-end" }}><button className="knopf leise-knopf" onClick={zu}>Abbrechen</button><button className="knopf haupt-knopf" disabled={!ziel} onClick={los}>Kopieren</button></div>
    </div>
  </Dialog>;
}

function Einstellungen({ offen, zu, p, speichern }) {
  const { kurz } = useParams();
  const [e, setE] = useState(p.einstellungen || {});
  const [neu, setNeu] = useState({ titel: "", url: "" }); const [fehler, setFehler] = useState("");
  useEffect(() => { if (offen) { setE(p.einstellungen || {}); setFehler(""); } }, [offen]);
  const seiten = e.seiten || [];
  const seiteDazu = () => {
    let u; try { u = new URL(neu.url.trim().startsWith("http") ? neu.url.trim() : "https://" + neu.url.trim()); } catch { return setFehler("Bitte eine gültige Adresse eingeben."); }
    if (u.protocol !== "https:") return setFehler("Nur Adressen mit https:// sind möglich.");
    setE({ ...e, seiten: [...seiten, { titel: neu.titel.trim() || u.hostname.replace(/^www\./, ""), url: u.origin + u.pathname.replace(/\/$/, "") }] }); setNeu({ titel: "", url: "" }); setFehler("");
  };
  return <Dialog offen={offen} titel="Hinweise und Einstellungen" onZu={zu}>
    <form className="formular" onSubmit={(ev) => { ev.preventDefault(); speichern({ einstellungen: e }); zu(); }}>
      <section className="stapel" style={{ gap: 8 }}>
        <b>Wo wird geschrieben?</b>
        <div className="segment" role="radiogroup" aria-label="Modus">
          <button type="button" role="radio" aria-checked={e.modus !== "lernumgebung"} aria-pressed={e.modus !== "lernumgebung"} onClick={() => setE({ ...e, modus: "browser" })}>Im Browser</button>
          <button type="button" role="radio" aria-checked={e.modus === "lernumgebung"} aria-pressed={e.modus === "lernumgebung"} onClick={() => setE({ ...e, modus: "lernumgebung" })}>Nur in der Lernumgebung</button>
        </div>
        <p className="leise klein">{e.modus === "lernumgebung" ? "Die Klasse braucht die trimez. Lernumgebung. Der Laptop ist während der Prüfung gesperrt; nur die erlaubten Hilfsmittel sind offen." : "Für Übungen und Tests ohne Sperre. Das Verlassen des Fensters wird gemeldet, aber nicht verhindert."} <Link to={`/s/${kurz}/lernumgebung`}>Mehr zur Lernumgebung</Link></p>
      </section>
      <section className="stapel" style={{ gap: 8 }}>
        <b>Erlaubte Hilfsmittel</b>
        <label className="check"><input type="checkbox" checked={!!e.rechner} onChange={(x) => setE({ ...e, rechner: x.target.checked })} style={{ width: "auto", minHeight: 0 }} />Taschenrechner (wissenschaftlich, eingebaut)</label>
        {seiten.length > 0 && <div className="liste-kompakt">{seiten.map((x, k) => <div key={x.url}><span><b>{x.titel}</b> <span className="leise klein">{x.url}</span></span><button type="button" className="knopf leise-knopf klein-knopf" onClick={() => setE({ ...e, seiten: seiten.filter((_, i) => i !== k) })}>Entfernen</button></div>)}</div>}
        <div className="seite-neu">
          <input value={neu.titel} onChange={(x) => setNeu({ ...neu, titel: x.target.value })} placeholder="Name, z. B. Duden" aria-label="Name der Seite" />
          <input value={neu.url} onChange={(x) => setNeu({ ...neu, url: x.target.value })} placeholder="https://www.duden.de" aria-label="Adresse der Seite" onKeyDown={(x) => { if (x.key === "Enter") { x.preventDefault(); seiteDazu(); } }} />
          <button type="button" className="knopf" onClick={seiteDazu} disabled={!neu.url.trim()}>Erlauben</button>
        </div>
        {fehler && <span className="feld-fehler">{fehler}</span>}
        <p className="leise klein">Erlaubt ist die Seite und alles darunter, z. B. «https://www.geogebra.org/calculator». In der Lernumgebung bleibt alles andere gesperrt.</p>
      </section>
      <label className="feld">Hinweise oben auf der Prüfung<textarea value={e.hinweise || ""} onChange={(x) => setE({ ...e, hinweise: x.target.value })} rows={3} /></label>
      <label className="feld">Weitere erlaubte Hilfsmittel (Text)<small>Erscheint auf der Prüfung, z. B. «Duden auf Papier»</small><input value={e.hilfsmittel || ""} onChange={(x) => setE({ ...e, hilfsmittel: x.target.value })} /></label>
      <label className="check"><input type="checkbox" checked={e.rueckwaerts !== false} onChange={(x) => setE({ ...e, rueckwaerts: x.target.checked })} style={{ width: "auto", minHeight: 0 }} />Zurückblättern erlaubt</label>
      <label className="check"><input type="checkbox" checked={!!e.mischen} onChange={(x) => setE({ ...e, mischen: x.target.checked })} style={{ width: "auto", minHeight: 0 }} />Antworten bei Auswahlaufgaben für jede Person mischen</label>
      <div className="reihe" style={{ justifyContent: "flex-end" }}><button type="button" className="knopf leise-knopf" onClick={zu}>Abbrechen</button><button className="knopf haupt-knopf">Speichern</button></div>
    </form>
  </Dialog>;
}
