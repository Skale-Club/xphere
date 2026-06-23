import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'
import { runFlowSync } from '@/lib/workflows/run-flow-sync'
import type { LeadIngestionPayload } from '@/lib/leads/ingestion-schema'

type ServiceClient = SupabaseClient<Database>

type MatchedWorkflow = {
  id: string
  current_version_id: string | null
}

export async function emitLeadCaptured(
  supabase: ServiceClient,
  orgId: string,
  receiptId: string,
  contactId: string,
  payload: LeadIngestionPayload,
): Promise<{ dispatched: number; dispatchId: string | null }> {
  try {
    const { data: matchedRows } = await supabase
      .from('workflows')
      .select('id, current_version_id')
      .eq('org_id', orgId)
      .eq('trigger_type', 'event')
      .eq('is_active', true)
      .eq('health_blocked', false)
      .contains('trigger_config', { event: 'lead.captured' })

    const matched = (matchedRows ?? []) as MatchedWorkflow[]
    const auditPayload: Json = {
      event: 'lead.captured',
      receipt_id: receiptId,
      contact_id: contactId,
    }
    const { data: dispatchRow } = await supabase
      .from('event_dispatches')
      .insert({
        org_id: orgId,
        event_type: 'lead.captured',
        source_table: 'lead_ingestions',
        source_id: receiptId,
        workflow_ids: matched.map((workflow) => workflow.id),
        payload: auditPayload,
      })
      .select('id')
      .maybeSingle()
    const dispatchId = dispatchRow?.id ?? null

    if (dispatchId) {
      await supabase
        .from('lead_ingestions')
        .update({ workflow_dispatch_id: dispatchId })
        .eq('id', receiptId)
        .eq('org_id', orgId)
    }

    if (matched.length === 0) return { dispatched: 0, dispatchId }

    const { data: contact } = await supabase
      .from('contacts')
      .select('id, name, first_name, last_name, email, phone, company, notes, source')
      .eq('id', contactId)
      .eq('org_id', orgId)
      .maybeSingle()
    if (!contact) return { dispatched: 0, dispatchId }

    const versionIds = matched
      .map((workflow) => workflow.current_version_id)
      .filter((id): id is string => Boolean(id))
    if (versionIds.length === 0) return { dispatched: 0, dispatchId }

    const { data: versions } = await supabase
      .from('workflow_versions')
      .select('id, definition')
      .in('id', versionIds)
    const definitions = new Map((versions ?? []).map((version) => [version.id, version.definition]))

    const triggerInput = {
      event: 'lead.captured',
      contact,
      lead: {
        receipt_id: receiptId,
        occurred_at: payload.occurred_at,
        status: payload.lead.status,
        score: payload.lead.score ?? null,
        classification: payload.lead.classification ?? null,
        page_url: payload.lead.page_url ?? null,
        answers: payload.lead.answers,
        attribution: payload.attribution ?? {},
        source: payload.source,
      },
    }

    for (const workflow of matched) {
      const definition = workflow.current_version_id
        ? definitions.get(workflow.current_version_id)
        : null
      if (!definition) continue
      void runFlowSync({
        workflowId: workflow.id,
        definition,
        triggerInput,
        context: { orgId },
      }).catch((error) => {
        console.error('[leads/events] workflow failed', error instanceof Error ? error.message : 'unknown error')
      })
    }

    return { dispatched: matched.length, dispatchId }
  } catch (error) {
    console.error('[leads/events] dispatch failed', error instanceof Error ? error.message : 'unknown error')
    return { dispatched: 0, dispatchId: null }
  }
}
