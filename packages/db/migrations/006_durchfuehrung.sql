-- Phase 5: Prüfungen durchführen und korrigieren (im Browser; die gesicherte Lernumgebung folgt in Phase 6)

ALTER TABLE pruefung DROP CONSTRAINT pruefung_status_check;
ALTER TABLE pruefung ADD CONSTRAINT pruefung_status_check CHECK (status IN ('entwurf','bereit','laeuft','beendet','zurueckgegeben'));
ALTER TABLE pruefung
  ADD COLUMN startcode text,                         -- 6 Zeichen, nur während die Prüfung läuft
  ADD COLUMN gestartet_am timestamptz,
  ADD COLUMN beendet_am timestamptz,
  ADD COLUMN zurueckgegeben_am timestamptz,
  ADD COLUMN bewertung_id uuid REFERENCES bewertung(id) ON DELETE SET NULL;  -- Übernahme ins Notenbuch

CREATE TABLE versuch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  pruefung_id uuid NOT NULL REFERENCES pruefung(id) ON DELETE CASCADE,
  schueler_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'laeuft' CHECK (status IN ('laeuft','abgegeben')),
  modus text NOT NULL DEFAULT 'browser' CHECK (modus IN ('browser','gesperrt','eingeschraenkt')),
  gestartet_am timestamptz NOT NULL DEFAULT now(),
  abgegeben_am timestamptz,
  abgabe_art text CHECK (abgabe_art IN ('selbst','zeit','lehrperson')),
  zuschlag_min integer NOT NULL DEFAULT 0 CHECK (zuschlag_min BETWEEN 0 AND 600),
  position integer NOT NULL DEFAULT 0,               -- ohne Zurückblättern: erste Aufgabe, die noch offen ist
  antworten jsonb NOT NULL DEFAULT '{}'::jsonb,       -- aktueller Stand: teil_id → Antwort
  seq integer NOT NULL DEFAULT 0,                     -- letzte angenommene Ereignisnummer
  abgabe_hash text,
  letzte_aktivitaet timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pruefung_id, schueler_id)
);

-- Jede Eingabe einzeln, nur anhängen: so lässt sich nachvollziehen, was wann gespeichert wurde
CREATE TABLE versuch_ereignis (
  id bigserial PRIMARY KEY,
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  versuch_id uuid NOT NULL REFERENCES versuch(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  teil_id uuid,
  wert jsonb,
  zeit_geraet timestamptz,
  zeit_server timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX versuch_ereignis_versuch ON versuch_ereignis (versuch_id, seq);

CREATE TABLE versuch_warnung (
  id bigserial PRIMARY KEY,
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  versuch_id uuid NOT NULL REFERENCES versuch(id) ON DELETE CASCADE,
  art text NOT NULL CHECK (art IN ('fokus','vollbild','offline','neu_geladen','zeit')),
  detail text,
  zeit timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE korrektur (
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  versuch_id uuid NOT NULL REFERENCES versuch(id) ON DELETE CASCADE,
  teil_id uuid NOT NULL REFERENCES pruefung_teil(id) ON DELETE CASCADE,
  punkte numeric(6,2) CHECK (punkte IS NULL OR punkte >= 0),
  kommentar text NOT NULL DEFAULT '',
  von uuid REFERENCES person(id) ON DELETE SET NULL,
  geaendert_am timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (versuch_id, teil_id)
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['versuch','versuch_ereignis','versuch_warnung','korrektur'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY mandant ON %I USING (schule_id = aktuelle_schule()) WITH CHECK (schule_id = aktuelle_schule())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO schule_app', t);
  END LOOP;
END $$;
REVOKE UPDATE, DELETE ON versuch_ereignis FROM schule_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO schule_app;
