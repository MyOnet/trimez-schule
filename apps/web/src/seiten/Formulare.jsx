// Formulare: Quiz (bewertet sich selbst), Umfragen und Anmeldungen (z. B. Elternabend) mit öffentlichem Link
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { useLaden, Laden, Dialog, Feld, Symbol, useMeldung, Absaetze, zeitCH, wann, lokal, ausLokal, useKurse, kursName } from "../ui.jsx";
import { TYPEN, neuerTeil, fmtNote } from "@schule/shared";
import TeilFormular from "./pruefung/TeilFormular.jsx";
import Pruefungsblatt from "./pruefung/Pruefungsblatt.jsx";

const ARTEN = { quiz: "Quiz", umfrage: "Umfrage", anmeldung: "Anmeldung" };
const STATUS = { entwurf: "Entwurf", offen: "offen", geschlossen: "geschlossen" };
const QUIZ = ["einfach", "mehrfach", "kurz", "zahl", "luecken", "zuordnung", "reihenfolge"];
const UMFRAGE = { auswahl: "Auswahl", skala: "Skala", text: "Textantwort", termin: "Zeitfenster mit Plätzen" };

export default function Formulare() {
  const z = useLaden("/api/formulare");
  const { kurz } = useParams();
  const [neu, setNeu] = useState(false);
  return <Laden zustand={z}>{(d) => <div>
    <div className="kopf"><div><h1>Formulare</h1><p className="leise" style={{ marginTop: 6 }}>Quiz zur Selbstkontrolle, Umfragen und Anmeldungen. Antworten bleiben in RESCOOL.</p></div>
      {d.darfErstellen && <button className="knopf haupt-knopf" onClick={() => setNeu(true)}><Symbol.plus />Neues Formular</button>}</div>
    {d.fuerMich.length > 0 && <section style={{ marginBottom: 24 }}><h2 style={{ fontSize: "1.1rem", marginBottom: 8 }}>Für Sie</h2>
      <div className="stapel" style={{ gap: 8 }}>{d.fuerMich.map((f) => <Link key={f.id} to={`/s/${kurz}/formulare/${f.id}`} className="karte reihe" style={{ justifyContent: "space-between", borderLeft: `4px solid ${f.farbe || "var(--gruen)"}`, color: "inherit", textDecoration: "none" }}>
        <span><b>{f.titel}</b><span className="leise klein" style={{ display: "block" }}>{ARTEN[f.art]} · {f.fach}{f.schliesst_am ? ` · bis ${zeitCH(f.schliesst_am)}` : ""}</span></span>
        <span className="chip">{f.erledigt ? (f.mehrfach ? "nochmals" : "erledigt") : "offen"}</span></Link>)}</div></section>}
    {d.darfErstellen && (!d.eigene.length ? <div className="leer"><b>Noch keine Formulare</b><span>Ein Quiz gehört zu einem Unterricht. Umfragen und Anmeldungen gehen auch über einen Link an Eltern.</span></div> :
      <div className="tabelle-huelle"><table><thead><tr><th>Titel</th><th>Art</th><th>Für</th><th>Antworten</th><th>Status</th></tr></thead><tbody>
        {d.eigene.map((f) => <tr key={f.id}><td><Link to={`/s/${kurz}/formulare/${f.id}`}><b>{f.titel}</b></Link></td><td>{ARTEN[f.art]}</td><td>{f.fach ? `${f.fach} ${f.klasse}` : f.einstellungen.oeffentlich ? "Link" : "–"}</td><td>{f.antworten}</td><td><span className="chip">{STATUS[f.status]}</span></td></tr>)}
      </tbody></table></div>)}
    {!d.darfErstellen && !d.fuerMich.length && <div className="leer"><b>Keine offenen Formulare</b><span>Wenn eine Lehrperson ein Quiz oder eine Umfrage öffnet, erscheint sie hier.</span></div>}
    <NeuesFormular offen={neu} onZu={() => setNeu(false)} />
  </div>}</Laden>;
}

