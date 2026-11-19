import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api.js";
import { useIch } from "../App.jsx";
import { useLaden, Laden, useMeldung } from "../ui.jsx";

export default function UnterrichtSeite() {
  const ich = useIch(); const meld = useMeldung(); const { kurz } = useParams();
  const einsicht = ich.rollen.some((r) => r === "admin" || r === "schulleitung");
  const meins = (u) => u.lehrpersonen.some((l) => l.id === ich.person.id);
  const verwalten = ich.rechte["unterricht.verwalten"];
  const z = useLaden("/api/unterricht");
  const lps = useLaden(verwalten ? "/api/personen?rolle=lehrperson" : null);
  const [nurOffen, setNurOffen] = useState(false); const [q, setQ] = useState("");
  const setzen = async (u, pid) => { try { await api(`/api/unterricht/${u.id}/lehrpersonen`, { methode: "PUT", daten: { lehrpersonen: pid ? [pid] : [] } }); meld("Gespeichert."); z.neu(); } catch (x) { meld(x.message, true); } };
  const liste = useMemo(() => (z.daten || []).filter((u) => (!nurOffen || u.lehrpersonen.length === 0) && (!q || `${u.klasse} ${u.fach} ${u.lehrpersonen.map((l) => l.name + " " + (l.kuerzel || "")).join(" ")}`.toLowerCase().includes(q.toLowerCase()))), [z.daten, nurOffen, q]);
  return (
    <div className="stapel">
      <div className="kopf"><div><h1>Unterricht</h1><p>{verwalten ? "Welches Fach in welcher Klasse von wem unterrichtet wird." : "Ihr Unterricht im aktiven Schuljahr."}</p></div></div>
      <div className="reihe"><input type="search" aria-label="Filtern" placeholder="Klasse, Fach oder Lehrperson" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320 }} />
        {verwalten && <label className="check"><input type="checkbox" checked={nurOffen} onChange={(e) => setNurOffen(e.target.checked)} />Nur ohne Lehrperson</label>}</div>
      <Laden zustand={z}>{() => liste.length === 0 ? <div className="leer">{nurOffen ? "Überall ist eine Lehrperson zugeteilt." : "Kein Unterricht gefunden."}</div> : (
        <div className="tabelle-huelle"><table>
          <thead><tr><th>Klasse</th><th>Fach</th><th>Lehrperson</th><th><span className="sr">Notenbuch</span></th></tr></thead>
          <tbody>{liste.map((u) => <tr key={u.id}>
            <td><b>{u.klasse}</b>{u.gruppe && <span className="leise">, {u.gruppe}</span>}</td>
            <td><span className="reihe" style={{ gap: 10 }}><span className="punkt" style={{ background: u.farbe }} />{u.fach}</span></td>
            <td>{verwalten ? <select aria-label={`Lehrperson ${u.klasse} ${u.fach}`} value={u.lehrpersonen[0]?.id || ""} onChange={(e) => setzen(u, e.target.value)} style={{ maxWidth: 280 }}>
              <option value="">— noch offen —</option>{(lps.daten || []).map((p) => <option key={p.id} value={p.id}>{p.nachname} {p.vorname}{p.kuerzel ? ` (${p.kuerzel})` : ""}</option>)}</select>
              : u.lehrpersonen.map((l) => l.name).join(", ")}</td>
            <td className="zahl">{(meins(u) || einsicht) && <Link className="knopf klein-knopf" to={`/s/${kurz}/unterricht/${u.id}/noten`}>Notenbuch</Link>}</td>
          </tr>)}</tbody>
        </table></div>)}</Laden>
    </div>
  );
}
