// Kalender: persönlicher Stundenplan mit Änderungen, Termine, Prüfungen (mit Prüfungslimit), Abgaben; Abo als iCal.
// Administration: Untis-Import und Lektionszeiten.
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, hochladen } from "../api.js";
import { useLaden, Laden, Dialog, Feld, Symbol, useMeldung, useKurse, kursName, DateiKnopf } from "../ui.jsx";
import { wochenbeginn, plusTage, kalenderwoche } from "@schule/shared";
import { useIch } from "../App.jsx";

const TAGE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const ART = { pruefung: "Prüfung", anlass: "Anlass", ferien: "Ferien", sonstig: "Termin" };
const heute = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Zurich" });
const uhr = (iso) => new Date(iso).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Zurich" });
const tagIso = (iso) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Europe/Zurich" });

export default function Kalender({ person }) {
  const ich = useIch();
  const [such, setSuchRoh] = useSearchParams();
  const setSuch = (x) => setSuchRoh((p) => { const n = new URLSearchParams(p); if (x.woche) n.set("woche", x.woche); else n.delete("woche"); return n; });
  // Am Sonntag zeigt der Kalender schon die kommende Woche
  const wb = such.get("woche") || wochenbeginn(new Date(heute() + "T12:00").getDay() === 0 ? plusTage(heute(), 1) : heute());
  const pfad = `/api/kalender?von=${wb}&bis=${plusTage(wb, 6)}${person ? `&person=${person}` : ""}`;
  const z = useLaden(pfad, [pfad]);
  const [dlg, setDlg] = useState(null);
  const [lekt, setLekt] = useState(null);
  const lp = ich.unterrichtet;
  return <div>
    <div className="kopf"><div>{!person && <h1>Kalender</h1>}<p className="leise" style={{ marginTop: 6 }}>Woche {kalenderwoche(wb)} · {new Date(wb + "T12:00").toLocaleDateString("de-CH", { day: "numeric", month: "long" })} bis {new Date(plusTage(wb, 5) + "T12:00").toLocaleDateString("de-CH", { day: "numeric", month: "long", year: "numeric" })}</p></div>
      <div className="reihe" style={{ gap: 8, flexWrap: "wrap" }}>
        <div className="segment" role="group" aria-label="Woche"><button onClick={() => setSuch({ woche: plusTage(wb, -7) })} aria-label="Vorherige Woche">‹</button><button onClick={() => setSuch({})}>Heute</button><button onClick={() => setSuch({ woche: plusTage(wb, 7) })} aria-label="Nächste Woche">›</button></div>
        {!person && lp && <button className="knopf" onClick={() => setDlg("pruefung")}><Symbol.pruefung />Prüfung ankündigen</button>}
        {!person && z.daten && (z.daten.darf.schule || ich.rechte.klassenlehrperson) && <button className="knopf" onClick={() => setDlg("termin")}><Symbol.plus />Termin</button>}
        {!person && <button className="knopf leise-knopf" onClick={() => setDlg("abo")}><Symbol.link />Abonnieren</button>}
      </div></div>
    <Laden zustand={z}>{(d) => <Woche d={d} wb={wb} onLektion={!person && (lp || d.darf.aendern) ? setLekt : null} neu={z.neu} />}</Laden>
    {z.daten && z.daten.darf.stundenplan && !person && <StundenplanVerwaltung onFertig={z.neu} />}
    <PruefungDialog offen={dlg === "pruefung"} onZu={() => setDlg(null)} onFertig={z.neu} />
    <TerminDialog offen={dlg === "termin"} onZu={() => setDlg(null)} onFertig={z.neu} darfSchule={z.daten && z.daten.darf.schule} />
    <AboDialog offen={dlg === "abo"} onZu={() => setDlg(null)} aktiv={z.daten && z.daten.abo} onFertig={z.neu} />
    <AenderungDialog l={lekt} onZu={() => setLekt(null)} onFertig={z.neu} darfAlles={z.daten && z.daten.darf.aendern} />
  </div>;
}

