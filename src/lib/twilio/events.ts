// SEED-044+ (phone-numbers Phase 3): inbound phone-number event emitter.
//
// Mirrors src/lib/pipeline/events.ts (emitOpportunityEvent) and
// src/lib/calendar/transition.ts (emitCalendarEvent):
//   1. Build {{phone.*}} + {{contact.*}} scope.
//   2. Look up active event-trigger workflows whose trigger_config.event matches.
//      Optional trigger_config.phone_number_id narrows the match to one number.
//   3. Record an audit row in event_dispatches.
//   4. Dispatch each via runFlowSync (fire-and-forget).
//
// Cascade depth is tracked the same way pipeline events do, but inbound webhook
// events are unlikely to re-fire themselves; the safeguard is kept for parity.
//
// IMPORTANT: this emitter is invoked from webhook handlers (Twilio SMS / Voice),
// which return synchronously. We never throw — emission failures must not block
// the inbound HTTP response or break the conversation/call_log persistence.

import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'
import { runFlowSync } from '@/lib/workflows/run-flow-sync'
import { runFlow, definitionHasWait } from '@/lib/flows/engine'
import type { FlowDefinition } from '@/lib/flows/schema'
import { resumeMatchingWaits } from '@/lib/flows/resume-waits'
import { buildPhoneScope, lookupContactByPhone } from '@/lib/twilio/scope'

export type InboundPhoneEventType = 'inbound_sms_to_number' | 'inbound_call_to_number'

export interface InboundPhoneEventPayload {
  /** UUID of the twilio_phone_numbers row that received the inbound traffic. */
  phoneNumberId: string | null
  /** Sender's phone in E.164 (used for contact lookup). */
  fromNumber: string | null
  /** The org's number that received the inbound traffic in E.164. */
  toNumber: string | null
  /** UUID of the conversations row (SMS path) when known. */
  conversationId?: string | null
  /** UUID of the call_logs row (voice path) when known. */
  callLogId?: string | null
  /** Provider message/call id for traceability. */
  externalId?: string | null
}

export interface EmitInboundPhoneEventOptions {
  depth?: number
  parentDispatchId?: string | null
  supabase?: SupabaseClient<Database>
}

const MAX_CASCADE_DEPTH = 3
const SOURCE_TABLE_BY_EVENT: Record<InboundPhoneEventType, string> = {
  inbound_sms_to_number: 'conversations',
  inbound_call_to_number: 'call_logs',
}

interface MatchedWorkflow {
  id: string
  current_version_id: string | null
  trigger_config: Record<string, unknown> | null
}

async function findMatchingWorkflows(
  supabase: SupabaseClient<Database>,
  orgId: string,
  eventType: InboundPhoneEventType,
  phoneNumberId: string | null,
): Promise<MatchedWorkflow[]> {
  const { data, error } = await supabase
    .from('workflows')
    .select('id, current_version_id, trigger_config')
    .eq('org_id', orgId)
    .eq('trigger_type', 'event')
    .eq('is_active', true)
    .eq('health_blocked', false)
    .contains('trigger_config', { event: eventType })

  if (error || !data) return []

  return (data as MatchedWorkflow[]).filter((wf) => {
    const cfgPhoneId = (wf.trigger_config as { phone_number_id?: string } | null)?.phone_number_id
    if (!cfgPhoneId) return true
    return cfgPhoneId === phoneNumberId
  })
}

async function recordDispatch(
  supabase: SupabaseClient<Database>,
  orgId: string,
  eventType: InboundPhoneEventType,
  sourceId: string,
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
      source_table: SOURCE_TABLE_BY_EVENT[eventType],
      source_id: sourceId,
      workflow_ids: workflowIds,
      payload,
      parent_id: parentDispatchId,
      depth,
    })
    .select('id')
    .single()
  if (error) {
    console.error('[twilio/events] dispatch record error:', error.message)
    return null
  }
  return (data as { id: string }).id
}

export async function emitInboundPhoneEvent(
  orgId: string,
  eventType: InboundPhoneEventType,
  payload: InboundPhoneEventPayload,
  options: EmitInboundPhoneEventOptions = {},
): Promise<{ dispatched: number; dispatch_id: string | null }> {
  const depth = options.depth ?? 0
  if (depth > MAX_CASCADE_DEPTH) {
    console.warn(
      '[twilio/events] cascade depth limit hit',
      eventType,
      payload.phoneNumberId,
    )
    return { dispatched: 0, dispatch_id: null }
  }

  try {
    const supabase = options.supabase ?? createServiceRoleClient()

    const [phone, contact] = await Promise.all([
      buildPhoneScope(supabase, payload.phoneNumberId),
      lookupContactByPhone(supabase, orgId, payload.fromNumber),
    ])

    const matched = await findMatchingWorkflows(
      supabase,
      orgId,
      eventType,
      payload.phoneNumberId,
    )

    const sourceId =
      eventType === 'inbound_sms_to_number'
        ? payload.conversationId ?? null
        : payload.callLogId ?? null

    const auditPayload: Json = {
      event: eventType,
      phone_number_id: payload.phoneNumberId,
      from_number: payload.fromNumber,
      to_number: payload.toNumber,
      conversation_id: payload.conversationId ?? null,
      call_log_id: payload.callLogId ?? null,
      external_id: payload.externalId ?? null,
    }

    // Skip the audit insert when we have no source row id — event_dispatches
    // requires source_id NOT NULL. This only happens if the caller couldn't
    // persist the row before emitting (programmer error); log and continue.
    const dispatchId = sourceId
      ? await recordDispatch(
          supabase,
          orgId,
          eventType,
          sourceId,
          auditPayload,
          matched.map((m) => m.id),
          depth,
          options.parentDispatchId ?? null,
        )
      : null

    const triggerInput: Record<string, unknown> = {
      phone,
      contact,
      event: eventType,
      from_number: payload.fromNumber,
      to_number: payload.toNumber,
    }

    // Resume runs suspended on a wait node this inbound event satisfies.
    const phoneContactId =
      (contact as { id?: unknown } | null)?.id != null
        ? String((contact as { id?: unknown }).id)
        : null
    void resumeMatchingWaits(supabase, {
      orgId,
      eventType,
      contactId: phoneContactId,
      payload: triggerInput,
    }).catch((err) => {
      console.error('[twilio/events] resumeMatchingWaits error:', err)
    })

    if (matched.length === 0) {
      return { dispatched: 0, dispatch_id: dispatchId }
    }

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
      const definition = wf.current_version_id ? defById.get(wf.current_version_id) : null
      if (!definition) continue
      if (definitionHasWait(definition)) {
        void runFlow({
          workflowId: wf.id,
          versionId: wf.current_version_id ?? null,
          definition: definition as FlowDefinition,
          orgId,
          triggerType: 'event',
          triggerPayload: triggerInput,
          supabase,
        }).catch((err) => {
          console.error('[twilio/events] runFlow error:', err)
        })
      } else {
        void runFlowSync({
          workflowId: wf.id,
          definition,
          triggerInput,
          context: { orgId },
        }).catch((err) => {
          console.error('[twilio/events] runFlowSync error:', err)
        })
      }
    }

    return { dispatched: matched.length, dispatch_id: dispatchId }
  } catch (err) {
    console.error('[twilio/events] emit error (swallowed):', err)
    return { dispatched: 0, dispatch_id: null }
  }
}
