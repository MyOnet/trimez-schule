// Absenzen: Lehrperson erfasst pro Lektion; Schüler/innen oder Eltern entschuldigen online;
// Klassenlehrperson entscheidet und wird bei Schwellen unentschuldigter Absenzen benachrichtigt.
import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, hochladen } from "../api.js";
import { useLaden, Laden, Dialog, Feld, Symbol, useMeldung, DateiListe, DateiKnopf, tagCH, zeitCH, useKurse, kursName } from "../ui.jsx";
import { useIch } from "../App.jsx";

const STATUS = { offen: "offen", entschuldigt: "entschuldigt", unentschuldigt: "unentschuldigt" };
const STATUS_KL = { offen: "chip", entschuldigt: "chip", unentschuldigt: "warn-chip" };
const E_STATUS = { eingereicht: "eingereicht", angenommen: "angenommen", abgelehnt: "abgelehnt" };
const heute = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Zurich" });

export default function Absenzen() {
  const ich = useIch();
  const [such] = useSearchParams();
  if (ich.rollen.includes("schueler") && !ich.unterrichtet) return <MeineAbsenzen />;
  if (ich.rollen.includes("eltern") && !ich.unterrichtet && !ich.rechte.absenzen) return <MeineAbsenzen person={such.get("person")} />;
  return <AbsenzenLp />;
}

function AbsenzenLp() {
  const ich = useIch();
  const [reiter, setReiter] = useState(ich.unterrichtet ? "erfassen" : "klassen");
  return <div>
    <div className="kopf"><div><h1>Absenzen</h1><p className="leise" style={{ marginTop: 6 }}>Erfassen Sie Absenzen pro Lektion. Entschuldigungen kommen online; die Klassenlehrperson entscheidet.</p></div>
      {ich.unterrichtet && ich.rechte.absenzen && <div className="segment" role="tablist">{[["erfassen", "Erfassen"], ["klassen", "Meine Klassen"]].map(([k, t]) => <button key={k} aria-pressed={reiter === k} onClick={() => setReiter(k)}>{t}</button>)}</div>}</div>
    {reiter === "erfassen" ? <Erfassen /> : <Klassen />}
  </div>;
}

function Erfassen() {
  const kurse = useKurse();
  const ich = useIch();
  const [uid, setUid] = useState("");
  const [datum, setDatum] = useState(heute());
  const [lektion, setLektion] = useState("");
  return <Laden zustand={kurse}>{(k) => {
    const meine = k;
    const u = uid || (meine[0] && meine[0].id);
    if (!meine.length) return <div className="leer"><b>Kein Unterricht</b></div>;
    return <div className="stapel" style={{ gap: 12 }}>
      <div className="reihe" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <Feld label="Unterricht" type="select" value={u} onChange={(e) => { setUid(e.target.value); setLektion(""); }}>{meine.map((x) => <option key={x.id} value={x.id}>{kursName(x)}</option>)}</Feld>
        <Feld label="Datum" type="date" max={heute()} value={datum} onChange={(e) => { setDatum(e.target.value); setLektion(""); }} />
      </div>
      <Liste key={`${u}:${datum}:${lektion}`} uid={u} datum={datum} lektion={lektion} setLektion={setLektion} />
    </div>;
  }}</Laden>;
}