function NeuesFormular({ offen, onZu }) {
  const kurse = useKurse();
  const nav = useNavigate();
  const { kurz } = useParams();
  const [f, setF] = useState({ art: "quiz", titel: "", unterricht_id: "" });
  const [fehler, setFehler] = useState({});
  const los = async () => {
    try { const r = await api("/api/formulare", { methode: "POST", daten: { ...f, unterricht_id: f.unterricht_id || null, fragen: [], einstellungen: { oeffentlich: f.art !== "quiz" && !f.unterricht_id } } }); nav(`/s/${kurz}/formulare/${r.id}`); }
    catch (e) { setFehler({ [e.feld || "_"]: e.message }); }
  };
  return <Dialog offen={offen} titel="Neues Formular" onZu={onZu} fuss={<><button className="knopf" onClick={onZu}>Abbrechen</button><button className="knopf haupt-knopf" onClick={los}>Erstellen</button></>}>
    <div className="stapel" style={{ gap: 12, minWidth: "min(440px, 80vw)" }}>
      {fehler._ && <div className="hinweis fehler">{fehler._}</div>}
      <div className="segment" role="group" aria-label="Art">{Object.entries(ARTEN).map(([k, t]) => <button key={k} type="button" aria-pressed={f.art === k} onClick={() => setF({ ...f, art: k })}>{t}</button>)}</div>
      <p className="leise klein">{f.art === "quiz" ? "Fragen mit richtiger Lösung. Die Schülerinnen und Schüler sehen ihr Ergebnis sofort." : f.art === "umfrage" ? "Meinungen und Rückmeldungen, auf Wunsch anonym." : "Anmeldung mit Zeitfenstern und Plätzen, z. B. für Elterngespräche."}</p>
      <Feld label="Titel" value={f.titel} onChange={(e) => setF({ ...f, titel: e.target.value })} fehler={fehler.titel} autoFocus />
      <Laden zustand={kurse}>{(k) => <Feld label={f.art === "quiz" ? "Unterricht" : "Unterricht (leer = nur über Link)"} type="select" value={f.unterricht_id} onChange={(e) => setF({ ...f, unterricht_id: e.target.value })} fehler={fehler.unterricht_id}>
        <option value="">{f.art === "quiz" ? "Bitte wählen" : "Kein Unterricht (Link für Eltern oder Gäste)"}</option>{k.map((u) => <option key={u.id} value={u.id}>{kursName(u)}</option>)}</Feld>}</Laden>
    </div>
  </Dialog>;
}

export function Formular() {
  const { id } = useParams();
  const z = useLaden(`/api/formulare/${id}`);
  return <Laden zustand={z}>{(d) => d.verwalten ? <FormularVerwalten d={d} neu={z.neu} /> : <FormularAusfuellen d={d} neu={z.neu} />}</Laden>;
}

