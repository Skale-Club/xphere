import 'server-only'

// Workflow dispatch for Local SEO events — same shape as emitCommerceEvent
// (src/lib/commerce/events.ts): find active event workflows for the org,
// audit the dispatch in event_dispatches, run each flow. Runs inside the cron
// tick, so flows are awaited (a background promise could be cut off when the
// request ends). Never throws.

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, Json } from '@/types/database'
import { definitionHasWait, runFlow } from '@/lib/flows/engine'
import type { FlowDefinition } from '@/lib/flows/schema'
import { runFlowSync } from '@/lib/workflows/run-flow-sync'

type Admin = SupabaseClient<Database>

export type LocalSeoEvent =
  | 'local_seo.scan_completed'
  | 'local_seo.rank_changed'
  | 'gbp.review_received'
  | 'gbp.review_negative'
  | 'gbp.google_update_detected'

export async function dispatchLocalSeoWorkflowEvent(
  admin: Admin,
  orgId: string,
  event: LocalSeoEvent,
  sourceId: string,
  payload: Record<string, unknown>,
  sourceTable = 'local_seo_scans',
): Promise<{ dispatched: number }> {
  try {
    const { data: matched } = await admin
      .from('workflows')
      .select('id, current_version_id')
      .eq('org_id', orgId)
      .eq('trigger_type', 'event')
      .eq('is_active', true)
      .eq('health_blocked', false)
      .contains('trigger_config', { event })
    const workflows = matched ?? []

    await admin.from('event_dispatches').insert({
      org_id: orgId,
      event_type: event,
      source_table: sourceTable,
      source_id: sourceId,
      workflow_ids: workflows.map((w) => w.id),
      payload: { event, source_id: sourceId } as Json,
    })
    if (!workflows.length) return { dispatched: 0 }

    const versionIds = workflows.map((w) => w.current_version_id).filter((id): id is string => !!id)
    if (!versionIds.length) return { dispatched: 0 }
    const { data: versions } = await admin.from('workflow_versions').select('id, definition').in('id', versionIds)
    const defs = new Map((versions ?? []).map((v) => [v.id, v.definition]))

    const triggerInput = { event, ...payload }
    const runs = workflows.map(async (w) => {
      const definition = w.current_version_id ? defs.get(w.current_version_id) : null
      if (!definition) return
      if (definitionHasWait(definition)) {
        await runFlow({
          workflowId: w.id,
          versionId: w.current_version_id ?? null,
          definition: definition as FlowDefinition,
          orgId,
          triggerType: 'event',
          triggerPayload: triggerInput,
          supabase: admin,
        })
      } else {
        await runFlowSync({ workflowId: w.id, definition, triggerInput, context: { orgId } })
      }
    })
    await Promise.allSettled(runs)
    return { dispatched: workflows.length }
  } catch (err) {
    console.error('[local-seo/workflow-events] dispatch failed', err instanceof Error ? err.message : err)
    return { dispatched: 0 }
  }
}
