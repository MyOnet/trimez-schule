-- Kursnotizbuch (Sheaf) pro Unterricht, aufgebaut wie ein Kursnotizbuch:
--   bibliothek   Inhaltsbibliothek: die Lehrperson schreibt, die Klasse liest
--   gemeinsam    Zusammenarbeitsbereich: alle schreiben
--   lehrkraefte  nur Lehrpersonen des Unterrichts
--   schueler     eigener Bereich je Schüler/in (besitzer_id): die Person selbst und ihre Lehrpersonen
-- Abschnitte können in Abschnittsgruppen liegen (eltern_id, beliebig tief). Seiten haben eine Ebene (Unterseiten).
-- Erlaubt oder gesperrt: dauerhaft pro Unterricht, in einer laufenden Lektion, in einer Prüfung (einstellungen.notizbuch).

ALTER TABLE unterricht ADD COLUMN notizbuch boolean NOT NULL DEFAULT true;
ALTER TABLE lektion ADD COLUMN notizbuch boolean NOT NULL DEFAULT true;

CREATE TABLE notiz_abschnitt (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  unterricht_id uuid NOT NULL REFERENCES unterricht(id) ON DELETE CASCADE,
  bereich text NOT NULL CHECK (bereich IN ('bibliothek','gemeinsam','lehrkraefte','schueler')),
  besitzer_id uuid REFERENCES person(id) ON DELETE CASCADE,
  eltern_id uuid REFERENCES notiz_abschnitt(id) ON DELETE CASCADE,
  art text NOT NULL DEFAULT 'abschnitt' CHECK (art IN ('abschnitt','gruppe')),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  farbe text NOT NULL DEFAULT '#3E8EED' CHECK (farbe ~ '^#[0-9A-Fa-f]{6}$'),
  reihenfolge double precision NOT NULL DEFAULT 0,
  offen boolean NOT NULL DEFAULT true,
  erstellt_am timestamptz NOT NULL DEFAULT now(),
  geaendert_am timestamptz NOT NULL DEFAULT now(),
  geloescht_am timestamptz,
  CHECK ((bereich = 'schueler') = (besitzer_id IS NOT NULL))
);
CREATE INDEX notiz_abschnitt_unterricht ON notiz_abschnitt (unterricht_id, bereich, besitzer_id);

CREATE TABLE notiz_seite (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  abschnitt_id uuid NOT NULL REFERENCES notiz_abschnitt(id) ON DELETE CASCADE,
  titel text NOT NULL DEFAULT '' CHECK (length(titel) <= 300),
  ebene smallint NOT NULL DEFAULT 0 CHECK (ebene BETWEEN 0 AND 2),
  reihenfolge double precision NOT NULL DEFAULT 0,
  inhalt jsonb NOT NULL DEFAULT '{"items": [], "strokes": [], "bg": {}}'::jsonb,
  text text NOT NULL DEFAULT '',                 -- reiner Text für Suche und Vorschau
  version integer NOT NULL DEFAULT 1,
  erstellt_am timestamptz NOT NULL DEFAULT now(),
  geaendert_am timestamptz NOT NULL DEFAULT now(),
  geaendert_von uuid REFERENCES person(id) ON DELETE SET NULL,
  verteilt_von uuid,                             -- Seite aus der Bibliothek, von der diese Kopie stammt
  geloescht_am timestamptz
);
CREATE INDEX notiz_seite_abschnitt ON notiz_seite (abschnitt_id, reihenfolge);

-- Bilder und Anhänge auf Seiten. Wer den Abschnitt lesen darf, darf die Datei lesen.
CREATE TABLE notiz_datei (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  abschnitt_id uuid NOT NULL REFERENCES notiz_abschnitt(id) ON DELETE CASCADE,
  speicher_key text NOT NULL,
  dateiname text NOT NULL,
  mime text NOT NULL,
  groesse bigint NOT NULL,
  erstellt_von uuid REFERENCES person(id) ON DELETE SET NULL,
  erstellt_am timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notiz_datei_abschnitt ON notiz_datei (abschnitt_id);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['notiz_abschnitt','notiz_seite','notiz_datei'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY mandant ON %I USING (schule_id = aktuelle_schule()) WITH CHECK (schule_id = aktuelle_schule())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO schule_app', t);
  END LOOP;
END $$;
