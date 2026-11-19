-- Phase 4: Prüfungen erstellen
-- Eine Prüfung gehört zu einem Unterricht und besteht aus Teilen (Aufgaben oder Abschnitte mit Text).
-- Teile sind Kopien: Wird eine Aufgabe in der Aufgabenbank später geändert, bleibt die Prüfung gleich.
-- Durchführung, Abgabe und Korrektur folgen in Phase 5.

CREATE TABLE aufgabe (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  besitzer_id uuid NOT NULL REFERENCES person(id) ON DELETE NO ACTION,
  fach_id uuid REFERENCES fach(id) ON DELETE SET NULL,
  typ text NOT NULL,
  inhalt jsonb NOT NULL,
  loesung jsonb NOT NULL DEFAULT '{}'::jsonb,
  punkte numeric(6,2) NOT NULL DEFAULT 0 CHECK (punkte >= 0),
  schlagworte text[] NOT NULL DEFAULT '{}',
  geteilt text NOT NULL DEFAULT 'privat' CHECK (geteilt IN ('privat','fachgruppe','schule')),
  such_text text NOT NULL DEFAULT '',
  erstellt_am timestamptz NOT NULL DEFAULT now(),
  geaendert_am timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX aufgabe_suche ON aufgabe USING gin (to_tsvector('german', such_text));

CREATE TABLE pruefung (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  unterricht_id uuid NOT NULL REFERENCES unterricht(id) ON DELETE CASCADE,
  erstellt_von uuid REFERENCES person(id) ON DELETE SET NULL,
  titel text NOT NULL CHECK (length(titel) BETWEEN 1 AND 160),
  datum date,
  dauer_min integer CHECK (dauer_min IS NULL OR dauer_min BETWEEN 1 AND 600),
  status text NOT NULL DEFAULT 'entwurf' CHECK (status IN ('entwurf','bereit')),
  -- hinweise (Text oben auf der Prüfung), hilfsmittel, rueckwaerts (zurückblättern erlaubt), mischen (Reihenfolge der Antworten)
  einstellungen jsonb NOT NULL DEFAULT '{"rueckwaerts": true, "mischen": false, "hinweise": "", "hilfsmittel": ""}'::jsonb,
  notenschluessel_id uuid REFERENCES notenschluessel(id) ON DELETE SET NULL,
  quelle text NOT NULL DEFAULT 'editor' CHECK (quelle IN ('editor','umwandlung')),
  erstellt_am timestamptz NOT NULL DEFAULT now(),
  geaendert_am timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pruefung_unterricht ON pruefung (unterricht_id);

CREATE TABLE pruefung_teil (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  pruefung_id uuid NOT NULL REFERENCES pruefung(id) ON DELETE CASCADE,
  nr integer NOT NULL,
  typ text NOT NULL,
  inhalt jsonb NOT NULL,
  loesung jsonb NOT NULL DEFAULT '{}'::jsonb,
  punkte numeric(6,2) NOT NULL DEFAULT 0 CHECK (punkte >= 0),
  aufgabe_id uuid REFERENCES aufgabe(id) ON DELETE SET NULL,   -- Herkunft aus der Aufgabenbank
  UNIQUE (pruefung_id, nr) DEFERRABLE INITIALLY DEFERRED
);

-- Umwandlung einer Word- oder PDF-Datei in Teile: Vorschlag, den die Lehrperson bestätigt
CREATE TABLE umwandlung (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  pruefung_id uuid NOT NULL REFERENCES pruefung(id) ON DELETE CASCADE,
  dateiname text NOT NULL,
  mime text NOT NULL,
  datei_key text NOT NULL,
  original_html text,                   -- bei Word: Inhalt als HTML für die Ansicht links
  vorschlag jsonb NOT NULL DEFAULT '[]'::jsonb,
  verfahren text NOT NULL CHECK (verfahren IN ('regeln','ki')),
  hinweis text,
  status text NOT NULL DEFAULT 'offen' CHECK (status IN ('offen','uebernommen','verworfen')),
  erstellt_von uuid REFERENCES person(id) ON DELETE SET NULL,
  erstellt_am timestamptz NOT NULL DEFAULT now()
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['aufgabe','pruefung','pruefung_teil','umwandlung'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY mandant ON %I USING (schule_id = aktuelle_schule()) WITH CHECK (schule_id = aktuelle_schule())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO schule_app', t);
  END LOOP;
END $$;