function FormularVerwalten({ d, neu }) {
  const f = d.formular;
  const { kurz } = useParams();
  const nav = useNavigate();
  const zeige = useMeldung();
  const [reiter, setReiter] = useState(f.status === "entwurf" ? "fragen" : "ergebnisse");
  const status = async (s) => { try { await api(`/api/formulare/${f.id}/status`, { methode: "POST", daten: { status: s } }); zeige(s === "offen" ? "Geöffnet" : "Geschlossen"); neu(); } catch (e) { zeige(e.message, true); } };
  const link = `${location.origin}${d.link}`;
  return <div>
    <div className="kopf"><div><p className="leise klein"><Link to={`/s/${kurz}/formulare`}>Formulare</Link> · {ARTEN[f.art]}</p><h1>{f.titel}</h1>
      <p className="leise" style={{ marginTop: 6 }}><span className="chip">{STATUS[f.status]}</span> {d.anzahl} Antworten{f.schliesst_am ? ` · schliesst ${zeitCH(f.schliesst_am)}` : ""}</p></div>
      <div className="reihe" style={{ gap: 8, flexWrap: "wrap" }}>
        {f.status !== "offen" ? <button className="knopf haupt-knopf" onClick={() => status("offen")}>Öffnen</button> : <button className="knopf" onClick={() => status("geschlossen")}>Schliessen</button>}
        {d.anzahl > 0 && <a className="knopf" href={`/api/formulare/${f.id}/csv`}>CSV herunterladen</a>}
        <button className="knopf leise-knopf" onClick={async () => { if (!confirm(`«${f.titel}» mit allen Antworten löschen?`)) return; await api(`/api/formulare/${f.id}`, { methode: "DELETE" }); nav(`/s/${kurz}/formulare`); }}><Symbol.papierkorb />Löschen</button>
      </div></div>
    {f.einstellungen.oeffentlich && <div className="hinweis reihe" style={{ gap: 8, flexWrap: "wrap", marginBottom: 16 }}><Symbol.link /><span>Link zum Ausfüllen (ohne Anmeldung):</span><code style={{ userSelect: "all" }}>{link}</code>
      <button className="knopf leise-knopf klein" onClick={() => navigator.clipboard.writeText(link).then(() => zeige("Link kopiert"))}>Kopieren</button></div>}
    <div className="segment" role="tablist" style={{ marginBottom: 16 }}>{[["fragen", "Fragen"], ["ergebnisse", `Ergebnisse (${d.anzahl})`]].map(([k, t]) => <button key={k} role="tab" aria-pressed={reiter === k} onClick={() => setReiter(k)}>{t}</button>)}</div>
    {reiter === "fragen" ? <FragenEditor d={d} neu={neu} /> : <Ergebnisse d={d} neu={neu} />}
  </div>;
}

