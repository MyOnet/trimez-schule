# Bericht: Härtung der Lernumgebung

Stand: 17. November 2026

## Grundsatz

Auf Laptops, die den Schülerinnen und Schülern gehören, lässt sich keine Prüfungs-Software unumgehbar machen. Das gilt auch für Safe Exam Browser. Wer Administratorrechte hat, kann jede Software verändern. Ein Handy unter dem Tisch oder ein HDMI-Aufnahmegerät sieht keine Software.

Ziel dieser Härtung ist darum zweierlei:
- Umgehen soll sehr aufwendig werden.
- Versuche sollen für die Aufsicht sichtbar werden.

Die Aufsicht im Raum bleibt nötig.

## Was neu ist

**Eigener Desktop unter Windows** (wie SEB)
- Die App startet auf einem neuen, leeren Desktop, ohne Taskleiste und ohne fremde Fenster.
- Ein Wächter schaltet zurück, falls die App nicht startet oder endet.
- Der Server lässt Prüfungen unter Windows nur zu, wenn der eigene Desktop wirklich aktiv ist (`LERNUMGEBUNG_WINDOWS_DESKTOP=aus` schaltet das für Notfälle ab).

**Virtuelle Maschinen** (Meldung an die Aufsicht)
- Hypervisor der CPU: VMware, VirtualBox, KVM/QEMU, Parallels, Xen und weitere. Ausgenommen ist «Microsoft Hv», weil Windows 11 selbst darüber läuft.
- Windows: Angaben des BIOS und Gast-Treiber (z. B. VBoxGuest.sys, vmhgfs.sys).
- Gast-Werkzeuge werden beendet und gemeldet (z. B. VBoxTray, vmtoolsd).
- Mac: zusätzlich das Modell («VirtualMac», VMware, Parallels).

**Echtheit der App**
- **Eigener Schlüssel pro Version**: `node scripts/lu-neue-version.mjs 1.1.0` erzeugt ihn und sagt, wohin er gehört. Mit `LERNUMGEBUNG_MIN_VERSION` weist der Server alte Versionen ab.
- **Schlüssel verdeckt**: Der Schlüssel steht nicht mehr im Klartext in der App, sondern wird beim Start zusammengesetzt. Eine einfache Suche in der Datei findet ihn nicht mehr (geprüft).
- **Selbstprüfung der Signatur**: Windows mit Authenticode, Mac mit `codesign`. Ist die App unverändert signiert, meldet sie das dem Server. Mit `LERNUMGEBUNG_SIGNATUR=pflicht` lässt der Server nur noch signierte Apps zu. Das erst einschalten, wenn die Versionen signiert sind.

**Fremder Code**
- Windows: Programmbibliotheken im eigenen Prozess, die weder zu Windows, zur App noch zu WebView2 gehören und nicht gültig signiert sind, werden als «fremder Code» gemeldet. Signierte (z. B. Virenschutz) gelten als harmlos.
- Mac: über `DYLD_INSERT_LIBRARIES` eingeschleuste Bibliotheken werden gemeldet.
- **Tastatur-Makros** werden beendet und gemeldet, zum Beispiel:
  - AutoHotkey
  - AutoIt
  - TinyTask
  - PhraseExpress
  - Beeftext
  - espanso
  - PowerToys Keyboard Manager
  - Keyboard Maestro
  - Karabiner
  - BetterTouchTool
  - TextExpander

  Fremde Tastaturfilter lassen sich unter Windows ohne Administratorrechte nicht direkt auflisten. Darum werden die bekannten Programme erkannt.
- **Remotedesktop-Sitzungen** und **Debugger von aussen** werden gemeldet.

**Auffälligkeiten** (Aufsicht, unten auf der Seite)

| Hinweis | Wann |
|---|---|
| Viel Text auf einmal | mindestens 200 Zeichen schneller als 15 Zeichen pro Sekunde (eingefügt oder vorbereitet) |
| Lange Pause | 10 Minuten oder mehr zwischen zwei Eingaben |
| Sehr früh abgegeben | vor einem Viertel der Zeit, mindestens 80 % beantwortet |
| Gerätewechsel | Zugriffe ohne Lernumgebung oder von einem anderen Gerät |
| Ähnliche Texte | mindestens die Hälfte gleicher Wortgruppen zwischen zwei Personen |
| Gleiche Fehler | mindestens 4 gleiche falsche Antworten, die 60 % ihrer Fehler ausmachen |

Bei der langen Pause zählt die Zeit vor der ersten und nach der letzten Eingabe nicht, denn da wird gelesen und durchgesehen. Gleiche richtige Antworten zählen bei den gleichen Fehlern nicht.

Die Seite sagt ausdrücklich: Hinweise, keine Beweise. Die Zeit des Geräts zählt nur, wenn sie zur Zeit des Servers passt.

## Wie geprüft

- 179 automatische Tests:
  - neu: Regeln der Auffälligkeiten mit und ohne Fehlalarm
  - neu: Signatur-Pflicht, Meldung «fremder Code», nur die Lehrperson sieht Auffälligkeiten
  - Kern der App: 10 Tests
- App für Windows und Mac fehlerfrei geprüft (`cargo check`, `clippy`), die Windows-App gebaut.
- Browser-Durchläufe der Phasen 5, 6 und 7 ohne Fehler.
- **Nicht geprüft**: auf echten Geräten und in echten virtuellen Maschinen. Das ist der nächste Schritt.

## Was es noch braucht

1. **Test auf deinem Windows-Laptop**:
   - Läuft der eigene Desktop?
   - Gibt es Fehlalarme («fremder Code», «virtuelle Maschine»)?
   - Zusätzlich in einer VirtualBox testen.
2. **Code-Signatur** (Windows und Mac), danach `LERNUMGEBUNG_SIGNATUR=pflicht`.
3. **Apples Prüfungsschnittstelle (AAC)** beantragen.
4. **Unabhängiger Sicherheitstest**, bevor Schulen damit wichtige Prüfungen schreiben.
