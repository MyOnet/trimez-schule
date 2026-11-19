# Bericht Phase 3: Material

Stand: 17. November 2026

## Was jetzt geht

**Ablage für Lehrpersonen** (Menü «Material»)
- Eigene Ordner, beliebig verschachtelt. Material lässt sich mit der Maus auf einen Ordner ziehen.
- Dateien einfach auf die Seite ziehen oder mit «Hochladen» wählen, auch mehrere auf einmal, mit Fortschritt.
- Erlaubt: PDF, Word, PowerPoint, Excel, OpenDocument, Text, Bilder, Audio, Video, ZIP, GeoGebra, EPUB, bis 50 MB. Programme, Webseiten und Dateien, deren Inhalt nicht zur Endung passt, werden abgelehnt.
- Ausser Dateien auch Links (z. B. OneDrive, SharePoint, YouTube, Moodle) und kurze Texte (z. B. Hausaufgaben).
- Fach, Stufe, Schlagworte und Beschreibung. Beim Hochladen wird das Fach vorgeschlagen, wenn die Lehrperson nur ein Fach hat.

**Finden**
- Ein Suchfeld für alles: Titel, Schlagworte und der Text im Dokument (PDF, Word, PowerPoint, Excel). Angefangene Wörter genügen, deutsche Wortformen werden erkannt.
- Treffer zeigen die Stelle im Dokument mit markiertem Suchwort.
- Filter nach Fach und Art. Taste «/» springt ins Suchfeld.

**Teilen im Kollegium**
- Pro Material: «Nur ich», «Fachgruppe» oder «Ganze Schule».
- Privates Material sieht niemand sonst, auch nicht die Administration.
- Geteiltes Material anderer lässt sich direkt für die eigenen Klassen freigeben, ohne Kopie.

**Freigabe für Klassen**
- Für einen oder mehrere eigene Kurse freigeben, sofort oder ab einem Zeitpunkt (z. B. Lösungen nach der Prüfung) und optional bis zu einem Zeitpunkt, mit Hinweis an die Klasse.
- Pro Freigabe sieht die Lehrperson, wie viele Schülerinnen und Schüler es geöffnet haben.
- Klassenansicht (Reiter «Material» neben «Notenbuch»): was die Klasse sieht, was geplant ist, was abgelaufen ist. Dateien, die man hier hineinzieht, landen in der Ablage und sind sofort für die Klasse sichtbar. «Aus der Ablage» sucht in eigenem und geteiltem Material.

**Versionen**
- Neue Version hochladen: Die Freigaben bleiben, die Klasse sieht sofort die neue Fassung. Ältere Versionen bleiben für die Lehrperson abrufbar und lassen sich wieder verwenden.

**Papierkorb**
- Gelöschtes verschwindet sofort bei den Klassen, lässt sich wiederherstellen oder endgültig löschen (dann wird auch die Datei entfernt).

**Für Schülerinnen und Schüler**
- Menü «Material»: alles Freigegebene nach Fach, Neues mit «Neu» markiert, Suche auch im Inhalt.
- Auf der Übersicht ein Hinweis bei neuem Material.
- PDF, Bilder und Videos öffnen im Browser, andere Dateien werden heruntergeladen, Texte öffnen in einem Fenster.

## Sicherheit

- Dateien liegen verschlüsselt (AES-256-GCM, eigener Schlüssel nur für Dateien). Im Betrieb bei Infomaniak im Objektspeicher; ausgeliefert wird dann über Links, die 5 Minuten gültig sind, und erst nach der Rechteprüfung.
- Wer Material nicht sehen darf, bekommt «nicht gefunden», nicht «verboten». So lässt sich nicht herausfinden, was es gibt.
- Ältere Versionen sehen nur Lehrpersonen. Direkt im Browser angezeigt werden nur PDF, Bilder, Audio, Video und reiner Text, nie Webseiten oder SVG.
- Teilen, Freigaben, neue Versionen und Löschen stehen im Protokoll.

## Technik

- Migration `004_material.sql`: `ordner`, `material`, `material_version`, `freigabe`, `material_abruf`, alle mit Zeilen-Sicherheit.
- Suche mit der Volltextsuche von PostgreSQL (siehe Architektur E7). Meilisearch kann später dazukommen.
- Rechte: `material.erstellen`, `material.lesen`, `material.bearbeiten`, `material.freigeben`.
- Tests: 109 automatische Tests grün (neu u. a. 13 Material-Tests über die API und ein Test, der prüft, dass jede Tabelle Zeilen-Sicherheit hat), dazu drei Browser-Durchläufe ohne Fehler.

## Offen und zu prüfen

- **Direkte Anbindung an OneDrive/SharePoint** (Dateien aus Microsoft 365 auswählen, ohne Link zu kopieren): braucht die Registrierung der App im Microsoft-Konto der Schule. Bis dahin funktionieren Links aus OneDrive als Material.
- **Texterkennung für eingescannte PDF** und Vorschaubilder für Word und PowerPoint folgen mit dem Hintergrunddienst (Worker).
- **Virenprüfung** der Uploads (ClamAV) gehört vor dem Echtbetrieb dazu.
- **Objektspeicher bei Infomaniak** ist eingebaut, aber noch nicht gegen das echte Konto getestet.
- Die Vorschau von PDF in der Seitenleiste nutzt den Betrachter des Browsers; im automatischen Test (ohne sichtbaren Browser) lässt sie sich nicht prüfen.

## Nächste Phase

Phase 4, Prüfungen erstellen: Aufgabentypen, Punkte, Prüfungen aus Word/PDF umwandeln, Vorschau wie die Schülerinnen und Schüler sie sehen.
