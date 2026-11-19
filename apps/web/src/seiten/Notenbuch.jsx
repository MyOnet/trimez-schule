// Notenbuch eines Unterrichts: Tabelle wie in Excel. Schülerinnen und Schüler in Zeilen, Bewertungen in Spalten.
// Tippen speichert automatisch (pro Spalte, kurz nach der letzten Eingabe). Pfeiltasten und Enter springen weiter.
// Einfügen aus Excel: mehrere Zeilen werden nach unten verteilt.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api.js";
import { useLaden, Laden, Dialog, useMeldung, Note, Symbol, datumCH } from "../ui.jsx";
import { UnterrichtReiter } from "./UnterrichtMaterial.jsx";
import { schnitt, zeugnisVorschlag, punkteZuNote, noteLesen, notenStufe, fmtNote } from "@schule/shared";

const KZ = { a: "abwesend", abw: "abwesend", abwesend: "abwesend", n: "nachholen", nach: "nachholen", nachholen: "nachholen", d: "dispensiert", disp: "dispensiert", dispensiert: "dispensiert" };
const KZ_KURZ = { abwesend: "abw.", nachholen: "nachh.", dispensiert: "disp." };
const k = (b, s) => `${b}:${s}`;

export default function Notenbuch() {
  const { kurz, uid } = useParams(); const meld = useMeldung();
  const [semester, setSemester] = useState("");
  const z = useLaden(`/api/notenbuch/${uid}${semester ? `?semester=${semester}` : ""}`);
  return <Laden zustand={z}>{(d) => <Tabelle d={d} neu={z.neu} kurz={kurz} uid={uid} setSemester={setSemester} meld={meld} />}</Laden>;
}

