-- Kalender: Stundenplan (aus Untis oder von Hand), Änderungen (Ausfall, Raum, Vertretung), Termine (Prüfungen,
-- Anlässe, Ferien) und ein persönliches Kalender-Abo (iCal) fürs Handy.
-- Die Lektionszeiten stehen in schule.einstellungen.lektionen: [{ nr, von: "07:45", bis: "08:30" }].

CREATE TABLE stundenplan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  unterricht_id uuid NOT NULL REFERENCES unterricht(id) ON DELETE CASCADE,
  wochentag smallint NOT NULL CHECK (wochentag BETWEEN 1 AND 6),   -- 1 = Montag
  lektion smallint NOT NULL CHECK (lektion BETWEEN 1 AND 16),
  raum text CHECK (length(raum) <= 30),
  woche text NOT NULL DEFAULT 'alle' CHECK (woche IN ('alle','A','B')),
  gueltig_von date, gueltig_bis date,
  quelle text NOT NULL DEFAULT 'manuell' CHECK (quelle IN ('manuell','untis')),
  extern_nr text,
  erstellt_am timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stundenplan_unterricht ON stundenplan (unterricht_id);
CREATE UNIQUE INDEX stundenplan_einmal ON stundenplan (unterricht_id, wochentag, lektion, woche, coalesce(gueltig_von, '2000-01-01'));

CREATE TABLE stundenplan_aenderung (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  datum date NOT NULL,
  unterricht_id uuid NOT NULL REFERENCES unterricht(id) ON DELETE CASCADE,
  lektion smallint NOT NULL CHECK (lektion BETWEEN 1 AND 16),
  art text NOT NULL CHECK (art IN ('ausfall','raum','vertretung','zusatz')),
  raum text CHECK (length(raum) <= 30),
  vertretung_id uuid REFERENCES person(id) ON DELETE SET NULL,
  text text NOT NULL DEFAULT '' CHECK (length(text) <= 300),
  erstellt_von uuid REFERENCES person(id) ON DELETE SET NULL,
  erstellt_am timestamptz NOT NULL DEFAULT now(),
  UNIQUE (datum, unterricht_id, lektion)
);

CREATE TABLE termin (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  art text NOT NULL CHECK (art IN ('pruefung','anlass','ferien','sonstig')),
  titel text NOT NULL CHECK (length(titel) BETWEEN 1 AND 160),
  beschreibung text NOT NULL DEFAULT '' CHECK (length(beschreibung) <= 4000),
  von timestamptz NOT NULL,
  bis timestamptz NOT NULL CHECK (bis >= von),
  ganztag boolean NOT NULL DEFAULT false,
  fuer text NOT NULL CHECK (fuer IN ('schule','lehrpersonen','klasse','unterricht')),
  klasse_id uuid REFERENCES klasse(id) ON DELETE CASCADE,
  unterricht_id uuid REFERENCES unterricht(id) ON DELETE CASCADE,
  pruefung_id uuid REFERENCES pruefung(id) ON DELETE SET NULL,
  ort text CHECK (length(ort) <= 80),
  ausnahme_grund text,                                          -- Prüfungslimit mit Bewilligung der Schulleitung überschritten
  ausnahme_von uuid REFERENCES person(id) ON DELETE SET NULL,
  erstellt_von uuid REFERENCES person(id) ON DELETE SET NULL,
  erstellt_am timestamptz NOT NULL DEFAULT now(),
  CHECK ((fuer = 'klasse') = (klasse_id IS NOT NULL)),
  CHECK ((fuer = 'unterricht') = (unterricht_id IS NOT NULL)),
  CHECK (art <> 'pruefung' OR fuer = 'unterricht')
);
CREATE INDEX termin_zeit ON termin (von, bis);
CREATE INDEX termin_klasse ON termin (klasse_id, von);

-- Persönliches Kalender-Abo: nur der Hash des Tokens wird gespeichert
CREATE TABLE kalender_abo (
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  person_id uuid PRIMARY KEY REFERENCES person(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  erstellt_am timestamptz NOT NULL DEFAULT now()
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['stundenplan','stundenplan_aenderung','termin','kalender_abo'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY mandant ON %I USING (schule_id = aktuelle_schule()) WITH CHECK (schule_id = aktuelle_schule())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO schule_app', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION kalender_abo_finden(p_hash text)
RETURNS TABLE (schule_id uuid, person_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT schule_id, person_id FROM kalender_abo WHERE token_hash = p_hash $$;
REVOKE ALL ON FUNCTION kalender_abo_finden(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kalender_abo_finden(text) TO schule_app;
