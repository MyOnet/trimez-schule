import { useState } from "react";
import { api } from "../api.js";
import { useLaden, Laden, Dialog, useMeldung } from "../ui.jsx";

export default function Faecher() {
  const z = useLaden("/api/faecher"); const meld = useMeldung();
  const [form, setForm] = useState(null); const [fehler, setFehler] = useState(null);
  const speichern = async (e) => {
    e.preventDefault();
    try { await api(form.id ? `/api/faecher/${form.id}` : "/api/faecher", { methode: form.id ? "PUT" : "POST", daten: { name: form.name, kuerzel: form.kuerzel, farbe: form.farbe, promotionsrelevant: form.promotionsrelevant } }); setForm(null); meld("Gespeichert."); z.neu(); }
    catch (x) { setFehler(x); }
  };
  const loeschen = async () => { if (!confirm(`Fach «${form.name}» löschen?`)) return; try { await api(`/api/faecher/${form.id}`, { methode: "DELETE" }); setForm(null); meld("Gelöscht."); z.neu(); } catch (x) { setFehler(x); } };
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  return (
    <div className="stapel">
      <div className="kopf"><div><h1>Fächer</h1><p>Die Farbe erscheint bei Klassen, Stundenplan und Prüfungen.</p></div><button className="knopf haupt-knopf" onClick={() => { setFehler(null); setForm({ name: "", kuerzel: "", farbe: "#1F5C4A", promotionsrelevant: true }); }}>Neues Fach</button></div>
      <Laden zustand={z}>{(liste) => liste.length === 0 ? <div className="leer">Noch keine Fächer erfasst.</div> : (
        <div className="tabelle-huelle"><table>
          <thead><tr><th>Fach</th><th>Kürzel</th><th>Promotion</th><th></th></tr></thead>
          <tbody>{liste.map((f) => <tr key={f.id}>
            <td><span className="reihe" style={{ gap: 10 }}><span className="punkt" style={{ background: f.farbe }} />{f.name}</span></td>
            <td>{f.kuerzel}</td><td>{f.promotionsrelevant ? "zählt" : <span className="leise">zählt nicht</span>}</td>
            <td className="zahl"><button className="knopf klein-knopf" onClick={() => { setFehler(null); setForm({ ...f }); }}>Bearbeiten</button></td>
          </tr>)}</tbody>
        </table></div>)}</Laden>
      <Dialog offen={!!form} titel={form && form.id ? "Fach bearbeiten" : "Neues Fach"} onZu={() => setForm(null)}>
        {form && <form className="formular" onSubmit={speichern}>
          {fehler && <div className="hinweis fehler" role="alert">{fehler.message}</div>}
          <label className="feld">Name<input value={form.name} onChange={set("name")} required maxLength={60} /></label>
          <div className="zwei"><label className="feld">Kürzel<input value={form.kuerzel} onChange={set("kuerzel")} required maxLength={8} /></label><label className="feld">Farbe<input type="color" value={form.farbe} onChange={set("farbe")} style={{ padding: 4 }} /></label></div>
          <label className="check"><input type="checkbox" checked={form.promotionsrelevant} onChange={set("promotionsrelevant")} />Zählt für die Promotion</label>
          <div className="zwischen">{form.id ? <button type="button" className="knopf leise-knopf gefahr" onClick={loeschen}>Löschen</button> : <span />}<div className="reihe"><button type="button" className="knopf leise-knopf" onClick={() => setForm(null)}>Abbrechen</button><button className="knopf haupt-knopf">Speichern</button></div></div>
        </form>}
      </Dialog>
    </div>
  );
}
