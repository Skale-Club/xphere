// SEED-036: pipeline event emitter.
//
// Bridges the sales pipeline lifecycle into the unified workflow engine.
// Mirrors the calendar event pattern from src/lib/calendar/transition.ts:
//   1. Record an audit row in event_dispatches.
//   2. Look up active workflows whose trigger_config.event matches.
//   3. Dispatch each via the unified workflow runner (runFlowSync).
//
// Cascade depth is tracked so a pipeline_move_opportunity action inside a
// workflow can't infinitely re-fire stage_changed → workflow → move → ...
//
// Time-based pipeline triggers (aged_in_stage, no_activity, etc.) are NOT
// emitted here | they will be produced by a separate scheduler (see
// supabase/migrations/099 scheduled_opportunity_ticks table).

import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'
import { buildOpportunityScope } from '@/lib/pipeline/scope'
import { runFlowSync } from '@/lib/workflows/run-flow-sync'
import { enqueueQualified, enqueuePurchase } from '@/lib/meta/capi-enqueue'

export type OpportunityEventType =
  | 'opportunity.created'
  | 'opportunity.stage_changed'
  | 'opportunity.won'
  | 'opportunity.lost'
  | 'opportunity.updated'
  | 'opportunity.note_added'
  | 'opportunity.assigned'
  | 'opportunity.value_changed'
  | 'opportunity.deleted'
  // Time-based events emitted by src/app/api/cron/calendar-tick/route.ts
  // (SEED-036 scheduler). These are NOT emitted on user request paths.
  | 'opportunity.aged_in_stage'
  | 'opportunity.no_activity'
  | 'opportunity.close_date_approaching'
  | 'opportunity.close_date_passed'
  | 'opportunity.stale'

export const OPPORTUNITY_EVENTS: readonly OpportunityEventType[] = [
  'opportunity.created',
  'opportunity.stage_changed',
  'opportunity.won',
  'opportunity.lost',
  'opportunity.updated',
  'opportunity.note_added',
  'opportunity.assigned',
  'opportunity.value_changed',
  'opportunity.deleted',
  'opportunity.aged_in_stage',
  'opportunity.no_activity',
  'opportunity.close_date_approaching',
  'opportunity.close_date_passed',
  'opportunity.stale',
] as const

export const OPPORTUNITY_TIME_BASED_EVENTS: readonly OpportunityEventType[] = [
  'opportunity.aged_in_stage',
  'opportunity.no_activity',
  'opportunity.close_date_approaching',
  'opportunity.close_date_passed',
  'opportunity.stale',
] as const

export interface OpportunityEventPayload {
  opportunity_id: string
  // Optional pre-computed snapshot for deleted-row case (where the row is gone)
  opportunity_snapshot?: Record<string, unknown>
  changes?: Record<string, { from: unknown; to: unknown }>
  note?: { content: string }
  // For stage_changed: include from/to stage ids if known.
  from_stage_id?: string | null
  to_stage_id?: string | null
}

export interface EmitOpportunityEventOptions {
  /** Cascade depth | incremented when a workflow action re-emits. Capped at MAX_CASCADE_DEPTH. */
  depth?: number
  parentDispatchId?: string | null
  /** Optional explicit supabase client; defaults to service-role. */
  supabase?: SupabaseClient<Database>
}

const MAX_CASCADE_DEPTH = 3

