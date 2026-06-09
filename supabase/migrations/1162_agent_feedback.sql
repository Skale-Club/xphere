-- =============================================================================
-- Migration: 1162_agent_feedback
-- Project 2 (Q7): Feedback signals — thumbs up/down, handoff, idk
-- Creates: agent_feedback_signal enum + agent_feedback table
-- RLS:     INSERT authenticated (any org member can submit feedback)
--          SELECT authenticated, scoped to own org via get_current_org_id()
--          UPDATE/DELETE: disabled (feedback is immutable once submitted)
-- =============================================================================

-- Signal enum

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'agent_feedback_signal') THEN
    CREATE TYPE public.agent_feedback_signal AS ENUM (
      'thumbs_up',
      'thumbs_down',
      'handoff',
      'idk'
    );
  END IF;
END $$;

-- Feedback table

CREATE TABLE IF NOT EXISTS public.agent_feedback (
  id                UUID                          PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID                          NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- The specific invocation being rated (nullable: widget may not expose invocation_id)
  invocation_id     UUID                          REFERENCES public.agent_invocations(id) ON DELETE SET NULL,
  -- The conversation turn (message) the feedback is attached to
  conversation_id   UUID                          REFERENCES public.conversations(id) ON DELETE SET NULL,
  message_id        UUID                          NULL,
  -- The signal submitted by the operator / end-user
  signal            public.agent_feedback_signal  NOT NULL,
  -- Optional free-text annotation (e.g. "hallucinated pricing")
  note              TEXT                          NULL,
  -- Who submitted (NULL = anonymous / widget user)
  submitted_by      UUID                          REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ                   NOT NULL DEFAULT now()
);

-- Indexes

CREATE INDEX IF NOT EXISTS agent_feedback_org_id_idx
  ON public.agent_feedback (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS agent_feedback_invocation_id_idx
  ON public.agent_feedback (invocation_id)
  WHERE invocation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS agent_feedback_conversation_id_idx
  ON public.agent_feedback (conversation_id)
  WHERE conversation_id IS NOT NULL;

-- RLS

ALTER TABLE public.agent_feedback ENABLE ROW LEVEL SECURITY;

-- Org members can read their own org's feedback
CREATE POLICY "agent_feedback_select_org" ON public.agent_feedback
  FOR SELECT
  TO authenticated
  USING (org_id = get_current_org_id());

-- Org members can submit feedback for their own org
CREATE POLICY "agent_feedback_insert_org" ON public.agent_feedback
  FOR INSERT
  TO authenticated
  WITH CHECK (org_id = get_current_org_id());

-- Service role bypasses RLS (for API + widget submissions)
CREATE POLICY "agent_feedback_service_role" ON public.agent_feedback
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Comments

COMMENT ON TABLE public.agent_feedback IS
  'Operator and end-user quality signals for agent invocations (Q7, Project 2).';
COMMENT ON COLUMN public.agent_feedback.signal IS
  'thumbs_up | thumbs_down | handoff (user asked for human) | idk (agent admitted it did not know)';
COMMENT ON COLUMN public.agent_feedback.note IS
  'Optional free-text annotation from the reviewer.';
