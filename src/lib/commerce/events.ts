// emitCommerceEvent — 1:1 mirror of emitLeadCaptured (src/lib/leads/events.ts) for
// inbound Medusa commerce webhooks (contract §5). Maps the webhook `type` to the
// workflow trigger event (`commerce.<type>`), finds-or-creates a contact by email,
// annotates the originating conversation via the pinned `cart` key — LOCKED
// OVERRIDE: Phase 133 renamed the pinned conversation key from `cart_id` to
// `cart` (see 136-RESEARCH Pitfall 1; verified against src/lib/medusa/context.ts,
// actions/get-cart.ts, actions/add-to-cart.ts) — dispatches matching workflows,
// and audits every dispatch in event_dispatches. Money (`total`, `unit_price`) is
// forwarded in MAJOR units, exactly as received — never converted to minor units
// (cents). Never throws.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'
import { findOrCreateContactByEmail } from '@/lib/contacts/find-or-create-by-email'
import { emitContactEvent } from '@/lib/contacts/events'
import { runFlowSync } from '@/lib/workflows/run-flow-sync'
import { runFlow, definitionHasWait } from '@/lib/flows/engine'
import type { FlowDefinition } from '@/lib/flows/schema'
import { resumeMatchingWaits } from '@/lib/flows/resume-waits'

type ServiceClient = SupabaseClient<Database>

export interface CommerceOrderItem {
  title: string
  variant_id: string | null
  quantity: number
  unit_price: number // MAJOR units — verbatim from contract §5
}

export interface CommerceOrderData {
  order_id: string
  display_id: number
  email: string
  currency_code: string
  total: number // MAJOR units — verbatim from contract §5
  cart_id: string | null
  items: CommerceOrderItem[]
}

export interface CommerceCustomerData {
  customer_id: string
  email: string
  first_name?: string | null
  last_name?: string | null
}

type MatchedWorkflow = {
  id: string
  current_version_id: string | null
}

const WF_EVENT_MAP = {
  'order.placed': 'commerce.order.placed',
  'customer.created': 'commerce.customer.created',
} as const