function Woche({ d, wb, onLektion, neu }) {
  const zeige = useMeldung();
  const tage = TAGE.map((t, i) => ({ t, datum: plusTage(wb, i) }));
  const mitSa = d.eintraege.some((e) => e.datum === tage[5].datum || (e.von && tagIso(e.von) === tage[5].datum));
  const sicht = mitSa ? tage : tage.slice(0, 5);
  const lekt = d.eintraege.filter((e) => e.typ === "lektion");
  const nummern = [...new Set(lekt.map((e) => e.lektion))].sort((a, b) => a - b);
  const bisN = nummern.length ? Math.max(...nummern) : 0;
  const zeilen = d.lektionen.filter((l) => l.nr <= Math.max(bisN, 1));
  const tagesTermine = (datum) => d.eintraege.filter((e) => e.typ !== "lektion" && tagIso(e.von) <= datum && tagIso(e.bis || e.von) >= datum);
  const h = heute();
  return <div className="tabelle-huelle" style={{ marginBottom: 24 }}>
    <table className="kalender" style={{ tableLayout: "fixed", minWidth: 640 }}>
      <thead><tr><th style={{ width: 64 }}></th>{sicht.map((x) => <th key={x.datum} style={{ background: x.datum === h ? "var(--gelb-hell, #FFF7CC)" : undefined }}>{x.t} {new Date(x.datum + "T12:00").getDate()}.{new Date(x.datum + "T12:00").getMonth() + 1}.</th>)}</tr></thead>
      <tbody>
        <tr><td className="leise klein">Termine</td>{sicht.map((x) => <td key={x.datum} style={{ verticalAlign: "top" }}>{tagesTermine(x.datum).map((e) => <div key={e.typ + e.id + x.datum} className="klein" style={{ borderLeft: `3px solid ${e.farbe || (e.art === "ferien" ? "#15803D" : "#2C3FC4")}`, paddingLeft: 6, marginBottom: 4 }}>
          <b>{e.typ === "auftrag" ? "Abgabe" : ART[e.art]}</b>{!e.ganztag && e.typ !== "auftrag" ? ` ${uhr(e.von)}` : e.typ === "auftrag" ? ` ${uhr(e.von)}` : ""}<br />{e.fach ? `${e.fach}: ` : ""}{e.titel}
          {e.eigen && <button className="knopf leise-knopf klein" aria-label="Termin löschen" onClick={async () => { if (!confirm(`«${e.titel}» löschen?`)) return; try { await api(`/api/termine/${e.id}`, { methode: "DELETE" }); neu(); } catch (x) { zeige(x.message, true); } }}>×</button>}
        </div>)}</td>)}</tr>
        {zeilen.map((l) => <tr key={l.nr}><td className="leise klein">{l.nr}.<br />{l.von}</td>{sicht.map((x) => <td key={x.datum} style={{ verticalAlign: "top", padding: 2 }}>
          {lekt.filter((e) => e.datum === x.datum && e.lektion === l.nr).map((e, i) => { const aus = e.aenderung && e.aenderung.art === "ausfall";
            return <button key={i} onClick={onLektion ? () => onLektion(e) : undefined} disabled={!onLektion} className="klein" style={{ all: "unset", display: "block", width: "100%", boxSizing: "border-box", cursor: onLektion ? "pointer" : "default", padding: "4px 6px", borderRadius: 6, background: aus ? "repeating-linear-gradient(45deg,#f3f4f6,#f3f4f6 4px,#fff 4px,#fff 8px)" : `${e.farbe || "#2C3FC4"}1a`, borderLeft: `3px solid ${e.farbe || "#2C3FC4"}`, textDecoration: aus ? "line-through" : undefined }}>
              <b>{e.kuerzel || e.fach}</b> {e.klasse}{e.gruppe ? ` ${e.gruppe}` : ""}<br /><span className="leise">{e.raum || ""}{e.lp ? ` · ${e.lp}` : ""}</span>
              {e.aenderung && <span style={{ display: "block", color: "#B91C1C", textDecoration: "none" }}>{e.aenderung.label}{e.aenderung.text ? `: ${e.aenderung.text}` : ""}</span>}
            </button>; })}
        </td>)}</tr>)}
      </tbody>
    </table>
    {!lekt.length && <p className="leise" style={{ padding: 12 }}>Für diese Woche ist kein Stundenplan erfasst (oder es sind Ferien).</p>}
  </div>;
}