function Tabelle({ d, neu, kurz, uid, setSemester, meld }) {
  const [werte, setWerte] = useState({});           // Eingaben: «bid:sid» → { text, dirty, fehler }
  const [zeugnis, setZeugnis] = useState({});
  const [bewDialog, setBewDialog] = useState(null);
  const [grundFrage, setGrundFrage] = useState(null); // { titel, weiter(grund) }
  const timer = useRef({});
  const tabelle = useRef(null);
  const schluessel = useMemo(() => new Map(d.schluessel.map((s) => [s.id, s])), [d.schluessel]);

  // Ausgangswerte aus den gespeicherten Leistungen
  useEffect(() => {
    const w = {};
    for (const l of d.leistungen) {
      const b = d.bewertungen.find((x) => x.id === l.bewertung_id);
      w[k(l.bewertung_id, l.schueler_id)] = { text: l.kennzeichen ? KZ_KURZ[l.kennzeichen] : b && b.max_punkte ? fmtNote(l.punkte) : fmtNote(l.note) };
    }
    setWerte(w);
    setZeugnis(Object.fromEntries(d.zeilen.map((z) => [z.id, z.zeugnis && z.zeugnis.gesetzt != null ? String(z.zeugnis.gesetzt) : ""])));
  }, [d]);

  // Eingabe auswerten: Note, Punkte oder Kennzeichen
  const lesen = useCallback((b, text) => {
    const t = String(text || "").trim().toLowerCase().replace(/\.$/, "");
    if (!t) return { leer: true };
    if (KZ[t]) return { kennzeichen: KZ[t] };
    if (b.max_punkte) {
      const p = Number(t.replace(",", "."));
      if (!Number.isFinite(p) || p < 0 || p > Number(b.max_punkte)) return { fehler: `Punkte von 0 bis ${fmtNote(b.max_punkte)}` };
      return { punkte: p, note: punkteZuNote(p, b.max_punkte, schluessel.get(b.notenschluessel_id)) };
    }
    const n = noteLesen(t);
    return n.fehler ? { fehler: n.fehler } : { note: n.note };
  }, [schluessel]);

  // Speichern einer Spalte (alle geänderten Zellen der Bewertung)
  const speichern = useCallback(async (b, grund) => {
    const geaendert = Object.entries(werte).filter(([key, v]) => key.startsWith(b.id + ":") && v.dirty && !v.fehler);
    if (!geaendert.length) return;
    const eintraege = geaendert.map(([key, v]) => { const sid = key.split(":")[1]; const x = lesen(b, v.text); return { schueler_id: sid, punkte: x.punkte ?? null, note: x.note ?? null, kennzeichen: x.kennzeichen ?? null }; });
    try {
      await api(`/api/bewertungen/${b.id}/leistungen`, { methode: "PUT", daten: { eintraege, grund } });
      setWerte((w) => { const n = { ...w }; for (const [key] of geaendert) n[key] = { ...n[key], dirty: false }; return n; });
    } catch (x) {
      if (x.feld === "grund") setGrundFrage({ titel: x.message, weiter: (g) => speichern(b, g) });
      else meld(x.message, true);
    }
  }, [werte, lesen, meld]);

  const aendern = (b, sid, text) => {
    const x = lesen(b, text);
    setWerte((w) => ({ ...w, [k(b.id, sid)]: { text, dirty: true, fehler: x.fehler || null } }));
    clearTimeout(timer.current[b.id]);
    timer.current[b.id] = setTimeout(() => document.dispatchEvent(new CustomEvent("nb-speichern", { detail: b.id })), 900);
  };
  // Speichern über ein Ereignis, damit immer der aktuelle Stand der Eingaben verwendet wird
  useEffect(() => {
    const h = (e) => { const b = d.bewertungen.find((x) => x.id === e.detail); if (b) speichern(b); };
    document.addEventListener("nb-speichern", h);
    return () => document.removeEventListener("nb-speichern", h);
  }, [speichern, d.bewertungen]);

  // Tastatur: Enter/Pfeil runter → nächste Zeile, Pfeil hoch → vorherige, Pfeil links/rechts am Rand → Nachbarspalte
  const taste = (e, zi, si) => {
    const ziel = (z, s) => { const el = tabelle.current && tabelle.current.querySelector(`input[data-z="${z}"][data-s="${s}"]`); if (el) { e.preventDefault(); el.focus(); el.select(); } };
    if (e.key === "Enter" || e.key === "ArrowDown") ziel(e.shiftKey && e.key === "Enter" ? zi - 1 : zi + 1, si);
    else if (e.key === "ArrowUp") ziel(zi - 1, si);
    else if (e.key === "ArrowLeft" && e.target.selectionStart === 0) ziel(zi, si - 1);
    else if (e.key === "ArrowRight" && e.target.selectionEnd === e.target.value.length) ziel(zi, si + 1);
  };
  const einfuegen = (e, b, zi) => {
    const t = e.clipboardData.getData("text");
    if (!/[\n\t]/.test(t.trim())) return;
    e.preventDefault();
    const zeilen = t.replace(/\r/g, "").split("\n").filter((x, i, a) => x !== "" || i < a.length - 1).map((x) => x.split("\t")[0]);
    zeilen.forEach((wert, i) => { const z = d.zeilen[zi + i]; if (z) aendern(b, z.id, wert); });
    meld(`${Math.min(zeilen.length, d.zeilen.length - zi)} Werte eingefügt.`);
  };

  // Laufende Schnitte (inkl. noch nicht gespeicherter Eingaben)
  const rechnen = (sid) => {
    const e = d.bewertungen.map((b) => { const v = werte[k(b.id, sid)]; if (!v || v.fehler) return null; const x = lesen(b, v.text); return { note: x.note ?? null, gewicht: b.gewicht, kennzeichen: x.kennzeichen }; }).filter(Boolean);
    return schnitt(e).schnitt;
  };
  const spaltenSchnitt = (b) => schnitt(d.zeilen.map((z) => { const v = werte[k(b.id, z.id)]; if (!v || v.fehler) return null; const x = lesen(b, v.text); return { note: x.note ?? null, gewicht: 1, kennzeichen: x.kennzeichen }; }).filter(Boolean)).schnitt;

  const zeugnisSetzen = async (sid, wert, grund) => {
    setZeugnis((z) => ({ ...z, [sid]: wert }));
    try { await api(`/api/notenbuch/${uid}/zeugnis`, { methode: "PUT", daten: { schueler_id: sid, gesetzt: wert === "" ? null : Number(wert), semester_id: d.semester.id, grund } }); meld("Zeugnisnote gespeichert."); }
    catch (x) { if (x.feld === "grund") setGrundFrage({ titel: x.message, weiter: (g) => zeugnisSetzen(sid, wert, g) }); else meld(x.message, true); }
  };

  const ungespeichert = Object.values(werte).some((v) => v.dirty);
  const halbe = []; for (let n = 1; n <= 6; n += d.rundungZeugnis) halbe.push(Math.round(n * 100) / 100);
  const u = d.unterricht;

  return (
    <div>
      <div className="kopf">
        <div>
          <div className="pfad"><Link to={`/s/${kurz}/`}>Übersicht</Link><span aria-hidden="true">/</span><Link to={`/s/${kurz}/klassen/${u.klasse_id}`}>Klasse {u.klasse}</Link></div>
          <h1 style={{ display: "flex", gap: 14, alignItems: "center" }}><span className="punkt" style={{ background: u.farbe, width: 14, height: 14, borderRadius: 4 }} />{u.fach} {u.klasse}{u.gruppe ? `, ${u.gruppe}` : ""}</h1>
        </div>
        <div className="reihe kein-druck">
          {d.darfSchreiben && <Link className="knopf" to={`/s/${kurz}/unterricht/${uid}/muendlich`}><Symbol.muendlich />Mündlich erfassen</Link>}
          <button className="knopf" onClick={() => window.print()}><Symbol.drucken />Drucken</button>
          {d.darfSchreiben && <button className="knopf haupt-knopf" onClick={() => setBewDialog({ neu: true })}><Symbol.plus />Neue Bewertung</button>}
        </div>
      </div>

      <UnterrichtReiter kurz={kurz} uid={uid} />
      <div className="nb-werkzeug">
        <div className="segment" role="group" aria-label="Semester">
          {d.semesterListe.map((s) => <button key={s.id} aria-pressed={s.id === d.semester.id} onClick={() => setSemester(s.id)}>{s.nr}. Semester</button>)}
        </div>
        <div className="legende">
          <span><Note wert={5.75} /> sehr gut</span><span><Note wert={5} /> gut</span><span><Note wert={4.25} /> knapp</span><span><Note wert={3.5} /> ungenügend</span>
          <span aria-live="polite" style={{ minWidth: 130 }}>{ungespeichert ? "Wird gespeichert …" : "Alles gespeichert"}</span>
        </div>
      </div>
      {!d.darfSchreiben && <div className="hinweis kein-druck" style={{ marginBottom: 14 }}>Sie sehen dieses Notenbuch zur Einsicht. Die Einsicht wird protokolliert.</div>}
      {d.darfSchreiben && d.mussBegruenden && <div className="hinweis kein-druck" style={{ marginBottom: 14 }}>Sie unterrichten dieses Fach nicht. Die Einsicht wird protokolliert; jede Änderung verlangt einen Grund.</div>}

      {d.bewertungen.length === 0 ? (
        <div className="leer"><b>Noch keine Bewertungen in diesem Semester</b><span>Legen Sie eine Prüfung, einen Test oder einen Vortrag an. Danach tragen Sie die Noten oder Punkte direkt in die Tabelle ein.</span>
          {d.darfSchreiben && <button className="knopf haupt-knopf" onClick={() => setBewDialog({ neu: true })}><Symbol.plus />Neue Bewertung</button>}</div>
      ) : (
        <div className="nb-huelle" ref={tabelle}>
          <table className="nb">
            <thead><tr>
              <th className="name" style={{ verticalAlign: "bottom", padding: "10px 14px" }}><span className="leise klein">{d.zeilen.length} Schülerinnen und Schüler</span></th>
              {d.bewertungen.map((b) => (
                <th key={b.id}>
                  <button className="nb-kopf" onClick={() => d.darfSchreiben && setBewDialog(b)} title={d.darfSchreiben ? "Bewertung bearbeiten oder freigeben" : b.titel}>
                    <span className="t">{b.titel}</span>
                    <span className="m">{datumCH(b.datum)}, ×{fmtNote(b.gewicht)}{b.max_punkte ? `, ${fmtNote(b.max_punkte)} P.` : ""}</span>
                    {b.status === "freigegeben" ? <span className="chip gruen"><span className="p" />freigegeben</span> : <span className="chip gelb"><span className="p" />Entwurf</span>}
                  </button>
                </th>))}
              <th className="sum-kopf trenn">Schnitt</th>
              <th className="sum-kopf" title="Vorschlag aus den mündlichen Beobachtungen">Mündlich</th>
              <th className="sum-kopf">Vorschlag</th>
              <th className="sum-kopf">Zeugnis</th>
            </tr></thead>
            <tbody>
              {d.zeilen.map((z, zi) => {
                const sn = rechnen(z.id);
                const vs = zeugnisVorschlag(sn, d.rundungZeugnis);
                return (
                  <tr key={z.id}>
                    <th className="name" scope="row"><b>{z.nachname}</b> {z.vorname}</th>
                    {d.bewertungen.map((b, si) => {
                      const v = werte[k(b.id, z.id)] || { text: "" };
                      const x = lesen(b, v.text);
                      const st = x.note != null ? notenStufe(x.note) : "";
                      return (
                        <td key={b.id} className={`zelle ${st}${v.fehler ? " ungueltig" : ""}${v.dirty ? " ungespeichert" : ""}`}>
                          <input className="n" value={v.text} data-z={zi} data-s={si} readOnly={!d.darfSchreiben}
                            aria-label={`${b.titel}, ${z.vorname} ${z.nachname}${b.max_punkte ? ", Punkte" : ", Note"}`} aria-invalid={!!v.fehler} title={v.fehler || (x.kennzeichen ? x.kennzeichen : "")}
                            inputMode="decimal" autoComplete="off"
                            onChange={(e) => aendern(b, z.id, e.target.value)} onKeyDown={(e) => taste(e, zi, si)} onPaste={(e) => einfuegen(e, b, zi)}
                            onFocus={(e) => e.target.select()} onBlur={() => { if (v.dirty) document.dispatchEvent(new CustomEvent("nb-speichern", { detail: b.id })); }} />
                          {b.max_punkte && x.note != null && <span className="punkte-note">{fmtNote(x.note)}</span>}
                        </td>);
                    })}
                    <td className="sum trenn"><Note wert={sn} /></td>
                    <td className="sum" title={z.muendlich.grund || `${z.beobachtungen} Beobachtungen`}>{z.muendlich.note != null ? <Note wert={z.muendlich.note} /> : <span className="leise klein">{z.beobachtungen || "–"}</span>}</td>
                    <td className="sum"><Note wert={vs} /></td>
                    <td className="sum" style={{ padding: 0, minWidth: 90 }}>
                      <select className="z" aria-label={`Zeugnisnote ${z.vorname} ${z.nachname}`} value={zeugnis[z.id] ?? ""} disabled={!d.darfSchreiben} onChange={(e) => zeugnisSetzen(z.id, e.target.value)}>
                        <option value="">{vs != null ? `(${fmtNote(vs)})` : "–"}</option>
                        {halbe.map((n) => <option key={n} value={String(n)}>{fmtNote(n)}</option>)}
                      </select>
                    </td>
                  </tr>);
              })}
            </tbody>
            <tfoot><tr>
              <td className="name">Schnitt der Klasse</td>
              {d.bewertungen.map((b) => <td key={b.id} style={{ textAlign: "center", padding: "8px 0" }}><Note wert={spaltenSchnitt(b)} /></td>)}
              <td className="sum trenn"><Note wert={schnitt(d.zeilen.map((z) => ({ note: rechnen(z.id), gewicht: 1 }))).schnitt} /></td><td /><td /><td />
            </tr></tfoot>
          </table>
        </div>
      )}
      <p className="leise klein kein-druck" style={{ marginTop: 12 }}>Eingabe: Note (z. B. 4.5) oder Punkte. Für fehlende Leistungen «a» (abwesend), «n» (nachholen) oder «d» (dispensiert); diese zählen nicht im Schnitt. Aus Excel kopierte Spalten lassen sich direkt einfügen.</p>

      <BewertungDialog offen={bewDialog} zu={() => setBewDialog(null)} d={d} uid={uid} neu={neu} meld={meld} setGrundFrage={setGrundFrage} />
      <GrundDialog frage={grundFrage} zu={() => setGrundFrage(null)} />
    </div>
  );
}

