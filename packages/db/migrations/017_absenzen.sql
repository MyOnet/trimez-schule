-- Absenzen: Die Lehrperson erfasst pro Lektion, wer fehlt oder zu spät kommt. Schülerinnen und Schüler (oder ihre
-- Eltern) entschuldigen online; die Klassenlehrperson nimmt die Entschuldigung an oder lehnt sie ab. Nach Ablauf der
-- Frist gilt eine offene Absenz als unentschuldigt. Ab einer Schwelle unentschuldigter Lektionen erhält die
-- Klassenlehrperson eine Mitteilung.

CREATE TABLE entschuldigung (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  schueler_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  art text NOT NULL DEFAULT 'entschuldigung' CHECK (art IN ('entschuldigung','gesuch')),   -- gesuch = Urlaub vorher beantragt
  von date NOT NULL, bis date NOT NULL CHECK (bis >= von),
  grund text NOT NULL CHECK (grund IN ('krankheit','unfall','arzt','familie','religion','sport_kultur','andere')),
  text text NOT NULL DEFAULT '' CHECK (length(text) <= 2000),
  eingereicht_von uuid REFERENCES person(id) ON DELETE SET NULL,
  eingereicht_am timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'eingereicht' CHECK (status IN ('eingereicht','angenommen','abgelehnt')),
  entschieden_von uuid REFERENCES person(id) ON DELETE SET NULL,
  entschieden_am timestamptz,
  bemerkung text NOT NULL DEFAULT '' CHECK (length(bemerkung) <= 1000)
);
CREATE INDEX entschuldigung_schueler ON entschuldigung (schueler_id, von);

CREATE TABLE absenz (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  schueler_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  datum date NOT NULL,
  lektion smallint CHECK (lektion BETWEEN 1 AND 16),
  unterricht_id uuid REFERENCES unterricht(id) ON DELETE SET NULL,
  art text NOT NULL DEFAULT 'abwesend' CHECK (art IN ('abwesend','verspaetet')),
  minuten smallint CHECK (minuten IS NULL OR minuten BETWEEN 1 AND 120),
  status text NOT NULL DEFAULT 'offen' CHECK (status IN ('offen','entschuldigt','unentschuldigt')),
  entschuldigung_id uuid REFERENCES entschuldigung(id) ON DELETE SET NULL,
  bemerkung text NOT NULL DEFAULT '' CHECK (length(bemerkung) <= 300),
  erfasst_von uuid REFERENCES person(id) ON DELETE SET NULL,
  erstellt_am timestamptz NOT NULL DEFAULT now(),
  geaendert_am timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX absenz_einmal ON absenz (schueler_id, datum, coalesce(lektion, 0), coalesce(unterricht_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX absenz_schueler ON absenz (schueler_id, datum);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['entschuldigung','absenz'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY mandant ON %I USING (schule_id = aktuelle_schule()) WITH CHECK (schule_id = aktuelle_schule())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO schule_app', t);
  END LOOP;
END $$;
CREATE TRIGGER absenz_geaendert BEFORE UPDATE ON absenz FOR EACH ROW EXECUTE FUNCTION geaendert();