function Liste({ uid, datum, lektion, setLektion }) {
  const zeige = useMeldung();
  const z = useLaden(`/api/absenzen/erfassen/${uid}?datum=${datum}${lektion ? `&lektion=${lektion}` : ""}`);
  const [st, setSt] = useState(null);
  useEffect(() => { if (z.daten) setSt(Object.fromEntries(z.daten.schueler.map((s) => [s.id, s.absenz ? { art: s.absenz.art, minuten: s.absenz.minuten || 5 } : { art: "" }]))); }, [z.daten]);
  return <Laden zustand={z}>{(d) => {
    if (!st) return null;
    const l = d.lektion;
    const speichern = async () => { try { const r = await api(`/api/absenzen/erfassen/${uid}`, { methode: "PUT", daten: { datum: d.datum, lektion: l, eintraege: d.schueler.map((s) => ({ schueler_id: s.id, art: st[s.id].art || null, minuten: st[s.id].minuten })) } }); zeige(r.neu || r.entfernt ? `Gespeichert (${r.neu} neu, ${r.entfernt} entfernt)` : "Gespeichert"); z.neu(); } catch (e) { zeige(e.message, true); } };
    const zahl = Object.values(st).filter((x) => x.art).length;
    return <>
      <div className="reihe" style={{ gap: 8, flexWrap: "wrap" }}><span className="leise">Lektion:</span>
        {[...new Set([...d.plan, ...(l ? [l] : [])])].sort((a, b) => a - b).map((n) => <button key={n} className="knopf klein" aria-pressed={n === l} style={n === l ? { fontWeight: 700 } : undefined} onClick={() => setLektion(String(n))}>{n}.</button>)}
        <select aria-label="Andere Lektion" value="" onChange={(e) => setLektion(e.target.value)}><option value="">andere …</option>{Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}. Lektion</option>)}</select>
      </div>
      {!l ? <div className="hinweis">Für diesen Tag ist keine Lektion im Stundenplan. Bitte die Lektion wählen.</div> : <>
        <div className="tabelle-huelle"><table><thead><tr><th>Name</th><th>Anwesend</th><th>Abwesend</th><th>Verspätet</th><th></th></tr></thead><tbody>
          {d.schueler.map((s) => { const x = st[s.id]; const set = (y) => setSt({ ...st, [s.id]: { ...x, ...y } }); const entschieden = s.absenz && s.absenz.status !== "offen";
            return <tr key={s.id} style={{ background: x.art === "abwesend" ? "#FEF2F2" : x.art === "verspaetet" ? "#FFFBEB" : undefined }}>
              <td><b>{s.nachname}</b> {s.vorname}</td>
              {["", "abwesend", "verspaetet"].map((a) => <td key={a}><input type="radio" name={`a-${s.id}`} aria-label={`${s.vorname} ${s.nachname}: ${a || "anwesend"}`} checked={x.art === a} onChange={() => set({ art: a })} disabled={entschieden} />
                {a === "verspaetet" && x.art === "verspaetet" && <input type="number" min="1" max="120" aria-label="Minuten" value={x.minuten} onChange={(e) => set({ minuten: Number(e.target.value) })} style={{ width: 60, marginLeft: 6 }} />}</td>)}
              <td className="klein">{s.gesuch && <span className="chip">Gesuch: {s.gesuch.grund}</span>}{s.ganztag && <span className="chip">ganztags gemeldet</span>}{entschieden && <span className={STATUS_KL[s.absenz.status]}>{STATUS[s.absenz.status]}</span>}</td>
            </tr>; })}
        </tbody></table></div>
        <div className="reihe" style={{ gap: 12 }}><button className="knopf haupt-knopf" onClick={speichern}>Speichern</button><span className="leise">{zahl ? `${zahl} abwesend oder verspätet` : "Alle anwesend"}</span></div>
      </>}
    </>;
  }}</Laden>;
}

function Klassen() {
  const z = useLaden("/api/absenzen/klassen");
  const [kid, setKid] = useState("");
  return <Laden zustand={z}>{(liste) => {
    const k = kid || (liste[0] && liste[0].id);
    if (!liste.length) return <div className="leer"><b>Keine Klasse</b><span>Die Klassenübersicht sehen Klassenlehrpersonen und die Schulleitung.</span></div>;
    return <div className="stapel" style={{ gap: 12 }}>
      {liste.length > 1 && <div className="reihe" style={{ gap: 6, flexWrap: "wrap" }}>{liste.map((x) => <button key={x.id} className="knopf" aria-pressed={x.id === k} style={x.id === k ? { fontWeight: 700 } : undefined} onClick={() => setKid(x.id)}>{x.name}{x.offen ? ` (${x.offen})` : ""}</button>)}</div>}
      <Klasse key={k} kid={k} />
    </div>;
  }}</Laden>;
}

function Klasse({ kid }) {
  const z = useLaden(`/api/klassen/${kid}/absenzen`);
  const { kurz } = useParams();
  return <Laden zustand={z}>{(d) => <>
    <h2 style={{ fontSize: "1.15rem" }}>Klasse {d.klasse.name}</h2>
    {d.offen.length > 0 && <section className="stapel" style={{ gap: 8 }}><h3 className="klein">Zu entscheiden ({d.offen.length})</h3>{d.offen.map((e) => <Entscheid key={e.id} e={e} gruende={d.gruende} neu={z.neu} />)}</section>}
    <p className="leise klein">Offene Absenzen werden nach {d.frist_tage} Tagen ohne Entschuldigung unentschuldigt. Meldung an Sie ab {d.schwellen.join(", ")} unentschuldigten Lektionen.</p>
    <div className="tabelle-huelle"><table><thead><tr><th>Name</th><th>Lektionen</th><th>offen</th><th>entschuldigt</th><th>unentschuldigt</th><th>Verspätungen</th></tr></thead><tbody>
      {d.schueler.map((s) => <tr key={s.id}><td><Link to={`/s/${kurz}/absenzen/schueler/${s.id}`}><b>{s.nachname}</b> {s.vorname}</Link></td><td>{s.lektionen}</td><td>{s.offen || ""}</td><td>{s.entschuldigt || ""}</td>
        <td>{s.unentschuldigt ? <span className={s.unentschuldigt >= d.schwellen[0] ? "warn-chip" : ""}>{s.unentschuldigt}</span> : ""}</td><td>{s.verspaetungen || ""}</td></tr>)}
    </tbody></table></div>
  </>}</Laden>;
}

