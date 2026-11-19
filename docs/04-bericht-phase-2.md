# Bericht Phase 2: Notenbuch und neues Design

Stand: 16. November 2026

## Was jetzt geht

**Notenbuch pro Fach und Klasse** (`/s/<schule>/unterricht/<id>/noten`)
- Tabelle wie in Excel: Namen links fest, Bewertungen als Spalten, Kopfzeile bleibt beim Scrollen stehen.
- Eingabe von Noten (z. B. 4.5) oder Punkten. Bei Punkten rechnet der gewählte Notenschlüssel die Note sofort aus und zeigt sie klein daneben.
- `a`, `n`, `d` für abwesend, nachholen, dispensiert. Diese zählen nicht im Schnitt.
- Enter und Pfeiltasten springen wie in Excel. Eine aus Excel kopierte Spalte lässt sich direkt einfügen.
- Speichert automatisch knapp eine Sekunde nach der letzten Eingabe; oben steht «Alles gespeichert» oder «Wird gespeichert …».
- Farben pro Notenstufe: ungenügend (unter 4), knapp (unter 4.5), gut, sehr gut. Ungültige Eingaben (z. B. 99 Punkte bei 36 möglichen) werden rot umrandet und nicht gespeichert.
- Spalten rechts: gewichteter Schnitt, Vorschlag aus den mündlichen Beobachtungen, Zeugnisvorschlag (auf halbe Noten gerundet) und die Zeugnisnote, die die Lehrperson selbst setzt.
- Unten: Klassenschnitt pro Bewertung.
- Bewertung anlegen, ändern, löschen; Art (Prüfung, Test, Vortrag …), Datum, Gewicht, optional Punkte mit Notenschlüssel.

**Entwurf und Freigabe**
- Neue Bewertungen sind Entwürfe. Schülerinnen und Schüler sehen sie erst nach «Freigeben».
- Wer eine freigegebene Note, ein Gewicht oder eine Punktzahl ändert oder eine freigegebene Bewertung löscht, muss einen Grund angeben. Alter Wert, neuer Wert und Grund stehen im Protokoll.
- Die Schulleitung kann Noten ändern, aber immer nur mit Grund. Wer ein Notenbuch einsieht, ohne das Fach zu unterrichten, wird protokolliert.

**Mündlich erfassen auf dem Handy** (`…/muendlich`)
- Pro Person fünf grosse Knöpfe: ++ + ○ − −−. Ein Tipp speichert, «Rückgängig» erscheint im Hinweis unten.
- Vorschlag: ++ = 6, + = 5, ○ = 4.5, − = 3.5, −− = 2.5, Durchschnitt auf Viertelnoten gerundet, erst ab drei Beobachtungen.
- «Als Note übernehmen» legt daraus eine mündliche Bewertung als Entwurf an, die die Lehrperson anpassen kann.
- Diese Umrechnung ist ein Vorschlag von uns, nicht kantonal vorgegeben. Schulen sollen sie später selbst einstellen können.

**Meine Noten** für Schülerinnen und Schüler: pro Fach eine Karte mit Schnitt und allen freigegebenen Noten (Punkte, Gewicht, Kommentar). Entwürfe bleiben unsichtbar, auch über die API.

**Drucken / PDF**: «Drucken» liefert ein sauberes A4-Querformat ohne Navigation (Beispiel: `bilder/phase-2/notenbuch-beispiel.pdf`).

**Übersicht für Lehrpersonen**: pro Klasse eine Karte mit Klassenschnitt, Verteilung der Notenstufen als Streifen und Hinweis auf offene Entwürfe.

## Neues Design «Tafel»

- Navigation als dunkelgrüne Wandtafel, aktiver Eintrag mit gelbem Kreidestrich.
- Titel in Bricolage Grotesque, Text weiterhin in Atkinson Hyperlegible Next (gut lesbar, auch für Menschen mit Sehschwäche).
- Anmeldung zweiteilig: Tafel links, Heftpapier mit Rand rechts.
- Notenstufen überall in denselben vier Farben, auch im Druck.
- Funktioniert ab 390 px Breite; das Notenbuch scrollt auf dem Handy seitlich, Namen bleiben stehen.

Bildschirmfotos: `docs/bilder/phase-2/`.

## Technik

- Migration `003_notenbuch.sql`: `bewertungsart`, `notenschluessel`, `bewertung`, `leistung`, `beobachtung`, `zeugnisnote`, alle mit Zeilen-Sicherheit pro Schule.
- Notenrechnung in `packages/shared/src/noten.mjs` (Server und Oberfläche rechnen identisch, in Hundertsteln, ohne Rundungsfehler).
- Rechte: `noten.lesen`, `noten.schreiben`, `noten.eigene`.
- Tests: 91 automatische Tests grün (u. a. 18 zur Notenrechnung, 11 zum Notenbuch über die API), dazu zwei Browser-Durchläufe ohne Fehler.

## Offen und zu prüfen

- **Promotionsregeln Gymnasium Kanton Zürich:** noch nicht eingebaut. Sie werden aus dem aktuellen Reglement übernommen und nicht aus dem Gedächtnis. Die Rundung der Zeugnisnote (halbe Noten) ist einstellbar.
- **Microsoft 365 und edu-ID** sind gebaut, aber noch nicht gegen die echten Dienste getestet (dafür braucht es die Registrierung der Schule).
- Notenschlüssel als Tabelle (Punkte-Bereiche) ist in der Datenbank vorbereitet, die Oberfläche zum Bearbeiten folgt.
- Eine Lehrperson aus der Praxis sollte das Notenbuch eine Woche testen.

## Nächste Phase

Phase 3, Material: Ordner pro Fach und Klasse, Hochladen, Teilen mit Klassen, Suche, Versionen, Anbindung an OneDrive/SharePoint der Schule.
