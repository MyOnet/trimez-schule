// Aufträge: Lehrperson erstellt (Termin, Raster, Punkte), sieht wer fehlt, gibt Rückmeldung und überträgt ins Notenbuch.
// Schülerinnen und Schüler geben Text, Dateien oder eine Notizbuchseite ab und überarbeiten nach Rückmeldung.
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, hochladen } from "../api.js";
import { useLaden, Laden, Dialog, Feld, Symbol, Note, useMeldung, DateiListe, DateiKnopf, Absaetze, zeitCH, wann, lokal, ausLokal, useKurse, kursName } from "../ui.jsx";
import { useIch } from "../App.jsx";
import { fmtNote } from "@schule/shared";

export const STAND = { offen: "offen", fehlt: "fehlt", abgegeben: "abgegeben", spaet: "spät abgegeben", ueberarbeiten: "zur Überarbeitung", zurueckgegeben: "zurückgegeben" };
const STAND_KLASSE = { fehlt: "warn-chip", spaet: "warn-chip", ueberarbeiten: "warn-chip" };
const STATUS = { entwurf: "Entwurf", veroeffentlicht: "veröffentlicht", geschlossen: "geschlossen" };
export const StandChip = ({ s }) => <span className={STAND_KLASSE[s] || "chip"}>{STAND[s] || s}</span>;

export default function Auftraege() {
  const ich = useIch();
  return ich.rollen.includes("schueler") && !ich.unterrichtet ? <MeineAuftraege /> : <AuftraegeLp />;
}

function MeineAuftraege() {
  const z = useLaden("/api/meine-auftraege");
  const { kurz } = useParams();
  return <Laden zustand={z}>{(liste) => {
    const gruppen = [["Zu erledigen", liste.filter((a) => ["offen", "fehlt", "ueberarbeiten"].includes(a.stand))], ["Abgegeben", liste.filter((a) => ["abgegeben", "spaet"].includes(a.stand))], ["Zurückgegeben", liste.filter((a) => a.stand === "zurueckgegeben")]];
    return <div>
      <div className="kopf"><div><h1>Aufträge</h1><p className="leise" style={{ marginTop: 6 }}>Was Ihre Lehrpersonen Ihnen aufgegeben haben.</p></div></div>
      {!liste.length && <div className="leer"><b>Keine Aufträge</b><span>Sobald eine Lehrperson einen Auftrag veröffentlicht, erscheint er hier.</span></div>}
      {gruppen.filter(([, l]) => l.length).map(([titel, l]) => <section key={titel} style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: "1.1rem", marginBottom: 8 }}>{titel}</h2>
        <div className="stapel" style={{ gap: 8 }}>{l.map((a) => <Link key={a.id} to={`/s/${kurz}/auftraege/${a.id}`} className="karte reihe" style={{ justifyContent: "space-between", borderLeft: `4px solid ${a.farbe || "var(--gruen)"}`, textDecoration: "none", color: "inherit" }}>
          <div><b>{a.titel}</b><div className="leise klein">{a.fach}{a.faellig_am ? ` · fällig ${wann(a.faellig_am)}, ${new Date(a.faellig_am).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })}` : ""}</div></div>
          <div className="reihe" style={{ gap: 8 }}>{a.stand === "zurueckgegeben" && a.note != null && <Note wert={a.note} />}<StandChip s={a.stand} /></div>
        </Link>)}</div>
      </section>)}
    </div>;
  }}</Laden>;
}

function AuftraegeLp() {
  const kurse = useKurse();
  const [such, setSuch] = useSearchParams();
  return <Laden zustand={kurse}>{(k) => {
    const uid = such.get("u") || (k[0] && k[0].id);
    return <div>
      <div className="kopf"><div><h1>Aufträge</h1><p className="leise" style={{ marginTop: 6 }}>Aufträge mit Termin, Raster und Rückmeldung. Punkte übertragen Sie mit einem Klick ins Notenbuch.</p></div>
        {k.length > 0 && <label className="feld" style={{ minWidth: 220 }}>Unterricht<select value={uid} onChange={(e) => setSuch({ u: e.target.value })}>{k.map((u) => <option key={u.id} value={u.id}>{kursName(u)}</option>)}</select></label>}
      </div>
      {!k.length ? <div className="leer"><b>Kein Unterricht</b><span>Aufträge erstellen Sie für einen Unterricht, den Sie erteilen.</span></div> : <AuftragsListe uid={uid} />}
    </div>;
  }}</Laden>;
}

