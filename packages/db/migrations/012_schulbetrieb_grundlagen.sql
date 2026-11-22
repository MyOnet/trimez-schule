-- Schulbetrieb: Grundlagen für Aufträge, Klassenraum, Formulare, Kalender, Absenzen, Ablage, Zeugnisse und Elternzugang
--   * Geburtsdatum (Elternzugang nur bis 18, danach nur mit Freigabe der volljährigen Person)
--   * Eltern ↔ Kind
--   * Mitteilungen an eine Person (Glocke in der Navigation)
--   * Dateien der neuen Bereiche an einer Stelle (Rechte prüft der Server je Bereich)

ALTER TABLE person ADD COLUMN geburtsdatum date;
ALTER TABLE person ADD COLUMN eltern_freigabe boolean NOT NULL DEFAULT false;   -- volljährig: Eltern dürfen weiter einsehen

CREATE TABLE eltern_kind (
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  eltern_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  kind_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  beziehung text NOT NULL DEFAULT 'Erziehungsberechtigt' CHECK (length(beziehung) <= 40),
  erstellt_am timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (eltern_id, kind_id),
  CHECK (eltern_id <> kind_id)
);
CREATE INDEX eltern_kind_kind ON eltern_kind (kind_id);

CREATE TABLE mitteilung (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  person_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  art text NOT NULL CHECK (length(art) <= 40),                 -- auftrag, erinnerung, absenz, raum, formular, matura …
  titel text NOT NULL CHECK (length(titel) <= 200),
  text text NOT NULL DEFAULT '' CHECK (length(text) <= 1000),
  link text CHECK (link IS NULL OR link ~ '^/'),                -- Pfad innerhalb der Schule, z. B. «/auftraege/…»
  schluessel text,                                             -- verhindert doppelte Mitteilungen (z. B. «absenz:5:…»)
  erstellt_am timestamptz NOT NULL DEFAULT now(),
  gelesen_am timestamptz
);
CREATE INDEX mitteilung_person ON mitteilung (person_id, erstellt_am DESC);
CREATE UNIQUE INDEX mitteilung_einmal ON mitteilung (person_id, schluessel) WHERE schluessel IS NOT NULL;

CREATE TABLE datei (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  bezug_typ text NOT NULL CHECK (bezug_typ IN ('auftrag','abgabe','beitrag','laufwerk','matura','entschuldigung')),
  bezug_id uuid NOT NULL,
  ordner_id uuid,                                              -- nur Ablage
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  mime text NOT NULL,
  groesse bigint NOT NULL CHECK (groesse >= 0),
  sha256 text NOT NULL,
  speicher_key text NOT NULL,
  erstellt_von uuid REFERENCES person(id) ON DELETE SET NULL,
  erstellt_am timestamptz NOT NULL DEFAULT now(),
  geaendert_am timestamptz NOT NULL DEFAULT now(),
  geloescht_am timestamptz
);
CREATE INDEX datei_bezug ON datei (bezug_typ, bezug_id) WHERE geloescht_am IS NULL;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['eltern_kind','mitteilung','datei'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY mandant ON %I USING (schule_id = aktuelle_schule()) WITH CHECK (schule_id = aktuelle_schule())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO schule_app', t);
  END LOOP;
END $$;
