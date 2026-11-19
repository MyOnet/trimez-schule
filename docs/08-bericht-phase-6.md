# Bericht Phase 6: Lernumgebung

Stand: 17. November 2026

## Was es jetzt gibt

**Prüfungen nur in der Lernumgebung.** In den Einstellungen einer Prüfung wählt die Lehrperson «Nur in der Lernumgebung» und legt die erlaubten Hilfsmittel fest: den eingebauten Taschenrechner und Seiten wie Duden oder GeoGebra.
- Im normalen Browser kommt niemand hinein. Die Person sieht, wie es geht, und der Versuch erscheint in der Aufsicht.
- In der Aufsicht steht pro Person «Windows, gesperrt», «Mac, gesperrt» oder «Browser», dazu die Meldungen der App.
- «Gerät wechseln» erlaubt das Weiterschreiben auf einem anderen Laptop (z. B. wenn der Akku leer ist).

**Die App** (`apps/lernumgebung`, Rust und Tauri 2) für Windows 10/11 und macOS 12+:

| | Windows | macOS |
|---|---|---|
| Vollbild, immer im Vordergrund, ohne Rahmen | ja | ja |
| Wechseln sperren | Windows-Taste, Alt+Tab, Alt+Esc, Strg+Esc, Alt+F4, Druck | Cmd+Tab, Dock, Menüleiste, Sofort beenden, Abmelden (Kiosk-Modus von macOS) |
| Fenster verlassen (z. B. Strg+Alt+Entf) | wird zurückgeholt und gemeldet | durch Kiosk-Modus gesperrt |
| Bildschirmaufnahme | Fenster erscheint nicht in Aufnahmen | erst mit Apples Prüfungsschnittstelle |
| Fernsteuerung, Aufnahme- und Chat-Programme | werden beendet und gemeldet | werden beendet und gemeldet |
| Zweiter Bildschirm, Debugger, virtuelle Maschine | gemeldet | Bildschirm und VM gemeldet |
| Nur trimez. und erlaubte Seiten | ja | ja |
| Zwischenablage | wird zu Beginn und am Ende geleert | – |
| Beenden | erst nach der Abgabe | erst nach der Abgabe |

**Echtheitsnachweis.** Jede Anfrage der App ist mit dem Schlüssel ihrer Version unterschrieben (HMAC-SHA256 über Pfad, Zeit, Gerät, Sperre, Prüfwert der Konfiguration und Inhalt). Der Server prüft:
- die Unterschrift
- die Uhrzeit (±2 Minuten)
- Wiederholungen (dieselbe Anfrage zweimal wird abgewiesen)
- die Version (alte Versionen lassen sich mit `LERNUMGEBUNG_MIN_VERSION` abschalten)
- das Gerät
- ob die App die aktuelle Konfiguration der Prüfung durchsetzt

So arbeitet auch der «Browser Exam Key» von Safe Exam Browser.

**Taschenrechner** (wissenschaftlich, in der Prüfung eingebaut): rechnet ohne `eval`, mit Grad und Bogenmass, Winkelfunktionen, Logarithmen, Potenzen, Fakultät und «ans». Funktioniert auch bei Prüfungen im Browser.

**Seite «Lernumgebung»** für Schülerinnen und Schüler: Download, was die App tut und was nicht. Sie zeigt auch, ob die App erkannt wurde.

## Wie geprüft

- **Server:** 8 Tests mit einer nachgebildeten App. Abgewiesen werden falsche Unterschrift, falsche Uhrzeit, unbekannte Version, Wiederholung, fehlende Sperre, anderes Gerät und veraltete Konfiguration. Meldungen der App werden angenommen, solche aus dem Browser nicht.
- **App-Kern (Rust):** 7 Tests, darunter Unterschrift und Prüfwert mit denselben Vergleichswerten wie der Server, die Freigabeliste und die verbotenen Programme.
- **App für Windows und macOS:** Hier vollständig auf Fehler geprüft (`cargo check` und `clippy` für beide Ziele, auch mit Apples Prüfungsschnittstelle). **Gestartet wurde sie noch nicht**: Dafür braucht es einen Windows-PC und einen Mac.
- **Browser-Durchlauf:** Lea im Browser wird abgewiesen. Elias schreibt in der nachgebildeten App, rechnet mit dem Taschenrechner und öffnet Duden. Die Aufsicht zeigt «Windows, gesperrt».

## Unterwegs gefunden

- **Sicherheitslücke behoben:** Die Antwort von Fastify ist «thenable». Darum hat die Prüfung auf die Lernumgebung den Zugang zwar mit 403 abgelehnt, den Versuch aber trotzdem angelegt. Die Tests haben das aufgedeckt; jetzt ist es korrigiert.
- **Taschenrechner:** «constructor» wurde als Konstante erkannt (Prototyp von JavaScript-Objekten). Jetzt werden nur eigene Namen angenommen, dazu gibt es einen Test.

## Was du tun musst

1. **App bauen:** Den Code in ein (privates) GitHub-Repository legen und unter Settings → Secrets `LU_SERVER` und `LU_SCHLUESSEL` eintragen. Der Workflow `.github/workflows/lernumgebung.yml` baut dann Windows und macOS. Den gleichen Schlüssel auf dem Server als `LERNUMGEBUNG_SCHLUESSEL=1.0.0=<Schlüssel>` eintragen. Einen Schlüssel erzeugst du mit `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
2. **Code-Signatur:** Windows braucht ein Code-Signing-Zertifikat (sonst warnt SmartScreen), macOS ein Apple-Developer-Konto (99 USD pro Jahr) für Signatur und Beglaubigung.
3. **Apples Prüfungsschnittstelle beantragen:** Berechtigung `com.apple.developer.automatic-assessment-configuration` bei Apple anfragen (Formular für Assessment-Apps). Danach mit `--features aac` bauen und die Berechtigung in `macos/Entitlements.plist` eintragen.
4. **Testen:** Auf einem Windows-Laptop und einem Mac mit einer Testprüfung durchspielen. Das ist der wichtigste offene Schritt.
5. **Download-Links:** Nach dem Bauen `LERNUMGEBUNG_WINDOWS_URL` und `LERNUMGEBUNG_MACOS_URL` auf dem Server setzen; die Seite «Lernumgebung» zeigt sie an.

## Grenzen (ehrlich)

- Auf privaten Laptops lässt sich jede Sperre durch sehr versierte Personen umgehen, auch bei Safe Exam Browser. Der Schlüssel steckt in der App und kann mit Aufwand herausgelesen werden. Gegenmittel: Schlüssel pro Version, alte Versionen abschalten, Meldungen der App, Aufsicht im Raum.
- Strg+Alt+Entf lässt sich unter Windows von keiner normalen App sperren. Ein eigener Desktop (wie bei Safe Exam Browser) ist der nächste Ausbauschritt.
- Apples Prüfungsschnittstelle ist im Code vorbereitet, aber ohne Berechtigung und echten Mac ungetestet. Der Start der Sitzung braucht vermutlich noch einen Delegierten, der auf Apples Rückmeldung wartet.
- Die Meldung «virtuelle Maschine» beruht auf Hinweisen (Netzwerkkarte, macOS-Systemwert), nicht auf Beweisen.
- ChromeOS: siehe Phase 7 (`docs/09-bericht-phase-7.md`).
