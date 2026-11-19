import { useLaden, Laden, zeitCH } from "../ui.jsx";
const NAMEN = { "anmeldung": "Anmeldung", "anmeldung.fehlgeschlagen": "Anmeldung fehlgeschlagen", "konto.zweiter_faktor_eingerichtet": "Zwei-Faktor eingerichtet", "konto.passwort_geaendert": "Passwort geändert",
  "person.erstellt": "Person erfasst", "person.geaendert": "Person geändert", "person.ausgetreten": "Person ausgetragen", "person.konto_zurueckgesetzt": "Konto zurückgesetzt",
  "klasse.erstellt": "Klasse angelegt", "klasse.geaendert": "Klasse geändert", "klasse.geloescht": "Klasse gelöscht", "klasse.schueler_hinzugefuegt": "Schüler/in hinzugefügt", "klasse.schueler_entfernt": "Schüler/in entfernt",
  "fach.erstellt": "Fach angelegt", "fach.geaendert": "Fach geändert", "fach.geloescht": "Fach gelöscht", "schuljahr.erstellt": "Schuljahr angelegt", "schuljahr.geaendert": "Schuljahr geändert",
  "unterricht.erstellt": "Fach in Klasse angelegt", "unterricht.lehrpersonen": "Lehrperson zugeteilt", "unterricht.geloescht": "Fach in Klasse entfernt", "import.ausgefuehrt": "Import" };
export default function Protokoll() {
  const z = useLaden("/api/protokoll");
  return (
    <div className="stapel">
      <div className="kopf"><div><h1>Protokoll</h1><p>Wer wann was geändert hat. Einträge lassen sich nicht ändern oder löschen.</p></div></div>
      <Laden zustand={z}>{(liste) => <div className="tabelle-huelle"><table>
        <thead><tr><th>Zeit</th><th>Person</th><th>Aktion</th></tr></thead>
        <tbody>{liste.map((x) => <tr key={x.id}><td className="klein">{zeitCH(x.zeit)}</td><td>{x.person || <span className="leise">unbekannt</span>}</td><td>{NAMEN[x.aktion] || x.aktion}</td></tr>)}</tbody>
      </table></div>}</Laden>
    </div>
  );
}
