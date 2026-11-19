// Die trimez. Lernumgebung: was sie tut, Download, ob sie gerade erkannt wird
import { useLaden, Laden, Marke } from "../ui.jsx";
import { useIch } from "../App.jsx";

const LU = typeof window !== "undefined" ? window.trimezLernumgebung : undefined;

export default function Lernumgebung() {
  const ich = useIch();
  const z = useLaden("/api/lernumgebung");
  const lehr = !!(ich.rechte && ich.rechte["pruefung.verwalten"]);
  return (
    <Laden zustand={z}>{(d) => (
      <div style={{ maxWidth: 900 }}>
        <div className="kopf"><div><h1>Lernumgebung</h1><p className="leise" style={{ marginTop: 6 }}>Die App, mit der Prüfungen auf dem eigenen Laptop gesperrt geschrieben werden.</p></div></div>

        {LU || d.erkannt ? <div className={"hinweis" + (d.erkannt && d.erkannt.gueltig && d.erkannt.gesperrt ? " ok" : "")} style={{ marginBottom: 20 }}>
          {d.erkannt && d.erkannt.gueltig ? <span><b>Sie verwenden die Lernumgebung {d.erkannt.version}</b> ({d.erkannt.plattform === "macos" ? "Mac" : "Windows"}). {d.erkannt.gesperrt ? `Gesperrt: ${d.erkannt.sperren.join(", ")}.` : "Die Sperre ist nicht aktiv. Bitte die App neu starten."}</span>
            : <span><b>Die Lernumgebung wurde nicht erkannt</b>{d.erkannt && d.erkannt.grund ? ` (${d.erkannt.grund})` : ""}. Bitte die aktuelle Version installieren.</span>}
        </div> : null}

        <div className="lu-raster">
          <section className="karte lu-download">
            <span className="wappen"><Marke /></span>
            <h2>Herunterladen</h2>
            <p className="leise">Einmal installieren, ohne Administratorrechte. Danach öffnen und mit dem Schulkonto anmelden.</p>
            <div className="stapel" style={{ gap: 10 }}>
              {d.download.windows ? <a className="knopf haupt-knopf" href={d.download.windows}>Für Windows 10 und 11</a> : <span className="knopf" aria-disabled="true">Windows: wird bereitgestellt</span>}
              {d.download.macos ? <a className="knopf haupt-knopf" href={d.download.macos}>Für macOS 12 und neuer</a> : <span className="knopf" aria-disabled="true">macOS: wird bereitgestellt</span>}
            </div>
          </section>
          <section className="karte">
            <h2>Was während einer Prüfung passiert</h2>
            <ul className="lu-liste">
              <li><b>Vollbild.</b> Wechseln mit Alt+Tab, der Windows-Taste oder Cmd+Tab ist gesperrt, Taskleiste und Dock sind weg. Wer das Fenster trotzdem verlässt (z. B. mit Strg+Alt+Entf), wird zurückgeholt, und die Lehrperson sieht es.</li>
              <li><b>Nur erlaubte Seiten.</b> trimez. und was die Lehrperson freigibt, z. B. Duden. Der eingebaute Taschenrechner, wenn erlaubt.</li>
              <li><b>Keine Aufnahme unter Windows.</b> Bildschirmfotos und Aufnahmen zeigen das Prüfungsfenster nicht. Auf dem Mac folgt das mit Apples Prüfungsschnittstelle.</li>
              <li><b>Fernsteuerung und Chat werden beendet.</b> Zum Beispiel TeamViewer, AnyDesk, Discord. Die Lehrperson sieht, dass etwas beendet wurde.</li>
              <li><b>Beenden erst nach der Abgabe.</b> Danach ist der Laptop wieder ganz normal.</li>
            </ul>
          </section>
          <section className="karte">
            <h2>Was die App nicht tut</h2>
            <ul className="lu-liste">
              <li>Sie liest keine Dateien, macht keine Fotos und keine Aufnahmen.</li>
              <li>Sie läuft nur, wenn sie geöffnet ist. Im Alltag ist sie nicht aktiv.</li>
              <li>An die Schule gehen nur die Antworten und Hinweise wie «Programm beendet» oder «zweiter Bildschirm».</li>
            </ul>
          </section>
          {lehr && <section className="karte">
            <h2>Für Lehrpersonen</h2>
            <ul className="lu-liste">
              <li>In den Einstellungen einer Prüfung «Nur in der Lernumgebung» wählen und erlaubte Hilfsmittel festlegen.</li>
              <li>Wer es im normalen Browser versucht, kommt nicht hinein und erscheint in der Aufsicht.</li>
              <li>Akku leer? In der Aufsicht «Gerät wechseln», dann auf einem anderen Laptop weiterschreiben.</li>
              <li><b>Grenze:</b> Auf privaten Laptops kann eine sehr versierte Person jede Sperre umgehen, auch bei Safe Exam Browser. Aufsicht im Raum bleibt nötig.</li>
            </ul>
          </section>}
        </div>
      </div>)}</Laden>);
}
