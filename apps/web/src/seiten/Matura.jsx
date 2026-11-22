// Maturaarbeit: Zuteilung, Meilensteine, Arbeitsjournal, Dateien, Abgabe und Bewertung nach Kriterien
import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { api, hochladen } from "../api.js";
import { useLaden, Laden, Dialog, Feld, Symbol, useMeldung, DateiListe, DateiKnopf, Absaetze, Note, datumCH, zeitCH, wann } from "../ui.jsx";
import { fmtNote, kriterienNote } from "@schule/shared";

const STAND_KL = { thema: "chip", in_arbeit: "chip", abgegeben: "neu-chip", bewertet: "chip" };

export default function Matura() {
  const z = useLaden("/api/matura");
  const { kurz } = useParams();
  const nav = useNavigate();
  const [neu, setNeu] = useState(false);
  return <Laden zustand={z}>{(d) => {
    if (d.liste.length === 1 && !d.darfZuteilen) return <Navigate to={`/s/${kurz}/matura/${d.liste[0].id}`} replace />;
    return <div>
      <div className="kopf"><div><h1>Maturaarbeiten</h1><p className="leise" style={{ marginTop: 6 }}>Meilensteine, Arbeitsjournal und Bewertung an einem Ort.</p></div>
        {d.darfZuteilen && <button className="knopf haupt-knopf" onClick={() => setNeu(true)}><Symbol.plus />Betreuung erfassen</button>}</div>
      {!d.liste.length ? <div className="leer"><b>Keine Maturaarbeiten</b><span>{d.darfZuteilen ? "Erfassen Sie eine Betreuung: Schülerin oder Schüler, Arbeitstitel, Abgabetermin." : "Sobald Ihre Betreuung erfasst ist, erscheint Ihre Arbeit hier."}</span></div> :
        <div className="tabelle-huelle"><table><thead><tr><th>Schüler/in</th><th>Klasse</th><th>Titel</th><th>Betreuung</th><th>Meilensteine</th><th>Journal</th><th>Abgabe</th><th>Stand</th></tr></thead><tbody>
          {d.liste.map((m) => <tr key={m.id} onClick={() => nav(`/s/${kurz}/matura/${m.id}`)} style={{ cursor: "pointer" }}>
            <td><Link to={`/s/${kurz}/matura/${m.id}`}><b>{m.schueler}</b></Link></td><td>{m.klasse || ""}</td><td>{m.titel}</td><td>{m.betreuer}</td>
            <td>{m.bestaetigt}/{m.meilensteine}{m.zu_bestaetigen ? <span className="neu-chip" style={{ marginLeft: 6 }}>{m.zu_bestaetigen} bestätigen</span> : ""}</td>
            <td className="leise">{m.letzter_eintrag ? wann(m.letzter_eintrag) : "–"}</td><td>{m.abgabe_bis ? datumCH(m.abgabe_bis) : "–"}</td>
            <td><span className={STAND_KL[m.status]}>{d.status[m.status]}</span>{m.note != null && <> <Note wert={m.note} /></>}</td></tr>)}
        </tbody></table></div>}
      <Zuteilen offen={neu} onZu={() => setNeu(false)} />
    </div>;
  }}</Laden>;
}

function PersonSuche({ rolle, label, wert, setWert }) {
  const [such, setSuch] = useState("");
  const z = useLaden(`/api/matura-personen?rolle=${rolle}&q=${encodeURIComponent(such)}`, [such]);
  return <div className="stapel" style={{ gap: 4 }}>
    <Feld label={label} value={wert ? `${wert.vorname} ${wert.nachname}${wert.klasse ? ` (${wert.klasse})` : ""}` : such} onChange={(e) => { setWert(null); setSuch(e.target.value); }} placeholder="Name eingeben" />
    {!wert && such.length > 0 && z.daten && <div className="reihe" style={{ gap: 6, flexWrap: "wrap" }}>{z.daten.slice(0, 8).map((p) => <button key={p.id} type="button" className="knopf leise-knopf klein" onClick={() => setWert(p)}>{p.vorname} {p.nachname}{p.klasse ? ` (${p.klasse})` : ""}</button>)}</div>}
  </div>;
}

