-- Zeugnisse und Promotion: Die Promotion wird nach den Regeln der Schule berechnet (Standard: Promotionsreglement
-- für die Gymnasien des Kantons Zürich, LS 413.251.1, § 9 und § 10). Entscheiden tut die Schule (Klassenkonvent,
-- Schulleitung); RESCOOL schlägt vor und hält den Entscheid mit Begründung fest.
-- Maturaarbeit: Betreuung mit Meilensteinen, Arbeitsjournal, Abgabe und Bewertung nach Kriterien.

CREATE TABLE promotion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  schueler_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  semester_id uuid NOT NULL REFERENCES semester(id) ON DELETE CASCADE,
  klasse_id uuid REFERENCES klasse(id) ON DELETE SET NULL,
  ergebnis text NOT NULL CHECK (ergebnis IN ('promoviert','provisorisch','nicht_promoviert')),
  berechnung jsonb NOT NULL DEFAULT '{}'::jsonb,
  abweichung boolean NOT NULL DEFAULT false,                    -- Entscheid weicht von der Berechnung ab (§ 13)
  bemerkung text NOT NULL DEFAULT '' CHECK (length(bemerkung) <= 1000),
  entschieden_von uuid REFERENCES person(id) ON DELETE SET NULL,
  entschieden_am timestamptz NOT NULL DEFAULT now(),
  UNIQUE (schueler_id, semester_id)
);

CREATE TABLE maturaarbeit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  schueler_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  betreuer_id uuid NOT NULL REFERENCES person(id) ON DELETE RESTRICT,
  koreferent_id uuid REFERENCES person(id) ON DELETE SET NULL,
  fach_id uuid REFERENCES fach(id) ON DELETE SET NULL,
  titel text NOT NULL CHECK (length(titel) BETWEEN 1 AND 200),
  fragestellung text NOT NULL DEFAULT '' CHECK (length(fragestellung) <= 4000),
  status text NOT NULL DEFAULT 'thema' CHECK (status IN ('thema','in_arbeit','abgegeben','bewertet')),
  abgabe_bis date,
  abgegeben_am timestamptz,
  praesentation_am timestamptz,
  -- { kriterien: [{ id, name, gewicht, note, kommentar }] }
  bewertung jsonb NOT NULL DEFAULT '{"kriterien": []}'::jsonb,
  note numeric(4,2) CHECK (note IS NULL OR (note >= 1 AND note <= 6)),
  bewertet_am timestamptz,
  erstellt_am timestamptz NOT NULL DEFAULT now(),
  geaendert_am timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX maturaarbeit_betreuer ON maturaarbeit (betreuer_id);
CREATE UNIQUE INDEX maturaarbeit_einmal ON maturaarbeit (schueler_id);

CREATE TABLE ma_meilenstein (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  arbeit_id uuid NOT NULL REFERENCES maturaarbeit(id) ON DELETE CASCADE,
  titel text NOT NULL CHECK (length(titel) BETWEEN 1 AND 160),
  faellig date,
  erledigt_am timestamptz,                                       -- von der Schülerin, dem Schüler gemeldet
  bestaetigt_am timestamptz,                                     -- von der Betreuungsperson bestätigt
  bestaetigt_von uuid REFERENCES person(id) ON DELETE SET NULL,
  reihenfolge smallint NOT NULL DEFAULT 0
);
CREATE INDEX ma_meilenstein_arbeit ON ma_meilenstein (arbeit_id, reihenfolge);

CREATE TABLE ma_journal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  arbeit_id uuid NOT NULL REFERENCES maturaarbeit(id) ON DELETE CASCADE,
  autor_id uuid REFERENCES person(id) ON DELETE SET NULL,
  datum date NOT NULL DEFAULT current_date,
  art text NOT NULL DEFAULT 'eintrag' CHECK (art IN ('eintrag','besprechung')),
  text text NOT NULL CHECK (length(text) BETWEEN 1 AND 8000),
  stunden numeric(4,1) CHECK (stunden IS NULL OR (stunden > 0 AND stunden <= 24)),
  erstellt_am timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ma_journal_arbeit ON ma_journal (arbeit_id, datum DESC);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['promotion','maturaarbeit','ma_meilenstein','ma_journal'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY mandant ON %I USING (schule_id = aktuelle_schule()) WITH CHECK (schule_id = aktuelle_schule())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO schule_app', t);
  END LOOP;
END $$;
CREATE TRIGGER maturaarbeit_geaendert BEFORE UPDATE ON maturaarbeit FOR EACH ROW EXECUTE FUNCTION geaendert();
