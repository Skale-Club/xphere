-- Ephemeral operator channel for Notion webhook subscription verification.
-- The verification token is never persisted or logged. An authorized operator
-- may LISTEN on the database session while requesting a token from Notion.

CREATE OR REPLACE FUNCTION public.broadcast_global_knowledge_webhook_verification(
  p_verification_token TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_verification_token IS NULL
     OR length(p_verification_token) < 16
     OR length(p_verification_token) > 512 THEN
    RAISE EXCEPTION 'Invalid webhook verification token';
  END IF;

  PERFORM pg_notify(
    'global_knowledge_notion_verification',
    p_verification_token
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.broadcast_global_knowledge_webhook_verification(TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.broadcast_global_knowledge_webhook_verification(TEXT)
  TO service_role;
