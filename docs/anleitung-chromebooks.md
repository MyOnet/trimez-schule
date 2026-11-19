# Chromebooks mit trimez. Schule

Stand: 17. November 2026

## Kurz

Für ChromeOS gibt es **keine trimez. Lernumgebung**. Sperren kann man nur Chromebooks, die die Schule verwaltet (in der Google Admin-Konsole registriert). Das macht dann ChromeOS selbst:
- Kiosk mit trimez. als einziger App
- Liste der erlaubten Adressen

Private Chromebooks lassen sich nicht sperren; dort läuft trimez. im normalen Browser.

| | Private Chromebooks (BYOD) | Schuleigene, verwaltete Chromebooks |
|---|---|---|
| Unterricht, Material, Noten | im Browser, ohne Einschränkung | im Browser, ohne Einschränkung |
| Lektion: nur erlaubte Seiten | nur angezeigt, nicht durchgesetzt | über die Adressliste der Admin-Konsole |
| Prüfung «Nur in der Lernumgebung» | nicht möglich | nicht möglich (der Server erkennt ChromeOS nicht als Lernumgebung) |
| Prüfung «im Browser» | möglich, Fensterwechsel werden nur gemeldet | möglich; im Kiosk ist kein Wechsel möglich |

## Warum keine App für ChromeOS

Die Lernumgebung braucht Rechte, die ChromeOS normalen Apps nicht gibt:
- Tastenkombinationen abfangen
- andere Programme beenden
- den Bildschirm vor Aufnahmen schützen

Linux-Apps laufen auf ChromeOS in einem abgeschotteten Bereich und können das System nicht sperren. Android-Apps können das ebenfalls nicht.

Die Sperre auf ChromeOS ist darum Sache der Verwaltung: Google stellt dafür den Kiosk-Modus und Adresslisten bereit.

## Einrichten (Schul-IT, verwaltete Chromebooks)

Voraussetzung: Die Chromebooks sind in der Google Admin-Konsole der Schule registriert (Chrome Education Upgrade).

Die Menüs der Admin-Konsole ändern sich gelegentlich. Die genauen Schritte stehen in der Hilfe von Google (Links unten).

1. **Prüfungs-Kiosk mit trimez.**
   - In der Admin-Konsole unter den Kiosk-Einstellungen für Chrome-Geräte eine Web-App per Adresse hinzufügen: `https://<ihre-schule>.trimez.ch/s/<kürzel>/`
   - Auf dem Anmeldebildschirm des Chromebooks erscheint dann die Kiosk-App. Wer sie startet, sieht nur trimez., ohne Browserleiste und ohne andere Apps.
   - Für Prüfungen mit Hilfsmitteln die erlaubten Seiten zusätzlich in die Adressliste des Kiosks aufnehmen (Schritt 2).
2. **Adressliste**
   - Für die Kiosk-Sitzung (oder eine eigene Organisationseinheit «Prüfung») alles sperren (`*` in der Sperrliste).
   - Erlaubt werden nur:
     - die Adresse von trimez.
     - die Anmeldung der Schule: `login.microsoftonline.com` für Microsoft 365 (dazu kommen die Adressen, die Microsoft für die Anmeldeseite angibt) und `login.eduid.ch` für edu-ID. Beim Test in Schritt 3 zeigt sich, ob etwas fehlt.
     - die Seiten, die in der Prüfung erlaubt sind (z. B. `www.duden.de`)
3. **Testen:** Mit einem Chromebook eine Testprüfung im Modus «im Browser» durchspielen:
   - Lässt sich ein anderes Fenster öffnen?
   - Lässt sich eine fremde Seite aufrufen?
   - Klappt die Anmeldung?

Für den **Unterricht** genügt meist Schritt 2 für die Organisationseinheit der Klasse. Die Lehrperson trägt dieselben Seiten in der Lektion als «erlaubt» ein, damit die Schülerinnen und Schüler sie in trimez. finden.

## Was trimez. dabei weiss und was nicht

- trimez. sieht, dass jemand im Browser ist. Es kann **nicht** prüfen, ob das Chromebook im Kiosk läuft. Die Lernumgebung für Windows und macOS weist das mit einer Unterschrift nach; auf ChromeOS fehlt so ein Nachweis.
- In der Aufsicht und in der Lektion erscheinen Chromebooks darum als «Browser». Die Lehrperson weiss, welche Klasse mit verwalteten Chromebooks arbeitet.
- Prüfungen mit «Nur in der Lernumgebung» weisen Chromebooks ab. Für Klassen mit verwalteten Chromebooks die Prüfung «im Browser» durchführen; gesperrt wird dann über den Kiosk.

Möglicher späterer Ausbau: Die Admin-Konsole kann dem Kiosk eine Kennung mitgeben. Der Server könnte damit verwaltete Chromebooks von privaten Geräten unterscheiden. Bevor das gebaut wird, braucht es eine Schule mit verwalteten Chromebooks zum Testen.

## Quellen (Hilfe von Google)

- [Add web apps to Chrome kiosks](https://support.google.com/chrome/a/answer/9781496)
- [Use Chromebooks for student assessments](https://support.google.com/chrome/a/answer/3273084)
- [Allow or block access to websites](https://support.google.com/chrome/a/answer/7532419)
- [URL blocklist filter format](https://support.google.com/chrome/a/answer/9942583)