function AuftragsListe({ uid }) {
  const z = useLaden(`/api/unterricht/${uid}/auftraege`, [uid]);
  const [neu, setNeu] = useState(false);
  const { kurz } = useParams();
  const nav = useNavigate();
  return <Laden zustand={z}>{(d) => <>
    {!d.lehrperson ? <div className="hinweis">In diesem Unterricht sind Sie nicht Lehrperson.</div> : <>
      <div className="reihe" style={{ justifyContent: "flex-end", marginBottom: 12 }}><button className="knopf haupt-knopf" onClick={() => setNeu(true)}><Symbol.plus />Neuer Auftrag</button></div>
      {!d.auftraege.length ? <div className="leer"><b>Noch keine Aufträge in {d.unterricht.fach} {d.unterricht.klasse}</b><span>Ein Auftrag hat eine Anleitung, einen Termin und auf Wunsch ein Bewertungsraster.</span></div> :
        <div className="tabelle-huelle"><table><thead><tr><th>Auftrag</th><th>Fällig</th><th>Abgegeben</th><th>Zu bewerten</th><th>Status</th></tr></thead><tbody>
          {d.auftraege.map((a) => <tr key={a.id} onClick={() => nav(`/s/${kurz}/auftraege/${a.id}`)} style={{ cursor: "pointer" }}>
            <td><Link to={`/s/${kurz}/auftraege/${a.id}`}><b>{a.titel}</b></Link></td>
            <td>{a.faellig_am ? zeitCH(a.faellig_am) : "–"}</td>
            <td>{a.status === "entwurf" ? "–" : `${a.abgegeben} von ${d.schueler}`}</td>
            <td>{a.zu_bewerten || "–"}</td>
            <td><span className="chip">{STATUS[a.status]}</span>{a.bewertung_id && <span className="chip">im Notenbuch</span>}</td>
          </tr>)}</tbody></table></div>}
      <AuftragEditor offen={neu} onZu={() => setNeu(false)} uid={uid} onGespeichert={(a) => nav(`/s/${kurz}/auftraege/${a.id}`)} />
    </>}
  </>}</Laden>;
}

