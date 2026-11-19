# Bericht Phase 5: Prüfungen durchführen und korrigieren

Stand: 17. November 2026

## Ablauf

1. **Starten.** Im Editor einer bereiten Prüfung «Prüfung starten». Es erscheint ein Code mit 6 Zeichen (ohne verwechselbare Zeichen wie 0/O oder 1/I), auf Wunsch gross für den Beamer.
2. **Beginnen.** Schülerinnen und Schüler sehen auf ihrer Übersicht «Prüfung läuft» und geben den Code ein. Nur wer im Unterricht ist, kommt hinein.
3. **Schreiben.** Prüfungsmodus ohne Menü: Zeit oben (wird gelb in den letzten 5 Minuten), Aufgaben-Übersicht links (beantwortete dunkel), Prüfungsblatt rechts.
   - Jede Eingabe wird nach einem Moment gespeichert. Bricht das Netz ab, bleiben die Antworten auf dem Gerät und werden nachgesendet («Keine Verbindung …» oben).
   - Wechselt jemand das Fenster oder den Tab, sieht die Person einen Hinweis, und die Lehrperson sieht es in der Aufsicht.
   - Ohne «Zurückblättern» kommt eine Aufgabe nach der anderen.
4. **Abgeben.** Mit Übersicht der unbeantworteten Aufgaben. Danach eine Quittung mit Zeit und Prüfnummer (aus allen Antworten berechnet, SHA-256). Bei Zeitablauf wird automatisch abgegeben (eine Minute Kulanz für Netz und Uhr).
5. **Aufsicht.** Pro Person: schreibt, abgegeben, nicht begonnen; Fortschritt; zuletzt aktiv (rot nach 3 Minuten Stille); Warnungen. Zuschlag (z. B. Nachteilsausgleich), einziehen, wieder öffnen (falls versehentlich abgegeben), neuer Code, Prüfung beenden.
6. **Korrigieren.** Automatisch bewertet: Auswahl, Zahl, Lücken, Zuordnung, Reihenfolge, Kurzantworten mit bekannter Lösung. Offen bleiben Freitexte und abweichende Kurz- oder Lückenantworten.
   - «Nach Aufgabe»: alle Antworten zu einer Aufgabe untereinander, Lösung oder Erwartung oben, Punkte mit Schnellknöpfen (0, halb, voll) und Kommentar.
   - «Nach Person»: eine Prüfung nach der anderen.
   - Jede automatische Bewertung lässt sich übersteuern und wieder zurücksetzen.
7. **Notenbuch.** «Ins Notenbuch übernehmen» legt eine Bewertung (Prüfung, Punkte, Note nach dem Notenschlüssel) als Entwurf an; wer nicht geschrieben hat, steht als «abwesend» drin. Freigegeben wird wie gewohnt im Notenbuch.
8. **Zurückgeben.** Danach sehen Schülerinnen und Schüler ihre Prüfung mit Punkten pro Aufgabe, Lösungen, Kommentaren und Note.

## Sicherheit und Nachvollziehbarkeit

- Lösungen verlassen den Server nicht, solange geschrieben wird: Lücken ohne Antworten, Zuordnungen getrennt und gemischt, Reihenfolgen gemischt (fest pro Person).
- Jede Eingabe wird einzeln gespeichert (nur anhängen, die Datenbank verbietet Ändern und Löschen). Doppelt gesendete Eingaben werden erkannt.
- Laufende Prüfungen lassen sich nicht mehr ändern oder löschen.
- Start, Abgabe, Zuschlag, Einziehen, Wiederöffnen, Notenbuch und Rückgabe stehen im Protokoll.
- **Grenze:** Im normalen Browser lässt sich das Wechseln zu anderen Programmen nicht verhindern, nur melden. Das Sperren übernimmt die Lernumgebung in Phase 6.

## Korrigiert unterwegs

- **Anmeldung einer ganzen Klasse:** Die Begrenzung der Anmeldeversuche zählte pro Netzadresse. Eine Klasse hinter der gemeinsamen Adresse der Schule wäre nach 10 Anmeldungen pro Minute ausgesperrt worden. Jetzt zählt sie pro Adresse und Konto. Dazu gibt es einen Test.
- **Reihenfolge-Aufgaben:** Wer die angezeigte Reihenfolge nicht verändert, wird nach genau dieser Reihenfolge bewertet (nicht mit 0).

## Technik

- Migration `006_durchfuehrung.sql`: `versuch`, `versuch_ereignis` (nur anhängen), `versuch_warnung`, `korrektur`; Prüfung mit Status `laeuft`, `beendet`, `zurueckgegeben`, Code und Verknüpfung zum Notenbuch.
- Abgleich über regelmässige Abfragen (Aufsicht alle 4 Sekunden, Prüfungsmodus alle 20 Sekunden plus bei jedem Speichern). Für mehrere Server und grosse Schulen folgt WebSocket mit Redis (Architektur E5).
- Tests: 153 automatische Tests grün (neu 13 zur Durchführung und Korrektur, 2 zur Schülerfassung ohne Lösungen, 1 zur Anmeldung einer Klasse) und fünf Browser-Durchläufe; Phase 5 mit drei Schülerinnen und Schülern gleichzeitig, davon eine kurz offline und eine auf dem Handy.

## Offen

- Gesicherte Lernumgebung (Phase 6): Windows und macOS sperren, nur erlaubte Programme und Seiten, Echtheitsprüfung der App.
- Live-Verbindung über WebSocket statt Abfragen.
- Korrektur von Handschrift oder Zeichnungen (Fotos hochladen) und KI-Vorschläge für Freitexte.
