import { useState } from "react";
import { api } from "../api.js";
import { useLaden, Laden, Dialog, useMeldung, datumCH } from "../ui.jsx";

const leer = { bezeichnung: "", von: "", bis: "", aktiv: false, s1von: "", s1bis: "", s2von: "", s2bis: "" };
export default function Schuljahre() {
  const z = useLaden("/api/schuljahre"); const meld = useMeldung();
  const [form, setForm] = useState(null); const [fehler, setFehler] = useState(null);
  const oeffnen = (j) => { setFehler(null); setForm(j ? { id: j.id, bezeichnung: j.bezeichnung, von: j.von, bis: j.bis, aktiv: j.aktiv, s1von: j.semester[0]?.von || "", s1bis: j.semester[0]?.bis || "", s2von: j.semester[1]?.von || "", s2bis: j.semester[1]?.bis || "" } : { ...leer }); };
  const speichern = async (e) => {
    e.preventDefault();
    const semester = [[1, form.s1von, form.s1bis], [2, form.s2von, form.s2bis]].filter(([, a, b]) => a && b).map(([nr, von, bis]) => ({ nr, von, bis }));
    try { await api(form.id ? `/api/schuljahre/${form.id}` : "/api/schuljahre", { methode: form.id ? "PUT" : "POST", daten: { bezeichnung: form.bezeichnung, von: form.von, bis: form.bis, aktiv: form.aktiv, semester } }); setForm(null); meld("Gespeichert."); z.neu(); }
    catch (x) { setFehler(x); }
  };
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  return (
    <div className="stapel">
      <div className="kopf"><div><h1>Schuljahre</h1><p>Das aktive Schuljahr bestimmt, welche Klassen und Fächer überall angezeigt werden.</p></div><button className="knopf haupt-knopf" onClick={() => oeffnen()}>Neues Schuljahr</button></div>
      <Laden zustand={z}>{(liste) => liste.length === 0 ? <div className="leer">Noch kein Schuljahr erfasst.</div> : (
        <div className="tabelle-huelle"><table>
          <thead><tr><th>Schuljahr</th><th>Dauer</th><th>Semester</th><th></th></tr></thead>
          <tbody>{liste.map((j) => <tr key={j.id}>
            <td><b>{j.bezeichnung}</b> {j.aktiv && <span className="chip gruen">aktiv</span>}</td>
            <td>{datumCH(j.von)} bis {datumCH(j.bis)}</td>
            <td className="klein">{j.semester.map((s) => `${s.nr}. Semester bis ${datumCH(s.bis)}`).join(", ") || "—"}</td>
            <td className="zahl"><button className="knopf klein-knopf" onClick={() => oeffnen(j)}>Bearbeiten</button></td>
          </tr>)}</tbody>
        </table></div>)}</Laden>
      <Dialog offen={!!form} titel={form && form.id ? "Schuljahr bearbeiten" : "Neues Schuljahr"} onZu={() => setForm(null)}>
        {form && <form className="formular" onSubmit={speichern} id="f-jahr">
          {fehler && <div className="hinweis fehler" role="alert">{fehler.message}</div>}
          <label className="feld">Bezeichnung<small>Format 2026/27</small><input value={form.bezeichnung} onChange={set("bezeichnung")} placeholder="2026/27" required /></label>
          <div className="zwei"><label className="feld">Beginn<input type="date" value={form.von} onChange={set("von")} required /></label><label className="feld">Ende<input type="date" value={form.bis} onChange={set("bis")} required /></label></div>
          <div className="zwei"><label className="feld">1. Semester von<input type="date" value={form.s1von} onChange={set("s1von")} /></label><label className="feld">bis<input type="date" value={form.s1bis} onChange={set("s1bis")} /></label></div>
          <div className="zwei"><label className="feld">2. Semester von<input type="date" value={form.s2von} onChange={set("s2von")} /></label><label className="feld">bis<input type="date" value={form.s2bis} onChange={set("s2bis")} /></label></div>
          <label className="check"><input type="checkbox" checked={form.aktiv} onChange={set("aktiv")} />Aktives Schuljahr</label>
          <div className="reihe" style={{ justifyContent: "flex-end" }}><button type="button" className="knopf leise-knopf" onClick={() => setForm(null)}>Abbrechen</button><button className="knopf haupt-knopf">Speichern</button></div>
        </form>}
      </Dialog>
    </div>
  );
}
