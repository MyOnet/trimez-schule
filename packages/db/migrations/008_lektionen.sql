-- Phase 7: Unterrichtsmodus. Die Lehrperson startet eine Lektion für einen Unterricht. Während der Lektion
--   * sind nur die freigegebenen Seiten offen (in der Lernumgebung durchgesetzt, im Browser nur angezeigt),
--   * kann sie allen eine Seite oder ein Material schicken («Anstoss»),
--   * kann sie die Bildschirme anhalten (Aufmerksamkeit nach vorne).
-- Die Teilnahme hält fest, wer gerade dabei ist und womit (Browser oder Lernumgebung).

CREATE TABLE lektion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  unterricht_id uuid NOT NULL REFERENCES unterricht(id) ON DELETE CASCADE,
  gestartet_von uuid REFERENCES person(id) ON DELETE SET NULL,
  gestartet_am timestamptz NOT NULL DEFAULT now(),
  beendet_am timestamptz,
  lernumgebung boolean NOT NULL DEFAULT false,         -- Lernumgebung verlangt (Browser wird markiert)
  rechner boolean NOT NULL DEFAULT false,
  seiten jsonb NOT NULL DEFAULT '[]'::jsonb,            -- [{ url, titel }]
  angehalten boolean NOT NULL DEFAULT false,            -- Bildschirme angehalten
  anstoss jsonb,                                        -- { nr, art: 'material'|'seite', material_id?, url?, titel, zeit }
  anstoss_nr integer NOT NULL DEFAULT 0
);
-- Pro Unterricht höchstens eine laufende Lektion
CREATE UNIQUE INDEX lektion_laufend ON lektion (unterricht_id) WHERE beendet_am IS NULL;

CREATE TABLE lektion_teilnahme (
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  lektion_id uuid NOT NULL REFERENCES lektion(id) ON DELETE CASCADE,
  schueler_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  erste_aktivitaet timestamptz NOT NULL DEFAULT now(),
  letzte_aktivitaet timestamptz NOT NULL DEFAULT now(),
  modus text NOT NULL DEFAULT 'browser' CHECK (modus IN ('browser','gesperrt')),
  plattform text,
  app_version text,
  sichtbar boolean NOT NULL DEFAULT true,               -- Seite im Vordergrund (Browser: Tab sichtbar)
  gesehen_nr integer NOT NULL DEFAULT 0,                -- zuletzt angezeigter Anstoss
  warnungen integer NOT NULL DEFAULT 0,
  warnung_art text,
  warnung_zuletzt timestamptz,
  PRIMARY KEY (lektion_id, schueler_id)
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['lektion','lektion_teilnahme'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY mandant ON %I USING (schule_id = aktuelle_schule()) WITH CHECK (schule_id = aktuelle_schule())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO schule_app', t);
  END LOOP;
END $$;