function GrundDialog({ frage, zu }) {
  const [g, setG] = useState("");
  useEffect(() => setG(""), [frage]);
  return (
    <Dialog offen={!!frage} titel="Grund für die Änderung" onZu={zu}>
      {frage && <form className="formular" onSubmit={(e) => { e.preventDefault(); if (!g.trim()) return; frage.weiter(g.trim()); zu(); }}>
        <p>{frage.titel}</p>
        <p className="leise klein">Der Grund erscheint im Protokoll, zusammen mit altem und neuem Wert. Schülerinnen und Schüler sehen ihn nicht.</p>
        <label className="feld">Grund<textarea value={g} onChange={(e) => setG(e.target.value)} maxLength={300} required autoFocus placeholder="z. B. Korrekturfehler bei Aufgabe 3" /></label>
        <div className="reihe" style={{ justifyContent: "flex-end" }}><button type="button" className="knopf leise-knopf" onClick={zu}>Abbrechen</button><button className="knopf haupt-knopf">Ändern</button></div>
      </form>}
    </Dialog>
  );
}

function BewertungDialog({ offen, zu, d, uid, neu, meld, setGrundFrage }) {
  const [f, setF] = useState(null); const [fehler, setFehler] = useState("");
  useEffect(() => {
    if (!offen) return setF(null);
    setFehler("");
    const art = d.arten.find((a) => a.name === "Prüfung") || d.arten[0];
    setF(offen.neu ? { titel: "", datum: new Date().toISOString().slice(0, 10), bewertungsart_id: art ? art.id : "", gewicht: art ? String(art.gewicht_standard) : "1", mitPunkten: false, max_punkte: "", notenschluessel_id: d.schluessel[0] ? d.schluessel[0].id : "", kategorie: art ? art.kategorie : "schriftlich" }
      : { ...offen, gewicht: String(offen.gewicht), mitPunkten: !!offen.max_punkte, max_punkte: offen.max_punkte ? String(offen.max_punkte) : "", notenschluessel_id: offen.notenschluessel_id || (d.schluessel[0] ? d.schluessel[0].id : "") });
  }, [offen]);
  if (!f || !offen) return <Dialog offen={false} />;
  const set = (key) => (e) => setF({ ...f, [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const artWahl = (e) => { const a = d.arten.find((x) => x.id === e.target.value); setF({ ...f, bewertungsart_id: e.target.value, gewicht: a ? String(a.gewicht_standard) : f.gewicht, kategorie: a ? a.kategorie : f.kategorie }); };
  const daten = (grund) => ({ titel: f.titel, datum: f.datum, gewicht: f.gewicht, bewertungsart_id: f.bewertungsart_id || null, kategorie: f.kategorie, max_punkte: f.mitPunkten ? f.max_punkte : null, notenschluessel_id: f.mitPunkten ? f.notenschluessel_id || null : null, semester_id: d.semester.id, grund });
  const speichern = async (e, grund) => {
    e && e.preventDefault(); setFehler("");
    try {
      if (offen.neu) await api(`/api/notenbuch/${uid}/bewertungen`, { methode: "POST", daten: daten() });
      else await api(`/api/bewertungen/${offen.id}`, { methode: "PUT", daten: daten(grund) });
      meld(offen.neu ? "Bewertung angelegt. Tragen Sie jetzt die Noten ein." : "Gespeichert."); zu(); neu();
    } catch (x) { if (x.feld === "grund") setGrundFrage({ titel: x.message, weiter: (g) => speichern(null, g) }); else setFehler(x.message); }
  };
  const freigeben = async (zurueck, grund) => {
    try { await api(`/api/bewertungen/${offen.id}/freigeben`, { methode: "POST", daten: { zurueck, grund } }); meld(zurueck ? "Die Noten sind wieder verborgen." : "Freigegeben. Die Schülerinnen und Schüler sehen ihre Noten jetzt."); zu(); neu(); }
    catch (x) { if (x.feld === "grund") setGrundFrage({ titel: x.message, weiter: (g) => freigeben(zurueck, g) }); else setFehler(x.message); }
  };
  const loeschen = async (grund) => {
    if (!grund && !confirm(`Bewertung «${offen.titel}» mit allen Noten löschen?`)) return;
    try { await api(`/api/bewertungen/${offen.id}`, { methode: "DELETE", daten: { grund } }); meld("Gelöscht."); zu(); neu(); }
    catch (x) { if (x.feld === "grund") setGrundFrage({ titel: x.message, weiter: (g) => loeschen(g) }); else setFehler(x.message); }
  };
  return (
    <Dialog offen={!!offen} titel={offen && offen.neu ? "Neue Bewertung" : "Bewertung"} onZu={zu}>
      <form className="formular" onSubmit={speichern}>
        {fehler && <div className="hinweis fehler" role="alert">{fehler}</div>}
        <label className="feld">Titel<input value={f.titel} onChange={set("titel")} required maxLength={80} placeholder="z. B. Erörterung" autoFocus /></label>
        <div className="drei">
          <label className="feld">Art<select value={f.bewertungsart_id || ""} onChange={artWahl}>{d.arten.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <label className="feld">Datum<input type="date" value={f.datum} onChange={set("datum")} required /></label>
          <label className="feld">Gewicht<input inputMode="decimal" value={f.gewicht} onChange={set("gewicht")} required /></label>
        </div>
        <label className="check"><input type="checkbox" checked={f.mitPunkten} onChange={set("mitPunkten")} />Mit Punkten (die Note wird berechnet)</label>
        {f.mitPunkten && <div className="zwei">
          <label className="feld">Maximale Punktzahl<input inputMode="decimal" value={f.max_punkte} onChange={set("max_punkte")} required /></label>
          <label className="feld">Notenschlüssel<select value={f.notenschluessel_id} onChange={set("notenschluessel_id")}>{d.schluessel.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        </div>}
        {!offen.neu && <div className="karte flach" style={{ padding: 14, background: "var(--flaeche2)" }}>
          <div className="zwischen">
            <span className="klein">{offen.status === "freigegeben" ? "Freigegeben: Die Schülerinnen und Schüler sehen diese Noten." : "Entwurf: Nur Sie sehen diese Noten."}</span>
            {offen.status === "freigegeben" ? <button type="button" className="knopf klein-knopf" onClick={() => freigeben(true)}>Wieder verbergen</button> : <button type="button" className="knopf klein-knopf haupt-knopf" onClick={() => freigeben(false)}>Freigeben</button>}
          </div>
        </div>}
        <div className="zwischen">
          {!offen.neu ? <button type="button" className="knopf leise-knopf gefahr" onClick={() => loeschen()}>Löschen</button> : <span />}
          <div className="reihe"><button type="button" className="knopf leise-knopf" onClick={zu}>Abbrechen</button><button className="knopf haupt-knopf">{offen.neu ? "Anlegen" : "Speichern"}</button></div>
        </div>
      </form>
    </Dialog>
  );
}
