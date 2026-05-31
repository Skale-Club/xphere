-- Keep inbox previews current for every persisted conversation message.
-- Some send paths insert directly into conversation_messages; the inbox list
-- reads conversations.last_message, so make the parent row authoritative.

CREATE OR REPLACE FUNCTION public.sync_conversation_preview_from_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  preview text;
  media jsonb;
  mime_type text;
  filename text;
BEGIN
  preview := NULLIF(BTRIM(COALESCE(NEW.content, '')), '');

  IF preview IS NULL THEN
    media := NEW.metadata -> 'media';
    IF jsonb_typeof(media) = 'array' AND jsonb_array_length(media) > 0 THEN
      mime_type := COALESCE(media -> 0 ->> 'mime_type', '');
      filename := NULLIF(BTRIM(COALESCE(media -> 0 ->> 'filename', '')), '');

      IF mime_type LIKE 'image/%' THEN
        preview := 'Photo';
      ELSIF mime_type LIKE 'audio/%' THEN
        preview := 'Audio';
      ELSIF mime_type LIKE 'video/%' THEN
        preview := 'Video';
      ELSE
        preview := COALESCE('File: ' || filename, 'File');
      END IF;
    END IF;
  END IF;

  IF preview IS NULL THEN
    preview := CASE NEW.message_type
      WHEN 'image' THEN 'Photo'
      WHEN 'audio' THEN 'Audio'
      WHEN 'video' THEN 'Video'
      WHEN 'document' THEN 'File'
      ELSE NULL
    END;
  END IF;

  UPDATE public.conversations
  SET
    last_message = COALESCE(preview, last_message),
    last_message_at = NEW.created_at,
    updated_at = GREATEST(updated_at, NEW.created_at)
  WHERE id = NEW.conversation_id
    AND (last_message_at IS NULL OR NEW.created_at >= last_message_at);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_conversation_preview_from_message
  ON public.conversation_messages;

CREATE TRIGGER trg_sync_conversation_preview_from_message
  AFTER INSERT ON public.conversation_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_conversation_preview_from_message();
