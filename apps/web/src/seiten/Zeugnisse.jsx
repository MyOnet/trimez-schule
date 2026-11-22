// Zeugnisse und Promotion: Semesterzeugnis als PDF aus den Zeugnisnoten; Promotionsrechnung nach Reglement,
// Entscheid durch die Schulleitung (Abweichung nur mit Begründung, § 13 Klassenkonvent)
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { useLaden, Laden, Dialog, Feld, Symbol, useMeldung, Note, datumCH } from "../ui.jsx";
import { fmtNote } from "@schule/shared";

const ERG = { promoviert: "promoviert", provisorisch: "provisorisch promoviert", nicht_promoviert: "nicht promoviert" };
const ERG_KL = { promoviert: "chip", provisorisch: "warn-chip", nicht_promoviert: "warn-chip" };

export default function Zeugnisse() {
  const z = useLaden("/api/zeugnisse/klassen");
  const [such, setSuch] = useSearchParams();
  return <Laden zustand={z}>{(liste) => {
    const kid = such.get("klasse") || (liste[0] && liste[0].id);
    return <div>
      <div className="kopf"><div><h1>Zeugnisse und Promotion</h1><p className="leise" style={{ marginTop: 6 }}>Aus den Zeugnisnoten im Notenbuch. RESCOOL rechnet nach dem Promotionsreglement und schlägt vor; entscheiden tut die Schule.</p></div>
        {liste.length > 1 && <label className="feld">Klasse<select value={kid} onChange={(e) => setSuch({ klasse: e.target.value })}>{liste.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</select></label>}</div>
      {!liste.length ? <div className="leer"><b>Keine Klasse</b><span>Zeugnisse sehen Klassenlehrpersonen und die Schulleitung.</span></div> : <Klasse key={kid} kid={kid} semester={such.get("semester")} setSemester={(s) => setSuch({ klasse: kid, semester: s })} />}
    </div>;
  }}</Laden>;
}

function Klasse({ kid, semester, setSemester }) {
  const z = useLaden(`/api/klassen/${kid}/zeugnisse${semester ? `?semester=${semester}` : ""}`, [semester]);
  const zeige = useMeldung();
  const [wer, setWer] = useState(null);
  return <Laden zustand={z}>{(d) => {
    const fertig = d.zeilen.filter((x) => x.entscheid).length;
    const faecher = d.faecher;
    return <>
      <div className="reihe" style={{ gap: 8, flexWrap: "wrap", marginBottom: 12, justifyContent: "space-between" }}>
        <div className="segment" role="group" aria-label="Semester">{d.semesterListe.map((s) => <button key={s.id} aria-pressed={s.id === d.semester.id} onClick={() => setSemester(s.id)}>{s.nr}. Semester</button>)}</div>
        <div className="reihe" style={{ gap: 8 }}>
          <a className="knopf" href={`/api/klassen/${kid}/zeugnisse.pdf?semester=${d.semester.id}&ansicht=1`} target="_blank" rel="noopener"><Symbol.drucken />Alle Zeugnisse (PDF)</a>
          {d.darfEntscheiden && <button className="knopf haupt-knopf" disabled={!fertig} onClick={async () => { try { const r = await api(`/api/klassen/${kid}/zeugnisse/bereit`, { methode: "POST", daten: { semester_id: d.semester.id } }); zeige(`${r.empfaenger} benachrichtigt${r.offen ? `, ${r.offen} noch ohne Entscheid` : ""}`); } catch (e) { zeige(e.message, true); } }}>Zeugnisse freigeben ({fertig}/{d.zeilen.length})</button>}
        </div></div>
      <p className="leise klein">Regeln: {d.regeln.doppelteKompensation ? "doppelte Kompensation der Abweichungen unter 4" : ""}{d.regeln.maxUngenuegend != null ? `, höchstens ${d.regeln.maxUngenuegend} Noten unter 4` : ""}{d.regeln.mindestschnitt ? `, Schnitt mindestens ${d.regeln.mindestschnitt}` : ""}. Nur promotionsrelevante Fächer zählen.</p>
      <div className="tabelle-huelle"><table><thead><tr><th>Name</th>{faecher.map((f) => <th key={f.id} title={f.name} style={{ opacity: f.promotionsrelevant ? 1 : 0.6 }}>{f.kuerzel}</th>)}<th>Schnitt</th><th>unter 4</th><th>Vorschlag</th><th>Entscheid</th><th></th></tr></thead><tbody>
        {d.zeilen.map((s) => <tr key={s.id}>
          <td><b>{s.nachname}</b> {s.vorname}</td>
          {faecher.map((f) => { const n = s.noten.find((x) => x.fach_id === f.id); return <td key={f.id}>{n ? <span style={{ opacity: n.freigegeben ? 1 : 0.5 }} title={n.freigegeben ? "" : "noch nicht freigegeben"}><Note wert={n.note} /></span> : ""}</td>; })}
          <td>{s.promotion.schnitt != null ? fmtNote(s.promotion.schnitt) : "–"}</td><td>{s.promotion.ungenuegend || ""}</td>
          <td>{s.vorschlag ? <span className={ERG_KL[s.vorschlag]} title={s.promotion.gruende.join(" ")}>{ERG[s.vorschlag]}</span> : <span className="leise klein" title={s.promotion.fehlend.join(", ")}>Noten fehlen</span>}</td>
          <td>{s.entscheid ? <span className={ERG_KL[s.entscheid.ergebnis]} title={s.entscheid.bemerkung || ""}>{ERG[s.entscheid.ergebnis]}{s.entscheid.abweichung ? " *" : ""}</span> : "–"}</td>
          <td style={{ whiteSpace: "nowrap" }}><a className="knopf leise-knopf klein" href={`/api/klassen/${kid}/zeugnisse.pdf?semester=${d.semester.id}&schueler=${s.id}&ansicht=1`} target="_blank" rel="noopener">PDF</a>
            {d.darfEntscheiden && <button className="knopf leise-knopf klein" onClick={() => setWer(s)}>Entscheiden</button>}</td>
        </tr>)}
      </tbody></table></div>
      <p className="leise klein" style={{ marginTop: 6 }}>* weicht von der Berechnung ab (mit Begründung). Blasse Noten sind im Notenbuch noch nicht freigegeben.</p>
      <Entscheid s={wer} d={d} kid={kid} onZu={() => setWer(null)} onFertig={() => { setWer(null); z.neu(); }} />
    </>;
  }}</Laden>;
}

function Entscheid({ s, d, kid, onZu, onFertig }) {
  const [erg, setErg] = useState("");
  const [bem, setBem] = useState("");
  const [fehler, setFehler] = useState(null);
  if (!s) return null;
  const e = erg || (s.entscheid && s.entscheid.ergebnis) || s.vorschlag || "promoviert";
  const los = async () => { try { await api(`/api/klassen/${kid}/promotion`, { methode: "POST", daten: { schueler_id: s.id, semester_id: d.semester.id, ergebnis: e, bemerkung: bem || (s.entscheid && s.entscheid.bemerkung) || "" } }); setErg(""); setBem(""); setFehler(null); onFertig(); } catch (x) { setFehler(x.message); } };
  return <Dialog offen={!!s} titel={`Promotion: ${s.vorname} ${s.nachname}`} onZu={() => { setErg(""); setBem(""); setFehler(null); onZu(); }} fuss={<><button className="knopf" onClick={onZu}>Abbrechen</button><button className="knopf haupt-knopf" onClick={los}>Entscheid speichern</button></>}>
    <div className="stapel" style={{ gap: 12, maxWidth: 520 }}>
      <div className="hinweis stapel" style={{ gap: 4 }}>
        <span>Summe der Abweichungen unter 4: <b>{fmtNote(s.promotion.minus)}</b> (doppelt {fmtNote(s.promotion.minus * 2)}), über 4: <b>{fmtNote(s.promotion.plus)}</b>. Noten unter 4: <b>{s.promotion.ungenuegend}</b>.</span>
        {s.promotion.gruende.map((g, i) => <span key={i}>{g}</span>)}
        {s.promotion.fehlend.length > 0 && <span>Es fehlen: {s.promotion.fehlend.join(", ")}</span>}
        <span>Vorschlag: <b>{s.vorschlag ? ERG[s.vorschlag] : "keiner (Noten fehlen)"}</b></span>
      </div>
      <div className="segment" role="group" aria-label="Ergebnis">{Object.entries(ERG).map(([k, t]) => <button key={k} type="button" aria-pressed={e === k} onClick={() => setErg(k)}>{t}</button>)}</div>
      <label className="feld">Begründung {s.vorschlag && e !== s.vorschlag ? "(nötig, weicht vom Vorschlag ab)" : "(freiwillig)"}<textarea rows={3} value={bem} onChange={(x) => setBem(x.target.value)} placeholder={s.entscheid && s.entscheid.bemerkung ? s.entscheid.bemerkung : "z. B. Entscheid des Klassenkonvents vom …"} /></label>
      {fehler && <div className="hinweis fehler" role="alert">{fehler}</div>}
    </div>
  </Dialog>;
}

/** Für Schüler/innen und Eltern: freigegebene Zeugnisse (Liste mit PDF) */
export function MeineZeugnisse({ person }) {
  const z = useLaden(`/api/meine-zeugnisse${person ? `?person=${person}` : ""}`, [person]);
  return <Laden zustand={z}>{(l) => !l.length ? null : <section className="karte" style={{ marginTop: 16 }}><h2 style={{ fontSize: "1.1rem", marginBottom: 8 }}>Zeugnisse</h2>
    <ul style={{ margin: 0, paddingLeft: 18 }}>{l.map((x) => <li key={x.semester_id}><a href={`/api/mein-zeugnis.pdf?semester=${x.semester_id}${person ? `&person=${person}` : ""}&ansicht=1`} target="_blank" rel="noopener">{x.schuljahr}, {x.nr}. Semester</a> · {ERG[x.ergebnis]}</li>)}</ul></section>}</Laden>;
}
