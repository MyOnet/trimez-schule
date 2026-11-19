# RESCOOL

Schulplattform für Gymnasien: Notenbuch, Material, Prüfungen und die gesicherte Lernumgebung für die Laptops der Schülerinnen und Schüler.

**Stand: Phase 6 (Lernumgebung).** Die Phasen und Entscheidungen stehen in `docs/`.

## Aufbau

| Ordner | Inhalt |
|---|---|
| `apps/api` | Server (Fastify): Anmeldung, Rechte, Verwaltung, Import, Notenbuch, Material, Prüfungen |
| `apps/lernumgebung` | App für gesperrte Prüfungen (Rust, Tauri 2): `kern` (testbar überall) und `app` (Windows, macOS) |
| `apps/web` | Oberfläche (React + Vite), Deutsch |
| `packages/db` | Datenbank: Migrationen (SQL mit Zeilen-Sicherheit), Testdaten |
| `packages/shared` | Rechte, Eingabe-Regeln, Texte, gemeinsam für Server und Oberfläche |
| `tests` | Rechte-Matrix, Mandanten-Trennung, API, Browser-Durchlauf |
| `docs` | Architektur, Datenmodell, Phasenbericht |

## Lokal starten

Voraussetzungen: Node 22, pnpm, PostgreSQL 16.

```bash
# 1. Datenbank und Rollen (einmalig, als postgres)
psql -c "CREATE ROLE schule_owner LOGIN PASSWORD 'dev-owner' BYPASSRLS"
psql -c "CREATE ROLE schule_app LOGIN PASSWORD 'dev-app' NOBYPASSRLS"
psql -c "CREATE DATABASE schule OWNER schule_owner"

# 2. Pakete, Migrationen, Testschule
pnpm install
pnpm db:migrate
pnpm db:seed

# 3. Oberfläche bauen und Server starten
pnpm build
node apps/api/src/server.mjs        # http://localhost:5180/s/seeufer/anmelden
```

Für die Entwicklung der Oberfläche mit automatischem Neuladen: Server wie oben starten, dann `pnpm dev:web`. Die Oberfläche läuft auf http://localhost:5173.

**Testschule «seeufer»** (alle Namen erfunden): `admin@seeufer.test` (Administration und Schulleitung) oder `martin.keller@seeufer.test` (Lehrperson), Passwort `Seeufer-Test-2026!`. Beim ersten Anmelden muss die Zwei-Faktor-Anmeldung eingerichtet werden.

## Tests

```bash
pnpm test                    # 179 Tests: Rechte, Mandanten-Trennung, API, Prüfungen, Lernumgebung, Lektionen
# Für mehrere Durchläufe hintereinander den Server mit ANMELDE_LIMIT=1000 starten (sonst greift die Sperre gegen zu viele Anmeldungen)
node tests/e2e-phase1.mjs    # Browser-Durchlauf mit Bildschirmfotos (setzt die Testschule zurück)
node tests/e2e-phase2.mjs    # Notenbuch, mündlich, Meine Noten, Druck
node tests/e2e-phase3.mjs    # Material: Ablage, Suche, Hochladen, Freigabe, Schülersicht
node tests/e2e-phase4.mjs    # Prüfungen: Editor, Vorschau, Umwandlung aus Word, Formeln
node tests/e2e-phase5.mjs    # Durchführung: Code, drei Schüler/innen, offline, Aufsicht, Korrektur, Notenbuch
node tests/e2e-phase6.mjs    # Lernumgebung: Browser abgewiesen, nachgebildete App, Taschenrechner, erlaubte Seite
node tests/e2e-phase7.mjs    # Unterrichtsmodus: Lektion, Browser und App, an alle senden, anhalten
```

## Einstellungen (Umgebungsvariablen)

| Variable | Zweck |
|---|---|
| `DATABASE_URL` | Verbindung als `schule_app` (ohne Rechte zum Umgehen der Zeilen-Sicherheit) |
| `DATABASE_OWNER_URL` | Nur für Migrationen und Testdaten |
| `APP_SECRET` | 32 Byte, Base64; verschlüsselt die Zwei-Faktor-Schlüssel. In Produktion Pflicht |
| `COOKIE_SECRET` | Signiert das Cookie für die Anmeldung über Microsoft oder edu-ID |
| `PUBLIC_URL` | z. B. `https://schule.trimez.ch` (für die Rückleitung nach der Anmeldung) |
| `MS_CLIENT_ID`, `MS_CLIENT_SECRET` | App-Registrierung von RESCOOL in Microsoft Entra (mehrmandantenfähig); der Mandant jeder Schule steht in `schule.ms_tenant`. Umleitungsadressen (Plattform «Web»): `PUBLIC_URL/api/oidc/rueckruf` und `PUBLIC_URL/api/onenote/rueckruf`. Delegierte Berechtigungen: `openid`, `email`, `profile`, `offline_access`, `Notes.Read` (für den OneNote-Import). Die Informatik der Schule erteilt einmal die Administratorzustimmung. |
| `EDUID_CLIENT_ID`, `EDUID_CLIENT_SECRET`, `EDUID_ISSUER` | Zugang von trimez bei SWITCH edu-ID |
| `NODE_ENV=production` | Sichere Cookies, kein Entwicklungsschlüssel |

## Dateien (Material)