function FragenEditor({ d, neu }) {
  const f = d.formular;
  const zeige = useMeldung();
  const [st, setSt] = useState({ titel: f.titel, beschreibung: f.beschreibung, fragen: f.fragen, einstellungen: f.einstellungen, schliesst_am: lokal(f.schliesst_am) });
  const [fehler, setFehler] = useState(null);
  const typen = f.art === "quiz" ? QUIZ : [...(f.art === "anmeldung" ? ["termin"] : []), "auswahl", "skala", "text"];
  const setFrage = (i, x) => setSt({ ...st, fragen: st.fragen.map((y, j) => (j === i ? x : y)) });
  const neueFrage = (typ) => {
    const id = `f${Date.now() % 1e6}`;
    const x = QUIZ.includes(typ) ? { ...neuerTeil(typ), id } : typ === "skala" ? { id, typ, inhalt: { frage: "", von: 1, bis: 5, links: "", rechts: "" } } : typ === "text" ? { id, typ, inhalt: { frage: "" } } : { id, typ, inhalt: { frage: "", optionen: [{ id: "a", text: "" }, { id: "b", text: "" }] } };
    setSt({ ...st, fragen: [...st.fragen, x] });
  };
  const speichern = async () => {
    try { await api(`/api/formulare/${f.id}`, { methode: "PUT", daten: { ...st, schliesst_am: ausLokal(st.schliesst_am) } }); setFehler(null); zeige("Gespeichert"); neu(); }
    catch (e) { setFehler(e.message); }
  };
  return <div className="stapel" style={{ gap: 16, maxWidth: 820 }}>
    {fehler && <div className="hinweis fehler" role="alert">{fehler}</div>}
    <section className="karte stapel" style={{ gap: 10 }}>
      <Feld label="Titel" value={st.titel} onChange={(e) => setSt({ ...st, titel: e.target.value })} />
      <label className="feld">Beschreibung<textarea rows={3} value={st.beschreibung} onChange={(e) => setSt({ ...st, beschreibung: e.target.value })} /></label>
      <div className="zwei"><Feld label="Schliesst am (freiwillig)" type="datetime-local" value={st.schliesst_am} onChange={(e) => setSt({ ...st, schliesst_am: e.target.value })} /></div>
      <div className="reihe" style={{ gap: 16, flexWrap: "wrap" }}>
        {f.art === "umfrage" && <label className="check"><input type="checkbox" checked={!!st.einstellungen.anonym} onChange={(e) => setSt({ ...st, einstellungen: { ...st.einstellungen, anonym: e.target.checked } })} />Anonym</label>}
        <label className="check"><input type="checkbox" checked={!!st.einstellungen.mehrfach} onChange={(e) => setSt({ ...st, einstellungen: { ...st.einstellungen, mehrfach: e.target.checked } })} />{f.art === "quiz" ? "Mehrere Versuche" : "Mehrfach ausfüllen erlaubt"}</label>
        {f.art === "quiz" && <label className="check"><input type="checkbox" checked={st.einstellungen.loesungen !== false} onChange={(e) => setSt({ ...st, einstellungen: { ...st.einstellungen, loesungen: e.target.checked } })} />Lösungen nach dem Abgeben zeigen</label>}
        {f.art !== "quiz" && <label className="check"><input type="checkbox" checked={!!st.einstellungen.oeffentlich} onChange={(e) => setSt({ ...st, einstellungen: { ...st.einstellungen, oeffentlich: e.target.checked } })} />Öffentlicher Link (ohne Anmeldung)</label>}
      </div>
    </section>
    {st.fragen.map((x, i) => <section key={x.id} className="karte stapel" style={{ gap: 8 }}>
      <div className="reihe" style={{ justifyContent: "space-between" }}><b>Frage {i + 1} · {TYPEN[x.typ] ? (TYPEN[x.typ].name || TYPEN[x.typ]) : UMFRAGE[x.typ]}</b>
        <span className="reihe" style={{ gap: 4 }}>
          {i > 0 && <button className="knopf leise-knopf klein" aria-label="Nach oben" onClick={() => { const a = [...st.fragen]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; setSt({ ...st, fragen: a }); }}>↑</button>}
          <button className="knopf leise-knopf klein" aria-label="Frage entfernen" onClick={() => setSt({ ...st, fragen: st.fragen.filter((_, j) => j !== i) })}><Symbol.papierkorb /></button></span></div>
      {QUIZ.includes(x.typ) ? <><TeilFormular teil={x} setTeil={(t) => setFrage(i, t)} /><Feld label="Punkte" type="number" min="0" step="0.5" style={{ width: 100 }} value={x.punkte ?? 1} onChange={(e) => setFrage(i, { ...x, punkte: Number(e.target.value) })} /></> : <UmfrageFrage x={x} set={(y) => setFrage(i, y)} />}
      {!QUIZ.includes(x.typ) && <label className="check"><input type="checkbox" checked={x.pflicht !== false} onChange={(e) => setFrage(i, { ...x, pflicht: e.target.checked })} />Pflichtfrage</label>}
    </section>)}
    <div className="reihe" style={{ gap: 8, flexWrap: "wrap" }}><span className="leise">Frage hinzufügen:</span>{typen.map((t) => <button key={t} className="knopf" onClick={() => neueFrage(t)}><Symbol.plus />{TYPEN[t] ? (TYPEN[t].name || TYPEN[t]) : UMFRAGE[t]}</button>)}</div>
    <div><button className="knopf haupt-knopf" onClick={speichern}>Speichern</button></div>
  </div>;
}

