-- Herkunft importierter Abschnitte und Seiten (Kennung in OneNote). Damit lässt sich ein Import wiederholen oder
-- fortsetzen, ohne dass etwas doppelt entsteht: Bestehendes wird wiederverwendet, nur Neues kommt dazu.
ALTER TABLE notiz_abschnitt ADD COLUMN quelle text CHECK (length(quelle) <= 200);
ALTER TABLE notiz_seite ADD COLUMN quelle text CHECK (length(quelle) <= 200);
CREATE INDEX notiz_abschnitt_quelle ON notiz_abschnitt (unterricht_id, bereich, besitzer_id, quelle) WHERE quelle IS NOT NULL;
CREATE INDEX notiz_seite_quelle ON notiz_seite (abschnitt_id, quelle) WHERE quelle IS NOT NULL;
