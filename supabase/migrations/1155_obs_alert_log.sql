-- O3: dedupe log for observability alerts. One row per alert actually delivered,
-- so the alert cron does not re-notify the same condition every run.
-- Internal ops table: accessed only by the service role (RLS on, no policies).

CREATE TABLE IF NOT EXISTS public.obs_alert_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_key text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS obs_alert_log_key_sent_idx
  ON public.obs_alert_log (alert_key, sent_at DESC);

ALTER TABLE public.obs_alert_log ENABLE ROW LEVEL SECURITY;
