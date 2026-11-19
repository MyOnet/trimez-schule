-- Härtung der Lernumgebung: neue Meldung «fremder_code» (eingeschleuste, nicht signierte Programmbibliothek)
ALTER TABLE versuch_warnung DROP CONSTRAINT versuch_warnung_art_check;
ALTER TABLE versuch_warnung ADD CONSTRAINT versuch_warnung_art_check CHECK (art IN (
  'fokus','vollbild','offline','neu_geladen','zeit',                                    -- aus dem Browser
  'prozess','vm','debugger','aufnahme','bildschirm','sperre','geraet','fremder_code',   -- aus der Lernumgebung
  'ohne_lernumgebung'));                                                                -- vom Server erkannt