function Zuteilen({ offen, onZu }) {
  const z = useLaden(offen ? "/api/rechte" : null, [offen]);
  const nav = useNavigate();
  const { kurz } = useParams();
  const [s, setS] = useState(null), [b, setB] = useState(null);
  const [f, setF] = useState({ titel: "", abgabe_bis: "" });
  const [fehler, setFehler] = useState(null);
  const leitung = z.daten && z.daten["matura.verwalten"];
  const los = async () => { try { const a = await api("/api/matura", { methode: "POST", daten: { schueler_id: s && s.id, betreuer_id: b && b.id, ...f, abgabe_bis: f.abgabe_bis || null } }); onZu(); nav(`/s/${kurz}/matura/${a.id}`); } catch (e) { setFehler(e.message); } };
  return <Dialog offen={offen} titel="Betreuung erfassen" onZu={onZu} fuss={<><button className="knopf" onClick={onZu}>Abbrechen</button><button className="knopf haupt-knopf" onClick={los}>Erfassen</button></>}>
    <div className="stapel" style={{ gap: 12, minWidth: "min(460px, 80vw)" }}>
      <PersonSuche rolle="schueler" label="Schülerin oder Schüler" wert={s} setWert={setS} />
      {leitung ? <PersonSuche rolle="lehrperson" label="Betreuungsperson" wert={b} setWert={setB} /> : <p className="leise klein">Sie werden als Betreuungsperson eingetragen.</p>}
      <Feld label="Arbeitstitel" value={f.titel} onChange={(e) => setF({ ...f, titel: e.target.value })} />
      <Feld label="Abgabe bis" type="date" value={f.abgabe_bis} onChange={(e) => setF({ ...f, abgabe_bis: e.target.value })} />
      <p className="leise klein">Die üblichen Meilensteine werden angelegt (Thema, Disposition, Zwischenbericht, Rohfassung, Abgabe, Präsentation). Sie können sie danach anpassen.</p>
      {fehler && <div className="hinweis fehler" role="alert">{fehler}</div>}
    </div>
  </Dialog>;
}

export function MaturaDetail() {
  const { id, kurz } = useParams();
  const z = useLaden(`/api/matura/${id}`);
  const zeige = useMeldung();
  const tun = async (fn, text) => { try { await fn(); if (text) zeige(text); z.neu(); } catch (e) { zeige(e.message, true); } };
  return <Laden zustand={z}>{(d) => { const a = d.arbeit; const sch = d.rolle === "schueler"; return <div>
    <div className="kopf"><div><p className="leise klein"><Link to={`/s/${kurz}/matura`}>Maturaarbeiten</Link></p><h1>{a.titel}</h1>
      <p className="leise" style={{ marginTop: 6 }}>{a.s_vorname} {a.s_nachname} · Betreuung {a.b_vorname} {a.b_nachname}{a.k_vorname ? ` · Korreferat ${a.k_vorname} ${a.k_nachname}` : ""}{a.fach ? ` · ${a.fach}` : ""}</p></div>
      <div className="reihe" style={{ gap: 8, flexWrap: "wrap" }}><span className={STAND_KL[a.status]}>{d.status[a.status]}</span>
        {d.darf.betreuen && a.status === "thema" && <button className="knopf haupt-knopf" onClick={() => tun(() => api(`/api/matura/${a.id}`, { methode: "PUT", daten: { status: "in_arbeit" } }), "Thema genehmigt")}>Thema genehmigen</button>}
        {sch && a.status === "in_arbeit" && <button className="knopf haupt-knopf" onClick={() => confirm("Arbeit jetzt definitiv abgeben? Danach lassen sich die Dateien nicht mehr ändern.") && tun(() => api(`/api/matura/${a.id}/abgeben`, { methode: "POST" }), "Abgegeben")}>Arbeit abgeben</button>}
      </div></div>
    <div className="zwei" style={{ alignItems: "start" }}>
      <div className="stapel" style={{ gap: 16 }}>
        <Eckdaten d={d} tun={tun} />
        <Meilensteine d={d} tun={tun} />
        {d.rolle !== "eltern" && <section className="karte stapel" style={{ gap: 8 }}><h2 style={{ fontSize: "1.1rem" }}>Dateien</h2>
          <DateiListe dateien={d.dateien} pfad="/api/matura-dateien/" loeschen={(sch && ["thema", "in_arbeit"].includes(a.status)) || d.darf.betreuen ? (f) => tun(() => api(`/api/matura-dateien/${f.id}`, { methode: "DELETE" })) : null} />
          {((sch && ["thema", "in_arbeit"].includes(a.status)) || d.darf.betreuen) && <div><DateiKnopf mehrere onDatei={(f) => tun(() => hochladen(`/api/matura/${a.id}/dateien`, f))} /></div>}
          {sch && <p className="leise klein">Laden Sie zum Abgeben die fertige Arbeit als PDF hoch.</p>}</section>}
      </div>
      <div className="stapel" style={{ gap: 16 }}>
        {(d.darf.bewerten || a.bewertung) && <Bewertung d={d} tun={tun} />}
        {d.rolle !== "eltern" && <Journal d={d} tun={tun} />}
      </div>
    </div>
  </div>; }}</Laden>;
}

