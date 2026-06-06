// Comment lifecycle event emitter — mirrors the pattern in src/lib/contacts/events.ts.
//
// Bridges Zernio comment.received events into the unified workflow engine:
//   1. Find active 'event' workflows whose trigger_config.event = 'comment.received'.
//   2. Record an audit row in event_dispatches.
//   3. Build the comment scope and dispatch each workflow via runFlowSync.

import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'
import { runFlowSync } from '@/lib/workflows/run-flow-sync'

export type CommentEventType = 'comment.received'

export interface CommentScope {
  platform: string
  post_id: string
  comment_id: string
  text: string
  author_id: string
  author_name: string | null
  author_username: string | null
  is_reply: boolean
  is_ad_comment: boolean
  conversation_id: string
  contact_id: string | null
}

interface MatchedWorkflow {
  id: string
  current_version_id: string | null
}

async function findMatchingWorkflows(
  supabase: SupabaseClient<Database>,
  orgId: string,
  eventType: CommentEventType,
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

/**
 * Emit a comment.received event into the workflow engine.
 * Fire-and-forget friendly: never throws, returns a small summary.
 */
export async function emitCommentEvent(
  orgId: string,
  scope: CommentScope,
  options: { supabase?: SupabaseClient<Database> } = {},
): Promise<{ dispatched: number; dispatch_id: string | null }> {
  try {
    const supabase = options.supabase ?? createServiceRoleClient()
    const eventType: CommentEventType = 'comment.received'

    const matched = await findMatchingWorkflows(supabase, orgId, eventType)

    const auditPayload: Json = {
      event: eventType,
      conversation_id: scope.conversation_id,
      comment_id: scope.comment_id,
      platform: scope.platform,
    }
    const { data: dispatchRow } = await supabase
      .from('event_dispatches')
      .insert({
        org_id: orgId,
        event_type: eventType,
        source_table: 'conversations',
        source_id: scope.conversation_id,
        workflow_ids: matched.map((m) => m.id),
        payload: auditPayload,
      })
      .select('id')
      .maybeSingle()
    const dispatchId = (dispatchRow as { id: string } | null)?.id ?? null

    if (matched.length === 0) return { dispatched: 0, dispatch_id: dispatchId }

    const triggerInput: Record<string, unknown> = {
      comment: scope,
      event: eventType,
    }

    const versionIds = matched
      .map((m) => m.current_version_id)
      .filter((id): id is string => Boolean(id))
    if (versionIds.length === 0) return { dispatched: 0, dispatch_id: dispatchId }

    const { data: versions } = await supabase
      .from('workflow_versions')
      .select('id, definition')
      .in('id', versionIds)

    const defById = new Map<string, unknown>()
    for (const v of versions ?? []) defById.set(v.id as string, v.definition)

    for (const wf of matched) {
      const definition = wf.current_version_id ? defById.get(wf.current_version_id) : null
      if (!definition) continue
      void runFlowSync({
        workflowId: wf.id,
        definition,
        triggerInput,
        context: { orgId },
      }).catch((err) => {
        console.error('[zernio/events] runFlowSync error:', err)
      })
    }

    return { dispatched: matched.length, dispatch_id: dispatchId }
  } catch (err) {
    console.error(
      `[zernio/events] emit failed org_id=${orgId}`,
      err instanceof Error ? err.message : String(err),
    )
    return { dispatched: 0, dispatch_id: null }
  }
}
