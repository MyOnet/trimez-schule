# trimez. Schule: Architektur-Entscheidungen

Stand: vor Phase 1, angepasst an die Antworten vom 16.11.2026. Jede Entscheidung mit Begründung und dem, was wir dafür aufgeben.

## Rahmen (festgelegt)

- Zielschulen: **Gymnasien im Kanton Zürich**
- Geräte: **private Laptops der Schülerinnen und Schüler (BYOD)**, keine Geräteverwaltung durch die Schule
- Anmeldung: **Microsoft 365** und **Switch edu-ID**
- KI: erlaubt (abschaltbar pro Schule)
- Hosting: **Infomaniak** (Schweiz)
- Testschule: noch keine

## Überblick

```
                 ┌──────────────── Schweiz (Infomaniak oder Exoscale) ────────────────┐
 Lehrperson ──►  │  web (React)  ──►  api (Fastify, REST + WebSocket)  ──►  PostgreSQL │
 Schüler    ──►  │                         │        │                       (RLS)      │
                 │                         │        └──► Redis (Echtzeit, Warteschlange)
 Lernumgebung ─► │                         └──► worker (Umwandlung, OCR, KI, PDF)       │
 (Tauri/Rust)    │                                     └──► S3-Speicher (Dateien)       │
                 │                         Meilisearch (Suche im Material)              │
                 └─────────────────────────────────────────────────────────────────────┘
```

## Entscheidungen

### E1 Monorepo mit pnpm und Turborepo
```
apps/web            Oberfläche Lehrpersonen, Schulleitung, Admin, Schüler (eine App, Rollen steuern die Ansicht)
apps/api            Server: REST, WebSocket, Rechteprüfung
apps/worker         Hintergrundaufgaben: Dateien umwandeln, OCR, KI-Vorschläge, PDF/Zeugnis
apps/lernumgebung   Desktop-Client (Tauri 2, Rust) inkl. Windows-Dienst
packages/db         Datenbankschema (Drizzle), Migrationen, Testdaten
packages/shared     Typen und Prüfregeln (zod), Notenberechnung, Texte (i18n de/fr/it)
packages/ui         gemeinsame Bausteine der Oberfläche
```
Warum: Ein Typ für «Prüfung» gilt in Server, Web und Lernumgebung gleich. Notenberechnung gibt es genau einmal (in `shared`), mit Tests.

### E2 Web: React + Vite als Single-Page-App, kein Next.js
Alles liegt hinter dem Login, Suchmaschinen spielen keine Rolle. Die gleiche Oberfläche läuft im Browser **und** in der Lernumgebung. Ohne Server-Rendering ist das einfacher und schneller.
Aufgegeben: Seiten, die ohne JavaScript funktionieren (hier nicht nötig).

### E3 Server: Fastify (TypeScript) mit eigenen Modulen
Module: `konto`, `schule`, `noten`, `material`, `pruefungen`, `geraete`, `protokoll`. Jedes Modul prüft Rechte selbst über eine zentrale Funktion `darf(benutzer, aktion, objekt)`.
Warum Fastify: schnell, gute WebSocket-Unterstützung, Schema-Prüfung eingebaut.

### E4 Daten: PostgreSQL 16 mit Zeilen-Sicherheit (RLS)
- Eine Datenbank für alle Schulen, jede Tabelle hat `schule_id`.
- Jede Anfrage läuft in einer Transaktion mit `SET LOCAL app.schule_id = …`. Die Datenbank selbst blockiert Zugriffe auf fremde Schulen, auch wenn im Code eine Prüfung vergessen geht.
- Zusätzlich prüft der Server Rollen und Klassen (Lehrperson nur eigene Klassen).
- Noten als `numeric`, nie als Gleitkommazahl.

Aufgegeben: getrennte Datenbank pro Schule. Das wäre einfacher zu erklären, aber schwerer zu betreiben. Später für grosse Kunden möglich.

### E5 Echtzeit über WebSocket + Redis
Ereignisse wie «Note freigegeben», «Freigabeliste geändert», «Prüfung gestartet» oder «Abgabe eingegangen» gehen über Redis an alle Server-Instanzen und dann an die Geräte. Die Lernumgebung hält eine Verbindung; bricht sie ab, holt sie beim Wiederverbinden alles seit der letzten Ereignisnummer nach.