function AuftragEditor({ offen, onZu, uid, auftrag, onGespeichert }) {
  const zeige = useMeldung();
  const [f, setF] = useState(null);
  const [fehler, setFehler] = useState({});
  useEffect(() => { if (offen) setF(auftrag ? { titel: auftrag.titel, anleitung: auftrag.anleitung, faellig_am: lokal(auftrag.faellig_am), punkte_max: auftrag.punkte_max ?? "", raster: auftrag.raster || [], abgabe: auftrag.abgabe, spaet_erlaubt: auftrag.spaet_erlaubt }
    : { titel: "", anleitung: "", faellig_am: "", punkte_max: "", raster: [], abgabe: { text: true, datei: true, notizbuch: false }, spaet_erlaubt: true }); }, [offen]);
  const zu = () => { setF(null); setFehler({}); onZu(); };
  const speichern = async () => {
    try {
      const daten = { ...f, faellig_am: ausLokal(f.faellig_am), punkte_max: f.raster.length ? undefined : f.punkte_max === "" ? null : Number(f.punkte_max), raster: f.raster.map((k) => ({ ...k, punkte: Number(k.punkte) })) };
      const a = auftrag ? await api(`/api/auftraege/${auftrag.id}`, { methode: "PUT", daten }) : await api(`/api/unterricht/${uid}/auftraege`, { methode: "POST", daten });
      zeige(auftrag ? "Gespeichert" : "Auftrag erstellt (Entwurf)"); zu(); onGespeichert && onGespeichert(a.id ? a : auftrag);
    } catch (e) { setFehler({ [e.feld || "_"]: e.message }); }
  };
  const set = (k, v) => setF({ ...f, [k]: v });
  const summe = f ? f.raster.reduce((s, k) => s + (Number(k.punkte) || 0), 0) : 0;
  return <Dialog offen={offen} titel={auftrag ? "Auftrag bearbeiten" : "Neuer Auftrag"} onZu={zu} fuss={<><button className="knopf" onClick={zu}>Abbrechen</button><button className="knopf haupt-knopf" onClick={speichern}>Speichern</button></>}>
    {f && <div className="stapel" style={{ gap: 12, minWidth: "min(560px, 80vw)" }}>
      {fehler._ && <div className="hinweis fehler">{fehler._}</div>}
      <Feld label="Titel" value={f.titel} onChange={(e) => set("titel", e.target.value)} fehler={fehler.titel} autoFocus />
      <label className="feld">Anleitung<textarea rows={6} value={f.anleitung} onChange={(e) => set("anleitung", e.target.value)} /></label>
      <div className="zwei">
        <Feld label="Fällig am" type="datetime-local" value={f.faellig_am} onChange={(e) => set("faellig_am", e.target.value)} fehler={fehler.faellig_am} />
        {!f.raster.length && <Feld label="Punkte (freiwillig)" type="number" min="0.5" step="0.5" value={f.punkte_max} onChange={(e) => set("punkte_max", e.target.value)} fehler={fehler.punkte_max} />}
      </div>
      <fieldset className="stapel" style={{ gap: 6, border: 0, padding: 0 }}><legend className="klein"><b>Abgabe als</b></legend>
        <div className="reihe" style={{ gap: 16 }}>{[["text", "Text"], ["datei", "Dateien"], ["notizbuch", "Notizbuchseite"]].map(([k, t]) => <label key={k} className="check"><input type="checkbox" checked={!!f.abgabe[k]} onChange={(e) => set("abgabe", { ...f.abgabe, [k]: e.target.checked })} />{t}</label>)}</div>
        <label className="check"><input type="checkbox" checked={f.spaet_erlaubt} onChange={(e) => set("spaet_erlaubt", e.target.checked)} />Späte Abgaben annehmen (werden markiert)</label>
      </fieldset>
      <div className="stapel" style={{ gap: 6 }}>
        <div className="reihe" style={{ justifyContent: "space-between" }}><b className="klein">Bewertungsraster {f.raster.length > 0 && <span className="leise">({fmtNote(summe)} Punkte)</span>}</b>
          <button type="button" className="knopf leise-knopf klein" onClick={() => set("raster", [...f.raster, { id: `k${Date.now() % 100000}`, kriterium: "", beschreibung: "", punkte: 2 }])}><Symbol.plus />Kriterium</button></div>
        {f.raster.map((k, i) => <div key={k.id} className="reihe" style={{ gap: 8, alignItems: "flex-end" }}>
          <Feld label={`Kriterium ${i + 1}`} value={k.kriterium} onChange={(e) => set("raster", f.raster.map((x, j) => j === i ? { ...x, kriterium: e.target.value } : x))} fehler={fehler[`raster.${i}.kriterium`]} />
          <Feld label="Punkte" type="number" min="0.5" step="0.5" style={{ width: 90 }} value={k.punkte} onChange={(e) => set("raster", f.raster.map((x, j) => j === i ? { ...x, punkte: e.target.value } : x))} />
          <button type="button" className="knopf leise-knopf" aria-label="Kriterium entfernen" onClick={() => set("raster", f.raster.filter((_, j) => j !== i))}><Symbol.papierkorb /></button>
        </div>)}
      </div>
    </div>}
  </Dialog>;
}

export function AuftragDetail() {
  const { id } = useParams();
  const z = useLaden(`/api/auftraege/${id}`);
  return <Laden zustand={z}>{(d) => d.lehrperson ? <AuftragLp d={d} neu={z.neu} /> : <AuftragSchueler d={d} neu={z.neu} />}</Laden>;
}

