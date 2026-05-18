-- =============================================================================
-- Migration 063: Unified Calls View (SEED-014)
--
-- Creates a VIEW that merges public.calls (Vapi/AI) and public.call_logs
-- (Twilio/human) into a single queryable resource for the unified Calls UI.
--
-- RLS is inherited automatically from the underlying tables.
-- =============================================================================

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
  'inbound'::text                       AS direction,
  c.duration_seconds,
  c.status,
  c.ended_reason                        AS substatus,
  NULL::text                            AS recording_url,
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
  'Unified read-only view of AI (calls) + human (call_logs) call records. RLS inherits from base tables via SECURITY INVOKER.';
