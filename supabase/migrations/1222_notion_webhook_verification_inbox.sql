-- Supavisor does not relay LISTEN/NOTIFY across pooled sessions. Keep a
-- short-lived, unlogged inbox as the operator handoff instead: no WAL/backups,
-- no client policies, and rows expire automatically on the next delivery.

CREATE UNLOGGED TABLE public.global_knowledge_webhook_verification_inbox (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  verification_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '10 minutes',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.global_knowledge_webhook_verification_inbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.global_knowledge_webhook_verification_inbox
  FROM PUBLIC, anon, authenticated;

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

  DELETE FROM public.global_knowledge_webhook_verification_inbox
  WHERE expires_at <= now();

  INSERT INTO public.global_knowledge_webhook_verification_inbox (
    id,
    verification_token,
    expires_at,
    created_at
  )
  VALUES (
    TRUE,
    p_verification_token,
    now() + INTERVAL '10 minutes',
    now()
  )
  ON CONFLICT (id) DO UPDATE
  SET verification_token = EXCLUDED.verification_token,
      expires_at = EXCLUDED.expires_at,
      created_at = EXCLUDED.created_at;

  PERFORM pg_notify(
    'global_knowledge_notion_verification',
    p_verification_token
  );
END;
$$;
