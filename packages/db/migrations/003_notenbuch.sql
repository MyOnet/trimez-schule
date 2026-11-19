-- Phase 2: Notenbuch
-- Noten als numeric (nie Gleitkomma). Freigegebene Noten sind für Schülerinnen und Schüler sichtbar;
-- jede spätere Änderung braucht einen Grund und landet im Protokoll (das macht der Server).

-- Bewertungsarten mit Standard-Gewicht (von der Schule festgelegt)
CREATE TABLE bewertungsart (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  name text NOT NULL,
  kategorie text NOT NULL CHECK (kategorie IN ('schriftlich','muendlich')),
  gewicht_standard numeric(5,2) NOT NULL DEFAULT 1 CHECK (gewicht_standard > 0 AND gewicht_standard <= 100),
  reihenfolge smallint NOT NULL DEFAULT 0,
  UNIQUE (schule_id, name)
);

-- Notenschlüssel: Punkte → Note
--   linear: Note = 1 + 5 × Punkte / (Maximum × p6), p6 = Anteil der Punkte für die 6 (z. B. 0.95), höchstens 6
--   tabelle: [{ab: Prozent, note}] absteigend
CREATE TABLE notenschluessel (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  name text NOT NULL,
  art text NOT NULL DEFAULT 'linear' CHECK (art IN ('linear','tabelle')),
  parameter jsonb NOT NULL DEFAULT '{"p6": 1}'::jsonb,
  rundung numeric(3,2) NOT NULL DEFAULT 0.1 CHECK (rundung IN (0.01, 0.1, 0.25, 0.5)),
  besitzer_id uuid REFERENCES person(id) ON DELETE SET NULL,      -- NULL = Schule
  geteilt text NOT NULL DEFAULT 'privat' CHECK (geteilt IN ('privat','fachgruppe','schule')),
  erstellt_am timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bewertung (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  unterricht_id uuid NOT NULL REFERENCES unterricht(id) ON DELETE CASCADE,
  semester_id uuid NOT NULL REFERENCES semester(id) ON DELETE RESTRICT,
  bewertungsart_id uuid REFERENCES bewertungsart(id) ON DELETE SET NULL,
  kategorie text NOT NULL DEFAULT 'schriftlich' CHECK (kategorie IN ('schriftlich','muendlich')),
  titel text NOT NULL,
  datum date NOT NULL DEFAULT current_date,
  gewicht numeric(5,2) NOT NULL DEFAULT 1 CHECK (gewicht > 0 AND gewicht <= 100),
  max_punkte numeric(7,2) CHECK (max_punkte IS NULL OR max_punkte > 0),
  notenschluessel_id uuid REFERENCES notenschluessel(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'entwurf' CHECK (status IN ('entwurf','freigegeben')),
  freigegeben_am timestamptz, freigegeben_von uuid REFERENCES person(id) ON DELETE SET NULL,
  erstellt_von uuid REFERENCES person(id) ON DELETE SET NULL,
  erstellt_am timestamptz NOT NULL DEFAULT now(), geaendert_am timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bewertung_unterricht ON bewertung (unterricht_id, semester_id, datum);

CREATE TABLE leistung (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  bewertung_id uuid NOT NULL REFERENCES bewertung(id) ON DELETE CASCADE,
  schueler_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  punkte numeric(7,2) CHECK (punkte IS NULL OR punkte >= 0),
  note numeric(4,2) CHECK (note IS NULL OR (note >= 1 AND note <= 6)),
  kennzeichen text CHECK (kennzeichen IN ('abwesend','nachholen','dispensiert')),
  kommentar text,
  geaendert_von uuid REFERENCES person(id) ON DELETE SET NULL,
  geaendert_am timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bewertung_id, schueler_id)
);

-- Mündliche Beobachtungen während des Unterrichts (schnell auf dem Handy)
CREATE TABLE beobachtung (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  unterricht_id uuid NOT NULL REFERENCES unterricht(id) ON DELETE CASCADE,
  schueler_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  datum date NOT NULL DEFAULT current_date,
  wert smallint NOT NULL CHECK (wert BETWEEN -2 AND 2),   -- −− − ○ + ++
  text text,
  erfasst_von uuid REFERENCES person(id) ON DELETE SET NULL,
  erstellt_am timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX beobachtung_unterricht ON beobachtung (unterricht_id, schueler_id, datum);

CREATE TABLE zeugnisnote (
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  unterricht_id uuid NOT NULL REFERENCES unterricht(id) ON DELETE CASCADE,
  schueler_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  semester_id uuid NOT NULL REFERENCES semester(id) ON DELETE CASCADE,
  gesetzt numeric(4,2) CHECK (gesetzt IS NULL OR (gesetzt >= 1 AND gesetzt <= 6)),
  begruendung text,
  status text NOT NULL DEFAULT 'entwurf' CHECK (status IN ('entwurf','freigegeben')),
  geaendert_von uuid REFERENCES person(id) ON DELETE SET NULL,
  geaendert_am timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (unterricht_id, schueler_id, semester_id)
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['bewertungsart','notenschluessel','bewertung','leistung','beobachtung','zeugnisnote'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY mandant ON %I USING (schule_id = aktuelle_schule()) WITH CHECK (schule_id = aktuelle_schule())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO schule_app', t);
  END LOOP;
END $$;
CREATE TRIGGER bewertung_geaendert BEFORE UPDATE ON bewertung FOR EACH ROW EXECUTE FUNCTION geaendert();

-- Standard-Bewertungsarten für bestehende Schulen
INSERT INTO bewertungsart (schule_id, name, kategorie, gewicht_standard, reihenfolge)
SELECT s.id, a.name, a.kategorie, a.gewicht, a.r FROM schule s CROSS JOIN (VALUES
  ('Prüfung', 'schriftlich', 1, 1), ('Kurztest', 'schriftlich', 0.5, 2), ('Vortrag', 'muendlich', 1, 3),
  ('Projekt', 'schriftlich', 1, 4), ('Mündlich', 'muendlich', 1, 5)) AS a(name, kategorie, gewicht, r)
ON CONFLICT DO NOTHING;
INSERT INTO notenschluessel (schule_id, name, art, parameter, rundung, geteilt)
SELECT s.id, 'Linear (6 bei voller Punktzahl)', 'linear', '{"p6": 1}', 0.1, 'schule' FROM schule s;
