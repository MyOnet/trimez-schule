-- Aufträge: Die Lehrperson verteilt Arbeit mit Termin, Bewertungsraster und Punkten. Schülerinnen und Schüler geben
-- Text, Dateien oder eine Seite aus ihrem Notizbuch ab. Rückmeldung, Überarbeitung, Note ins Notenbuch.

CREATE TABLE auftrag (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  unterricht_id uuid NOT NULL REFERENCES unterricht(id) ON DELETE CASCADE,
  erstellt_von uuid REFERENCES person(id) ON DELETE SET NULL,
  titel text NOT NULL CHECK (length(titel) BETWEEN 1 AND 160),
  anleitung text NOT NULL DEFAULT '' CHECK (length(anleitung) <= 20000),
  faellig_am timestamptz,
  punkte_max numeric(7,2) CHECK (punkte_max IS NULL OR punkte_max > 0),
  raster jsonb NOT NULL DEFAULT '[]'::jsonb,                   -- [{ id, kriterium, beschreibung, punkte }]
  abgabe jsonb NOT NULL DEFAULT '{"text": true, "datei": true, "notizbuch": false}'::jsonb,
  spaet_erlaubt boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'entwurf' CHECK (status IN ('entwurf','veroeffentlicht','geschlossen')),
  veroeffentlicht_am timestamptz,
  notenschluessel_id uuid REFERENCES notenschluessel(id) ON DELETE SET NULL,
  bewertung_id uuid REFERENCES bewertung(id) ON DELETE SET NULL,          -- Notenbuch-Eintrag, sobald übertragen
  erstellt_am timestamptz NOT NULL DEFAULT now(),
  geaendert_am timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auftrag_unterricht ON auftrag (unterricht_id, faellig_am);

CREATE TABLE auftrag_abgabe (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  auftrag_id uuid NOT NULL REFERENCES auftrag(id) ON DELETE CASCADE,
  schueler_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  -- entwurf: angefangen, nicht abgegeben · abgegeben · ueberarbeiten: von der LP zurückgegeben zur Überarbeitung
  -- zurueckgegeben: bewertet und zurückgegeben (Rückmeldung sichtbar)
  status text NOT NULL DEFAULT 'entwurf' CHECK (status IN ('entwurf','abgegeben','ueberarbeiten','zurueckgegeben')),
  text text NOT NULL DEFAULT '' CHECK (length(text) <= 50000),
  notiz_seite_id uuid REFERENCES notiz_seite(id) ON DELETE SET NULL,
  version smallint NOT NULL DEFAULT 0,                         -- wie oft abgegeben
  abgegeben_am timestamptz,
  spaet boolean NOT NULL DEFAULT false,
  rueckmeldung text NOT NULL DEFAULT '' CHECK (length(rueckmeldung) <= 10000),
  raster_punkte jsonb NOT NULL DEFAULT '{}'::jsonb,            -- { kriterium_id: punkte }
  punkte numeric(7,2) CHECK (punkte IS NULL OR punkte >= 0),
  note numeric(4,2) CHECK (note IS NULL OR (note >= 1 AND note <= 6)),
  bewertet_von uuid REFERENCES person(id) ON DELETE SET NULL,
  zurueckgegeben_am timestamptz,
  erinnert_am timestamptz,
  geaendert_am timestamptz NOT NULL DEFAULT now(),
  UNIQUE (auftrag_id, schueler_id)
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['auftrag','auftrag_abgabe'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY mandant ON %I USING (schule_id = aktuelle_schule()) WITH CHECK (schule_id = aktuelle_schule())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO schule_app', t);
  END LOOP;
END $$;
CREATE TRIGGER auftrag_geaendert BEFORE UPDATE ON auftrag FOR EACH ROW EXECUTE FUNCTION geaendert();