function PruefungDialog({ offen, onZu, onFertig }) {
  const kurse = useKurse();
  const ich = useIch();
  const zeige = useMeldung();
  const [f, setF] = useState({ unterricht_id: "", datum: "", titel: "", ausnahme_grund: "" });
  const [plan, setPlan] = useState(null);
  const [fehler, setFehler] = useState(null);
  useEffect(() => { if (offen) { setF({ unterricht_id: "", datum: "", titel: "", ausnahme_grund: "" }); setPlan(null); setFehler(null); } }, [offen]);
  useEffect(() => { if (f.unterricht_id && f.datum) api(`/api/pruefungsplan?unterricht=${f.unterricht_id}&datum=${f.datum}&von=${wochenbeginn(f.datum)}`).then((p) => setPlan({ ...p, pruefungen: p.pruefungen.filter((x) => wochenbeginn(x.datum) === wochenbeginn(f.datum)) })).catch(() => setPlan(null)); else setPlan(null); }, [f.unterricht_id, f.datum]);
  const los = async () => { try { await api("/api/termine", { methode: "POST", daten: { art: "pruefung", unterricht_id: f.unterricht_id, ganztag: true, datum: f.datum, titel: f.titel, ausnahme_grund: f.ausnahme_grund || undefined } }); zeige("Prüfung angekündigt, die Klasse ist informiert"); onZu(); onFertig(); } catch (e) { setFehler(e.message); } };
  return <Dialog offen={offen} titel="Prüfung ankündigen" onZu={onZu} fuss={<><button className="knopf" onClick={onZu}>Abbrechen</button><button className="knopf haupt-knopf" onClick={los} disabled={plan && plan.pruefen && !plan.pruefen.ok && !(ich.rechte["pruefungslimit.ausnahme"] && f.ausnahme_grund)}>Ankündigen</button></>}>
    <div className="stapel" style={{ gap: 12, minWidth: "min(460px, 80vw)" }}>
      <Laden zustand={kurse}>{(k) => <Feld label="Unterricht" type="select" value={f.unterricht_id} onChange={(e) => setF({ ...f, unterricht_id: e.target.value })}><option value="">Bitte wählen</option>{k.map((u) => <option key={u.id} value={u.id}>{kursName(u)}</option>)}</Feld>}</Laden>
      <Feld label="Datum" type="date" value={f.datum} onChange={(e) => setF({ ...f, datum: e.target.value })} />
      <Feld label="Thema" value={f.titel} onChange={(e) => setF({ ...f, titel: e.target.value })} placeholder="z. B. Trigonometrie" />
      {plan && <div className={plan.pruefen && !plan.pruefen.ok ? "hinweis fehler" : "hinweis"} style={{ display: "block" }}>
        <b>Klasse {plan.klasse}: {plan.pruefungen.length ? `${plan.pruefungen.length} Prüfung(en) in dieser Woche` : "noch keine Prüfung in dieser Woche"}</b> (erlaubt: {plan.limit.proWoche} pro Woche, {plan.limit.proTag} pro Tag)
        {plan.pruefungen.length > 0 && <ul style={{ margin: "6px 0 0" }}>{plan.pruefungen.map((p, i) => <li key={i}>{new Date(p.datum + "T12:00").toLocaleDateString("de-CH", { weekday: "short", day: "numeric", month: "numeric" })}: {p.fach} {p.titel}</li>)}</ul>}
        {plan.pruefen && !plan.pruefen.ok && <p style={{ margin: "6px 0 0" }}>{plan.pruefen.grund}</p>}
      </div>}
      {plan && plan.pruefen && !plan.pruefen.ok && ich.rechte["pruefungslimit.ausnahme"] && <Feld label="Ausnahme bewilligen: Begründung" value={f.ausnahme_grund} onChange={(e) => setF({ ...f, ausnahme_grund: e.target.value })} />}
      {fehler && <div className="hinweis fehler" role="alert">{fehler}</div>}
    </div>
  </Dialog>;
}