function Eckdaten({ d, tun }) {
  const a = d.arbeit;
  const sch = d.rolle === "schueler";
  const [f, setF] = useState(null);
  const darf = (sch && ["thema", "in_arbeit"].includes(a.status)) || d.darf.betreuen;
  return <section className="karte stapel" style={{ gap: 8 }}>
    <div className="reihe" style={{ justifyContent: "space-between" }}><h2 style={{ fontSize: "1.1rem" }}>Fragestellung</h2>{darf && !f && <button className="knopf leise-knopf klein" onClick={() => setF({ titel: a.titel, fragestellung: a.fragestellung || "", abgabe_bis: a.abgabe_bis || "", praesentation_am: a.praesentation_am ? a.praesentation_am.slice(0, 16) : "" })}>Bearbeiten</button>}</div>
    {f ? <div className="stapel" style={{ gap: 8 }}>
      <Feld label="Titel" value={f.titel} onChange={(e) => setF({ ...f, titel: e.target.value })} />
      <label className="feld">Fragestellung<textarea rows={4} value={f.fragestellung} onChange={(e) => setF({ ...f, fragestellung: e.target.value })} /></label>
      {d.darf.betreuen && <div className="zwei"><Feld label="Abgabe bis" type="date" value={f.abgabe_bis} onChange={(e) => setF({ ...f, abgabe_bis: e.target.value })} /><Feld label="Präsentation" type="datetime-local" value={f.praesentation_am} onChange={(e) => setF({ ...f, praesentation_am: e.target.value })} /></div>}
      <div className="reihe" style={{ gap: 8 }}><button className="knopf" onClick={() => setF(null)}>Abbrechen</button><button className="knopf haupt-knopf" onClick={() => tun(async () => { await api(`/api/matura/${a.id}`, { methode: "PUT", daten: sch ? { titel: f.titel, fragestellung: f.fragestellung } : { ...f, abgabe_bis: f.abgabe_bis || null, praesentation_am: f.praesentation_am ? new Date(f.praesentation_am).toISOString() : null } }); setF(null); }, "Gespeichert")}>Speichern</button></div>
    </div> : <>{a.fragestellung ? <Absaetze text={a.fragestellung} /> : <p className="leise">Noch keine Fragestellung.</p>}
      <p className="leise klein">{a.abgabe_bis ? `Abgabe bis ${datumCH(a.abgabe_bis)}` : "Abgabetermin offen"}{a.abgegeben_am ? ` · abgegeben ${zeitCH(a.abgegeben_am)}` : ""}{a.praesentation_am ? ` · Präsentation ${zeitCH(a.praesentation_am)}` : ""}{d.stunden ? ` · ${fmtNote(d.stunden)} Stunden im Journal` : ""}</p></>}
  </section>;
}