function UmfrageFrage({ x, set }) {
  const i = x.inhalt;
  const inh = (y) => set({ ...x, inhalt: { ...i, ...y } });
  return <div className="stapel" style={{ gap: 8 }}>
    <Feld label="Frage" value={i.frage} onChange={(e) => inh({ frage: e.target.value })} />
    {x.typ === "text" && <label className="check"><input type="checkbox" checked={!!i.lang} onChange={(e) => inh({ lang: e.target.checked })} />Längere Antwort</label>}
    {x.typ === "skala" && <div className="reihe" style={{ gap: 8, flexWrap: "wrap" }}>
      <Feld label="Von" type="number" min="0" max="1" value={i.von} onChange={(e) => inh({ von: Number(e.target.value) })} style={{ width: 70 }} /><Feld label="Bis" type="number" min="3" max="10" value={i.bis} onChange={(e) => inh({ bis: Number(e.target.value) })} style={{ width: 70 }} />
      <Feld label="Beschriftung links" value={i.links} onChange={(e) => inh({ links: e.target.value })} /><Feld label="Beschriftung rechts" value={i.rechts} onChange={(e) => inh({ rechts: e.target.value })} /></div>}
    {(x.typ === "auswahl" || x.typ === "termin") && <>
      {i.optionen.map((o, k) => <div key={o.id} className="reihe" style={{ gap: 8, alignItems: "flex-end" }}>
        <Feld label={x.typ === "termin" ? `Zeitfenster ${k + 1}` : `Antwort ${k + 1}`} value={o.text} onChange={(e) => inh({ optionen: i.optionen.map((y, j) => (j === k ? { ...y, text: e.target.value } : y)) })} />
        {x.typ === "termin" && <Feld label="Plätze (0 = unbegrenzt)" type="number" min="0" style={{ width: 120 }} value={o.plaetze ?? 0} onChange={(e) => inh({ optionen: i.optionen.map((y, j) => (j === k ? { ...y, plaetze: Number(e.target.value) } : y)) })} />}
        <button className="knopf leise-knopf" aria-label="Entfernen" onClick={() => inh({ optionen: i.optionen.filter((_, j) => j !== k) })}><Symbol.papierkorb /></button></div>)}
      <div className="reihe" style={{ gap: 12 }}><button className="knopf leise-knopf" onClick={() => inh({ optionen: [...i.optionen, { id: `o${Date.now() % 1e5}`, text: "", ...(x.typ === "termin" ? { plaetze: 0 } : {}) }] })}><Symbol.plus />{x.typ === "termin" ? "Zeitfenster" : "Antwort"}</button>
        {x.typ === "auswahl" && <label className="check"><input type="checkbox" checked={!!i.mehrere} onChange={(e) => inh({ mehrere: e.target.checked })} />Mehrere Antworten möglich</label>}</div>
    </>}
  </div>;
}

function Ergebnisse({ d, neu }) {
  const zeige = useMeldung();
  return <div className="stapel" style={{ gap: 16, maxWidth: 900 }}>
    {Array.isArray(d.fehlen) ? d.fehlen.length > 0 && <div className="hinweis"><b>Noch nicht ausgefüllt ({d.fehlen.length}):</b> {d.fehlen.map((s) => `${s.vorname} ${s.nachname}`).join(", ")}</div>
      : d.fehlen > 0 && <div className="hinweis">{d.fehlen} haben noch nicht ausgefüllt (anonym).</div>}
    {d.auswertung.map((a, i) => <section key={a.id} className="karte stapel" style={{ gap: 8 }}>
      <b>{i + 1}. {a.frage}</b><span className="leise klein">{a.anzahl} Antworten{a.richtig != null ? `, ${a.richtig} richtig` : ""}{a.schnitt != null ? `, Schnitt ${fmtNote(a.schnitt)}` : ""}</span>
      {a.optionen && a.optionen.map((o) => { const max = Math.max(1, ...a.optionen.map((x) => x.anzahl)); return <div key={o.id} className="reihe" style={{ gap: 8 }}>
        <span style={{ flex: "0 0 40%" }}>{o.text}{o.plaetze ? <span className="leise klein"> ({o.anzahl}/{o.plaetze})</span> : ""}</span>
        <span style={{ flex: 1, background: "var(--linie, #e5e7eb)", borderRadius: 4, height: 14 }}><span style={{ display: "block", width: `${(o.anzahl / max) * 100}%`, height: "100%", background: "var(--blau, #2C3FC4)", borderRadius: 4 }} /></span>
        <b style={{ width: 32, textAlign: "right" }}>{o.anzahl}</b></div>; })}
      {a.verteilung && <div className="reihe" style={{ gap: 6 }}>{Array.from({ length: a.bis - a.von + 1 }, (_, k) => a.von + k).map((w) => <span key={w} className="chip">{w}: {a.verteilung[w] || 0}</span>)}</div>}
      {a.texte && (a.texte.length ? <ul style={{ margin: 0 }}>{a.texte.map((t, k) => <li key={k} style={{ whiteSpace: "pre-wrap" }}>{t}</li>)}</ul> : <span className="leise">Keine Textantworten.</span>)}
    </section>)}
    {d.antworten.length > 0 && <div className="tabelle-huelle"><table><thead><tr><th>Wer</th><th>Wann</th>{d.formular.art === "quiz" && <th>Punkte</th>}<th></th></tr></thead><tbody>
      {d.antworten.map((a) => <tr key={a.id}><td>{a.wer}{a.email ? <span className="leise klein"> · {a.email}</span> : ""}</td><td>{zeitCH(a.erstellt_am)}</td>{d.formular.art === "quiz" && <td>{fmtNote(a.punkte)} / {fmtNote(a.max_punkte)}</td>}
        <td><button className="knopf leise-knopf klein" onClick={async () => { if (!confirm("Antwort löschen? Ein Platz wird wieder frei.")) return; try { await api(`/api/formular-antworten/${a.id}`, { methode: "DELETE" }); neu(); } catch (e) { zeige(e.message, true); } }}>Löschen</button></td></tr>)}
    </tbody></table></div>}
  </div>;
}

