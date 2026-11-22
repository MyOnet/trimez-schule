import { useState } from "react";
import { api } from "../api.js";
import { useLaden, Laden, Dialog, useMeldung } from "../ui.jsx";
import { TEXTE } from "@schule/shared";
import { ElternVerknuepfung } from "./Eltern.jsx";

const ROLLEN = ["schueler", "lehrperson", "schulleitung", "admin", "eltern"];
export default function Personen() {
  const meld = useMeldung();
  const [rolle, setRolle] = useState(""); const [q, setQ] = useState("");
  const z = useLaden(`/api/personen?rolle=${rolle}&q=${encodeURIComponent(q)}`);
  const [form, setForm] = useState(null); const [fehler, setFehler] = useState(null); const [pw, setPw] = useState(null);
  const speichern = async (e) => {
    e.preventDefault();
    const daten = { vorname: form.vorname, nachname: form.nachname, email: form.email || null, kuerzel: form.kuerzel || null, extern_id: form.extern_id || null, rollen: form.rollen, geburtsdatum: form.geburtsdatum || null };
    try { await api(form.id ? `/api/personen/${form.id}` : "/api/personen", { methode: form.id ? "PUT" : "POST", daten }); setForm(null); meld("Gespeichert."); z.neu(); }
    catch (x) { setFehler(x); }
  };
  const austragen = async () => { if (!confirm(`${form.vorname} ${form.nachname} austragen? Bisherige Daten bleiben erhalten.`)) return; try { await api(`/api/personen/${form.id}`, { methode: "DELETE" }); setForm(null); meld("Ausgetragen."); z.neu(); } catch (x) { setFehler(x); } };
  const konto = async () => { try { const d = await api(`/api/personen/${form.id}/konto`, { methode: "POST" }); setPw({ name: `${form.vorname} ${form.nachname}`, email: form.email, passwort: d.passwort }); setForm(null); z.neu(); } catch (x) { setFehler(x); } };
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const rolleUm = (r) => setForm({ ...form, rollen: form.rollen.includes(r) ? form.rollen.filter((x) => x !== r) : [...form.rollen, r] });
  return (
    <div className="stapel">
      <div className="kopf"><div><h1>Personen</h1><p>Schülerinnen, Schüler, Lehrpersonen und Schulleitung. Für viele auf einmal: Import.</p></div>
        <button className="knopf haupt-knopf" onClick={() => { setFehler(null); setForm({ vorname: "", nachname: "", email: "", kuerzel: "", extern_id: "", geburtsdatum: "", rollen: ["schueler"] }); }}>Neue Person</button></div>
      <div className="reihe">
        <input type="search" aria-label="Suchen" placeholder="Name, E-Mail oder Kürzel" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320 }} />
        <select aria-label="Rolle" value={rolle} onChange={(e) => setRolle(e.target.value)} style={{ maxWidth: 220 }}><option value="">Alle Rollen</option>{ROLLEN.map((r) => <option key={r} value={r}>{TEXTE.rollen[r]}</option>)}</select>
      </div>
      <Laden zustand={z}>{(liste) => liste.length === 0 ? <div className="leer">Niemand gefunden.</div> : (
        <div className="tabelle-huelle"><table>
          <thead><tr><th>Name</th><th>Rolle</th><th>Klasse</th><th>E-Mail</th><th></th></tr></thead>
          <tbody>{liste.map((p) => <tr key={p.id}>
            <td><b>{p.nachname}</b> {p.vorname}{p.kuerzel && <span className="leise"> ({p.kuerzel})</span>}</td>
            <td><div className="chips">{(p.rollen || []).map((r) => <span key={r} className={"chip" + (r === "lehrperson" ? " gruen" : r === "admin" ? " gelb" : "")}>{TEXTE.rollen[r]}</span>)}</div></td>
            <td>{p.klasse || ""}</td><td className="klein">{p.email || <span className="leise">keine</span>}</td>
            <td className="zahl"><button className="knopf klein-knopf" onClick={() => { setFehler(null); setForm({ ...p, email: p.email || "", kuerzel: p.kuerzel || "", extern_id: p.extern_id || "", geburtsdatum: p.geburtsdatum || "", rollen: p.rollen || [] }); }}>Bearbeiten</button></td>
          </tr>)}</tbody>
        </table></div>)}</Laden>
      <Dialog offen={!!form} titel={form && form.id ? "Person bearbeiten" : "Neue Person"} onZu={() => setForm(null)}>
        {form && <form className="formular" onSubmit={speichern}>
          {fehler && <div className="hinweis fehler" role="alert">{fehler.message}</div>}
          <div className="zwei"><label className="feld">Vorname<input value={form.vorname} onChange={set("vorname")} required maxLength={60} /></label><label className="feld">Nachname<input value={form.nachname} onChange={set("nachname")} required maxLength={60} /></label></div>
          <label className="feld">E-Mail<small>Für die Anmeldung mit Microsoft 365 oder edu-ID muss sie mit dem Konto übereinstimmen.</small><input type="email" value={form.email} onChange={set("email")} maxLength={200} /></label>
          <div className="zwei"><label className="feld">Kürzel<small>nur Lehrpersonen</small><input value={form.kuerzel} onChange={set("kuerzel")} maxLength={6} /></label><label className="feld">Nummer<small>aus der Schulverwaltung</small><input value={form.extern_id} onChange={set("extern_id")} maxLength={40} /></label></div>
          {form.rollen.includes("schueler") && <label className="feld">Geburtsdatum<small>Eltern sehen Noten und Absenzen bis zum 18. Geburtstag.</small><input type="date" value={form.geburtsdatum || ""} onChange={set("geburtsdatum")} /></label>}
          <fieldset className="feld" style={{ border: 0, padding: 0, margin: 0 }}><legend style={{ fontWeight: 700, marginBottom: 6 }}>Rollen</legend><div className="reihe">{ROLLEN.map((r) => <label key={r} className="check"><input type="checkbox" checked={form.rollen.includes(r)} onChange={() => rolleUm(r)} />{TEXTE.rollen[r]}</label>)}</div></fieldset>
          {form.id && (form.rollen.includes("eltern") || form.rollen.includes("schueler")) && <ElternVerknuepfung person={form} />}
          {form.id && <div className="karte" style={{ padding: 14, background: "var(--flaeche2)" }}>
            <div className="zwischen"><span className="klein">{form.lokales_konto ? "Hat ein eigenes Konto (Passwort)." : "Kein eigenes Konto. Anmeldung über Microsoft 365 oder edu-ID."}</span>
              <button type="button" className="knopf klein-knopf" onClick={konto}>{form.lokales_konto ? "Passwort zurücksetzen" : "Eigenes Konto anlegen"}</button></div>
          </div>}
          <div className="zwischen">{form.id ? <button type="button" className="knopf leise-knopf gefahr" onClick={austragen}>Austragen</button> : <span />}<div className="reihe"><button type="button" className="knopf leise-knopf" onClick={() => setForm(null)}>Abbrechen</button><button className="knopf haupt-knopf">Speichern</button></div></div>
        </form>}
      </Dialog>
      <Dialog offen={!!pw} titel="Einmal-Passwort" onZu={() => setPw(null)} fuss={<button className="knopf haupt-knopf" onClick={() => setPw(null)}>Fertig</button>}>
        {pw && <div className="stapel"><p>Geben Sie {pw.name} dieses Passwort persönlich weiter. Es wird nur jetzt angezeigt. Bei der ersten Anmeldung richtet {pw.name.split(" ")[0]} die Zwei-Faktor-Anmeldung ein und kann das Passwort unter «Mein Konto» ändern.</p>
          <p>Anmeldung mit: <b>{pw.email}</b></p><p className="code">{pw.passwort}</p></div>}
      </Dialog>
    </div>
  );
}