function Entscheid({ e, gruende, neu }) {
  const zeige = useMeldung();
  const [bem, setBem] = useState("");
  const tun = async (status) => { try { const r = await api(`/api/entschuldigungen/${e.id}/entscheiden`, { methode: "POST", daten: { status, bemerkung: bem } }); zeige(`${status === "angenommen" ? "Angenommen" : "Abgelehnt"} (${r.lektionen} Lektionen)`); neu(); } catch (x) { zeige(x.message, true); } };
  return <div className="karte stapel" style={{ gap: 6 }}>
    <div className="reihe" style={{ justifyContent: "space-between" }}><b>{e.vorname} {e.nachname}: {e.art === "gesuch" ? "Gesuch" : "Entschuldigung"}</b><span className="leise klein">von {e.eingereicht_von_name}, {zeitCH(e.eingereicht_am)}</span></div>
    <span>{tagCH(e.von)}{e.bis !== e.von ? ` bis ${tagCH(e.bis)}` : ""} · {gruende[e.grund]}</span>
    {e.text && <span className="leise" style={{ whiteSpace: "pre-wrap" }}>{e.text}</span>}
    <DateiListe dateien={e.dateien} pfad="/api/entschuldigung-dateien/" />
    <div className="reihe" style={{ gap: 8, flexWrap: "wrap" }}><input placeholder="Bemerkung (bei Ablehnung nötig)" value={bem} onChange={(x) => setBem(x.target.value)} style={{ flex: 1, minWidth: 200 }} />
      <button className="knopf" onClick={() => tun("abgelehnt")}>Ablehnen</button><button className="knopf haupt-knopf" onClick={() => tun("angenommen")}>Annehmen</button></div>
  </div>;
}