/** Ausfüllen: angemeldet (Unterricht) oder über den öffentlichen Link */
export function Ausfuellen({ formular, absenden, mitName, erledigt }) {
  const [antworten, setAntworten] = useState({});
  const [name, setName] = useState({ name: "", email: "" });
  const [ergebnis, setErgebnis] = useState(null);
  const [fehler, setFehler] = useState(null);
  const quiz = formular.art === "quiz";
  const set = (k, v) => setAntworten({ ...antworten, [k]: v });
  const los = async (e) => { e.preventDefault(); try { setErgebnis(await absenden({ antworten, ...name })); setFehler(null); } catch (x) { setFehler(x.message); } };
  if (ergebnis) return <div className="karte stapel" style={{ gap: 12 }}>
    {quiz ? <><h2>{fmtNote(ergebnis.punkte)} von {fmtNote(ergebnis.max)} Punkten</h2>
      {formular.fragen.map((f, i) => { const r = ergebnis.ergebnisse[f.id] || {}; return <div key={f.id} className="stapel" style={{ gap: 2 }}><b>{i + 1}. {r.richtig ? "✓" : "✗"} {f.inhalt.frage}</b>{r.loesung && <span className="leise">Lösung: {r.loesung}</span>}</div>; })}
      <button className="knopf" onClick={() => { setErgebnis(null); setAntworten({}); }}>Nochmals versuchen</button></>
      : <><h2>Danke!</h2><p>Ihre Antwort ist gespeichert.</p></>}
  </div>;
  const quizTeile = formular.fragen.filter((f) => QUIZ.includes(f.typ));
  return <form onSubmit={los} className="stapel" style={{ gap: 16 }}>
    {erledigt && <div className="hinweis">Sie haben dieses Formular schon ausgefüllt.</div>}
    {formular.beschreibung && <Absaetze text={formular.beschreibung} />}
    {mitName && <div className="zwei"><Feld label="Name" value={name.name} onChange={(e) => setName({ ...name, name: e.target.value })} required /><Feld label="E-Mail (freiwillig)" type="email" value={name.email} onChange={(e) => setName({ ...name, email: e.target.value })} /></div>}
    {quiz ? <Pruefungsblatt p={{ titel: formular.titel }} teile={quizTeile} antworten={antworten} setAntwort={set} schluessel={formular.id} /> :
      formular.fragen.map((f, i) => <fieldset key={f.id} className="karte stapel" style={{ gap: 8, border: 0 }}>
        <legend style={{ fontWeight: 600 }}>{i + 1}. {f.inhalt.frage}{f.pflicht !== false && <span aria-label="Pflichtfrage"> *</span>}</legend>
        {f.typ === "text" && (f.inhalt.lang ? <textarea rows={4} value={antworten[f.id] || ""} onChange={(e) => set(f.id, e.target.value)} /> : <input value={antworten[f.id] || ""} onChange={(e) => set(f.id, e.target.value)} />)}
        {f.typ === "skala" && <div className="reihe" style={{ gap: 6, alignItems: "center", flexWrap: "wrap" }}><span className="leise klein">{f.inhalt.links}</span>
          {Array.from({ length: f.inhalt.bis - f.inhalt.von + 1 }, (_, k) => f.inhalt.von + k).map((w) => <label key={w} className="check"><input type="radio" name={f.id} checked={antworten[f.id] === w} onChange={() => set(f.id, w)} />{w}</label>)}
          <span className="leise klein">{f.inhalt.rechts}</span></div>}
        {(f.typ === "auswahl" || f.typ === "termin") && f.inhalt.optionen.map((o) => { const mehr = f.typ === "auswahl" && f.inhalt.mehrere; const v = antworten[f.id]; const an = mehr ? (v || []).includes(o.id) : v === o.id; const voll = o.frei === 0;
          return <label key={o.id} className="check"><input type={mehr ? "checkbox" : "radio"} name={f.id} disabled={voll} checked={an} onChange={(e) => set(f.id, mehr ? (e.target.checked ? [...(v || []), o.id] : (v || []).filter((x) => x !== o.id)) : o.id)} />{o.text}{o.frei != null && <span className="leise klein"> ({voll ? "voll" : `${o.frei} frei`})</span>}</label>; })}
      </fieldset>)}
    {fehler && <div className="hinweis fehler" role="alert">{fehler}</div>}
    <div><button className="knopf haupt-knopf">{quiz ? "Abgeben und auswerten" : "Absenden"}</button></div>
  </form>;
}