Hochgeladene Dateien liegen standardmässig verschlüsselt im Ordner `daten/dateien` (nicht im Git). Für den Betrieb bei Infomaniak wird der Objektspeicher verwendet:

| Variable | Bedeutung |
|---|---|
| `SPEICHER` | `lokal` (Standard) oder `s3` |
| `SPEICHER_ORDNER` | nur lokal: anderer Ordner als `daten/dateien` |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET` | Objektspeicher (Infomaniak: Endpunkt aus dem Kundenkonto) |
| `S3_ZUGRIFF`, `S3_GEHEIM` | Zugangsschlüssel des Objektspeichers (nur in den Umgebungsvariablen des Servers eintragen) |

## KI für die Umwandlung von Prüfungen (optional)

Ohne KI erkennt RESCOOL Aufgaben nach Regeln (Nummerierung, Punkte, Antwortmöglichkeiten). Mit KI werden auch unübliche Layouts erkannt. Dafür in den Umgebungsvariablen des Servers eintragen:

| Variable | Bedeutung |
|---|---|
| `ANTHROPIC_API_KEY` | Schlüssel für die Claude-API |
| `KI_MODELL` | Name des Modells, z. B. aus der Modellliste der Claude-API |

Eine Schule kann die KI abschalten (`einstellungen.ki = false`). An die KI geht nur der Text der Prüfung, keine Daten von Schülerinnen und Schülern.

## Lernumgebung (App für Prüfungen)

```bash
cd apps/lernumgebung
cargo test -p lernumgebung-kern                         # Kern: Signatur, Freigabeliste, Programme
cargo check --target x86_64-pc-windows-msvc             # Windows prüfen (ohne Windows)
CC_aarch64_apple_darwin=clang cargo check --target aarch64-apple-darwin   # macOS prüfen
```

Bauen und Signieren: `.github/workflows/lernumgebung.yml` (siehe `docs/08-bericht-phase-6.md`). Server-Variablen: `LERNUMGEBUNG_SCHLUESSEL` (`version=schlüssel;…`), `LERNUMGEBUNG_MIN_VERSION`, `LERNUMGEBUNG_WINDOWS_URL`, `LERNUMGEBUNG_MACOS_URL`. Ohne `NODE_ENV=production` gilt ein Entwicklungsschlüssel.

Die App setzt auch im **Unterrichtsmodus** die erlaubten Seiten durch: Sie übernimmt sie aus der laufenden Lektion (`GET /api/lektionen/:id`), genau wie bei Prüfungen. Chromebooks: siehe `docs/anleitung-chromebooks.md`.

## Testserver im Internet (Render, Gratis-Stufe)

Für Tests ohne eigenen Server-PC: `render.yaml` und `deploy/Dockerfile` bauen einen einzigen Container mit PostgreSQL und RESCOOL.

1. Code in ein (privates) GitHub-Repository stellen.
2. Auf render.com: *New → Blueprint*, das Repository wählen, *Apply*. Der erste Bau dauert einige Minuten.
3. Unter *Environment* steht `SEED_PASSWORT`: das Passwort aller Testkonten.
4. Adresse: `https://trimez-schule-test.onrender.com` (oder wie Render sie anzeigt). In der Lernumgebung (Testversion) beim ersten Start eingeben.

Grenzen der Gratis-Stufe: Nach 15 Minuten ohne Anfragen schläft der Dienst ein, das Aufwachen dauert bis zu einer Minute. **Bei jedem Neustart wird die Testschule neu angelegt**, Eingaben gehen dann verloren. Rechenzentrum in Frankfurt: nur Testdaten, keine echten Schülerdaten. Der Server läuft mit dem Entwicklungsschlüssel der Lernumgebung (passt zur Testversion der App).

## Kursnotizbuch

Jeder Unterricht hat ein Kursnotizbuch (Sheaf): Inhaltsbibliothek (Lehrperson schreibt, Klasse liest), Zusammenarbeit (alle schreiben), Bereich nur für Lehrpersonen und ein eigener Bereich für jede Schülerin und jeden Schüler (sichtbar für die Person und ihre Lehrpersonen, nicht für die Administration).

- **Erlauben oder sperren**: dauerhaft im Notizbuch (Schalter «Klasse darf öffnen»), pro Lektion (Unterrichtsmodus) und pro Prüfung (Hilfsmittel). Während einer Lektion ist nur das Notizbuch dieses Fachs offen; in einer Prüfung nur Bibliothek und eigener Bereich, ohne Zusammenarbeit. Der Server setzt das durch.
- **Seite verteilen**: Rechtsklick auf eine Seite der Bibliothek, «An alle Schüler/innen verteilen».
- **OneNote-Import**: «Importieren», dann «Alles aus OneNote importieren». Die Anmeldung läuft über das Microsoft-Konto der Schule (`Notes.Read`), danach kommen alle Notizbücher mit Abschnittsgruppen, Abschnitten, Seiten, Unterseiten, Tags, Bildern, Anhängen und Handschrift. Die Reihenfolge der Abschnitts-Tabs gibt Microsoft nicht heraus; RESCOOL ordnet nach Erstelldatum. Ohne Microsoft 365: Export aus OneNote als Word, .mht oder PDF und Datei-Import.
- Für Tests ohne Microsoft: `ONENOTE_TEST=1` (nie in Produktion) liefert Beispieldaten.