### E6 Dateien in S3-kompatiblem Speicher in der Schweiz
Verschlüsselt, Zugriff nur über kurzlebige, signierte Links, die der Server nach der Rechteprüfung ausgibt. Vorschauen (PDF, Bilder) erzeugt der Worker.

### E7 Suche: Meilisearch
Volltext auch im Inhalt von PDF/Word (Text extrahiert der Worker). Pro Schule ein eigener Index, Filter nach Fach, Stufe, Freigabe. Der Server filtert die Treffer nochmals nach Rechten. Ziel: Treffer in unter 300 ms.

**Stand Phase 3:** Die Suche läuft vorerst über die Volltextsuche von PostgreSQL (deutsche Wortstämme, Präfixsuche, Treffer-Auszug). Das genügt für eine Schule mit einigen zehntausend Dokumenten, braucht keinen zusätzlichen Dienst und gilt automatisch mit der Zeilen-Sicherheit. Meilisearch kommt dazu, wenn Tippfehler-Toleranz oder deutlich mehr Daten nötig werden. Den Text zieht vorerst der Server beim Hochladen aus PDF, Word, PowerPoint, Excel und OpenDocument; Texterkennung für Scans folgt mit dem Worker.

### E8 Umwandlung von Prüfungen (Worker)
1. Word → PDF mit LibreOffice (ohne Oberfläche); PDF → Text und Layout mit pdf.js; Scans → Texterkennung mit Tesseract (Deutsch).
2. KI-Strukturvorschlag (Aufgaben, Typen, Punkte, Antwortfelder) als JSON nach festem Schema. Anbieter: einer, der nicht mit Kundendaten trainiert. Die Schule kann KI abschalten; dann bleibt der Fallback.
3. Fallback: Das Original-PDF bleibt sichtbar, Antwortfelder werden darübergelegt.
4. Die Lehrperson bestätigt immer in der Ansicht «Original links, digital rechts».

### E9 Prüfungsantworten: Ereignisprotokoll + Versiegelung
- Jede Änderung ist ein Ereignis (`versuch_ereignis`: Aufgabe, Wert, Zeit, Folgenummer). Der aktuelle Stand ist ein Schnappschuss daraus.
- Die Lernumgebung speichert die Ereignisse zuerst lokal in SQLite, verschlüsselt mit einem Schlüssel aus dem Schlüsselspeicher des Systems, und schickt sie alle 3 Sekunden.
- Bei der Abgabe wird über die geordneten Antworten ein SHA-256-Wert gebildet. Gerät und Server speichern ihn, der Schüler bekommt ihn auf der Quittung.

### E10 Lernumgebung: Tauri 2 (Rust) + nativer Dienst
- **Oberfläche:** dieselbe React-App in der eingebetteten Webansicht (WebView2 unter Windows, WKWebView unter macOS).
- **Eigener Browser:** eigene Fenster, keine Adressleiste, Navigation nur nach Freigabeliste (Prüfung vor jedem Seitenaufruf), keine Entwicklertools, keine Downloads ausser erlaubten.
- **Windows-Dienst (Rust, läuft als System):**
  - überwacht Prozesse und beendet nicht freigegebene
  - Netzfilter über die Windows Filtering Platform, damit die Freigabeliste auch für andere Programme gilt
  - schützt das Fenster vor Bildschirmaufnahmen (`SetWindowDisplayAffinity`)
  - erkennt virtuelle Maschinen, Fernsteuerung, zweiten Bildschirm und Debugger
- **Private Laptops (BYOD), darum Vorgehen wie Safe Exam Browser:** Die Schule verwaltet die Geräte nicht. Die Schülerin installiert die Lernumgebung einmal selbst, mit Admin-Rechten für den Dienst. Im Prüfungsmodus:
  - Die App öffnet einen **eigenen Windows-Desktop** (`CreateDesktop`/`SwitchDesktop`). Andere Fenster sind dort nicht erreichbar, Alt+Tab und Win-Taste wirken nicht.
  - Der Dienst beendet nicht erlaubte Prozesse (Liste wie bei SEB) und erkennt Fernsteuerung, virtuelle Maschinen und zweite Bildschirme.
  - Der Netzfilter lässt nur die Prüfung und die erlaubten Hilfsmittel durch.
  - **Ehrlich:** Wer Admin-Rechte über das eigene Gerät hat, kann eine lokale Sperre grundsätzlich manipulieren, z. B. mit einer veränderten App oder einer VM. Darum setzen wir zusätzlich auf
    1. Prüfung der Echtheit der App durch den Server: signierter Nachweis pro Sitzung, Versionsprüfung, Prüfwert über App-Dateien und Konfiguration wie der «Browser Exam Key» von SEB;
    2. Erkennen und Melden an die Aufsicht;
    3. Aufsicht im Raum.

    Das ist derselbe Stand wie SEB, den die Zürcher Gymnasien heute nutzen.