export async function emitCommerceEvent(
  supabase: ServiceClient,
  orgId: string,
  receiptId: string,
  type: 'order.placed' | 'customer.created',
  data: CommerceOrderData | CommerceCustomerData,
): Promise<{ dispatched: number; dispatchId: string | null }> {
  try {
    // Body `type` and the workflow trigger event are different namespaces — map explicitly.
    const WF_EVENT = WF_EVENT_MAP[type]

    // 1. Find-or-create contact by email — delegates to the shared UIX-03
    // helper (find-or-create-by-email.ts) so this stays the ONLY other
    // consumer alongside the chat route's linkVerifiedContact; no inline
    // upsert is forked here anymore.
    const { contactId: cid, created: contactWasCreated } = await findOrCreateContactByEmail(supabase, orgId, data.email, {
      lifecycleStage: type === 'order.placed' ? 'customer' : 'lead',
      sourceType: 'medusa',
      sourceId:
        type === 'order.placed' ? (data as CommerceOrderData).order_id : (data as CommerceCustomerData).customer_id,
      ...(type === 'customer.created'
        ? {
            firstName: (data as CommerceCustomerData).first_name ?? null,
            lastName: (data as CommerceCustomerData).last_name ?? null,
            name:
              [(data as CommerceCustomerData).first_name, (data as CommerceCustomerData).last_name]
                .filter(Boolean)
                .join(' ')
                .trim() || null,
          }
        : {}),
    })
    const contactId: string | null = cid
    if (contactWasCreated && cid) {
      // A commerce-created contact is still a new contact — mirror the leads route.
      void emitContactEvent(orgId, 'contact.created', cid, { supabase }).catch((err) => {
        console.error('[commerce/events] emitContactEvent error', err instanceof Error ? err.message : 'unknown error')
      })
    }

    // 2. Query matching workflows.
    const { data: matchedRows } = await supabase
      .from('workflows')
      .select('id, current_version_id')
      .eq('org_id', orgId)
      .eq('trigger_type', 'event')
      .eq('is_active', true)
      .eq('health_blocked', false)
      .contains('trigger_config', { event: WF_EVENT })

    const matched = (matchedRows ?? []) as MatchedWorkflow[]

    // Audit the dispatch regardless of match count — "why didn't anything fire" debugging.
    const auditPayload: Json = { event: WF_EVENT, receipt_id: receiptId, contact_id: contactId }
    const { data: dispatchRow } = await supabase
      .from('event_dispatches')
      .insert({
        org_id: orgId,
        event_type: WF_EVENT,
        source_table: 'commerce_event_receipts',
        source_id: receiptId,
        workflow_ids: matched.map((workflow) => workflow.id),
        payload: auditPayload,
      })
      .select('id')
      .maybeSingle()
    const dispatchId = dispatchRow?.id ?? null

    // 3. Conversation annotation — order.placed only, and only when cart_id is set.
    if (type === 'order.placed') {
      const order = data as CommerceOrderData
      if (order.cart_id) {
        const { data: convo } = await supabase
          .from('conversations')
          .select('id, contact_id, memory')
          .eq('org_id', orgId)
          .eq('memory->commerce->>cart', order.cart_id) // ← key is `cart`, NOT cart_id (Phase 133 renamed it)
          .order('last_active_at', { ascending: false })
          .limit(1) // guards maybeSingle() against >1 row
          .maybeSingle()

        if (convo) {
          const memory = (convo.memory as Record<string, unknown>) ?? {}
          const commerce = (memory.commerce as Record<string, unknown>) ?? {}
          const update: Record<string, unknown> = {
            // Spread-merge — never clobber other pinned keys (cus, region_id, write_count, …).
            memory: { ...memory, commerce: { ...commerce, last_order_display_id: order.display_id } },
          }
          if (!convo.contact_id) update.contact_id = contactId
          await supabase.from('conversations').update(update).eq('id', convo.id).eq('org_id', orgId)
        }
      }
    }

    // 4. Build triggerInput and dispatch matched workflows.
    const { data: contact } = contactId
      ? await supabase
          .from('contacts')
          .select('id, name, first_name, last_name, email, phone, company, notes, source')
          .eq('id', contactId)
          .eq('org_id', orgId)
          .maybeSingle()
      : { data: null }

    const triggerInput: Record<string, unknown> =
      type === 'order.placed'
        ? { event: WF_EVENT, contact, order: { ...(data as CommerceOrderData) } }
        : { event: WF_EVENT, contact, customer: { ...(data as CommerceCustomerData) } }

    // Resume runs suspended on a wait node this event satisfies (by contact).
    void resumeMatchingWaits(supabase, {
      orgId,
      eventType: WF_EVENT,
      contactId,
      payload: triggerInput,
    }).catch((error) => {
      console.error('[commerce/events] resumeMatchingWaits error', error instanceof Error ? error.message : 'unknown error')
    })

    if (matched.length === 0) return { dispatched: 0, dispatchId }

    const versionIds = matched
      .map((workflow) => workflow.current_version_id)
      .filter((id): id is string => Boolean(id))
    if (versionIds.length === 0) return { dispatched: 0, dispatchId }

    const { data: versions } = await supabase
      .from('workflow_versions')
      .select('id, definition')
      .in('id', versionIds)
    const definitions = new Map((versions ?? []).map((version) => [version.id, version.definition]))

    for (const workflow of matched) {
      const definition = workflow.current_version_id
        ? definitions.get(workflow.current_version_id)
        : null
      if (!definition) continue
      if (definitionHasWait(definition)) {
        void runFlow({
          workflowId: workflow.id,
          versionId: workflow.current_version_id ?? null,
          definition: definition as FlowDefinition,
          orgId,
          triggerType: 'event',
          triggerPayload: triggerInput,
          supabase,
        }).catch((error) => {
          console.error('[commerce/events] runFlow failed', error instanceof Error ? error.message : 'unknown error')
        })
      } else {
        void runFlowSync({
          workflowId: workflow.id,
          definition,
          triggerInput,
          context: { orgId },
        }).catch((error) => {
          console.error('[commerce/events] runFlowSync failed', error instanceof Error ? error.message : 'unknown error')
        })
      }
    }

    return { dispatched: matched.length, dispatchId }
  } catch (error) {
    console.error('[commerce/events] dispatch failed', error instanceof Error ? error.message : 'unknown error')
    return { dispatched: 0, dispatchId: null }
  }
}
