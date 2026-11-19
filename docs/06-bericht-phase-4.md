# Bericht Phase 4: Prüfungen erstellen

Stand: 17. November 2026

## Was jetzt geht

**Prüfungen** (Menü «Prüfungen», auch als Reiter in der Klassenansicht)
- Liste nach anstehend und vergangen, mit Datum, Klasse, Anzahl Aufgaben, Punkten und Status (Entwurf oder Bereit).
- Neue Prüfung leer oder aus einer Word-Datei (.docx) oder einem PDF.

**Editor**
- Links die Gliederung (Abschnitte und nummerierte Aufgaben mit Punkten), rechts alle Aufgaben untereinander. Speichert automatisch.
- Neun Typen: Abschnitt mit Text (z. B. Lesetext), Einfachauswahl, Mehrfachauswahl (mit oder ohne Teilpunkte), Kurzantwort (mehrere richtige Schreibweisen), Zahl (mit Toleranz und Einheit), Lückentext (`[[Antwort|Alternative]]`), Zuordnung, Reihenfolge, Freitext (mit Erwartung und Bewertungsraster für die Korrektur).
- Texte mit **fett**, *kursiv* und Formeln (`$\sqrt{2}$`), mit Vorschau direkt unter dem Feld.
- Unvollständige Aufgaben werden gespeichert und rot markiert. «Als bereit markieren» geht erst, wenn alles vollständig ist; eine spätere unvollständige Änderung setzt die Prüfung zurück auf Entwurf.
- Aufgaben verschieben, an beliebiger Stelle einfügen, löschen.
- Datum, Dauer, Notenschlüssel, Hinweise, erlaubte Hilfsmittel, Zurückblättern, Antworten mischen.
- Für eine andere Klasse kopieren (unabhängige Kopie, z. B. für die Parallelklasse).

**Aufgabenbank**
- Fertige Aufgaben mit einem Klick speichern und in anderen Prüfungen wieder einfügen. Suche in Frage und Antworten.
- Teilen wie beim Material: privat, Fachgruppe, ganze Schule. Die Prüfung behält immer ihre eigene Kopie.

**Vorschau als Prüfungsblatt**
- Genau wie die Klasse die Prüfung sieht: Kopf mit Fach, Datum, Dauer und Punkten, Name und Klasse, rechts der Rand mit Punkte-Kästchen pro Aufgabe.
- Probe lösen und auswerten: Punkte pro Aufgabe (grün, gelb, rot), Total und Note nach dem gewählten Notenschlüssel. Freitext und unbekannte Kurzantworten sind als «von Hand» markiert.
- Lösungen einblenden. Drucken als A4 hochformat (Beispiel: `bilder/phase-4/pruefung-beispiel.pdf`).

**Umwandlung aus Word oder PDF**
- Erkennt Titel, Abschnitte («Teil A»), nummerierte Aufgaben («1.», «Aufgabe 2:»), Punkte («(4 P.)», «(4 Punkte)»), Antwortmöglichkeiten («a)», «☐»), angekreuzte Lösungen («☒»), Lücken («_____») und Antwortlinien. Kopfzeilen wie «Name: ___» fallen weg.
- Bestätigen: Original links, erkannte Aufgaben rechts. Jede Aufgabe lässt sich ändern, im Typ umstellen, löschen oder ergänzen. Was noch fehlt (meist die Lösung), ist markiert.
- Optional mit KI (Claude), wenn sie auf dem Server eingerichtet ist und die Schule sie erlaubt. Fällt bei Problemen automatisch auf die Regeln zurück. An die KI geht nur der Text der Prüfung.

## Technik

- Migration `005_pruefungen.sql`: `aufgabe`, `pruefung`, `pruefung_teil`, `umwandlung`, alle mit Zeilen-Sicherheit.
- Aufgabentypen, Prüfung der Eingaben und automatische Bewertung in `packages/shared/src/pruefung.mjs`, gemeinsam für Server und Oberfläche. So bewertet die Korrektur in Phase 5 genau gleich wie die Vorschau.
- Rechte: `pruefung.verwalten` (nur eigener Unterricht; Schulleitung und Administration sehen fremde Prüfungen nicht), `aufgabe.lesen`, `aufgabe.bearbeiten`.
- Formeln mit KaTeX.
- Tests: 136 automatische Tests grün (neu: 11 zur Bewertung, 10 zu Prüfungen über die API, 6 zur Umwandlung inklusive nachgebildeter KI-Antwort), vier Browser-Durchläufe ohne Fehler.

## Offen und zu prüfen

- **KI-Umwandlung** ist gebaut und mit einer nachgebildeten Antwort getestet, aber noch nicht mit dem echten Dienst. Dafür braucht es einen API-Schlüssel und den Modellnamen in den Umgebungsvariablen.
- **Eingescannte PDF** und Bilder in Aufgaben: Texterkennung und Bilder in Prüfungen folgen. Bilder aus Word werden bei der Umwandlung noch nicht übernommen.
- **Ältere .doc-Dateien** zuerst in Word als .docx speichern.
- Die Erkennung nach Regeln ist auf übliche Schweizer Prüfungsblätter ausgelegt. Echte Prüfungen von Lehrpersonen wären der beste Test.

## Nächste Phase

Phase 5, Prüfungen durchführen und korrigieren im Browser: Start mit Code, Zeit und Zuschlag, laufendes Speichern, Abgabe mit Quittung, Aufsicht live, Korrektur mit automatischen Vorschlägen und Übernahme ins Notenbuch. Danach Phase 6: die gesicherte Lernumgebung für die Laptops.
