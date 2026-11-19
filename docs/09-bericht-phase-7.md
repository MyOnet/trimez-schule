# Bericht Phase 7: Unterrichtsmodus und Chromebooks

Stand: 17. November 2026

## Was es jetzt gibt

**Lektion starten.** Im Unterricht gibt es neben Notenbuch, Material und Prüfungen den Reiter «Lektion». Die Lehrperson legt fest:
- welche Seiten erlaubt sind (z. B. Duden, GeoGebra)
- ob der Taschenrechner dabei ist
- ob die Lernumgebung verlangt wird

Die Einstellungen der letzten Lektion werden vorgeschlagen.

**Während der Lektion** sieht die Lehrperson für jede Person eine Kachel:
- dabei oder noch nicht da
- in der Lernumgebung (Windows oder Mac) oder im Browser
- «anderes Fenster», wenn die Lektionsseite nicht im Vordergrund ist
- «ohne Lernumgebung», wenn sie verlangt war
- Meldungen der App (z. B. ein verbotenes Programm wurde beendet)

Oben steht, wie viele dabei sind und womit.

**An alle senden.** Ein Material der Klasse (oder aus der eigenen Ablage) oder eine Seite im Internet erscheint sofort bei allen.
- Material, das noch nicht freigegeben ist, wird dabei für die Klasse freigegeben.
- Eine gesendete Seite wird zugleich erlaubt.
- Die Lehrperson sieht, wie viele es offen haben, und kann es zurücknehmen.

**Bildschirme anhalten.** Ein Klick, und bei allen steht bildschirmfüllend «Bitte nach vorne schauen». In der Lernumgebung schliesst sich dabei auch das Fenster mit den erlaubten Seiten.

**Für Schülerinnen und Schüler** erscheint auf der Übersicht «Lektion läuft». Die Lektionsseite zeigt:
- was die Lehrperson gerade schickt: Texte, PDF und Bilder direkt auf der Seite, andere Dateien zum Herunterladen
- die erlaubten Seiten und den Taschenrechner
- das Material der Klasse

**In der Lernumgebung** übernimmt die App die erlaubten Seiten der Lektion, alle paar Sekunden aktuell:
- Ändert die Lehrperson die Liste, gilt das gleich auch in der App.
- Nach dem Ende der Lektion ist nur noch trimez. offen.
- Verlangt die Lektion die Lernumgebung, lässt sich die App erst nach dem Ende der Lektion schliessen.

**Chromebooks:** Anleitung für die Schul-IT in `docs/anleitung-chromebooks.md`. Für ChromeOS gibt es keine Lernumgebung (siehe Grenzen). Verwaltete Chromebooks sperrt die Admin-Konsole von Google (Kiosk, Adressliste); private Chromebooks arbeiten im Browser.

## Wie geprüft

- **Server:** 8 neue Tests (insgesamt 172):
  - Rechte: nur die unterrichtende Lehrperson; nur Schüler/innen dieses Unterrichts
  - höchstens eine laufende Lektion pro Unterricht
  - Puls im Browser und in der nachgebildeten App
  - Meldungen nur von einer gültigen App
  - Anhalten und Seiten wirken auf die Konfiguration der App
  - Senden von Material (mit automatischer Freigabe) und Seiten; «gesehen»
  - Ende
- **App:** Für Windows und macOS fehlerfrei geprüft (`cargo check`, `clippy`). Die 7 Tests des Kerns laufen weiter. Wie schon in Phase 6 gilt: noch nicht auf echten Geräten gestartet.
- **Browser-Durchlauf** (`tests/e2e-phase7.mjs`): Lehrperson, Lea im Browser und Elias in der nachgebildeten App. Durchgespielt werden Start, Kacheln, Material und Seite senden, Anhalten, Handy-Breite und Ende. Die Durchläufe der Phasen 3, 5 und 6 laufen weiter fehlerfrei.

Bilder in `docs/bilder/phase-7/`.

## Unterwegs gefunden

- «Gesehen» kam bei der Lehrperson bis zu 7 Sekunden zu spät an. Jetzt bestätigt die Seite einen neuen Anstoss sofort.

## Was du tun musst

1. **Mit einer echten Klasse ausprobieren**, zuerst im Browser. Lohnt sich das Anhalten? Sind die Kacheln im Unterricht lesbar (Beamer, Tablet)?
2. **Lernumgebung auf echten Geräten** (offen seit Phase 6): Eine Lektion mit verlangter Lernumgebung auf einem Windows-Laptop und einem Mac durchspielen.
3. **Chromebooks:** Nur nötig, wenn eine Schule eigene, verwaltete Chromebooks hat. Dann die Anleitung mit deren IT durchgehen.

## Grenzen (ehrlich)

- **Im Browser lässt sich nichts durchsetzen.** Die Lehrperson sieht nur, ob die Lektionsseite im Vordergrund ist. Andere Tabs und Programme bleiben offen, auch beim Anhalten. Durchsetzen kann nur die Lernumgebung.
- **«Anderes Fenster»** beruht auf dem Fokus des Browsers. Ein zweiter Bildschirm oder ein Fenster daneben fällt nicht auf.
- **Bildschirme anhalten** wirkt nach höchstens 4 Sekunden, weil die Seite den Stand alle 4 Sekunden abfragt. Für sofortige Wirkung bräuchte es eine stehende Verbindung (WebSocket). Das ist ein möglicher Ausbau, wenn die Klassen gross werden.
- **Keine Bildschirmansicht** der Schülerinnen und Schüler: Die Lehrperson sieht nicht, was auf den Bildschirmen ist. Das ist so gewollt (Datenschutz, private Laptops).
- **ChromeOS:**
  - Es gibt keine Lernumgebung für ChromeOS, und trimez. kann nicht nachweisen, dass ein Chromebook im Kiosk läuft.
  - Prüfungen «Nur in der Lernumgebung» sind auf Chromebooks nicht möglich.
  - Die Anleitung beruht auf der Hilfe von Google. Sie ist nicht an einem verwalteten Chromebook getestet.
- **Vergessene Lektionen** enden nach 6 Stunden von selbst.