function TerminDialog({ offen, onZu, onFertig, darfSchule }) {
  const zeige = useMeldung();
  const kl = useLaden(offen ? "/api/absenzen/klassen" : null, [offen]);
  const [f, setF] = useState(null);
  const [fehler, setFehler] = useState(null);
  useEffect(() => { if (offen) { setF({ art: "anlass", fuer: darfSchule ? "schule" : "klasse", klasse_id: "", titel: "", beschreibung: "", ort: "", ganztag: true, datum: "", bis_datum: "", von: "", bis: "" }); setFehler(null); } }, [offen]);
  const los = async () => {
    try {
      const daten = { ...f, von: f.ganztag ? undefined : new Date(f.von).toISOString(), bis: f.ganztag || !f.bis ? undefined : new Date(f.bis).toISOString(), datum: f.ganztag ? f.datum : undefined, bis_datum: f.ganztag ? f.bis_datum || undefined : undefined, klasse_id: f.fuer === "klasse" ? f.klasse_id : undefined };
      await api("/api/termine", { methode: "POST", daten }); zeige("Termin eingetragen"); onZu(); onFertig();
    } catch (e) { setFehler(e.message); }
  };
  return <Dialog offen={offen} titel="Termin eintragen" onZu={onZu} fuss={<><button className="knopf" onClick={onZu}>Abbrechen</button><button className="knopf haupt-knopf" onClick={los}>Eintragen</button></>}>
    {f && <div className="stapel" style={{ gap: 12, minWidth: "min(480px, 80vw)" }}>
      <div className="zwei">
        <Feld label="Art" type="select" value={f.art} onChange={(e) => setF({ ...f, art: e.target.value, ganztag: e.target.value === "ferien" ? true : f.ganztag })}>{["anlass", "sonstig", ...(darfSchule ? ["ferien"] : [])].map((a) => <option key={a} value={a}>{ART[a]}</option>)}</Feld>
        <Feld label="Für" type="select" value={f.fuer} onChange={(e) => setF({ ...f, fuer: e.target.value })}>{darfSchule && <><option value="schule">ganze Schule</option><option value="lehrpersonen">nur Lehrpersonen</option></>}<option value="klasse">eine Klasse</option></Feld>
      </div>
      {f.fuer === "klasse" && <Laden zustand={kl}>{(d) => <Feld label="Klasse" type="select" value={f.klasse_id} onChange={(e) => setF({ ...f, klasse_id: e.target.value })}><option value="">Bitte wählen</option>{(d.klassen || d).map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</Feld>}</Laden>}
      <Feld label="Titel" value={f.titel} onChange={(e) => setF({ ...f, titel: e.target.value })} />
      {f.art !== "ferien" && <label className="check"><input type="checkbox" checked={f.ganztag} onChange={(e) => setF({ ...f, ganztag: e.target.checked })} />Ganztägig</label>}
      {f.ganztag ? <div className="zwei"><Feld label="Von" type="date" value={f.datum} onChange={(e) => setF({ ...f, datum: e.target.value })} /><Feld label="Bis (freiwillig)" type="date" value={f.bis_datum} onChange={(e) => setF({ ...f, bis_datum: e.target.value })} /></div>
        : <div className="zwei"><Feld label="Beginn" type="datetime-local" value={f.von} onChange={(e) => setF({ ...f, von: e.target.value })} /><Feld label="Ende" type="datetime-local" value={f.bis} onChange={(e) => setF({ ...f, bis: e.target.value })} /></div>}
      <Feld label="Ort (freiwillig)" value={f.ort} onChange={(e) => setF({ ...f, ort: e.target.value })} />
      <label className="feld">Beschreibung<textarea rows={3} value={f.beschreibung} onChange={(e) => setF({ ...f, beschreibung: e.target.value })} /></label>
      {fehler && <div className="hinweis fehler" role="alert">{fehler}</div>}
    </div>}
  </Dialog>;
}

function AboDialog({ offen, onZu, aktiv, onFertig }) {
  const [pfad, setPfad] = useState(null);
  const zeige = useMeldung();
  const url = pfad ? `${location.origin}${pfad}` : null;
  return <Dialog offen={offen} titel="Kalender abonnieren" onZu={() => { setPfad(null); onZu(); }} fuss={<button className="knopf" onClick={() => { setPfad(null); onZu(); }}>Fertig</button>}>
    <div className="stapel" style={{ gap: 12, maxWidth: 520 }}>
      <p>Mit dem Abo erscheinen Stundenplan, Prüfungen und Termine in Ihrer Kalender-App (Outlook, Apple, Google). Der Link ist geheim: wer ihn hat, sieht Ihren Kalender.</p>
      {url ? <><code style={{ wordBreak: "break-all", userSelect: "all" }}>{url}</code><button className="knopf" onClick={() => navigator.clipboard.writeText(url).then(() => zeige("Link kopiert"))}>Link kopieren</button><p className="leise klein">Der Link wird nur jetzt angezeigt. Ein neuer Link macht den alten ungültig.</p></> :
        <button className="knopf haupt-knopf" onClick={async () => { const r = await api("/api/kalender/abo", { methode: "POST" }); setPfad(r.pfad); onFertig(); }}>{aktiv ? "Neuen Link erstellen (alter wird ungültig)" : "Link erstellen"}</button>}
      {aktiv && !url && <button className="knopf leise-knopf" onClick={async () => { await api("/api/kalender/abo", { methode: "DELETE" }); zeige("Abo beendet"); onFertig(); }}>Abo beenden</button>}
    </div>
  </Dialog>;
}

function AenderungDialog({ l, onZu, onFertig, darfAlles }) {
  const zeige = useMeldung();
  const [f, setF] = useState({ art: "ausfall", raum: "", text: "" });
  useEffect(() => { if (l) setF({ art: (l.aenderung && l.aenderung.art) || "ausfall", raum: "", text: (l.aenderung && l.aenderung.text) || "" }); }, [l]);
  if (!l) return null;
  const los = async () => { try { await api("/api/stundenplan/aenderungen", { methode: "POST", daten: { unterricht_id: l.unterricht_id, datum: l.datum, lektion: l.lektion, ...f } }); zeige("Eingetragen, die Klasse sieht es im Kalender"); onZu(); onFertig(); } catch (e) { zeige(e.message, true); } };
  return <Dialog offen={!!l} titel={`${l.fach} ${l.klasse || ""}, ${new Date(l.datum + "T12:00").toLocaleDateString("de-CH", { weekday: "long", day: "numeric", month: "long" })}, ${l.lektion}. Lektion`} onZu={onZu}
    fuss={<><button className="knopf" onClick={onZu}>Abbrechen</button><button className="knopf haupt-knopf" onClick={los}>Speichern</button></>}>
    <div className="stapel" style={{ gap: 12, minWidth: "min(420px, 80vw)" }}>
      <div className="segment" role="group">{[["ausfall", "Fällt aus"], ["raum", "Anderer Raum"], ...(darfAlles ? [["zusatz", "Zusatz"]] : [])].map(([k, t]) => <button key={k} type="button" aria-pressed={f.art === k} onClick={() => setF({ ...f, art: k })}>{t}</button>)}</div>
      {f.art === "raum" && <Feld label="Neuer Raum" value={f.raum} onChange={(e) => setF({ ...f, raum: e.target.value })} />}
      <Feld label="Hinweis (freiwillig)" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} placeholder="z. B. Selbststudium, Auftrag im Klassenraum" />
    </div>
  </Dialog>;
}