function FormularAusfuellen({ d }) {
  const { kurz } = useParams();
  const f = d.formular;
  return <div style={{ maxWidth: 820 }}>
    <div className="kopf"><div><p className="leise klein"><Link to={`/s/${kurz}/formulare`}>Formulare</Link> · {ARTEN[f.art]}</p><h1>{f.titel}</h1>{f.schliesst_am && <p className="leise">Offen bis {zeitCH(f.schliesst_am)}</p>}</div></div>
    {!f.offen ? <div className="hinweis">Dieses Formular ist geschlossen.</div> : (d.erledigt && !d.mehrfach) ? <div className="hinweis">Sie haben dieses Formular schon ausgefüllt. Danke!</div> :
      <Ausfuellen formular={f} erledigt={d.erledigt} absenden={(x) => api(`/api/formulare/${f.id}/antworten`, { methode: "POST", daten: { antworten: x.antworten } })} />}
    {d.versuche.length > 0 && <p className="leise klein" style={{ marginTop: 12 }}>Bisherige Versuche: {d.versuche.map((v) => `${fmtNote(v.punkte)}/${fmtNote(v.max_punkte)} (${wann(v.erstellt_am)})`).join(", ")}</p>}
  </div>;
}

/** Öffentliche Seite /f/:token (ohne Anmeldung, z. B. Eltern) */
export function FormularOeffentlich() {
  const { token } = useParams();
  const [d, setD] = useState(null);
  const [fehler, setFehler] = useState(null);
  useEffect(() => { api(`/api/f/${token}`).then(setD).catch((e) => setFehler(e.message)); }, [token]);
  return <div className="haupt" style={{ maxWidth: 760, margin: "0 auto", padding: "32px 16px" }}>
    {fehler ? <div className="hinweis fehler">{fehler}</div> : !d ? <p className="leise">Wird geladen …</p> : <>
      <p className="leise">{d.schule.replace(/ \(Testschule\)$/, "")}</p><h1 style={{ marginBottom: 16 }}>{d.formular.titel}</h1>
      {!d.formular.offen ? <div className="hinweis">Dieses Formular ist geschlossen.</div> :
        <Ausfuellen formular={d.formular} mitName={!d.formular.anonym} absenden={(x) => api(`/api/f/${token}`, { methode: "POST", daten: x })} />}
    </>}
  </div>;
}