function Kopf({ d, kinder }) {
  const { kurz } = useParams();
  const a = d.auftrag;
  return <div className="kopf"><div>
    <p className="leise klein"><Link to={`/s/${kurz}/auftraege${d.lehrperson ? `?u=${d.unterricht.id}` : ""}`}>Aufträge</Link> · {d.unterricht.fach} {d.unterricht.klasse}</p>
    <h1>{a.titel}</h1>
    <p className="leise" style={{ marginTop: 6 }}>{a.faellig_am ? `Fällig ${zeitCH(a.faellig_am)}` : "Ohne Termin"}{a.punkte_max ? ` · ${fmtNote(a.punkte_max)} Punkte` : ""}{d.lehrperson ? ` · ${STATUS[a.status]}` : ""}</p>
  </div>{kinder}</div>;
}

function AuftragLp({ d, neu }) {
  const zeige = useMeldung();
  const a = d.auftrag;
  const [bearbeiten, setBearbeiten] = useState(false);
  const [wer, setWer] = useState(null);
  const [nb, setNb] = useState(false);
  const tun = async (pfad, daten, text) => { try { const r = await api(`/api/auftraege/${a.id}${pfad}`, { methode: "POST", daten }); zeige(typeof text === "function" ? text(r) : text); neu(); } catch (e) { zeige(e.message, true); } };
  const zahlen = Object.fromEntries(Object.keys(STAND).map((k) => [k, d.liste.filter((x) => x.stand === k).length]));
  const aktuell = wer && d.liste.find((x) => x.schueler.id === wer);
  return <div>
    <Kopf d={d} kinder={<div className="reihe" style={{ gap: 8, flexWrap: "wrap" }}>
      <button className="knopf" onClick={() => setBearbeiten(true)}>Bearbeiten</button>
      {a.status === "entwurf" && <button className="knopf haupt-knopf" onClick={() => tun("/veroeffentlichen", undefined, (r) => `Veröffentlicht, ${r.empfaenger} Schülerinnen und Schüler benachrichtigt`)}>Veröffentlichen</button>}
      {a.status === "veroeffentlicht" && <button className="knopf" onClick={() => tun("/schliessen", {}, "Abgabe geschlossen")}>Abgabe schliessen</button>}
      {a.status === "geschlossen" && <button className="knopf" onClick={() => tun("/schliessen", { oeffnen: true }, "Wieder geöffnet")}>Wieder öffnen</button>}
      {a.status !== "entwurf" && (zahlen.offen + zahlen.fehlt + zahlen.ueberarbeiten) > 0 && <button className="knopf" onClick={() => tun("/erinnern", {}, (r) => r.erinnert ? `${r.erinnert} erinnert` : "Heute schon erinnert")}><Symbol.glocke />Erinnern</button>}
      {zahlen.abgegeben + zahlen.spaet > 0 && <button className="knopf" onClick={() => tun("/alle-zurueckgeben", {}, (r) => `${r.anzahl} zurückgegeben`)}>Alle bewerteten zurückgeben</button>}
      {a.punkte_max && <button className="knopf" onClick={() => setNb(true)}><Symbol.noten />Ins Notenbuch</button>}
    </div>} />
    {a.anleitung && <section className="karte" style={{ marginBottom: 16 }}><Absaetze text={a.anleitung} /><DateiListe dateien={d.anhaenge} pfad="/api/auftrag-dateien/" loeschen={async (f) => { await api(`/api/auftrag-dateien/${f.id}`, { methode: "DELETE" }); neu(); }} />
      <DateiKnopf text="Anhang hinzufügen" onDatei={async (x) => { try { await hochladen(`/api/auftraege/${a.id}/dateien`, x); neu(); } catch (e) { zeige(e.message, true); } }} /></section>}
    <div className="reihe" style={{ gap: 8, flexWrap: "wrap", marginBottom: 12 }}>{Object.entries(STAND).map(([k, t]) => zahlen[k] ? <span key={k} className={STAND_KLASSE[k] || "chip"}>{zahlen[k]} {t}</span> : null)}</div>
    <div className="zwei" style={{ alignItems: "start", gridTemplateColumns: aktuell ? "minmax(260px, 1fr) minmax(320px, 1.3fr)" : "1fr" }}>
      <div className="tabelle-huelle"><table><thead><tr><th>Name</th><th>Stand</th><th>Punkte</th><th>Note</th></tr></thead><tbody>
        {d.liste.map((x) => <tr key={x.schueler.id} onClick={() => setWer(x.schueler.id)} style={{ cursor: "pointer", background: wer === x.schueler.id ? "var(--flaeche-2, #eef)" : undefined }}>
          <td><button className="link-knopf" style={{ all: "unset", cursor: "pointer", fontWeight: 600 }}>{x.schueler.nachname} {x.schueler.vorname}</button></td>
          <td><StandChip s={x.stand} />{x.abgabe && x.abgabe.version > 1 ? <span className="leise klein"> v{x.abgabe.version}</span> : null}</td>
          <td>{x.abgabe && x.abgabe.punkte != null ? fmtNote(x.abgabe.punkte) : "–"}</td>
          <td>{x.abgabe && x.abgabe.note != null ? <Note wert={x.abgabe.note} /> : "–"}</td>
        </tr>)}</tbody></table></div>
      {aktuell && <Bewerten key={aktuell.schueler.id} a={a} x={aktuell} neu={neu} weiter={() => { const i = d.liste.findIndex((y) => y.schueler.id === wer); const n = d.liste.slice(i + 1).find((y) => ["abgegeben", "spaet"].includes(y.stand)); setWer(n ? n.schueler.id : null); }} />}
    </div>
    <AuftragEditor offen={bearbeiten} onZu={() => setBearbeiten(false)} auftrag={a} onGespeichert={neu} />
    <InsNotenbuch offen={nb} onZu={() => setNb(false)} d={d} onFertig={neu} />
  </div>;
}

