-- trimez. Schule: Grundlage (Phase 1)
-- Mandanten über schule_id + Zeilen-Sicherheit (RLS). Die App verbindet sich als schule_app (ohne BYPASSRLS)
-- und setzt pro Transaktion app.schule_id. Ohne gesetzte Schule sieht sie nichts.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE OR REPLACE FUNCTION aktuelle_schule() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.schule_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION geaendert() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN NEW.geaendert_am := now(); RETURN NEW; END $$;

-- ---------- Schule ----------
CREATE TABLE schule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kurzname text NOT NULL UNIQUE CHECK (kurzname ~ '^[a-z0-9-]{2,30}$'),   -- in der Adresse: /s/<kurzname>
  name text NOT NULL,
  kanton char(2) NOT NULL DEFAULT 'ZH',
  typ text NOT NULL DEFAULT 'gymnasium' CHECK (typ IN ('gymnasium','volksschule','berufsschule')),
  einstellungen jsonb NOT NULL DEFAULT '{}'::jsonb,
  ms_tenant text,            -- Microsoft-365-Mandant der Schule (für die Anmeldung)
  eduid_an boolean NOT NULL DEFAULT true,
  lokale_konten_an boolean NOT NULL DEFAULT true,
  erstellt_am timestamptz NOT NULL DEFAULT now(),
  geaendert_am timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE schuljahr (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  bezeichnung text NOT NULL,                -- «2026/27»
  von date NOT NULL, bis date NOT NULL CHECK (bis > von),
  aktiv boolean NOT NULL DEFAULT false,
  erstellt_am timestamptz NOT NULL DEFAULT now(), geaendert_am timestamptz NOT NULL DEFAULT now(),
  UNIQUE (schule_id, bezeichnung)
);
CREATE TABLE semester (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  schuljahr_id uuid NOT NULL REFERENCES schuljahr(id) ON DELETE CASCADE,
  nr smallint NOT NULL CHECK (nr IN (1,2)),
  von date NOT NULL, bis date NOT NULL CHECK (bis > von),
  erstellt_am timestamptz NOT NULL DEFAULT now(), geaendert_am timestamptz NOT NULL DEFAULT now(),
  UNIQUE (schuljahr_id, nr)
);

-- ---------- Personen, Konten, Rollen ----------
CREATE TABLE person (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  vorname text NOT NULL, nachname text NOT NULL,
  kuerzel text,                              -- Lehrpersonen-Kürzel, z. B. «MÜL»
  email citext,
  extern_id text,                            -- Nummer aus der Schulverwaltung (Import)
  status text NOT NULL DEFAULT 'aktiv' CHECK (status IN ('aktiv','ausgetreten')),
  erstellt_am timestamptz NOT NULL DEFAULT now(), geaendert_am timestamptz NOT NULL DEFAULT now(),
  UNIQUE (schule_id, email), UNIQUE (schule_id, extern_id)
);
CREATE TABLE rolle (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  person_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  art text NOT NULL CHECK (art IN ('admin','schulleitung','lehrperson','schueler','eltern')),
  gueltig_von date, gueltig_bis date,
  erstellt_am timestamptz NOT NULL DEFAULT now(), geaendert_am timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id, art)
);
-- Anmeldewege einer Person: Microsoft 365, edu-ID oder eigenes Konto (Passwort + Zwei-Faktor)
CREATE TABLE konto (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  person_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  art text NOT NULL CHECK (art IN ('ms','eduid','lokal')),
  subjekt text,                              -- «oid» bei Microsoft, «sub» bei edu-ID
  passwort_hash text,
  totp_geheimnis text,                       -- verschlüsselt (AES-GCM, Schlüssel nur im Server)
  totp_aktiv boolean NOT NULL DEFAULT false,
  fehlversuche smallint NOT NULL DEFAULT 0,
  gesperrt_bis timestamptz,
  letzte_anmeldung timestamptz,
  erstellt_am timestamptz NOT NULL DEFAULT now(), geaendert_am timestamptz NOT NULL DEFAULT now(),
  UNIQUE (schule_id, art, subjekt),
  CHECK (art <> 'lokal' OR passwort_hash IS NOT NULL)
);
CREATE UNIQUE INDEX konto_lokal_einmal ON konto (person_id) WHERE art = 'lokal';

-- Sitzungen: nur der Hash des Tokens wird gespeichert
CREATE TABLE sitzung (
  token_hash text PRIMARY KEY,
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  stufe text NOT NULL DEFAULT 'voll' CHECK (stufe IN ('voll','zweiter_faktor')),  -- «zweiter_faktor» = Passwort ok, Code fehlt noch
  erstellt_am timestamptz NOT NULL DEFAULT now(),
  letzte_aktivitaet timestamptz NOT NULL DEFAULT now(),
  laeuft_ab timestamptz NOT NULL,
  geraet text
);
CREATE INDEX sitzung_person ON sitzung (person_id);