function Meilensteine({ d, tun }) {
  const sch = d.rolle === "schueler";
  return <section className="karte stapel" style={{ gap: 8 }}>
    <div className="reihe" style={{ justifyContent: "space-between" }}><h2 style={{ fontSize: "1.1rem" }}>Meilensteine</h2>
      {d.darf.betreuen && <button className="knopf leise-knopf klein" onClick={() => { const t = prompt("Neuer Meilenstein"); if (t) tun(() => api(`/api/matura/${d.arbeit.id}/meilensteine`, { methode: "POST", daten: { titel: t } })); }}><Symbol.plus />Meilenstein</button>}</div>
    <ol style={{ margin: 0, paddingLeft: 0, listStyle: "none" }} className="stapel">{d.meilensteine.map((m) => { const ueber = m.faellig && !m.erledigt_am && m.faellig < new Date().toISOString().slice(0, 10);
      return <li key={m.id} className="reihe" style={{ gap: 10, alignItems: "flex-start", padding: "6px 0", borderBottom: "1px solid var(--linie, #eee)" }}>
        <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: 11, flex: "0 0 22px", display: "grid", placeItems: "center", fontSize: 13, background: m.bestaetigt_am ? "#15803D" : m.erledigt_am ? "#FDE68A" : "transparent", color: m.bestaetigt_am ? "#fff" : "inherit", border: "2px solid " + (m.bestaetigt_am ? "#15803D" : "#9CA3AF") }}>{m.bestaetigt_am ? "✓" : ""}</span>
        <span style={{ flex: 1 }}><b>{m.titel}</b><span className="leise klein" style={{ display: "block", color: ueber ? "#B91C1C" : undefined }}>{m.faellig ? `bis ${datumCH(m.faellig)}` : ""}{m.erledigt_am ? ` · erledigt ${datumCH(m.erledigt_am)}` : ""}{m.bestaetigt_am ? ` · bestätigt von ${m.bestaetigt_von_name}` : m.erledigt_am ? " · wartet auf Bestätigung" : ""}</span></span>
        {sch && !m.bestaetigt_am && <button className="knopf leise-knopf klein" onClick={() => tun(() => api(`/api/ma-meilensteine/${m.id}`, { methode: "PUT", daten: { erledigt: !m.erledigt_am } }))}>{m.erledigt_am ? "Doch nicht" : "Erledigt"}</button>}
        {d.darf.betreuen && <><button className="knopf leise-knopf klein" onClick={() => tun(() => api(`/api/ma-meilensteine/${m.id}`, { methode: "PUT", daten: { bestaetigt: !m.bestaetigt_am } }))}>{m.bestaetigt_am ? "Aufheben" : "Bestätigen"}</button>
          <input type="date" aria-label={`Termin für ${m.titel}`} value={m.faellig || ""} onChange={(e) => tun(() => api(`/api/ma-meilensteine/${m.id}`, { methode: "PUT", daten: { faellig: e.target.value || null } }))} style={{ width: 140 }} /></>}
      </li>; })}</ol>
  </section>;
}

function Journal({ d, tun }) {
  const sch = d.rolle === "schueler";
  const [f, setF] = useState({ text: "", stunden: "", datum: new Date().toISOString().slice(0, 10) });
  return <section className="karte stapel" style={{ gap: 8 }}>
    <h2 style={{ fontSize: "1.1rem" }}>{sch ? "Mein Arbeitsjournal" : "Arbeitsjournal und Besprechungen"}</h2>
    {d.darf.schreiben && <form className="stapel" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); tun(async () => { await api(`/api/matura/${d.arbeit.id}/journal`, { methode: "POST", daten: { ...f, stunden: f.stunden === "" ? null : Number(f.stunden) } }); setF({ ...f, text: "", stunden: "" }); }); }}>
      <textarea rows={3} aria-label={sch ? "Was haben Sie gemacht?" : "Notiz zur Besprechung"} placeholder={sch ? "Was haben Sie gemacht? Was ist der nächste Schritt?" : "Notiz zur Besprechung (die Schülerin, der Schüler sieht sie)"} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} />
      <div className="reihe" style={{ gap: 8 }}><input type="date" aria-label="Datum" value={f.datum} onChange={(e) => setF({ ...f, datum: e.target.value })} />{sch && <input type="number" min="0.1" max="24" step="0.25" aria-label="Stunden" placeholder="Stunden" value={f.stunden} onChange={(e) => setF({ ...f, stunden: e.target.value })} style={{ width: 100 }} />}
        <button className="knopf haupt-knopf" disabled={!f.text.trim()}>{sch ? "Eintragen" : "Notiz speichern"}</button></div>
    </form>}
    {!d.journal.length ? <p className="leise">Noch keine Einträge.</p> : d.journal.map((j) => <div key={j.id} style={{ borderLeft: `3px solid ${j.art === "besprechung" ? "#2C3FC4" : "#D1D5DB"}`, paddingLeft: 10 }}>
      <div className="leise klein">{datumCH(j.datum)} · {j.art === "besprechung" ? `Besprechung (${j.autor})` : j.autor}{j.stunden ? ` · ${fmtNote(j.stunden)} h` : ""}</div><Absaetze text={j.text} /></div>)}
  </section>;
}

