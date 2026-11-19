# trimez. Schule: Datenmodell (Entwurf)

Alle Tabellen haben `id` (UUID v7), `schule_id`, `erstellt_am` und `geaendert_am`, sofern nicht anders vermerkt. Zeilen-Sicherheit (RLS) über `schule_id` in jeder Tabelle.

## Organisation

```
schule            name, kanton, stufe[], einstellungen(json: rundung, gewichtungen, promotionsregeln, ki_an, aufbewahrung)
schuljahr         schule_id, bezeichnung («2026/27»), von, bis
semester          schuljahr_id, nr (1|2), von, bis, zeugnis_stichtag
person            vorname, nachname, geburtsjahr?, email?, extern_id (Import), status (aktiv|ausgetreten)
konto             person_id, anmeldung (ms|google|eduid|lokal), subjekt, passwort_hash?, totp?, letzte_anmeldung
rolle             person_id, art (admin|schulleitung|lehrperson|schueler|eltern), gueltig_von, gueltig_bis
klasse            schuljahr_id, name («2a»), stufe, klassenlehrperson_id
klasse_schueler   klasse_id, person_id, von, bis
fach              name («Mathematik»), kuerzel, farbe
unterricht        klasse_id, fach_id, semester_id, gruppe? (Halbklasse, Niveau)   ← «Kurs»
unterricht_lp     unterricht_id, person_id, art (haupt|stellvertretung), von, bis
unterricht_schueler  unterricht_id, person_id   (nur wenn nicht ganze Klasse, z. B. Niveaugruppen)
fachgruppe        fach_id, name; fachgruppe_mitglied(person_id)
```

`unterricht` ist der zentrale Anker: Noten, Prüfungen, Freigaben und Material hängen daran. So funktionieren Halbklassen, Niveaugruppen und Stellvertretungen ohne Sonderfälle.

## Notenbuch

```
bewertungsart     schule_id, fach_id?, name («Prüfung», «Mündlich»), kategorie (schriftlich|muendlich), gewicht_standard
notenschluessel   name, art (linear|tabelle|formel), parameter(json), besitzer_id?, geteilt (privat|fachgruppe|schule)
bewertung         unterricht_id, bewertungsart_id, titel, datum, gewicht, max_punkte?, notenschluessel_id?,
                  pruefung_id?, status (entwurf|freigegeben), freigegeben_am, freigegeben_von
leistung          bewertung_id, schueler_id, punkte?, note? numeric(4,2), kennzeichen? (abwesend|nachholen|dispensiert),
                  kommentar?, geaendert_von
beobachtung       unterricht_id, schueler_id, datum, wert (1–6 oder --/-/+/++), text      ← mündliche Notizen
zeugnisnote       unterricht_id, schueler_id, semester_id, vorschlag numeric, gesetzt numeric?, begruendung?, status
```

Regeln (in `packages/shared`, mit Tests):
- Note aus Punkten über den Notenschlüssel, dann Rundung nach Schuleinstellung.
- Fachschnitt = gewichteter Schnitt über die freigegebenen Leistungen ohne Kennzeichen.
- Zeugnisnote = Vorschlag aus dem Fachschnitt; gesetzt wird sie durch die Lehrperson.
- Promotionsprüfung: einstellbare Regeln, z. B. «höchstens 2 ungenügende Noten, Summe der Abweichungen ≥ x».

## Material

Umgesetzt in Phase 3 (`004_material.sql`):

```
ordner            besitzer_id, eltern_id?, name                         (persönliche Ablage)
material          besitzer_id, ordner_id?, fach_id?, stufe?, typ (datei|link|text), titel, beschreibung, url?, inhalt?,
                  schlagworte[], sichtbarkeit (privat|fachgruppe|schule), lizenz?, quelle?, aktuelle_version_id,
                  such_text, suche (tsvector, Deutsch), geloescht_am (Papierkorb)
material_version  material_id, nr, datei_key, dateiname, mime, groesse, sha256, seiten, text_auszug, hochgeladen_von
freigabe          material_id, unterricht_id, ab, bis?, hinweis           (eine pro Material und Unterricht)
material_abruf    material_id, person_id, erstes_am, letztes_am, anzahl  («12 von 20 geöffnet», «Neu»)
```

## Prüfungen

Umgesetzt in Phase 4 (`005_pruefungen.sql`), Durchführung folgt:

