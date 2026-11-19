import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api.js";
import { useIch } from "../App.jsx";
import { useLaden, Laden, Dialog, useMeldung } from "../ui.jsx";

export default function Klassen() {
  const ich = useIch(); const { kurz } = useParams(); const meld = useMeldung();
  const z = useLaden("/api/klassen");
  const jahre = useLaden(ich.rechte["klasse.verwalten"] ? "/api/schuljahre" : null);
  const lps = useLaden(ich.rechte["klasse.verwalten"] ? "/api/personen?rolle=lehrperson" : null);
  const [form, setForm] = useState(null); const [fehler, setFehler] = useState(null);
  const aktiv = jahre.daten && jahre.daten.find((j) => j.aktiv);
  const speichern = async (e) => {
    e.preventDefault();
    try { await api("/api/klassen", { methode: "POST", daten: { schuljahr_id: form.schuljahr_id, name: form.name, stufe: form.stufe ? Number(form.stufe) : null, profil: form.profil || null, klassenlehrperson_id: form.klp || null } }); setForm(null); meld("Klasse angelegt."); z.neu(); }
    catch (x) { setFehler(x); }
  };
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <div className="stapel">
      <div className="kopf"><div><h1>Klassen</h1><p>{ich.rechte["klasse.verwalten"] ? "Alle Klassen im aktiven Schuljahr." : "Ihre Klassen im aktiven Schuljahr."}</p></div>
        {ich.rechte["klasse.verwalten"] && <button className="knopf haupt-knopf" disabled={!aktiv} onClick={() => { setFehler(null); setForm({ schuljahr_id: aktiv.id, name: "", stufe: "", profil: "", klp: "" }); }}>Neue Klasse</button>}</div>
      <Laden zustand={z}>{(liste) => liste.length === 0 ? <div className="leer">Keine Klassen im aktiven Schuljahr.</div> : (
        <div className="raster">{liste.map((k) => (
          <Link key={k.id} to={`/s/${kurz}/klassen/${k.id}`} className="ukarte">
            <div className="klasse">{k.name}</div>
            <span className="leise klein">{[k.stufe && `${k.stufe}. Klasse`, k.profil].filter(Boolean).join(", ") || " "}</span>
            <span className="klein">{k.schueler} Schülerinnen und Schüler, {k.faecher} Fächer</span>
            <span className="leise klein">{k.klassenlehrperson ? `Klassenlehrperson: ${k.klassenlehrperson}` : "Keine Klassenlehrperson"}</span>
          </Link>))}</div>)}</Laden>
      <Dialog offen={!!form} titel="Neue Klasse" onZu={() => setForm(null)}>
        {form && <form className="formular" onSubmit={speichern}>
          {fehler && <div className="hinweis fehler" role="alert">{fehler.message}</div>}
          <div className="zwei"><label className="feld">Name<small>z. B. 3a</small><input value={form.name} onChange={set("name")} required maxLength={12} /></label>
            <label className="feld">Stufe<select value={form.stufe} onChange={set("stufe")}><option value="">—</option>{[1, 2, 3, 4, 5, 6].map((s) => <option key={s} value={s}>{s}. Klasse</option>)}</select></label></div>
          <label className="feld">Profil<input value={form.profil} onChange={set("profil")} placeholder="z. B. neusprachlich" maxLength={40} /></label>
          <label className="feld">Klassenlehrperson<select value={form.klp} onChange={set("klp")}><option value="">— noch offen —</option>{(lps.daten || []).map((p) => <option key={p.id} value={p.id}>{p.nachname} {p.vorname}{p.kuerzel ? ` (${p.kuerzel})` : ""}</option>)}</select></label>
          <div className="reihe" style={{ justifyContent: "flex-end" }}><button type="button" className="knopf leise-knopf" onClick={() => setForm(null)}>Abbrechen</button><button className="knopf haupt-knopf">Anlegen</button></div>
        </form>}
      </Dialog>
    </div>
  );
}