- **Verwaltete Geräte (später, falls eine Schule das will):** zusätzlich Zugewiesener Zugriff oder Shell Launcher über Intune. Strg+Alt+Entf lässt sich unter Windows nie abfangen, nur dessen Menü einschränken.
- **macOS und iPad:** Apples Prüfungsschnittstelle (Automatic Assessment Configuration). Sie funktioniert auch auf privaten Geräten ohne Geräteverwaltung und sperrt das System während der Prüfung (SEB für Mac nutzt sie auch). Dafür braucht trimez eine Freigabe von Apple; früh beantragen. Bei Gymnasien sind Macs häufig, darum ist macOS in Phase 6 gleich wichtig wie Windows (nicht erst Phase 7).
- **ChromeOS:** Kiosk-App über die Google-Admin-Konsole (Phase 7).
- **Echtheit:** Jedes Gerät erzeugt bei der Anmeldung ein Schlüsselpaar im TPM bzw. in der Secure Enclave. Der Server nimmt Prüfungsdaten nur mit gültiger Signatur dieses Schlüssels an.

Aufgegeben: Electron. Es wäre schneller gebaut, aber die Sperrfunktionen gehören in nativen, signierten Code, und Electron ist deutlich grösser.

### E11 Anmeldung
- OIDC für Microsoft 365 (Entra ID), mehrmandantenfähig: jede Schule verbindet ihren Microsoft-Mandanten einmal.
- Switch edu-ID über OIDC (Anmeldung bei SWITCH als Dienst nötig).
- Google Workspace später, falls eine Schule es braucht.
- Eigene Konten mit Argon2 und Zwei-Faktor (Pflicht für Lehrpersonen und Admins).
- Sitzungen serverseitig mit HttpOnly-Cookie.
- Geräte bekommen eigene Gerätezertifikate (E10). Schüler melden sich in der Lernumgebung per Schulkonto oder per QR-Code der Lehrperson an.

### E12 Betrieb
Container (Docker) bei **Infomaniak** (Public Cloud, Rechenzentren in Genf/Winterthur), Dateien im Infomaniak-Objektspeicher (S3-kompatibel), getrennte Umgebungen Staging und Produktion, verschlüsselte tägliche Backups an einen zweiten Schweizer Standort. Protokoll-Tabelle nur anhängend (kein UPDATE/DELETE, per Datenbank-Rechten erzwungen).

### E13 Tests
- Unit-Tests: Vitest für Notenberechnung, Rechte, Umwandlung.
- Rechte-Tests als Matrix (jede Rolle × jede Aktion).
- End-to-End-Tests: Playwright.
- Rust-Tests für Dienst und Client.
- Lasttest: 30 Klassen × 25 Schüler gleichzeitig in Prüfung.

## Grenzen (wird in Phase 6/7 ausgebaut)

| Gerät | Was die Lernumgebung verhindern kann | Was nicht |
|---|---|---|
| Windows, privat (Normalfall) | eigener Desktop während der Prüfung, Fensterwechsel, nicht erlaubte Programme, Bildschirmaufnahme, nicht freigegebene Websites; Erkennen von VM, Fernsteuerung, zweitem Bildschirm, veränderter App | Schutz gegen gezielte Manipulation durch jemanden mit Admin-Rechten und Fachwissen (nur erkennbar, nicht verhinderbar) |
| macOS, privat, mit Apple-Prüfungsmodus | System während der Prüfung gesperrt (von Apple durchgesetzt) | Zweitgerät |
| Windows, von der Schule verwaltet (optional) | zusätzlich Kioskmodus des Systems | Strg+Alt+Entf selbst (nur dessen Menü) |
| beliebiger Browser (Übungen) | nichts sperren, nur Fokusverlust melden | alles andere |

Kein System kann ein zweites Gerät im Raum verhindern. Dafür bleibt die Aufsicht zuständig.
