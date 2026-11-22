-- Formulare: Quiz zur Selbstkontrolle (bewertet sich selbst), Umfragen (z. B. Kursrückmeldung) und Anmeldungen
-- (z. B. Elternabend mit Zeitfenstern und Plätzen). Ein Formular gilt für einen Unterricht oder ist über einen Link
-- auch ohne Anmeldung erreichbar (für Eltern).

CREATE TABLE formular (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  erstellt_von uuid REFERENCES person(id) ON DELETE SET NULL,
  unterricht_id uuid REFERENCES unterricht(id) ON DELETE CASCADE,
  art text NOT NULL CHECK (art IN ('quiz','umfrage','anmeldung')),
  titel text NOT NULL CHECK (length(titel) BETWEEN 1 AND 160),
  beschreibung text NOT NULL DEFAULT '' CHECK (length(beschreibung) <= 4000),
  fragen jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- { anonym, mehrfach (mehrmals ausfüllen), loesungen (nach dem Absenden zeigen), oeffentlich (Link ohne Anmeldung) }
  einstellungen jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'entwurf' CHECK (status IN ('entwurf','offen','geschlossen')),
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(12), 'hex'),
  schliesst_am timestamptz,
  erstellt_am timestamptz NOT NULL DEFAULT now(),
  geaendert_am timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX formular_unterricht ON formular (unterricht_id);

CREATE TABLE formular_antwort (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  formular_id uuid NOT NULL REFERENCES formular(id) ON DELETE CASCADE,
  person_id uuid REFERENCES person(id) ON DELETE SET NULL,       -- leer bei anonymen Umfragen und bei Antworten über den Link
  name text CHECK (length(name) <= 120),                         -- Antworten über den Link (z. B. Eltern)
  email citext,
  antworten jsonb NOT NULL DEFAULT '{}'::jsonb,
  punkte numeric(7,2),
  max_punkte numeric(7,2),
  erstellt_am timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX formular_antwort_formular ON formular_antwort (formular_id, erstellt_am);
-- Wer schon geantwortet hat (auch bei anonymen Umfragen: hier steht nur, dass, nicht was)
CREATE TABLE formular_teilnahme (
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  formular_id uuid NOT NULL REFERENCES formular(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  anzahl smallint NOT NULL DEFAULT 1,
  PRIMARY KEY (formular_id, person_id)
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['formular','formular_antwort','formular_teilnahme'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY mandant ON %I USING (schule_id = aktuelle_schule()) WITH CHECK (schule_id = aktuelle_schule())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO schule_app', t);
  END LOOP;
END $$;
CREATE TRIGGER formular_geaendert BEFORE UPDATE ON formular FOR EACH ROW EXECUTE FUNCTION geaendert();

-- Öffentlicher Link: Schule zum Token finden (vor jeder Anmeldung). Gibt nur offene, öffentliche Formulare preis.
CREATE OR REPLACE FUNCTION formular_oeffentlich(p_token text)
RETURNS TABLE (schule_id uuid, formular_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT schule_id, id FROM formular WHERE token = p_token AND (einstellungen->>'oeffentlich')::boolean IS TRUE $$;
REVOKE ALL ON FUNCTION formular_oeffentlich(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION formular_oeffentlich(text) TO schule_app;