function Bewerten({ a, x, neu, weiter }) {
  const zeige = useMeldung();
  const ab = x.abgabe || {};
  const [rm, setRm] = useState(ab.rueckmeldung || "");
  const [rp, setRp] = useState(ab.raster_punkte || {});
  const [punkte, setPunkte] = useState(ab.punkte ?? "");
  const [note, setNote] = useState("");
  const speichern = async () => {
    const daten = { rueckmeldung: rm, ...(a.raster.length ? { raster_punkte: Object.fromEntries(Object.entries(rp).filter(([, v]) => v !== "" && v != null).map(([k, v]) => [k, Number(v)])) } : a.punkte_max ? { punkte: punkte === "" ? null : Number(punkte) } : {}), ...(note !== "" ? { note: Number(note) } : {}) };
    await api(`/api/auftraege/${a.id}/abgaben/${x.schueler.id}`, { methode: "PUT", daten });
  };
  const zurueck = async (art) => { try { await speichern(); await api(`/api/auftraege/${a.id}/abgaben/${x.schueler.id}/zurueckgeben`, { methode: "POST", daten: { art } }); zeige(art === "ueberarbeiten" ? "Zur Überarbeitung zurückgegeben" : "Zurückgegeben"); neu(); weiter(); } catch (e) { zeige(e.message, true); } };
  return <section className="karte stapel" style={{ gap: 12 }}>
    <div className="reihe" style={{ justifyContent: "space-between" }}><h2 style={{ fontSize: "1.15rem" }}>{x.schueler.vorname} {x.schueler.nachname}</h2><StandChip s={x.stand} /></div>
    {!x.abgabe || !ab.abgegeben_am ? <p className="leise">Noch nichts abgegeben.</p> : <>
      <p className="leise klein">Abgegeben {zeitCH(ab.abgegeben_am)}{ab.spaet ? " (spät)" : ""}{ab.version > 1 ? `, Version ${ab.version}` : ""}</p>
      {ab.text && <div className="textinhalt" style={{ background: "var(--papier, #fafafa)", padding: 12, borderRadius: 8, maxHeight: 320, overflow: "auto" }}><Absaetze text={ab.text} /></div>}
      <DateiListe dateien={ab.dateien} pfad="/api/auftrag-dateien/" />
      {ab.seite && <details><summary>Notizbuchseite: {ab.seite.titel}</summary><div style={{ whiteSpace: "pre-wrap" }}>{ab.seite.text}</div></details>}
    </>}
    {a.raster.length > 0 ? <div className="stapel" style={{ gap: 6 }}>{a.raster.map((k) => <label key={k.id} className="reihe" style={{ justifyContent: "space-between", gap: 8 }}>
      <span>{k.kriterium}<span className="leise klein"> (max. {fmtNote(k.punkte)})</span></span>
      <input type="number" min="0" max={k.punkte} step="0.5" style={{ width: 80 }} value={rp[k.id] ?? ""} onChange={(e) => setRp({ ...rp, [k.id]: e.target.value })} /></label>)}
      <div className="reihe" style={{ justifyContent: "space-between" }}><b>Total</b><b>{fmtNote(Object.values(rp).reduce((s, v) => s + (Number(v) || 0), 0))} / {fmtNote(a.punkte_max)}</b></div></div>
      : a.punkte_max ? <Feld label={`Punkte (max. ${fmtNote(a.punkte_max)})`} type="number" min="0" step="0.5" value={punkte} onChange={(e) => setPunkte(e.target.value)} /> : null}
    <Feld label={`Note (leer = aus Punkten${x.notenvorschlag != null ? `, Vorschlag ${fmtNote(x.notenvorschlag)}` : ""})`} type="number" min="1" max="6" step="0.25" value={note} onChange={(e) => setNote(e.target.value)} />
    <label className="feld">Rückmeldung<textarea rows={5} value={rm} onChange={(e) => setRm(e.target.value)} /></label>
    <div className="reihe" style={{ gap: 8, flexWrap: "wrap" }}>
      <button className="knopf" onClick={async () => { try { await speichern(); zeige("Gespeichert (noch nicht sichtbar)"); neu(); } catch (e) { zeige(e.message, true); } }}>Speichern</button>
      <button className="knopf" onClick={() => zurueck("ueberarbeiten")}>Zur Überarbeitung</button>
      <button className="knopf haupt-knopf" onClick={() => zurueck("bewertet")}>Zurückgeben</button>
    </div>
  </section>;
}

