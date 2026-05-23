-- Migration 1038: Contact first/last name split
--
-- `contacts.name` remains as a display/cache field for compatibility with
-- existing integrations and queries. `first_name` and `last_name` are the
-- canonical editable fields going forward.

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name TEXT;

-- Best-effort backfill from the legacy full-name field.
UPDATE contacts
SET
  first_name = CASE
    WHEN first_name IS NULL AND NULLIF(BTRIM(name), '') IS NOT NULL
      THEN SPLIT_PART(BTRIM(name), ' ', 1)
    ELSE first_name
  END,
  last_name = CASE
    WHEN last_name IS NULL
      AND NULLIF(BTRIM(name), '') IS NOT NULL
      AND POSITION(' ' IN BTRIM(name)) > 0
      THEN NULLIF(BTRIM(SUBSTRING(BTRIM(name) FROM POSITION(' ' IN BTRIM(name)) + 1)), '')
    ELSE last_name
  END
WHERE NULLIF(BTRIM(name), '') IS NOT NULL
  AND (first_name IS NULL OR last_name IS NULL);

CREATE OR REPLACE FUNCTION sync_contact_name_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  trimmed_name TEXT;
  combined_name TEXT;
BEGIN
  NEW.first_name = NULLIF(BTRIM(NEW.first_name), '');
  NEW.last_name = NULLIF(BTRIM(NEW.last_name), '');
  NEW.name = NULLIF(BTRIM(NEW.name), '');

  combined_name = NULLIF(BTRIM(CONCAT_WS(' ', NEW.first_name, NEW.last_name)), '');

  -- First/last are canonical. When present, refresh the legacy display name.
  IF combined_name IS NOT NULL THEN
    NEW.name = combined_name;
    RETURN NEW;
  END IF;

  -- Compatibility path for older callers that still send only `name`.
  IF NEW.name IS NOT NULL THEN
    trimmed_name = BTRIM(NEW.name);
    NEW.first_name = SPLIT_PART(trimmed_name, ' ', 1);
    IF POSITION(' ' IN trimmed_name) > 0 THEN
      NEW.last_name = NULLIF(BTRIM(SUBSTRING(trimmed_name FROM POSITION(' ' IN trimmed_name) + 1)), '');
    ELSE
      NEW.last_name = NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_contact_name_fields ON contacts;
CREATE TRIGGER trg_sync_contact_name_fields
  BEFORE INSERT OR UPDATE OF name, first_name, last_name ON contacts
  FOR EACH ROW
  EXECUTE FUNCTION sync_contact_name_fields();

CREATE INDEX IF NOT EXISTS contacts_first_name_idx
  ON contacts(first_name);

CREATE INDEX IF NOT EXISTS contacts_last_name_idx
  ON contacts(last_name);
