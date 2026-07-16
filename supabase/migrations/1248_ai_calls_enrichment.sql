-- =============================================================================
-- Migration 1248: AI calls enrichment
--
-- Problem: the Vapi end-of-call-report webhook only ever persisted
-- analysis.summary into public.calls — artifact.recordingUrl,
-- analysis.successEvaluation and analysis.structuredData were silently
-- dropped. Separately, unified_calls (migration 063) hardcoded
-- direction = 'inbound' and recording_url = NULL for every AI-call row, so
-- outbound Vapi campaign calls showed up as Inbound in the unified Calls UI
-- and never had a recording player.
--
-- This migration:
--   1. Adds recording_url / success_evaluation / structured_data to
--      public.calls so the webhook has somewhere to persist them.
--   2. Recreates unified_calls so AI rows report direction from
--      calls.call_type ('outboundPhoneCall' -> 'outbound', else 'inbound')
--      and expose calls.recording_url instead of a hardcoded NULL.
--
-- Everything else in the view (column list, ordering, human-call branch,
-- security_invoker, grants) is preserved unchanged from migration 063 —
-- grep "unified_calls" across supabase/migrations/ confirms 063 is the only
-- prior definition.
-- =============================================================================

BEGIN;

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS recording_url text,
  ADD COLUMN IF NOT EXISTS success_evaluation text,
  ADD COLUMN IF NOT EXISTS structured_data jsonb;

DROP VIEW IF EXISTS public.unified_calls;

CREATE VIEW public.unified_calls
WITH (security_invoker = true) AS
SELECT
  c.id,
  'ai'::text                            AS call_type,
  c.organization_id                     AS org_id,
  c.vapi_call_id                        AS external_id,
  c.customer_number                     AS counterpart_number,
  c.customer_name                       AS counterpart_name,
  NULL::uuid                            AS contact_id,
  CASE WHEN c.call_type = 'outboundPhoneCall' THEN 'outbound' ELSE 'inbound' END
                                         AS direction,
  c.duration_seconds,
  c.status,
  c.ended_reason                        AS substatus,
  c.recording_url                       AS recording_url,
  NULL::integer                         AS recording_duration,
  c.transcript,
  c.summary                             AS notes,
  c.cost,
  c.assistant_id,
  NULL::text                            AS routing_mode,
  COALESCE(c.started_at, c.created_at)  AS started_at,
  c.ended_at,
  c.created_at
FROM public.calls c

UNION ALL

SELECT
  l.id,
  'human'::text                                                AS call_type,
  l.org_id,
  l.call_sid                                                   AS external_id,
  CASE WHEN l.direction = 'inbound' THEN l.from_number ELSE l.to_number END
                                                               AS counterpart_number,
  NULL::text                                                   AS counterpart_name,
  l.contact_id,
  l.direction,
  l.duration_seconds,
  l.status,
  NULL::text                                                   AS substatus,
  l.recording_url,
  l.recording_duration,
  NULL::text                                                   AS transcript,
  l.notes,
  NULL::numeric                                                AS cost,
  NULL::text                                                   AS assistant_id,
  l.routing_mode,
  COALESCE(l.started_at, l.created_at)                         AS started_at,
  l.ended_at,
  l.created_at
FROM public.call_logs l;

GRANT SELECT ON public.unified_calls TO authenticated, anon;

COMMENT ON VIEW public.unified_calls IS
  'Unified read-only view of AI (calls) + human (call_logs) call records. RLS inherits from base tables via SECURITY INVOKER. Migration 1248: AI-row direction now derives from calls.call_type (outboundPhoneCall -> outbound) instead of a hardcoded inbound, and recording_url now sources calls.recording_url instead of a hardcoded NULL.';

COMMIT;
