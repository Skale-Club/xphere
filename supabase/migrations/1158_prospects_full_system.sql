-- =============================================================================
-- Migration 1157: Prospects full system
--
-- Extends the prospect lifecycle model (1151) with the data model required for
-- the full Prospects module (beyond the staged MVP):
--   * prospect_lists / prospect_list_members  — named lists of prospects
--   * prospect_sources                         — import sources / scrape runs
--   * prospect_audiences                       — saved filter segments
--   * prospect_conversions                     — conversion history
--   * prospect_engagement_events               — engagement timeline (Replies)
--
-- Also adds summary columns (score, recommended channel, last-activity
-- timestamps) to contacts and accounts so the prospect list can sort/filter on
-- engagement without scanning the event log.
--
-- All tables are org-scoped with the standard RLS isolation policy. Polymorphic
-- references (entity_type + entity_id) mirror the existing notes/tasks pattern
-- and intentionally carry no hard FK, since they point at either contacts or
-- accounts.
-- =============================================================================

-- ----- Summary columns on contacts -------------------------------------------

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS score               integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recommended_channel text,
  ADD COLUMN IF NOT EXISTS last_contacted_at   timestamptz,
  ADD COLUMN IF NOT EXISTS last_replied_at     timestamptz,
  ADD COLUMN IF NOT EXISTS last_visit_at       timestamptz;

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS score               integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recommended_channel text,
  ADD COLUMN IF NOT EXISTS last_contacted_at   timestamptz,
  ADD COLUMN IF NOT EXISTS last_replied_at     timestamptz,
  ADD COLUMN IF NOT EXISTS last_visit_at       timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contacts_recommended_channel_check'
  ) THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT contacts_recommended_channel_check
      CHECK (
        recommended_channel IS NULL OR recommended_channel IN (
          'email', 'sms', 'whatsapp', 'call', 'visit', 'linkedin'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'accounts_recommended_channel_check'
  ) THEN
    ALTER TABLE public.accounts
      ADD CONSTRAINT accounts_recommended_channel_check
      CHECK (
        recommended_channel IS NULL OR recommended_channel IN (
          'email', 'sms', 'whatsapp', 'call', 'visit', 'linkedin'
        )
      );
  END IF;
END $$;

-- ----- prospect_lists --------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.prospect_lists (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name        text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  description text,
  color       text,
  created_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_prospect_lists_org
  ON public.prospect_lists (org_id, created_at DESC);

-- ----- prospect_list_members -------------------------------------------------

CREATE TABLE IF NOT EXISTS public.prospect_list_members (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  list_id    uuid        NOT NULL REFERENCES public.prospect_lists(id) ON DELETE CASCADE,
  contact_id uuid        REFERENCES public.contacts(id) ON DELETE CASCADE,
  account_id uuid        REFERENCES public.accounts(id) ON DELETE CASCADE,
  added_by   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  added_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(contact_id, account_id) = 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_prospect_list_members_contact
  ON public.prospect_list_members (list_id, contact_id)
  WHERE contact_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_prospect_list_members_account
  ON public.prospect_list_members (list_id, account_id)
  WHERE account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_prospect_list_members_org
  ON public.prospect_list_members (org_id);

-- ----- prospect_sources ------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.prospect_sources (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_type     text        NOT NULL,
  source_key      text,
  label           text,
  external_run_id text,
  status          text        NOT NULL DEFAULT 'completed'
                    CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  total_count     integer     NOT NULL DEFAULT 0,
  imported_count  integer     NOT NULL DEFAULT 0,
  metadata        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prospect_sources_org
  ON public.prospect_sources (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_prospect_sources_run
  ON public.prospect_sources (org_id, source_type, external_run_id)
  WHERE external_run_id IS NOT NULL;

-- ----- prospect_audiences ----------------------------------------------------

CREATE TABLE IF NOT EXISTS public.prospect_audiences (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name             text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  description      text,
  definition       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  synced_platforms text[]      NOT NULL DEFAULT '{}',
  created_by       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_prospect_audiences_org
  ON public.prospect_audiences (org_id, created_at DESC);

-- ----- prospect_conversions --------------------------------------------------

CREATE TABLE IF NOT EXISTS public.prospect_conversions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  entity_type  text        NOT NULL CHECK (entity_type IN ('contact', 'account')),
  entity_id    uuid        NOT NULL,
  from_stage   text        NOT NULL,
  to_stage     text        NOT NULL,
  converted_by uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  payload      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prospect_conversions_entity
  ON public.prospect_conversions (org_id, entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_prospect_conversions_org
  ON public.prospect_conversions (org_id, created_at DESC);

-- ----- prospect_engagement_events --------------------------------------------

CREATE TABLE IF NOT EXISTS public.prospect_engagement_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  entity_type     text        NOT NULL CHECK (entity_type IN ('contact', 'account')),
  entity_id       uuid        NOT NULL,
  event_type      text        NOT NULL CHECK (event_type IN (
                    'imported', 'contacted', 'sent', 'delivered', 'opened',
                    'clicked', 'replied', 'bounced', 'unsubscribed', 'visit',
                    'note', 'status_changed', 'converted'
                  )),
  channel         text,
  source_platform text,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  payload         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prospect_events_entity
  ON public.prospect_engagement_events (org_id, entity_type, entity_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_prospect_events_org
  ON public.prospect_engagement_events (org_id, occurred_at DESC);

-- ----- RLS -------------------------------------------------------------------

ALTER TABLE public.prospect_lists              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_list_members       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_sources            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_audiences          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_conversions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_engagement_events  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS prospect_lists_org_isolation ON public.prospect_lists;
CREATE POLICY prospect_lists_org_isolation ON public.prospect_lists
  FOR ALL TO authenticated
  USING      (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

DROP POLICY IF EXISTS prospect_list_members_org_isolation ON public.prospect_list_members;
CREATE POLICY prospect_list_members_org_isolation ON public.prospect_list_members
  FOR ALL TO authenticated
  USING      (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

DROP POLICY IF EXISTS prospect_sources_org_isolation ON public.prospect_sources;
CREATE POLICY prospect_sources_org_isolation ON public.prospect_sources
  FOR ALL TO authenticated
  USING      (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

DROP POLICY IF EXISTS prospect_audiences_org_isolation ON public.prospect_audiences;
CREATE POLICY prospect_audiences_org_isolation ON public.prospect_audiences
  FOR ALL TO authenticated
  USING      (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

DROP POLICY IF EXISTS prospect_conversions_org_isolation ON public.prospect_conversions;
CREATE POLICY prospect_conversions_org_isolation ON public.prospect_conversions
  FOR ALL TO authenticated
  USING      (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

DROP POLICY IF EXISTS prospect_events_org_isolation ON public.prospect_engagement_events;
CREATE POLICY prospect_events_org_isolation ON public.prospect_engagement_events
  FOR ALL TO authenticated
  USING      (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

-- ----- Comments --------------------------------------------------------------

COMMENT ON TABLE public.prospect_lists IS
  'Named lists of prospect-stage records (Lists module). Membership in prospect_list_members.';
COMMENT ON TABLE public.prospect_sources IS
  'Import sources / scrape runs that created prospect-stage records (Sources module). '
  'external_run_id references the originating service run, e.g. an Xcraper search run.';
COMMENT ON TABLE public.prospect_audiences IS
  'Saved filter segments (Audiences module). definition holds the serialized filter; '
  'synced_platforms tracks which outbound platforms (e.g. xmail, meta) the audience was pushed to.';
COMMENT ON TABLE public.prospect_conversions IS
  'History of lifecycle conversions (Conversions module). Records every deliberate stage change.';
COMMENT ON TABLE public.prospect_engagement_events IS
  'Engagement timeline for prospect-stage records (Replies module + detail timeline). '
  'Fed by imports, outreach (Xmail), field visits (Xpot), and internal status changes.';
