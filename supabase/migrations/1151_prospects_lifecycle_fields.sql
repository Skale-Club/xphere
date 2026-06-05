-- =============================================================================
-- Migration 1147: Prospects lifecycle fields
--
-- Adds lifecycle-aware CRM state to contacts and accounts so Prospects can be a
-- controlled view of early-stage commercial records instead of a separate table.
-- Existing CRM rows default to `lead` to preserve current Contacts/Companies
-- behavior; `prospect` is only used by explicit prospect creation/import paths.
-- =============================================================================

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS lifecycle_stage text NOT NULL DEFAULT 'lead',
  ADD COLUMN IF NOT EXISTS engagement_status text NOT NULL DEFAULT 'not_contacted',
  ADD COLUMN IF NOT EXISTS intent_level text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS qualification_status text NOT NULL DEFAULT 'needs_review',
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS source_id text,
  ADD COLUMN IF NOT EXISTS source_payload jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contacts_lifecycle_stage_check'
  ) THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT contacts_lifecycle_stage_check
      CHECK (
        lifecycle_stage IN (
          'prospect',
          'lead',
          'opportunity',
          'customer',
          'lost',
          'archived'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contacts_engagement_status_check'
  ) THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT contacts_engagement_status_check
      CHECK (
        engagement_status IN (
          'not_contacted',
          'contacted',
          'opened',
          'clicked',
          'replied',
          'engaged',
          'interested',
          'needs_follow_up',
          'not_interested',
          'unsubscribed'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contacts_intent_level_check'
  ) THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT contacts_intent_level_check
      CHECK (intent_level IN ('none', 'low', 'medium', 'high'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contacts_qualification_status_check'
  ) THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT contacts_qualification_status_check
      CHECK (qualification_status IN ('unqualified', 'needs_review', 'qualified'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contacts_org_lifecycle_stage
  ON public.contacts (org_id, lifecycle_stage, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_contacts_org_source_ref
  ON public.contacts (org_id, source_type, source_id)
  WHERE source_type IS NOT NULL OR source_id IS NOT NULL;

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS lifecycle_stage text NOT NULL DEFAULT 'lead',
  ADD COLUMN IF NOT EXISTS engagement_status text NOT NULL DEFAULT 'not_contacted',
  ADD COLUMN IF NOT EXISTS intent_level text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS qualification_status text NOT NULL DEFAULT 'needs_review',
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS source_id text,
  ADD COLUMN IF NOT EXISTS source_payload jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'accounts_lifecycle_stage_check'
  ) THEN
    ALTER TABLE public.accounts
      ADD CONSTRAINT accounts_lifecycle_stage_check
      CHECK (
        lifecycle_stage IN (
          'prospect',
          'lead',
          'opportunity',
          'customer',
          'lost',
          'archived'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'accounts_engagement_status_check'
  ) THEN
    ALTER TABLE public.accounts
      ADD CONSTRAINT accounts_engagement_status_check
      CHECK (
        engagement_status IN (
          'not_contacted',
          'contacted',
          'opened',
          'clicked',
          'replied',
          'engaged',
          'interested',
          'needs_follow_up',
          'not_interested',
          'unsubscribed'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'accounts_intent_level_check'
  ) THEN
    ALTER TABLE public.accounts
      ADD CONSTRAINT accounts_intent_level_check
      CHECK (intent_level IN ('none', 'low', 'medium', 'high'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'accounts_qualification_status_check'
  ) THEN
    ALTER TABLE public.accounts
      ADD CONSTRAINT accounts_qualification_status_check
      CHECK (qualification_status IN ('unqualified', 'needs_review', 'qualified'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_accounts_org_lifecycle_stage
  ON public.accounts (org_id, lifecycle_stage, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_accounts_org_source_ref
  ON public.accounts (org_id, source_type, source_id)
  WHERE source_type IS NOT NULL OR source_id IS NOT NULL;