/** Sicht einer Schülerin, eines Schülers: eigene (oder für Eltern: des Kindes), für die Klassenlehrperson über /absenzen/schueler/:sid */
export function MeineAbsenzen({ person, sid }) {
  const pfad = sid ? `/api/absenzen/schueler/${sid}` : `/api/meine-absenzen${person ? `?person=${person}` : ""}`;
  const z = useLaden(pfad, [pfad]);
  const zeige = useMeldung();
  const [neu, setNeu] = useState(null);
  return <Laden zustand={z}>{(d) => <div>
    <div className="kopf"><div>{!person && <h1>{sid ? `Absenzen ${d.person.vorname} ${d.person.nachname}` : "Meine Absenzen"}</h1>}<p className="leise" style={{ marginTop: 6 }}>Entschuldigen Sie Absenzen innert {d.frist_tage} Tagen. Für Urlaub oder Anlässe stellen Sie vorher ein Gesuch.</p></div>
      {d.darfEinreichen && <div className="reihe" style={{ gap: 8 }}><button className="knopf" onClick={() => setNeu("gesuch")}>Gesuch stellen</button><button className="knopf haupt-knopf" onClick={() => setNeu("entschuldigung")}>Entschuldigen</button></div>}</div>
    <div className="reihe" style={{ gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
      {[["lektionen", "Lektionen abwesend"], ["offen", "offen"], ["entschuldigt", "entschuldigt"], ["unentschuldigt", "unentschuldigt"], ["verspaetungen", "Verspätungen"]].map(([k, t]) => <div key={k} className="karte" style={{ minWidth: 120 }}><div className="zahl-gross" style={{ fontSize: "1.6rem", fontWeight: 700 }}>{(d.zahlen && d.zahlen[k]) || 0}</div><span className="leise klein">{t}</span></div>)}
    </div>
    {d.entschuldigungen.length > 0 && <section style={{ marginBottom: 20 }}><h2 style={{ fontSize: "1.1rem", marginBottom: 8 }}>Entschuldigungen und Gesuche</h2>
      <div className="stapel" style={{ gap: 6 }}>{d.entschuldigungen.map((e) => <div key={e.id} className="karte reihe" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <span><b>{e.art === "gesuch" ? "Gesuch" : "Entschuldigung"}</b> {tagCH(e.von)}{e.bis !== e.von ? ` bis ${tagCH(e.bis)}` : ""} · {d.gruende[e.grund]}{e.bemerkung ? <span className="leise"> · {e.bemerkung}</span> : ""}</span>
        <span className="reihe" style={{ gap: 6 }}><DateiListe dateien={e.dateien} pfad="/api/entschuldigung-dateien/" /><span className={e.status === "abgelehnt" ? "warn-chip" : "chip"}>{E_STATUS[e.status]}</span></span></div>)}</div></section>}
    <h2 style={{ fontSize: "1.1rem", marginBottom: 8 }}>Absenzen</h2>
    {!d.absenzen.length ? <p className="leise">Keine Absenzen in diesem Schuljahr.</p> : <div className="tabelle-huelle"><table><thead><tr><th>Datum</th><th>Lektion</th><th>Fach</th><th>Art</th><th>Status</th>{d.darfEntscheiden && <th></th>}</tr></thead><tbody>
      {d.absenzen.map((a) => <tr key={a.id}><td>{tagCH(a.datum)}</td><td>{a.lektion ? `${a.lektion}.` : "ganzer Tag"}</td><td>{a.fach || ""}</td><td>{a.art === "verspaetet" ? `verspätet (${a.minuten} Min.)` : "abwesend"}</td><td><span className={STATUS_KL[a.status]}>{STATUS[a.status]}</span></td>
        {d.darfEntscheiden && <td><select aria-label="Status ändern" value={a.status} onChange={async (e) => { try { await api(`/api/absenzen/${a.id}`, { methode: "PUT", daten: { status: e.target.value } }); z.neu(); } catch (x) { zeige(x.message, true); } }}>{Object.entries(STATUS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></td>}</tr>)}
    </tbody></table></div>}
    <EntschuldigungDialog art={neu} onZu={() => setNeu(null)} person={d.person} gruende={d.gruende} onFertig={z.neu} />
  </div>}</Laden>;
}

function EntschuldigungDialog({ art, onZu, person, gruende, onFertig }) {
  const zeige = useMeldung();
  const [f, setF] = useState(null);
  const [datei, setDatei] = useState(null);
  const [fehler, setFehler] = useState(null);
  useEffect(() => { if (art) { const h = heute(); setF({ von: h, bis: h, grund: "krankheit", text: "" }); setDatei(null); setFehler(null); } }, [art]);
  const los = async () => {
    try { const e = await api("/api/entschuldigungen", { methode: "POST", daten: { ...f, art, person_id: person.id } }); if (datei) await hochladen(`/api/entschuldigungen/${e.id}/datei`, datei); zeige("Eingereicht. Die Klassenlehrperson entscheidet."); onZu(); onFertig(); }
    catch (x) { setFehler(x.message); }
  };
  return <Dialog offen={!!art} titel={art === "gesuch" ? "Gesuch um Dispens" : "Absenz entschuldigen"} onZu={onZu} fuss={<><button className="knopf" onClick={onZu}>Abbrechen</button><button className="knopf haupt-knopf" onClick={los}>Einreichen</button></>}>
    {f && <div className="stapel" style={{ gap: 12, minWidth: "min(440px, 80vw)" }}>
      <p className="leise">{person.vorname} {person.nachname}. {art === "gesuch" ? "Ein Gesuch stellen Sie vor der Abwesenheit." : "Eine Entschuldigung gilt für alle Lektionen in diesem Zeitraum."}</p>
      <div className="zwei"><Feld label="Von" type="date" value={f.von} onChange={(e) => setF({ ...f, von: e.target.value, bis: e.target.value > f.bis ? e.target.value : f.bis })} /><Feld label="Bis" type="date" value={f.bis} onChange={(e) => setF({ ...f, bis: e.target.value })} /></div>
      <Feld label="Grund" type="select" value={f.grund} onChange={(e) => setF({ ...f, grund: e.target.value })}>{Object.entries(gruende).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</Feld>
      <label className="feld">Bemerkung (freiwillig)<textarea rows={3} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} /></label>
      <div className="reihe" style={{ gap: 8 }}><DateiKnopf text="Arztzeugnis oder Beleg anhängen" accept=".pdf,image/*" onDatei={setDatei} />{datei && <span className="chip">{datei.name}</span>}</div>
      {fehler && <div className="hinweis fehler" role="alert">{fehler}</div>}
    </div>}
  </Dialog>;
}

export function SchuelerAbsenzen() {
  const { sid } = useParams();
  return <MeineAbsenzen sid={sid} />;
}