function InsNotenbuch({ offen, onZu, d, onFertig }) {
  const zeige = useMeldung();
  const [gewicht, setGewicht] = useState(1);
  const [art, setArt] = useState("");
  const los = async () => { try { const r = await api(`/api/auftraege/${d.auftrag.id}/ins-notenbuch`, { methode: "POST", daten: { gewicht: Number(gewicht), bewertungsart_id: art || null } }); zeige(`${r.anzahl} Noten als Entwurf im Notenbuch`); onZu(); onFertig(); } catch (e) { zeige(e.message, true); } };
  return <Dialog offen={offen} titel="Ins Notenbuch übertragen" onZu={onZu} fuss={<><button className="knopf" onClick={onZu}>Abbrechen</button><button className="knopf haupt-knopf" onClick={los}>Übertragen</button></>}>
    <div className="stapel" style={{ gap: 12 }}>
      <p className="leise">Alle bewerteten Abgaben kommen als Entwurf ins Notenbuch. Sichtbar werden sie erst, wenn Sie die Bewertung dort freigeben. Ein zweites Übertragen aktualisiert den Entwurf.</p>
      <Feld label="Gewicht" type="number" min="0.25" step="0.25" value={gewicht} onChange={(e) => setGewicht(e.target.value)} />
      <Feld label="Art" type="select" value={art} onChange={(e) => setArt(e.target.value)}><option value="">Auftrag</option>{d.arten.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Feld>
    </div>
  </Dialog>;
}

function AuftragSchueler({ d, neu }) {
  const zeige = useMeldung();
  const a = d.auftrag, ab = d.abgabe || { status: "entwurf", text: "", dateien: [] };
  const [txt, setTxt] = useState(ab.text || "");
  const gesperrt = ["abgegeben", "zurueckgegeben"].includes(ab.status) || a.status === "geschlossen";
  const speichern = async (still) => { try { await api(`/api/auftraege/${a.id}/meine-abgabe`, { methode: "PUT", daten: { text: txt } }); if (!still) zeige("Entwurf gespeichert"); } catch (e) { zeige(e.message, true); throw e; } };
  const abgeben = async () => { try { if (a.abgabe.text) await speichern(true); const r = await api(`/api/auftraege/${a.id}/abgeben`, { methode: "POST" }); zeige(r.spaet ? "Abgegeben (nach dem Termin)" : "Abgegeben"); neu(); } catch (e) { zeige(e.message, true); } };
  return <div>
    <Kopf d={d} kinder={<StandChip s={d.stand} />} />
    <div className="zwei" style={{ alignItems: "start" }}>
      <section className="karte"><h2 style={{ fontSize: "1.1rem", marginBottom: 8 }}>Auftrag</h2>{a.anleitung ? <Absaetze text={a.anleitung} /> : <p className="leise">Keine Anleitung.</p>}
        <DateiListe dateien={d.anhaenge} pfad="/api/auftrag-dateien/" />
        {a.raster.length > 0 && <><h3 className="klein" style={{ marginTop: 12 }}>Bewertet wird</h3><ul>{a.raster.map((k) => <li key={k.id}>{k.kriterium} ({fmtNote(k.punkte)} P.){ab.raster_punkte && ab.raster_punkte[k.id] != null ? <b> → {fmtNote(ab.raster_punkte[k.id])}</b> : null}</li>)}</ul></>}
        <p className="leise klein">{d.lehrpersonen.map((l) => `${l.vorname} ${l.nachname}`).join(", ")}</p>
      </section>
      <section className="karte stapel" style={{ gap: 12 }}>
        <h2 style={{ fontSize: "1.1rem" }}>Meine Abgabe</h2>
        {(ab.rueckmeldung || ab.note != null) && <div className="hinweis"><b>Rückmeldung</b>{ab.note != null && <> · Note <Note wert={ab.note} /></>}{ab.punkte != null && <> · {fmtNote(ab.punkte)} / {fmtNote(a.punkte_max)} Punkte</>}<Absaetze text={ab.rueckmeldung} /></div>}
        {a.abgabe.text && <label className="feld">Text<textarea rows={10} value={txt} disabled={gesperrt} onChange={(e) => setTxt(e.target.value)} onBlur={() => !gesperrt && txt !== (ab.text || "") && speichern(true).catch(() => {})} /></label>}
        {a.abgabe.datei && <div><b className="klein">Dateien</b><DateiListe dateien={ab.dateien} pfad="/api/auftrag-dateien/" loeschen={gesperrt ? null : async (f) => { await api(`/api/auftrag-dateien/${f.id}`, { methode: "DELETE" }); neu(); }} />
          {!gesperrt && <DateiKnopf mehrere onDatei={async (x) => { try { await hochladen(`/api/auftraege/${a.id}/meine-abgabe/dateien`, x); neu(); } catch (e) { zeige(e.message, true); } }} />}</div>}
        {a.abgabe.notizbuch && <Feld label="Seite aus meinem Notizbuch" type="select" disabled={gesperrt} value={ab.seite ? ab.seite.id : ""} onChange={async (e) => { try { await api(`/api/auftraege/${a.id}/meine-abgabe`, { methode: "PUT", daten: { notiz_seite_id: e.target.value || null } }); neu(); } catch (x) { zeige(x.message, true); } }}>
          <option value="">Keine</option>{d.meineSeiten.map((s) => <option key={s.id} value={s.id}>{s.abschnitt}: {s.titel}</option>)}</Feld>}
        <div className="reihe" style={{ gap: 8 }}>
          {!gesperrt && <><button className="knopf" onClick={() => speichern()}>Entwurf speichern</button><button className="knopf haupt-knopf" onClick={abgeben}>{ab.status === "ueberarbeiten" ? "Überarbeitung abgeben" : "Abgeben"}</button></>}
          {ab.status === "abgegeben" && a.status !== "geschlossen" && <button className="knopf" onClick={async () => { try { await api(`/api/auftraege/${a.id}/zurueckziehen`, { methode: "POST" }); neu(); } catch (e) { zeige(e.message, true); } }}>Abgabe zurückziehen</button>}
        </div>
        {ab.abgegeben_am && <p className="leise klein">Zuletzt abgegeben {zeitCH(ab.abgegeben_am)}{ab.spaet ? " (nach dem Termin)" : ""}.</p>}
      </section>
    </div>
  </div>;
}
