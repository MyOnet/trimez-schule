# Bericht Phase 1: Grundlage

## Fertig

- **Datenbank** (PostgreSQL 16)
  - Schulen, Schuljahre mit Semestern, Personen, Rollen, Konten, Sitzungen, Fächer, Klassen, «Unterricht» (Klasse × Fach × Gruppe) mit Lehrpersonen, Fachgruppen, Protokoll.
  - **Zeilen-Sicherheit auf allen Tabellen:** Die App verbindet sich mit einer Rolle, die sie nicht umgehen kann. Ohne gesetzte Schule sieht sie nichts.
  - Das Protokoll kann die App nur ergänzen, nicht ändern oder löschen. Schulen kann sie nicht anlegen.
- **Anmeldung**
  - Eigenes Konto: Argon2-Passwort, Sperre nach 8 Fehlversuchen für 15 Minuten, gleiche Antwortzeit auch für unbekannte E-Mails.
  - **Zwei-Faktor-Pflicht** für Administration, Schulleitung und Lehrpersonen mit eigenem Konto. Der Schlüssel liegt verschlüsselt (AES-GCM) in der Datenbank.
  - Microsoft 365 (pro Schule ihr Mandant, Mandant wird geprüft) und edu-ID über OpenID Connect mit PKCE. Bei der ersten Anmeldung wird das Konto über die E-Mail mit der erfassten Person verknüpft.
  - Sitzungen serverseitig, Cookie HttpOnly, beim Passwortwechsel werden andere Geräte abgemeldet.
- **Rechte:** eine zentrale Funktion `darf()`, serverseitig vor jeder Aktion. Lehrpersonen sehen nur ihre Klassen. Schülerinnen und Schüler sehen nur die eigene Klasse und keine E-Mail-Adressen der anderen.
- **Verwaltung** (Oberfläche): Übersicht, Schuljahre, Fächer, Klassen mit Fächern, Lehrpersonen und Schülerliste, Personen mit Rollen, Einmal-Passwort, Unterricht-Zuteilung, Protokoll, Mein Konto.
- **Import** CSV/Excel mit Vorschau:
  - erkennt die Spalten selbst
  - aktualisiert vorhandene Personen über Nummer oder E-Mail statt sie doppelt anzulegen
  - legt fehlende Klassen an
  - überspringt fehlerhafte Zeilen und zeigt den Grund
- **Testschule** «Kantonsschule Seeufer» mit 3 Klassen (3a, 3b, 5c), 60 Schülerinnen und Schülern, 8 Lehrpersonen; alle Namen erfunden.
- **Tests:**
  - 61 automatische Tests: Rechte-Matrix, Mandanten-Trennung direkt in der Datenbank, API pro Rolle.
  - Browser-Durchlauf mit Bildschirmfotos (Desktop und Handy), ohne Fehler.

## Offen (bewusst später)

- Microsoft 365 und edu-ID sind gebaut, aber **nicht gegen die echten Dienste getestet**: Dafür braucht es eine App-Registrierung in Microsoft Entra und einen Zugang bei SWITCH edu-ID.
- Mehrere Schulen pro Person (z. B. Lehrperson an zwei Gymnasien): heute je Schule ein eigenes Konto.
- Schulverwaltungs-Schnittstelle: Der CSV/Excel-Import deckt das ab. Ein direkter Anschluss an eine bestimmte Software folgt, wenn klar ist, welche die Testschule nutzt.
- Eltern-Zugang, Löschfristen: Phase 8.

## Risiken

- **BYOD-Prüfungsmodus (Phase 6):** Auf privaten Laptops bleibt Manipulation durch versierte Nutzer möglich, wie bei SEB. Gegenmittel sind Erkennung, Echtheitsprüfung der App und die Aufsicht im Raum. Das muss den Schulen klar kommuniziert werden.
- **Apple-Freigabe** für den Prüfungsmodus auf Mac: jetzt beantragen, die Bearbeitung kann dauern.
- **Promotionsregeln Gymnasium ZH:** vor Phase 2 mit dem aktuellen Reglement abgleichen, nicht aus dem Gedächtnis übernehmen.
- **Ohne Testschule** fehlen echte Rückmeldungen. Eine Lehrperson, die mitmacht, wäre ab Phase 2 sehr wertvoll.

## Nächste Phase

Phase 2, Notenbuch:
- Bewertungen mit Gewichtung und Notenschlüssel
- Eingabe wie in Excel
- mündliche Beobachtungen auf dem Handy
- Durchschnitte, Freigabe an Schülerinnen und Schüler
- Protokoll jeder Änderung
- PDF-Export