export function KlasseDetail() {
  const ich = useIch(); const { kurz, id } = useParams(); const meld = useMeldung();
  const z = useLaden(`/api/klassen/${id}`);
  const verwalten = ich.rechte["klasse.verwalten"];
  const faecher = useLaden(verwalten ? "/api/faecher" : null);
  const lps = useLaden(verwalten ? "/api/personen?rolle=lehrperson" : null);
  const [suche, setSuche] = useState(""); const [treffer, setTreffer] = useState([]); const [neuesFach, setNeuesFach] = useState(null);
  const suchen = async (t) => { setSuche(t); if (t.trim().length < 2) return setTreffer([]); try { setTreffer(await api(`/api/personen?rolle=schueler&q=${encodeURIComponent(t)}`)); } catch { setTreffer([]); } };
  const hinzu = async (p) => { await api(`/api/klassen/${id}/schueler`, { methode: "POST", daten: { personen: [p.id] } }); meld(`${p.vorname} ${p.nachname} hinzugefügt.`); setSuche(""); setTreffer([]); z.neu(); };
  const weg = async (p) => { if (!confirm(`${p.vorname} ${p.nachname} aus der Klasse entfernen?`)) return; await api(`/api/klassen/${id}/schueler/${p.id}`, { methode: "DELETE" }); meld("Entfernt."); z.neu(); };
  const lpSetzen = async (u, pid) => { await api(`/api/unterricht/${u.id}/lehrpersonen`, { methode: "PUT", daten: { lehrpersonen: pid ? [pid] : [] } }); meld("Gespeichert."); z.neu(); };
  const fachHinzu = async (e) => { e.preventDefault(); try { await api("/api/unterricht", { methode: "POST", daten: { klasse_id: id, fach_id: neuesFach.fach, gruppe: neuesFach.gruppe, lehrpersonen: neuesFach.lp ? [neuesFach.lp] : [] } }); setNeuesFach(null); meld("Fach hinzugefügt."); z.neu(); } catch (x) { meld(x.message, true); } };
  return (
    <Laden zustand={z}>{(k) => (
      <div className="stapel" style={{ gap: 28 }}>
        <div className="kopf"><div><p className="leise"><Link to={`/s/${kurz}/klassen`}>Klassen</Link></p><h1>Klasse {k.name}</h1><p>{[k.stufe && `${k.stufe}. Klasse`, k.profil, `Schuljahr ${k.schuljahr}`].filter(Boolean).join(", ")}</p></div></div>
        <section className="stapel" aria-labelledby="h-faecher">
          <div className="zwischen"><h2 id="h-faecher">Fächer und Lehrpersonen</h2>{verwalten && <button className="knopf" onClick={() => setNeuesFach({ fach: "", gruppe: "", lp: "" })}>Fach hinzufügen</button>}</div>
          {k.unterricht.length === 0 ? <div className="leer">Noch keine Fächer.</div> : <div className="tabelle-huelle"><table>
            <thead><tr><th>Fach</th><th>Gruppe</th><th>Lehrperson</th></tr></thead>
            <tbody>{k.unterricht.map((u) => <tr key={u.id}>
              <td><span className="reihe" style={{ gap: 10 }}><span className="punkt" style={{ background: u.farbe }} />{u.fach}</span></td>
              <td>{u.gruppe || <span className="leise">ganze Klasse</span>}</td>
              <td>{verwalten ? <select aria-label={`Lehrperson ${u.fach}`} value={u.lehrpersonen[0]?.id || ""} onChange={(e) => lpSetzen(u, e.target.value)} style={{ maxWidth: 280 }}>
                <option value="">— noch offen —</option>{(lps.daten || []).map((p) => <option key={p.id} value={p.id}>{p.nachname} {p.vorname}{p.kuerzel ? ` (${p.kuerzel})` : ""}</option>)}</select>
                : u.lehrpersonen.map((l) => l.name).join(", ") || <span className="leise">offen</span>}</td>
            </tr>)}</tbody></table></div>}
        </section>
        <section className="stapel" aria-labelledby="h-schueler">
          <div className="zwischen"><h2 id="h-schueler">Schülerinnen und Schüler ({k.schueler.length})</h2></div>
          {verwalten && <div style={{ position: "relative", maxWidth: 420 }}>
            <label className="feld">Hinzufügen<input type="search" value={suche} onChange={(e) => suchen(e.target.value)} placeholder="Name eingeben" /></label>
            {treffer.length > 0 && <ul className="karte" style={{ listStyle: "none", margin: "6px 0 0", padding: 6, position: "absolute", left: 0, right: 0, zIndex: 5 }}>
              {treffer.slice(0, 8).map((p) => <li key={p.id}><button className="knopf leise-knopf breit" style={{ justifyContent: "space-between" }} onClick={() => hinzu(p)}>{p.nachname} {p.vorname}<span className="leise klein">{p.klasse || "ohne Klasse"}</span></button></li>)}
            </ul>}
          </div>}
          {k.schueler.length === 0 ? <div className="leer">Noch niemand in dieser Klasse.</div> : <div className="tabelle-huelle"><table>
            <thead><tr><th>Name</th>{k.schueler[0].email !== null && <th>E-Mail</th>}<th>Nummer</th>{verwalten && <th></th>}</tr></thead>
            <tbody>{k.schueler.map((p) => <tr key={p.id}><td>{p.nachname} {p.vorname}</td>{p.email !== null && <td className="klein">{p.email}</td>}<td className="klein">{p.extern_id || ""}</td>
              {verwalten && <td className="zahl"><button className="knopf klein-knopf leise-knopf gefahr" onClick={() => weg(p)}>Entfernen</button></td>}</tr>)}</tbody>
          </table></div>}
        </section>
        <Dialog offen={!!neuesFach} titel="Fach hinzufügen" onZu={() => setNeuesFach(null)}>
          {neuesFach && <form className="formular" onSubmit={fachHinzu}>
            <label className="feld">Fach<select value={neuesFach.fach} onChange={(e) => setNeuesFach({ ...neuesFach, fach: e.target.value })} required><option value="">Bitte wählen</option>{(faecher.daten || []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
            <label className="feld">Gruppe<small>leer lassen, wenn die ganze Klasse teilnimmt</small><input value={neuesFach.gruppe} onChange={(e) => setNeuesFach({ ...neuesFach, gruppe: e.target.value })} placeholder="z. B. Halbklasse A" maxLength={40} /></label>
            <label className="feld">Lehrperson<select value={neuesFach.lp} onChange={(e) => setNeuesFach({ ...neuesFach, lp: e.target.value })}><option value="">— noch offen —</option>{(lps.daten || []).map((p) => <option key={p.id} value={p.id}>{p.nachname} {p.vorname}</option>)}</select></label>
            <div className="reihe" style={{ justifyContent: "flex-end" }}><button type="button" className="knopf leise-knopf" onClick={() => setNeuesFach(null)}>Abbrechen</button><button className="knopf haupt-knopf">Hinzufügen</button></div>
          </form>}
        </Dialog>
      </div>
    )}</Laden>
  );
}
