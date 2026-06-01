-- Migration 1129: never leave a conversation pinned to an archived (merged) contact.
-- Makes contact merges "real": any conversation attached to an archived_duplicate
-- contact is auto-redirected to the surviving contact. Backfills existing rows and
-- installs a trigger so it can never regress (foundation for the contact-centric inbox).

-- 1. Backfill: re-point conversations sitting on archived contacts to the survivor.
UPDATE conversations c
   SET contact_id = ct.merged_into_contact_id
  FROM contacts ct
 WHERE c.contact_id = ct.id
   AND ct.identity_status = 'archived_duplicate'
   AND ct.merged_into_contact_id IS NOT NULL;

-- 2. Trigger: rewrite contact_id to the survivor on insert/update.
CREATE OR REPLACE FUNCTION public.resolve_merged_conversation_contact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  survivor uuid;
  status text;
BEGIN
  IF NEW.contact_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT identity_status, merged_into_contact_id
    INTO status, survivor
    FROM public.contacts
   WHERE id = NEW.contact_id;

  -- Chain depth is 1 (merge_contacts guards prevent merging into an archived row),
  -- so a single hop always lands on the live survivor.
  IF status = 'archived_duplicate' AND survivor IS NOT NULL THEN
    NEW.contact_id := survivor;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_resolve_merged_conversation_contact ON public.conversations;
CREATE TRIGGER trg_resolve_merged_conversation_contact
  BEFORE INSERT OR UPDATE OF contact_id ON public.conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.resolve_merged_conversation_contact();