```
aufgabe           besitzer_id, fach_id?, typ, inhalt(json), loesung(json), punkte, schlagworte[], geteilt (privat|fachgruppe|schule)
pruefung          unterricht_id, erstellt_von, titel, datum?, dauer_min?, status (entwurf|bereit),
                  einstellungen(json: hinweise, hilfsmittel, rueckwaerts, mischen), notenschluessel_id?, quelle (editor|umwandlung)
pruefung_teil     pruefung_id, nr, typ, inhalt(json), loesung(json), punkte, aufgabe_id? (Herkunft; der Teil ist eine Kopie)
umwandlung        pruefung_id, dateiname, mime, datei_key, original_html?, vorschlag(json), verfahren (regeln|ki), status
```

Typen: abschnitt, einfach, mehrfach, kurz, zahl, luecken, zuordnung, reihenfolge, freitext (Bewertung in `packages/shared/src/pruefung.mjs`).

Durchführung (Phase 5, `006_durchfuehrung.sql`):

```
pruefung          + startcode, gestartet_am, beendet_am, zurueckgegeben_am, bewertung_id (Notenbuch);
                  status (entwurf|bereit|laeuft|beendet|zurueckgegeben)
versuch           pruefung_id, schueler_id, status (laeuft|abgegeben), modus (browser|gesperrt|eingeschraenkt), gestartet_am,
                  abgegeben_am, abgabe_art (selbst|zeit|lehrperson), zuschlag_min, position, antworten(json), seq, abgabe_hash
versuch_ereignis  versuch_id, seq, teil_id, wert(json), zeit_geraet, zeit_server        ← nur anhängen
versuch_warnung   versuch_id, art (fokus|vollbild|offline|neu_geladen|zeit), detail, zeit
korrektur         versuch_id, teil_id, punkte?, kommentar, von        (punkte leer = automatische Bewertung gilt)
```

## Lernumgebung und Geräte

```
geraet            name, plattform (windows|macos|ipados|chromeos), verwaltet (bool), version, oeffentlicher_schluessel,
                  letzter_kontakt, status
freigabeliste     besitzer_id, name, eintraege(json: domains, pfade, programme), geteilt
lektion           unterricht_id, gestartet_von, gestartet_am, beendet_am?, lernumgebung (verlangt), rechner,
                  seiten(json: url, titel), angehalten, anstoss(json: nr, art material|seite, …)?, anstoss_nr
                  ← höchstens eine laufende pro Unterricht; endet nach 6 Stunden von selbst
lektion_teilnahme lektion_id, schueler_id, erste/letzte_aktivitaet, modus (browser|gesperrt), plattform, app_version,
                  sichtbar, gesehen_nr, warnungen, warnung_art
notfallcode       geraet_id, code_hash, erstellt_von, verwendet_am?
```

## Querschnitt

```
protokoll         zeit, person_id, aktion, objekt_typ, objekt_id, vorher(json)?, nachher(json)?, grund?, ip_hash
                  ← nur anhängen (keine UPDATE/DELETE-Rechte), Zugriffe auf Noten werden auch protokolliert
ereignis          seq (pro Schule fortlaufend), typ, ziel (unterricht|person|geraet), daten(json)  ← für Echtzeit-Nachholen
aufbewahrung      objekt_typ, frist_monate, aktion (loeschen|anonymisieren)                          ← je Kanton einstellbar
```

## Gymnasium Kanton Zürich (Vorgaben für Testdaten und Standardregeln)

- Stufen: 1. bis 6. Klasse Langgymnasium bzw. 3. bis 6. Kurzgymnasium; Profile (z. B. altsprachlich, neusprachlich, mathematisch-naturwissenschaftlich, wirtschaftlich-rechtlich, musisch).
- Noten 1 bis 6, Zeugnisnoten in halben Noten.
- Die genauen Promotionsregeln aus dem Reglement der Mittelschulen des Kantons Zürich **übernehmen wir nicht aus dem Gedächtnis**. Sie werden als einstellbare Regeln gebaut und vor Phase 2 mit dem aktuellen Reglement abgeglichen.
- Anmeldung: Microsoft 365 der Schule (häufig) und edu-ID.

## Entscheide vom 16.11.2026

Gymnasien ZH · private Laptops (BYOD) · Microsoft 365 + edu-ID · KI erlaubt · Infomaniak · noch keine Testschule.