function StundenplanVerwaltung({ onFertig }) {
  const zeige = useMeldung();
  const [datei, setDatei] = useState(null);
  const [vorschau, setVorschau] = useState(null);
  const e = useLaden("/api/kalender/einstellungen");
  const pruefen = async (f) => { setDatei(f); try { setVorschau(await hochladen("/api/stundenplan/untis", f, { vorschau: "1" })); } catch (x) { zeige(x.message, true); } };
  const uebernehmen = async () => { try { const r = await hochladen("/api/stundenplan/untis", datei); zeige(`${r.uebernommen} Lektionen übernommen`); setDatei(null); setVorschau(null); onFertig(); } catch (x) { zeige(x.message, true); } };
  return <section className="karte stapel" style={{ gap: 12, marginTop: 24 }}>
    <h2 style={{ fontSize: "1.15rem" }}>Stundenplan verwalten</h2>
    <p className="leise">Laden Sie den Export aus Untis (GPU001.TXT) hoch. Sie sehen zuerst, was zugeordnet werden kann. Beim Übernehmen ersetzt RESCOOL alle früher aus Untis übernommenen Lektionen; von Hand erfasste bleiben.</p>
    <div><DateiKnopf text="GPU001.TXT wählen" accept=".txt,.csv" onDatei={pruefen} /></div>
    {vorschau && <div className="hinweis stapel" style={{ gap: 6 }}>
      <b>{vorschau.zugeordnet} Lektionen zugeordnet{vorschau.anzahlOffen ? `, ${vorschau.anzahlOffen} ohne passenden Unterricht` : ""}{vorschau.anzahlUnlesbar ? `, ${vorschau.anzahlUnlesbar} Zeilen unlesbar` : ""}</b>
      {vorschau.offen.length > 0 && <details><summary>Ohne passenden Unterricht</summary><ul>{vorschau.offen.slice(0, 30).map((o, i) => <li key={i}>Zeile {o.zeile}: {o.klasse} {o.fach} ({o.lehrer})</li>)}</ul></details>}
      {vorschau.unlesbar.length > 0 && <details><summary>Unlesbare Zeilen</summary><ul>{vorschau.unlesbar.map((o, i) => <li key={i}>{typeof o === "string" ? o : `Zeile ${o.zeile}: ${o.grund || ""}`}</li>)}</ul></details>}
      <div><button className="knopf haupt-knopf" onClick={uebernehmen} disabled={!vorschau.zugeordnet}>Übernehmen</button></div>
    </div>}
    <Laden zustand={e}>{(d) => <LektionsZeiten d={d} onFertig={e.neu} />}</Laden>
  </section>;
}

