-- Migration 1301: a dialling window, a redial policy, and the action that
-- queues a callback.
--
-- Everything here is additive, and every default reproduces today's behaviour
-- exactly: '{}' dial_window means "dial any time", '{}' retry_policy means
-- "never redial", is_evergreen false means "complete when the queue empties",
-- next_attempt_at NULL means "due now". No backfill, no DML — merging this
-- changes nothing for any tenant until someone configures a campaign.
--
-- Why a window at all: the engine dials whenever the cron tick runs, with no
-- notion of the hour. An order placed at 02:00 would ring the customer at
-- 02:05. Quiet hours were never implemented (see the comment in
-- src/app/api/cron/campaign-tick/route.ts), and the moment a campaign is
-- started by an event rather than by an operator clicking Start, they stop
-- being optional.
--
-- Shape is validated in TypeScript (src/lib/campaigns/dial-window.ts), not by
-- a CHECK: a config typo must degrade to "dial any time" rather than block an
-- INSERT, and the timezone database belongs in the app, not in a constraint.

-- PostgreSQL requires ALTER TYPE ... ADD VALUE to run outside a transaction
-- block. Supabase's migration runner honours that for a statement at the top
-- of the file; it is idempotent, so a re-run is a no-op.
ALTER TYPE public.action_type ADD VALUE IF NOT EXISTS 'campaign_enroll_call';

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS dial_window  jsonb   NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS retry_policy jsonb   NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS is_evergreen boolean NOT NULL DEFAULT false;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS default_dial_window jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.campaign_contacts
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;

-- The engine's candidate query filters on (campaign_id, status='pending') and
-- now also on next_attempt_at. Partial, because every other status is
-- irrelevant to dialling.
CREATE INDEX IF NOT EXISTS idx_campaign_contacts_pending_due
  ON public.campaign_contacts (campaign_id, next_attempt_at)
  WHERE status = 'pending';

COMMENT ON COLUMN public.campaigns.dial_window IS
  'Business-hours window this campaign may dial in. {} means no restriction (behaviour before 1301). '
  '{"timezone":"America/Sao_Paulo","days":{"monday":[["09:00","18:00"]],"sunday":[]},"blackout_dates":["2026-12-25"]}. '
  'A day with no entry is closed. Shape validated in src/lib/campaigns/dial-window.ts, which fails OPEN on a '
  'malformed value so a typo cannot silently stop every campaign.';

COMMENT ON COLUMN public.campaigns.retry_policy IS
  'Redial policy for a contact nobody answered. {} means no retries (behaviour before 1301). '
  '{"no_answer_max":2,"backoff_minutes":[30,240]}. no_answer_max is additionally clamped by '
  'campaign_contacts.retry_count CHECK (retry_count <= 2) from migration 005. Voicemail is never retried.';

COMMENT ON COLUMN public.campaigns.is_evergreen IS
  'True for a campaign that stays open for arrivals instead of completing when its queue empties — the shape a '
  'workflow enrols into. The enrol action re-arms a completed campaign anyway; this only spares it the round trip.';

COMMENT ON COLUMN public.organizations.default_dial_window IS
  'Window a newly created campaign starts from. Purely a seed for the campaign-level column; the engine never reads it.';

COMMENT ON COLUMN public.campaign_contacts.next_attempt_at IS
  'Earliest this pending contact may be dialled. NULL = due now, which is every row written before 1301. '
  'Set when a no-answer is queued for a retry.';
