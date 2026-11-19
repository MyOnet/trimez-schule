-- Phase 6: Lernumgebung (App für gesperrte Prüfungen)
ALTER TABLE versuch ADD COLUMN geraet_id text, ADD COLUMN plattform text CHECK (plattform IS NULL OR plattform IN ('windows','macos')), ADD COLUMN app_version text;
ALTER TABLE versuch_warnung DROP CONSTRAINT versuch_warnung_art_check;
ALTER TABLE versuch_warnung ADD CONSTRAINT versuch_warnung_art_check CHECK (art IN (
  'fokus','vollbild','offline','neu_geladen','zeit',                      -- aus dem Browser
  'prozess','vm','debugger','aufnahme','bildschirm','sperre','geraet',    -- aus der Lernumgebung
  'ohne_lernumgebung'));                                                  -- vom Server erkannt