function LektionsZeiten({ d, onFertig }) {
  const zeige = useMeldung();
  const [l, setL] = useState(d.lektionen);
  const [lim, setLim] = useState(d.limit || d.pruefungslimit);
  return <details><summary>Lektionszeiten und Prüfungslimit</summary>
    <div className="stapel" style={{ gap: 8, marginTop: 8 }}>
      {l.map((x, i) => <div key={i} className="reihe" style={{ gap: 8 }}><span style={{ width: 70 }}>{i + 1}. Lektion</span><input type="time" value={x.von} onChange={(e) => setL(l.map((y, j) => j === i ? { ...y, von: e.target.value } : y))} /><input type="time" value={x.bis} onChange={(e) => setL(l.map((y, j) => j === i ? { ...y, bis: e.target.value } : y))} /></div>)}
      <div className="reihe" style={{ gap: 8 }}><button className="knopf leise-knopf klein" onClick={() => setL([...l, { von: l[l.length - 1].bis, bis: l[l.length - 1].bis }])}><Symbol.plus />Lektion</button>{l.length > 1 && <button className="knopf leise-knopf klein" onClick={() => setL(l.slice(0, -1))}>Letzte entfernen</button>}</div>
      <div className="reihe" style={{ gap: 12 }}><Feld label="Prüfungen pro Woche und Klasse" type="number" min="0" max="10" value={lim.proWoche} onChange={(e) => setLim({ ...lim, proWoche: Number(e.target.value) })} /><Feld label="pro Tag" type="number" min="0" max="5" value={lim.proTag} onChange={(e) => setLim({ ...lim, proTag: Number(e.target.value) })} /></div>
      <p className="leise klein">0 bedeutet: kein Limit.</p>
      <div><button className="knopf haupt-knopf" onClick={async () => { try { await api("/api/kalender/einstellungen", { methode: "PUT", daten: { lektionen: l, pruefungslimit: lim } }); zeige("Gespeichert"); onFertig(); } catch (e) { zeige(e.message, true); } }}>Speichern</button></div>
    </div>
  </details>;
}