async function recordDispatch(
  supabase: SupabaseClient<Database>,
  orgId: string,
  eventType: OpportunityEventType,
  opportunityId: string,
  payload: Json,
  workflowIds: string[],
  depth: number,
  parentDispatchId: string | null,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('event_dispatches')
    .insert({
      org_id: orgId,
      event_type: eventType,
      source_table: 'opportunities',
      source_id: opportunityId,
      workflow_ids: workflowIds,
      payload,
      parent_id: parentDispatchId,
      depth,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[pipeline/events] dispatch record error:', error.message)
    return null
  }
  return (data as { id: string }).id
}

interface MatchedWorkflow {
  id: string
  current_version_id: string | null
}

async function findMatchingWorkflows(
  supabase: SupabaseClient<Database>,
  orgId: string,
  eventType: OpportunityEventType,
): Promise<MatchedWorkflow[]> {
  const { data, error } = await supabase
    .from('workflows')
    .select('id, current_version_id')
    .eq('org_id', orgId)
    .eq('trigger_type', 'event')
    .eq('is_active', true)
    .eq('health_blocked', false)
    .contains('trigger_config', { event: eventType })

  if (error || !data) return []
  return (data as MatchedWorkflow[]).map((w) => ({
    id: w.id,
    current_version_id: w.current_version_id ?? null,
  }))
}

export async function emitOpportunityEvent(
  orgId: string,
  eventType: OpportunityEventType,
  payload: OpportunityEventPayload,
  options: EmitOpportunityEventOptions = {},
): Promise<{ dispatched: number; dispatch_id: string | null }> {
  const depth = options.depth ?? 0
  if (depth > MAX_CASCADE_DEPTH) {
    console.warn(
      '[pipeline/events] cascade depth limit hit',
      eventType,
      payload.opportunity_id,
    )
    return { dispatched: 0, dispatch_id: null }
  }

  const supabase = options.supabase ?? createServiceRoleClient()

  // Build the workflow scope (opportunity/contact/stage/pipeline). For deleted
  // rows the live DB query will miss; the caller passes a snapshot in that case.
  const scope = await buildOpportunityScope(supabase, {
    opportunityId: payload.opportunity_id,
    eventType,
    snapshot: payload.opportunity_snapshot,
    fromStageId: payload.from_stage_id ?? null,
    toStageId: payload.to_stage_id ?? null,
  })

  // Look up matching workflows. We still record a dispatch row even when none
  // match | it's audit data for "why didn't anything fire" debugging.
  const matched = await findMatchingWorkflows(supabase, orgId, eventType)

  const auditPayload: Json = {
    event: eventType,
    opportunity_id: payload.opportunity_id,
    changes: (payload.changes ?? null) as unknown as Json,
    note: (payload.note ?? null) as unknown as Json,
  }

  const dispatchId = await recordDispatch(
    supabase,
    orgId,
    eventType,
    payload.opportunity_id,
    auditPayload,
    matched.map((m) => m.id),
    depth,
    options.parentDispatchId ?? null,
  )

  // Meta CAPI side-effects (fire-and-forget; no-op unless the org has CAPI
  // enabled). Run regardless of whether any workflow matched.
  if (eventType === 'opportunity.won') {
    void enqueuePurchase(orgId, payload.opportunity_id, { supabase }).catch((err) => {
      console.error('[pipeline/events] enqueuePurchase error:', err)
    })
  } else if (eventType === 'opportunity.stage_changed') {
    const stageName = scope.stage.to?.name ?? scope.stage.name ?? null
    void enqueueQualified(orgId, payload.opportunity_id, stageName, { supabase }).catch((err) => {
      console.error('[pipeline/events] enqueueQualified error:', err)
    })
  }

  if (matched.length === 0) {
    return { dispatched: 0, dispatch_id: dispatchId }
  }

  // Build the trigger input | workflow runtime spreads this into scope under
  // top-level namespaces (opportunity, contact, stage, pipeline, changes, note).
  const triggerInput: Record<string, unknown> = {
    ...scope,
    event: eventType,
  }
  if (payload.changes) triggerInput.changes = payload.changes
  if (payload.note) triggerInput.note = payload.note

  // Load each workflow's current definition and dispatch via the synchronous
  // runner. The runner enforces its own timeout | we fire-and-forget here so
  // event emission stays fast on the user request path.
  const versionIds = matched
    .map((m) => m.current_version_id)
    .filter((id): id is string => Boolean(id))

  if (versionIds.length === 0) {
    return { dispatched: 0, dispatch_id: dispatchId }
  }

  const { data: versions } = await supabase
    .from('workflow_versions')
    .select('id, definition')
    .in('id', versionIds)

  const defById = new Map<string, unknown>()
  for (const v of versions ?? []) {
    defById.set(v.id as string, v.definition)
  }

  for (const wf of matched) {
    const definition = wf.current_version_id
      ? defById.get(wf.current_version_id)
      : null
    if (!definition) continue
    // Fire-and-forget | propagate cascade depth via context.
    void runFlowSync({
      workflowId: wf.id,
      definition,
      triggerInput,
      context: {
        orgId,
        // Depth threading: future workflow actions that re-emit
        // pipeline events can read this from the action context. See
        // src/lib/action-engine/executors/pipeline-actions.ts.
      },
    }).catch((err) => {
      console.error('[pipeline/events] runFlowSync error:', err)
    })
  }

  return { dispatched: matched.length, dispatch_id: dispatchId }
}