function Bewertung({ d, tun }) {
  const a = d.arbeit;
  const [k, setK] = useState(a.bewertung ? a.bewertung.kriterien : []);
  const [grund, setGrund] = useState("");
  useEffect(() => { setK(a.bewertung ? a.bewertung.kriterien : []); }, [a.bewertung]);
  if (!d.darf.bewerten) return a.status === "bewertet" ? <section className="karte stapel" style={{ gap: 8 }}><h2 style={{ fontSize: "1.1rem" }}>Bewertung</h2>
    {a.bewertung.kriterien.map((x) => <div key={x.id}><div className="reihe" style={{ justifyContent: "space-between" }}><b>{x.name} ({x.gewicht} %)</b><Note wert={x.note} /></div>{x.kommentar && <Absaetze text={x.kommentar} />}</div>)}
    <div className="reihe" style={{ justifyContent: "space-between" }}><b>Note</b><Note wert={a.note} gross /></div></section> : null;
  const note = kriterienNote(k);
  const speichern = (abschliessen) => tun(() => api(`/api/matura/${a.id}/bewertung`, { methode: "PUT", daten: { kriterien: k.map((x) => ({ ...x, note: x.note === "" || x.note == null ? null : Number(x.note), gewicht: Number(x.gewicht) })), abschliessen, grund: grund || undefined } }), abschliessen ? "Bewertung abgeschlossen, die Schülerin oder der Schüler ist benachrichtigt" : "Zwischenstand gespeichert");
  return <section className="karte stapel" style={{ gap: 8 }}>
    <h2 style={{ fontSize: "1.1rem" }}>Bewertung</h2>
    <p className="leise klein">Gewichtete Note aus den Kriterien, auf halbe Noten gerundet. Sichtbar für die Schülerin, den Schüler erst nach dem Abschliessen.</p>
    {k.map((x, i) => <div key={x.id} className="stapel" style={{ gap: 4 }}>
      <div className="reihe" style={{ gap: 8, alignItems: "flex-end" }}>
        <Feld label="Kriterium" value={x.name} onChange={(e) => setK(k.map((y, j) => j === i ? { ...y, name: e.target.value } : y))} />
        <Feld label="Gewicht %" type="number" min="1" max="100" style={{ width: 80 }} value={x.gewicht} onChange={(e) => setK(k.map((y, j) => j === i ? { ...y, gewicht: e.target.value } : y))} />
        <Feld label="Note" type="number" min="1" max="6" step="0.25" style={{ width: 80 }} value={x.note ?? ""} onChange={(e) => setK(k.map((y, j) => j === i ? { ...y, note: e.target.value } : y))} />
      </div>
      <textarea rows={2} aria-label={`Kommentar ${x.name}`} placeholder="Kommentar" value={x.kommentar || ""} onChange={(e) => setK(k.map((y, j) => j === i ? { ...y, kommentar: e.target.value } : y))} />
    </div>)}
    <button className="knopf leise-knopf klein" style={{ alignSelf: "flex-start" }} onClick={() => setK([...k, { id: `k${k.length + 1}`, name: "", gewicht: 10, note: null, kommentar: "" }])}><Symbol.plus />Kriterium</button>
    <div className="reihe" style={{ justifyContent: "space-between" }}><b>Note</b>{note != null ? <Note wert={note} gross /> : <span className="leise">–</span>}</div>
    {a.status === "bewertet" && <Feld label="Grund für die Änderung (abgeschlossen)" value={grund} onChange={(e) => setGrund(e.target.value)} />}
    <div className="reihe" style={{ gap: 8 }}><button className="knopf" onClick={() => speichern(false)}>Zwischenstand speichern</button>{["abgegeben", "bewertet"].includes(a.status) && <button className="knopf haupt-knopf" onClick={() => speichern(true)}>Abschliessen</button>}</div>
  </section>;
}
