// Contact lifecycle event emitter.
//
// Bridges contact mutations into the unified workflow engine, mirroring the
// pattern in src/lib/pipeline/events.ts and src/lib/calendar/transition.ts:
//   1. Look up active 'event' workflows whose trigger_config.event matches.
//   2. Record an audit row in event_dispatches.
//   3. Build the contact scope and dispatch each workflow via runFlowSync.
//
// Currently emits `contact.created`. The trigger is declared in the workflow
// spec (src/lib/workflows/spec.ts → 'event:contact.created') and exposes the
// `contact.*` namespace to downstream nodes.

import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'
import { runFlowSync } from '@/lib/workflows/run-flow-sync'

export type ContactEventType = 'contact.created'

/** Fields exposed to workflows under the `contact.*` namespace. */
interface ContactScope {
  id: string
  name: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  company: string | null
  notes: string | null
  source: string | null
}

interface MatchedWorkflow {
  id: string
  current_version_id: string | null
}

async function findMatchingWorkflows(
  supabase: SupabaseClient<Database>,
  orgId: string,
  eventType: ContactEventType,
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

async function buildContactScope(
  supabase: SupabaseClient<Database>,
  contactId: string,
): Promise<ContactScope | null> {
  const { data } = await supabase
    .from('contacts')
    .select('id, name, first_name, last_name, email, phone, company, notes, source')
    .eq('id', contactId)
    .maybeSingle()
  return (data as ContactScope | null) ?? null
}

/**
 * Emit a contact lifecycle event. Fire-and-forget friendly: never throws,
 * returns a small summary. Matching workflows run via runFlowSync (which has
 * its own timeout) so the caller is not blocked by workflow execution.
 */
export async function emitContactEvent(
  orgId: string,
  eventType: ContactEventType,
  contactId: string,
  options: { supabase?: SupabaseClient<Database> } = {},
): Promise<{ dispatched: number; dispatch_id: string | null }> {
  try {
    const supabase = options.supabase ?? createServiceRoleClient()

    const matched = await findMatchingWorkflows(supabase, orgId, eventType)

    // Always record the dispatch (even when nothing matched) for "why didn't
    // anything fire" debugging.
    const auditPayload: Json = { event: eventType, contact_id: contactId }
    const { data: dispatchRow } = await supabase
      .from('event_dispatches')
      .insert({
        org_id: orgId,
        event_type: eventType,
        source_table: 'contacts',
        source_id: contactId,
        workflow_ids: matched.map((m) => m.id),
        payload: auditPayload,
      })
      .select('id')
      .maybeSingle()
    const dispatchId = (dispatchRow as { id: string } | null)?.id ?? null

    if (matched.length === 0) return { dispatched: 0, dispatch_id: dispatchId }

    const contact = await buildContactScope(supabase, contactId)
    if (!contact) return { dispatched: 0, dispatch_id: dispatchId }

    const triggerInput: Record<string, unknown> = { contact, event: eventType }

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
      // Fire-and-forget — a failing workflow must never block contact creation.
      void runFlowSync({
        workflowId: wf.id,
        definition,
        triggerInput,
        context: { orgId },
      }).catch((err) => {
        console.error('[contacts/events] runFlowSync error:', err)
      })
    }

    return { dispatched: matched.length, dispatch_id: dispatchId }
  } catch (err) {
    console.error(
      `[contacts/events] emit failed org_id=${orgId} event=${eventType}`,
      err instanceof Error ? err.message : String(err),
    )
    return { dispatched: 0, dispatch_id: null }
  }
}
