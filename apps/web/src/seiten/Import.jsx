import { useState } from "react";
import { api } from "../api.js";
import { useLaden, useMeldung } from "../ui.jsx";
import { TEXTE } from "@schule/shared";

export default function Import() {
  const meld = useMeldung();
  const jahre = useLaden("/api/schuljahre");
  const [vorschau, setVorschau] = useState(null); const [fehler, setFehler] = useState(""); const [jahr, setJahr] = useState(""); const [busy, setBusy] = useState(false); const [fertig, setFertig] = useState(null);
  const datei = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    setFehler(""); setVorschau(null); setFertig(null); setBusy(true);
    try { setVorschau(await api("/api/import/vorschau", { methode: "POST", datei: f })); const a = (jahre.daten || []).find((j) => j.aktiv); if (a) setJahr(a.id); }
    catch (x) { setFehler(x.message); }
    setBusy(false); e.target.value = "";
  };
  const ausfuehren = async () => {
    setBusy(true);
    try { const d = await api("/api/import/ausfuehren", { methode: "POST", daten: { schuljahr_id: jahr, zeilen: vorschau.zeilen } }); setFertig(d); setVorschau(null); meld("Import abgeschlossen."); }
    catch (x) { setFehler(x.message); }
    setBusy(false);
  };
  return (
    <div className="stapel" style={{ gap: 24 }}>
      <div className="kopf"><div><h1>Import</h1><p>Klassenlisten aus der Schulverwaltung übernehmen (CSV oder Excel). Sie sehen zuerst eine Vorschau; geändert wird erst beim Bestätigen.</p></div></div>
      <section className="karte stapel">
        <h2>1. Datei wählen</h2>
        <p className="klein leise">Erste Zeile = Überschriften. Erkannt werden: Nachname, Vorname, E-Mail, Klasse, Rolle, Nummer, Kürzel. Ohne Spalte «Rolle» gelten alle als Schülerinnen und Schüler. Vorhandene Personen werden über Nummer oder E-Mail erkannt und aktualisiert, nicht doppelt angelegt.</p>
        <div><label className="knopf haupt-knopf">{busy ? "Wird gelesen …" : "Datei wählen"}<input type="file" accept=".csv,.txt,.xlsx" onChange={datei} className="sr" /></label></div>
        {fehler && <div className="hinweis fehler" role="alert">{fehler}</div>}
        {fertig && <div className="hinweis ok" role="status">Fertig: {fertig.neu} neu angelegt, {fertig.aktualisiert} aktualisiert, {fertig.neueKlassen} neue Klassen.</div>}
      </section>
      {vorschau && <section className="stapel">
        <h2>2. Vorschau prüfen</h2>
        <div className="reihe"><span className="chip gruen">{vorschau.zusammenfassung.neu} neu</span><span className="chip">{vorschau.zusammenfassung.aktualisieren} aktualisieren</span>{vorschau.zusammenfassung.fehler > 0 && <span className="chip gelb">{vorschau.zusammenfassung.fehler} mit Fehler (werden übersprungen)</span>}</div>
        {vorschau.klassen.length > 0 && <p className="klein">Klassen in der Datei: {vorschau.klassen.join(", ")}. Fehlende Klassen werden im gewählten Schuljahr angelegt.</p>}
        <div className="tabelle-huelle" style={{ maxHeight: 420 }}><table>
          <thead><tr><th>Zeile</th><th>Name</th><th>E-Mail</th><th>Klasse</th><th>Rolle</th><th>Nummer</th><th>Aktion</th></tr></thead>
          <tbody>{vorschau.zeilen.slice(0, 300).map((z) => <tr key={z.zeile}>
            <td className="leise">{z.zeile}</td><td>{z.nachname} {z.vorname}</td><td className="klein">{z.email}</td><td>{z.klasse}</td><td>{TEXTE.rollen[z.rolle]}</td><td className="klein">{z.nummer}</td>
            <td>{z.fehler ? <span className="chip gelb">{z.fehler}</span> : z.aktion === "neu" ? <span className="chip gruen">neu</span> : <span className="chip">aktualisieren</span>}</td>
          </tr>)}</tbody>
        </table></div>
        {vorschau.zeilen.length > 300 && <p className="leise klein">Die Vorschau zeigt die ersten 300 von {vorschau.zeilen.length} Zeilen; importiert werden alle.</p>}
        <div className="karte reihe" style={{ justifyContent: "space-between" }}>
          <label className="feld" style={{ minWidth: 220 }}>Schuljahr für die Klassen<select value={jahr} onChange={(e) => setJahr(e.target.value)} required><option value="">Bitte wählen</option>{(jahre.daten || []).map((j) => <option key={j.id} value={j.id}>{j.bezeichnung}{j.aktiv ? " (aktiv)" : ""}</option>)}</select></label>
          <div className="reihe"><button className="knopf leise-knopf" onClick={() => setVorschau(null)}>Abbrechen</button><button className="knopf haupt-knopf" disabled={!jahr || busy} onClick={ausfuehren}>{busy ? "Wird importiert …" : `${vorschau.zeilen.length - vorschau.zusammenfassung.fehler} Personen importieren`}</button></div>
        </div>
      </section>}
    </div>
  );
}
