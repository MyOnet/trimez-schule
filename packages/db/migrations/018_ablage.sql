-- Ablage: Laufwerke mit Ordnern und Dateien (die Dateien stehen in «datei», bezug_typ = 'laufwerk').
--   person      persönliches Laufwerk, nur für die Person selbst
--   unterricht  gemeinsamer Ordner eines Unterrichts: Lehrpersonen schreiben, die Klasse liest (oder schreibt, wenn erlaubt)
--   gruppe      eigene Gruppe (z. B. Fachschaft, Projektgruppe) mit Mitgliedern

CREATE TABLE laufwerk (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  art text NOT NULL CHECK (art IN ('person','unterricht','gruppe')),
  person_id uuid REFERENCES person(id) ON DELETE CASCADE,
  unterricht_id uuid REFERENCES unterricht(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  schueler_schreiben boolean NOT NULL DEFAULT false,
  erstellt_von uuid REFERENCES person(id) ON DELETE SET NULL,
  erstellt_am timestamptz NOT NULL DEFAULT now(),
  CHECK ((art = 'person') = (person_id IS NOT NULL)),
  CHECK ((art = 'unterricht') = (unterricht_id IS NOT NULL))
);
CREATE UNIQUE INDEX laufwerk_person ON laufwerk (person_id) WHERE art = 'person';
CREATE UNIQUE INDEX laufwerk_unterricht ON laufwerk (unterricht_id) WHERE art = 'unterricht';

CREATE TABLE laufwerk_mitglied (
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  laufwerk_id uuid NOT NULL REFERENCES laufwerk(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  verwalten boolean NOT NULL DEFAULT false,                     -- Mitglieder hinzufügen und entfernen
  PRIMARY KEY (laufwerk_id, person_id)
);

CREATE TABLE lw_ordner (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  laufwerk_id uuid NOT NULL REFERENCES laufwerk(id) ON DELETE CASCADE,
  eltern_id uuid REFERENCES lw_ordner(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  erstellt_von uuid REFERENCES person(id) ON DELETE SET NULL,
  erstellt_am timestamptz NOT NULL DEFAULT now(),
  geloescht_am timestamptz
);
CREATE INDEX lw_ordner_laufwerk ON lw_ordner (laufwerk_id, eltern_id);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['laufwerk','laufwerk_mitglied','lw_ordner'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY mandant ON %I USING (schule_id = aktuelle_schule()) WITH CHECK (schule_id = aktuelle_schule())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO schule_app', t);
  END LOOP;
END $$;
