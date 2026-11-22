-- Klassenraum: ein Raum pro Unterricht mit Ankündigungen der Lehrperson, Fragen und Beiträgen der Klasse, Dateien.
-- Schulmitteilungen der Schulleitung an Lehrpersonen, Schülerinnen und Schüler und/oder Eltern.

ALTER TABLE unterricht ADD COLUMN raum_schueler_schreiben boolean NOT NULL DEFAULT true;

CREATE TABLE beitrag (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  unterricht_id uuid NOT NULL REFERENCES unterricht(id) ON DELETE CASCADE,
  autor_id uuid REFERENCES person(id) ON DELETE SET NULL,
  art text NOT NULL DEFAULT 'beitrag' CHECK (art IN ('ankuendigung','beitrag','frage')),
  eltern_id uuid REFERENCES beitrag(id) ON DELETE CASCADE,     -- Antwort auf einen Beitrag
  text text NOT NULL CHECK (length(text) BETWEEN 1 AND 8000),
  angeheftet boolean NOT NULL DEFAULT false,
  beantwortet boolean NOT NULL DEFAULT false,                   -- Fragen: von der Lehrperson als beantwortet markiert
  erstellt_am timestamptz NOT NULL DEFAULT now(),
  bearbeitet_am timestamptz,
  geloescht_am timestamptz,
  geloescht_von uuid REFERENCES person(id) ON DELETE SET NULL
);
CREATE INDEX beitrag_raum ON beitrag (unterricht_id, erstellt_am DESC) WHERE eltern_id IS NULL;
CREATE INDEX beitrag_antworten ON beitrag (eltern_id, erstellt_am);

CREATE TABLE raum_gelesen (
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  unterricht_id uuid NOT NULL REFERENCES unterricht(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  zuletzt timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (unterricht_id, person_id)
);

CREATE TABLE schulmitteilung (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  autor_id uuid REFERENCES person(id) ON DELETE SET NULL,
  titel text NOT NULL CHECK (length(titel) BETWEEN 1 AND 160),
  text text NOT NULL CHECK (length(text) BETWEEN 1 AND 10000),
  zielgruppe text[] NOT NULL CHECK (zielgruppe <@ ARRAY['lehrperson','schueler','eltern'] AND cardinality(zielgruppe) > 0),
  wichtig boolean NOT NULL DEFAULT false,
  ab timestamptz NOT NULL DEFAULT now(),
  bis timestamptz,
  erstellt_am timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE schulmitteilung_gelesen (
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  mitteilung_id uuid NOT NULL REFERENCES schulmitteilung(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  am timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mitteilung_id, person_id)
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['beitrag','raum_gelesen','schulmitteilung','schulmitteilung_gelesen'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY mandant ON %I USING (schule_id = aktuelle_schule()) WITH CHECK (schule_id = aktuelle_schule())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO schule_app', t);
  END LOOP;
END $$;
