// Workflow events for the SEO module, emitted by the audit engine when an
// audit completes:
//   seo.audit_completed     — every completed audit
//   seo.critical_issue_new  — error-severity issues that the previous audit
//                             of the site did not have (never on a first audit)
// Mirrors emitCommerceEvent: find active event workflows, audit the dispatch
// in event_dispatches, resume matching waits, run each workflow. No contact is
// involved. Never throws.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'
import { runFlowSync } from '@/lib/workflows/run-flow-sync'
import { runFlow, definitionHasWait } from '@/lib/flows/engine'
import type { FlowDefinition } from '@/lib/flows/schema'
import { resumeMatchingWaits } from '@/lib/flows/resume-waits'

type Sb = SupabaseClient<Database>

export type SeoEventType = 'seo.audit_completed' | 'seo.critical_issue_new'

/** Exposed to workflows as {{seo.*}}. */
export interface SeoEventPayload {
  site_id: string
  site_name: string
  host: string
  audit_id: string
  /** Dashboard link to the audit. */
  url: string
  health_score: number | null
  previous_health_score: number | null
  errors: number
  warnings: number
  notices: number
  pages_crawled: number
  new_issue_count: number
  /** New error-severity issues: [{ code, title, url }] (first 20). */
  new_issues: Array<{ code: string; title: string; url: string | null }>
}

export async function emitSeoEvent(
  supabase: Sb,
  orgId: string,
  eventType: SeoEventType,
  seo: SeoEventPayload,
): Promise<{ dispatched: number; dispatchId: string | null }> {
  try {
    const { data: matchedRows } = await supabase
      .from('workflows')
      .select('id, current_version_id')
      .eq('org_id', orgId)
      .eq('trigger_type', 'event')
      .eq('is_active', true)
      .eq('health_blocked', false)
      .contains('trigger_config', { event: eventType })
    const matched = (matchedRows ?? []) as Array<{ id: string; current_version_id: string | null }>

    // Audit every dispatch, even with no match — "why didn't anything fire" debugging.
    const { data: dispatchRow } = await supabase
      .from('event_dispatches')
      .insert({
        org_id: orgId,
        event_type: eventType,
        source_table: 'seo_audits',
        source_id: seo.audit_id,
        workflow_ids: matched.map((w) => w.id),
        payload: { event: eventType, site_id: seo.site_id, health_score: seo.health_score, new_issue_count: seo.new_issue_count } as Json,
      })
      .select('id')
      .maybeSingle()
    const dispatchId = dispatchRow?.id ?? null

    const triggerInput: Record<string, unknown> = { event: eventType, seo }

    void resumeMatchingWaits(supabase, { orgId, eventType, contactId: null, payload: triggerInput }).catch((err) => {
      console.error('[seo/events] resumeMatchingWaits error', err instanceof Error ? err.message : 'unknown error')
    })

    const versionIds = matched.map((w) => w.current_version_id).filter((id): id is string => Boolean(id))
    if (!versionIds.length) return { dispatched: 0, dispatchId }

    const { data: versions } = await supabase.from('workflow_versions').select('id, definition').in('id', versionIds)
    const definitions = new Map((versions ?? []).map((v) => [v.id, v.definition]))

    let dispatched = 0
    for (const workflow of matched) {
      const definition = workflow.current_version_id ? definitions.get(workflow.current_version_id) : null
      if (!definition) continue
      dispatched++
      if (definitionHasWait(definition)) {
        void runFlow({
          workflowId: workflow.id,
          versionId: workflow.current_version_id ?? null,
          definition: definition as FlowDefinition,
          orgId,
          triggerType: 'event',
          triggerPayload: triggerInput,
          supabase,
        }).catch((err) => console.error('[seo/events] runFlow failed', err instanceof Error ? err.message : 'unknown error'))
      } else {
        void runFlowSync({ workflowId: workflow.id, definition, triggerInput, context: { orgId } }).catch((err) =>
          console.error('[seo/events] runFlowSync failed', err instanceof Error ? err.message : 'unknown error'),
        )
      }
    }
    return { dispatched, dispatchId }
  } catch (err) {
    console.error('[seo/events] dispatch failed', err instanceof Error ? err.message : 'unknown error')
    return { dispatched: 0, dispatchId: null }
  }
}