-- ---------- Klassen, Fächer, Unterricht ----------
CREATE TABLE fach (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  name text NOT NULL, kuerzel text NOT NULL, farbe text NOT NULL DEFAULT '#5B6B7F' CHECK (farbe ~ '^#[0-9A-Fa-f]{6}$'),
  promotionsrelevant boolean NOT NULL DEFAULT true,
  erstellt_am timestamptz NOT NULL DEFAULT now(), geaendert_am timestamptz NOT NULL DEFAULT now(),
  UNIQUE (schule_id, kuerzel)
);
CREATE TABLE klasse (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  schuljahr_id uuid NOT NULL REFERENCES schuljahr(id) ON DELETE CASCADE,
  name text NOT NULL,                        -- «3a»
  stufe smallint CHECK (stufe BETWEEN 1 AND 6),
  profil text,                               -- z. B. «neusprachlich»
  klassenlehrperson_id uuid REFERENCES person(id) ON DELETE SET NULL,
  erstellt_am timestamptz NOT NULL DEFAULT now(), geaendert_am timestamptz NOT NULL DEFAULT now(),
  UNIQUE (schuljahr_id, name)
);
CREATE TABLE klasse_schueler (
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  klasse_id uuid NOT NULL REFERENCES klasse(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  von date, bis date,
  PRIMARY KEY (klasse_id, person_id)
);
-- «Unterricht» = Klasse (oder Gruppe) × Fach × Schuljahr. Daran hängen später Noten, Prüfungen, Material.
CREATE TABLE unterricht (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  klasse_id uuid NOT NULL REFERENCES klasse(id) ON DELETE CASCADE,
  fach_id uuid NOT NULL REFERENCES fach(id) ON DELETE RESTRICT,
  gruppe text NOT NULL DEFAULT '',           -- leer = ganze Klasse, sonst z. B. «Halbklasse A», «Niveau E»
  erstellt_am timestamptz NOT NULL DEFAULT now(), geaendert_am timestamptz NOT NULL DEFAULT now(),
  UNIQUE (klasse_id, fach_id, gruppe)
);
CREATE TABLE unterricht_lp (
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  unterricht_id uuid NOT NULL REFERENCES unterricht(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  art text NOT NULL DEFAULT 'haupt' CHECK (art IN ('haupt','stellvertretung')),
  von date, bis date,
  PRIMARY KEY (unterricht_id, person_id)
);
-- Nur wenn nicht die ganze Klasse teilnimmt (Gruppen)
CREATE TABLE unterricht_schueler (
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  unterricht_id uuid NOT NULL REFERENCES unterricht(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  PRIMARY KEY (unterricht_id, person_id)
);
CREATE TABLE fachgruppe (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  fach_id uuid NOT NULL REFERENCES fach(id) ON DELETE CASCADE,
  name text NOT NULL,
  UNIQUE (schule_id, fach_id)
);
CREATE TABLE fachgruppe_mitglied (
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  fachgruppe_id uuid NOT NULL REFERENCES fachgruppe(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  PRIMARY KEY (fachgruppe_id, person_id)
);

-- ---------- Protokoll (nur anhängen) ----------
CREATE TABLE protokoll (
  id bigserial PRIMARY KEY,
  schule_id uuid NOT NULL REFERENCES schule(id) ON DELETE CASCADE DEFAULT aktuelle_schule(),
  zeit timestamptz NOT NULL DEFAULT now(),
  person_id uuid,
  aktion text NOT NULL,
  objekt_typ text, objekt_id text,
  vorher jsonb, nachher jsonb, grund text,
  ip_hash text
);
CREATE INDEX protokoll_schule_zeit ON protokoll (schule_id, zeit DESC);

-- Zeitstempel
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['schule','schuljahr','semester','person','rolle','konto','fach','klasse','unterricht'] LOOP
    EXECUTE format('CREATE TRIGGER %I_geaendert BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION geaendert()', t, t);
  END LOOP;
END $$;

-- ---------- Zeilen-Sicherheit ----------
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['schuljahr','semester','person','rolle','konto','fach','klasse','klasse_schueler','unterricht','unterricht_lp','unterricht_schueler','fachgruppe','fachgruppe_mitglied','protokoll','sitzung'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY mandant ON %I USING (schule_id = aktuelle_schule()) WITH CHECK (schule_id = aktuelle_schule())', t);
  END LOOP;
END $$;
ALTER TABLE schule ENABLE ROW LEVEL SECURITY;
ALTER TABLE schule FORCE ROW LEVEL SECURITY;
CREATE POLICY mandant ON schule USING (id = aktuelle_schule()) WITH CHECK (id = aktuelle_schule());

-- Rechte der App: kein UPDATE/DELETE auf dem Protokoll, keine neuen Schulen (das macht nur trimez)
GRANT USAGE ON SCHEMA public TO schule_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO schule_app;
REVOKE UPDATE, DELETE ON protokoll FROM schule_app;
REVOKE INSERT, DELETE ON schule FROM schule_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO schule_app;

-- ---------- Funktionen vor der Anmeldung (Schule noch unbekannt) ----------
-- Laufen mit den Rechten des Besitzers, geben nur das Nötigste zurück.
CREATE OR REPLACE FUNCTION schule_oeffentlich(p_kurzname text)
RETURNS TABLE (id uuid, kurzname text, name text, ms boolean, eduid boolean, lokal boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT id, kurzname, name, ms_tenant IS NOT NULL, eduid_an, lokale_konten_an FROM schule WHERE kurzname = p_kurzname $$;

CREATE OR REPLACE FUNCTION sitzung_finden(p_hash text)
RETURNS TABLE (schule_id uuid, person_id uuid, stufe text, laeuft_ab timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT schule_id, person_id, stufe, laeuft_ab FROM sitzung WHERE token_hash = p_hash AND laeuft_ab > now() $$;

REVOKE ALL ON FUNCTION schule_oeffentlich(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION sitzung_finden(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION schule_oeffentlich(text), sitzung_finden(text) TO schule_app;
