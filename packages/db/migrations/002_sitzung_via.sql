-- Wie wurde angemeldet? (für die Pflicht zum zweiten Faktor bei eigenen Konten)
ALTER TABLE sitzung ADD COLUMN via text NOT NULL DEFAULT 'lokal' CHECK (via IN ('ms','eduid','lokal'));
DROP FUNCTION sitzung_finden(text);
CREATE FUNCTION sitzung_finden(p_hash text)
RETURNS TABLE (schule_id uuid, person_id uuid, stufe text, via text, laeuft_ab timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT schule_id, person_id, stufe, via, laeuft_ab FROM sitzung WHERE token_hash = p_hash AND laeuft_ab > now() $$;
REVOKE ALL ON FUNCTION sitzung_finden(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sitzung_finden(text) TO schule_app;
