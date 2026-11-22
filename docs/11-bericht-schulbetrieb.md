# Bericht: Schulbetrieb

Acht Module, alle eigenständig in RESCOOL gebaut. Sie hängen nicht von Microsoft 365 ab. Alle Daten liegen in der eigenen Datenbank, die Dateien im eigenen Speicher (Schweiz). Die Benachrichtigungen erscheinen in der App unter «Mitteilungen». Mails verschickt RESCOOL nicht.

| Modul | Seiten | Kern |
|---|---|---|
| Aufträge | `/auftraege`, `/auftraege/:id` | Fälligkeit, Raster, Punkte. Abgabe als Text, Dateien oder Notizbuchseite. Rückmeldung oder «Zur Überarbeitung» (mit Versionen). Erinnern ist einmal pro Tag möglich. «Ins Notenbuch» legt die Noten als Entwurf an. |
| Klassenraum | `/raum`, `/raum/:uid` | Ankündigungen (gehen als Mitteilung an die Klasse), Fragen (gehen an die Lehrperson), Antworten, Dateien, Anheften. Die Lehrperson kann Beiträge der Schüler/innen sperren. |
| Schulmitteilungen | `/mitteilungen` | Die Schulleitung schreibt an Lehrpersonen, Schüler/innen und Eltern. Optional als «wichtig» markiert und zeitlich begrenzt, mit Lesezahl. Die Glocke im Menü zeigt die Zahl der ungelesenen Mitteilungen. |
| Formulare | `/formulare`, `/f/:token` | Quiz, das sich selbst bewertet (Aufgabentypen wie in den Prüfungen). Umfragen, auch anonym. Anmeldungen mit Zeitfenstern und Plätzen. Teilnahme mit Anmeldung oder über einen öffentlichen Link. CSV-Export ist gegen Formel-Einschleusung geschützt. |
| Kalender | `/kalender` | Persönlicher Stundenplan mit Ausfall, Raumwechsel, Vertretung und Zusatzlektion, dazu Termine, Ferien und Abgaben. Eine Prüfung über dem Limit wird blockiert (Standard: 2 pro Woche und 1 pro Tag pro Klasse); die Schulleitung kann eine Ausnahme mit Begründung bewilligen. Untis-Import (GPU001.TXT) mit Vorschau. Kalender-Abo als iCal-Link. |
| Absenzen | `/absenzen` | Erfassen pro Lektion. Entschuldigen und Gesuche online, mit Beleg. Die Klassenlehrperson entscheidet. Nach der Frist (Standard 14 Tage) gilt eine Absenz als unentschuldigt. Ab 3, 6 und 10 unentschuldigten Absenzen erhält die Klassenlehrperson eine Meldung. |
| Ablage | `/ablage` | Persönliches Laufwerk (2 GB), ein Laufwerk pro Unterricht (Lehrperson schreibt, Klasse liest, wahlweise auch schreibt) und Gruppenlaufwerke mit Mitgliedern. |
| Zeugnisse | `/zeugnisse` | Semesterzeugnis als PDF aus den Zeugnisnoten. Promotionsrechnung nach dem Reglement Gymnasien ZH (LS 413.251.1, §§ 9, 10, 13). Den Entscheid fällt die Schulleitung; eine Abweichung vom Vorschlag braucht eine Begründung. |
| Maturaarbeit | `/matura` | Betreuung und Korreferat, Meilensteine (die Schüler/in meldet «erledigt», die Betreuung bestätigt), Arbeitsjournal mit Stunden, Besprechungsnotizen, Dateien, Abgabe. Bewertung nach gewichteten Kriterien. |
| Eltern | Start, `/eltern` | Nur lesen: Noten, Absenzen (entschuldigen ist erlaubt), Kalender, Zeugnisse und Mitteilungen der Kinder unter 18. Volljährige Kinder sind nur sichtbar, wenn sie zustimmen. Die Administration verknüpft Eltern und Kinder unter «Personen». |

## Datenbank
Migrationen `012` bis `019`. Jede Tabelle hat RLS «mandant». Zwei Funktionen laufen mit SECURITY DEFINER und brauchen nur ein Token: `formular_oeffentlich` (öffentlicher Formular-Link) und `kalender_abo_finden` (iCal; das Token ist gehasht gespeichert).

## Regeln, die die Schule anpassen kann (`schule.einstellungen`)
- `lektionen`, `pruefungslimit { proWoche, proTag }`: über den Kalender in der Administration
- `absenzen { frist_tage, schwellen }`
- `ablage { person_mb, unterricht_mb, gruppe_mb }`
- `promotion { doppelteKompensation, maxUngenuegend, mindestschnitt }`

## Tests
- `tests/schulbetrieb.test.mjs`: 28 Abläufe über die API, mit Rechten.
- `tests/schulbetrieb-regeln.test.mjs`: Promotion, Prüfungslimit, Untis, Formulare, Rechte-Matrix.
- `tests/e2e-schulbetrieb.mjs`: alle Seiten im Browser, als Lehrperson, Schulleitung, Schülerin, Mutter (mobil) und Gast.

Testkonten (Passwort wie üblich): `daniela.ammann@eltern.seeufer.test` (Mutter von Lea Ammann).
