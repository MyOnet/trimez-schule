-- Phase 3: Material
-- Lehrpersonen legen Material in ihrer Ablage ab (Ordner), teilen es mit der Fachgruppe oder der ganzen Schule
-- und geben es für ihren Unterricht frei. Schülerinnen und Schüler sehen nur, was für ihren Unterricht freigegeben ist.
-- Dateien liegen verschlüsselt im Speicher (lokal oder S3), hier stehen nur Schlüssel und Metadaten.

CREATE TABLE ordner (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  besitzer_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  eltern_id uuid REFERENCES ordner(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  erstellt_am timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ordner_besitzer ON ordner (besitzer_id);

CREATE TABLE material (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  besitzer_id uuid NOT NULL REFERENCES person(id) ON DELETE NO ACTION,   -- Personen werden deaktiviert, nicht gelöscht
  ordner_id uuid REFERENCES ordner(id) ON DELETE SET NULL,
  fach_id uuid REFERENCES fach(id) ON DELETE SET NULL,
  stufe smallint CHECK (stufe BETWEEN 1 AND 6),
  typ text NOT NULL CHECK (typ IN ('datei','link','text')),
  titel text NOT NULL CHECK (length(titel) BETWEEN 1 AND 160),
  beschreibung text NOT NULL DEFAULT '',
  url text CHECK (url IS NULL OR url ~ '^https?://'),
  inhalt text,                                      -- bei typ = text
  schlagworte text[] NOT NULL DEFAULT '{}',
  sichtbarkeit text NOT NULL DEFAULT 'privat' CHECK (sichtbarkeit IN ('privat','fachgruppe','schule')),
  lizenz text, quelle text,
  aktuelle_version_id uuid,
  such_text text NOT NULL DEFAULT '',               -- aus der Datei gezogener Text der aktuellen Version
  suche tsvector,
  erstellt_am timestamptz NOT NULL DEFAULT now(),
  geaendert_am timestamptz NOT NULL DEFAULT now(),
  geloescht_am timestamptz                           -- Papierkorb
);
CREATE INDEX material_suche ON material USING gin (suche);
CREATE INDEX material_besitzer ON material (besitzer_id);
CREATE INDEX material_titel ON material (lower(titel));

-- Suchindex: Titel zählt am meisten, dann Schlagworte, Beschreibung, Inhalt
CREATE FUNCTION material_suche_setzen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.suche :=
    setweight(to_tsvector('german', coalesce(NEW.titel, '')), 'A') ||
    setweight(to_tsvector('german', array_to_string(NEW.schlagworte, ' ')), 'B') ||
    setweight(to_tsvector('german', coalesce(NEW.beschreibung, '')), 'C') ||
    setweight(to_tsvector('german', left(coalesce(NEW.inhalt, '') || ' ' || coalesce(NEW.such_text, ''), 200000)), 'D');
  RETURN NEW;
END $$;
CREATE TRIGGER material_suche BEFORE INSERT OR UPDATE OF titel, schlagworte, beschreibung, inhalt, such_text ON material
  FOR EACH ROW EXECUTE FUNCTION material_suche_setzen();

CREATE TABLE material_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  material_id uuid NOT NULL REFERENCES material(id) ON DELETE CASCADE,
  nr integer NOT NULL,
  datei_key text NOT NULL,
  dateiname text NOT NULL,
  mime text NOT NULL,
  groesse bigint NOT NULL CHECK (groesse >= 0),
  sha256 text NOT NULL,
  seiten integer,
  text_auszug text NOT NULL DEFAULT '',
  hochgeladen_von uuid REFERENCES person(id) ON DELETE SET NULL,
  erstellt_am timestamptz NOT NULL DEFAULT now(),
  UNIQUE (material_id, nr)
);
ALTER TABLE material ADD CONSTRAINT material_aktuelle_version FOREIGN KEY (aktuelle_version_id) REFERENCES material_version(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

-- Freigabe für einen Unterricht, optional mit Zeitfenster (z. B. Lösungen erst nach der Prüfung)
CREATE TABLE freigabe (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  material_id uuid NOT NULL REFERENCES material(id) ON DELETE CASCADE,
  unterricht_id uuid NOT NULL REFERENCES unterricht(id) ON DELETE CASCADE,
  ab timestamptz NOT NULL DEFAULT now(),
  bis timestamptz CHECK (bis IS NULL OR bis > ab),
  hinweis text NOT NULL DEFAULT '',
  erstellt_von uuid REFERENCES person(id) ON DELETE SET NULL,
  erstellt_am timestamptz NOT NULL DEFAULT now(),
  UNIQUE (material_id, unterricht_id)
);
CREATE INDEX freigabe_unterricht ON freigabe (unterricht_id);

-- Wer hat freigegebenes Material schon geöffnet (für «12 von 20 geöffnet» und «Neu»)
CREATE TABLE material_abruf (
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  material_id uuid NOT NULL REFERENCES material(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  erstes_am timestamptz NOT NULL DEFAULT now(),
  letztes_am timestamptz NOT NULL DEFAULT now(),
  anzahl integer NOT NULL DEFAULT 1,
  PRIMARY KEY (material_id, person_id)
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['ordner','material','material_version','freigabe','material_abruf'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY mandant ON %I USING (schule_id = aktuelle_schule()) WITH CHECK (schule_id = aktuelle_schule())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO schule_app', t);
  END LOOP;
END $$;
