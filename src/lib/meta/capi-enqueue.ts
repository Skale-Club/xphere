// Meta CAPI — enqueue conversion events into the outbox (meta_capi_events).
//
// Called fire-and-forget from the contact / pipeline event emitters. Resolves
// the org's CAPI config + the contact's click signals, hashes user_data, and
// writes a durable row for the worker to send. Never throws to the caller.
//
// Event mapping (defaults, overridable via meta_capi_config.event_map):
//   lead       → 'Lead'           (contact.created)            action_source website
//   qualified  → 'QualifiedLead'  (opportunity → Qualified)    action_source system_generated
//   purchase   → 'Purchase'       (opportunity.won, + value)   action_source system_generated

import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildUserData } from '@/lib/meta/capi'
import { resolveClickSignals, resolveBrowserEventId } from '@/lib/analytics/identify'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>

type EventKey = 'lead' | 'qualified' | 'purchase'

const EVENT_NAMES: Record<EventKey, string> = {
  lead: 'Lead',
  qualified: 'QualifiedLead',
  purchase: 'Purchase',
}

interface CapiConfig {
  org_id: string
  enabled: boolean
  default_currency: string
  event_map: Record<string, { enabled?: boolean; stage_name?: string; value_source?: string }>
}

async function loadConfig(supabase: Db, orgId: string): Promise<CapiConfig | null> {
  const { data } = await supabase
    .from('meta_capi_config')
    .select('org_id, enabled, default_currency, event_map')
    .eq('org_id', orgId)
    .maybeSingle()
  if (!data || !data.enabled) return null
  return data as CapiConfig
}

function eventEnabled(config: CapiConfig, key: EventKey): boolean {
  const entry = config.event_map?.[key]
  // Default-on when the key is absent from the map.
  return entry?.enabled !== false
}

async function fetchContact(supabase: Db, contactId: string) {
  const { data } = await supabase
    .from('contacts')
    .select('id, name, first_name, last_name, email, phone, phone_e164, external_id')
    .eq('id', contactId)
    .maybeSingle()
  return data
}

async function eventSourceUrl(supabase: Db, orgId: string): Promise<string | undefined> {
  const { data } = await supabase
    .from('analytics_setups')
    .select('primary_website_url')
    .eq('organization_id', orgId)
    .maybeSingle()
  return data?.primary_website_url ?? undefined
}

interface InsertSpec {
  orgId: string
  eventName: string
  eventId: string
  actionSource: 'website' | 'system_generated'
  sourceTable: 'contacts' | 'opportunities'
  sourceId: string
  userData: Record<string, unknown>
  customData?: Record<string, unknown>
  eventSourceUrl?: string
}

async function insertOutbox(supabase: Db, spec: InsertSpec): Promise<void> {
  const payload: Record<string, unknown> = { user_data: spec.userData }
  if (spec.customData) payload.custom_data = spec.customData
  if (spec.eventSourceUrl) payload.event_source_url = spec.eventSourceUrl

  await supabase.from('meta_capi_events').upsert(
    {
      org_id: spec.orgId,
      event_name: spec.eventName,
      event_id: spec.eventId,
      event_time: new Date().toISOString(),
      action_source: spec.actionSource,
      source_table: spec.sourceTable,
      source_id: spec.sourceId,
      payload,
      status: 'pending',
      next_attempt_at: new Date().toISOString(),
    },
    { onConflict: 'org_id,event_name,event_id', ignoreDuplicates: true },
  )
}

/** Build the hashed user_data for a contact, enriched with click signals. */
async function userDataForContact(
  supabase: Db,
  orgId: string,
  contactId: string,
): Promise<{ userData: Record<string, unknown>; hasClick: boolean } | null> {
  const contact = await fetchContact(supabase, contactId)
  if (!contact) return null
  const signals = await resolveClickSignals(orgId, contactId, { supabase })
  const userData = await buildUserData({
    email: contact.email,
    phone: contact.phone_e164 ?? contact.phone,
    firstName: contact.first_name,
    lastName: contact.last_name,
    externalId: contact.external_id ?? contact.id,
    fbc: signals.fbc,
    fbp: signals.fbp,
    clientIp: signals.client_ip_address,
    clientUserAgent: signals.client_user_agent,
  })
  // Need at least one match key to bother sending.
  if (!userData.em && !userData.ph && !userData.fbc && !userData.fbp) return null
  return { userData, hasClick: Boolean(signals.fbc || signals.fbp) }
}

// ─── Public enqueue functions ───────────────────────────────────────────────

export async function enqueueLead(
  orgId: string,
  contactId: string,
  options: { supabase?: Db } = {},
): Promise<void> {
  try {
    const supabase = (options.supabase ?? createServiceRoleClient()) as Db
    const config = await loadConfig(supabase, orgId)
    if (!config || !eventEnabled(config, 'lead')) return

    const built = await userDataForContact(supabase, orgId, contactId)
    if (!built) return

    // Dedup with the browser Pixel Lead when we can find its eventID.
    const browserEventId = await resolveBrowserEventId(orgId, contactId, { supabase })
    const eventId = browserEventId ?? `lead_${contactId}`

    await insertOutbox(supabase, {
      orgId,
      eventName: EVENT_NAMES.lead,
      eventId,
      actionSource: built.hasClick ? 'website' : 'system_generated',
      sourceTable: 'contacts',
      sourceId: contactId,
      userData: built.userData,
      eventSourceUrl: built.hasClick ? await eventSourceUrl(supabase, orgId) : undefined,
    })
  } catch (err) {
    console.error('[capi-enqueue] enqueueLead error:', err instanceof Error ? err.message : err)
  }
}

export async function enqueueQualified(
  orgId: string,
  opportunityId: string,
  stageName: string | null,
  options: { supabase?: Db } = {},
): Promise<void> {
  try {
    const supabase = (options.supabase ?? createServiceRoleClient()) as Db
    const config = await loadConfig(supabase, orgId)
    if (!config || !eventEnabled(config, 'qualified')) return

    // Only fire when the destination stage matches the configured qualified stage.
    const wanted = config.event_map?.qualified?.stage_name ?? 'Qualified'
    if (!stageName || stageName.toLowerCase() !== wanted.toLowerCase()) return

    const { data: opp } = await supabase
      .from('opportunities')
      .select('id, contact_id, value, currency')
      .eq('id', opportunityId)
      .maybeSingle()
    if (!opp?.contact_id) return

    const built = await userDataForContact(supabase, orgId, opp.contact_id)
    if (!built) return

    await insertOutbox(supabase, {
      orgId,
      eventName: EVENT_NAMES.qualified,
      eventId: `qualified_${opportunityId}`,
      actionSource: 'system_generated',
      sourceTable: 'opportunities',
      sourceId: opportunityId,
      userData: built.userData,
      customData: opp.value
        ? { value: Number(opp.value), currency: opp.currency ?? config.default_currency }
        : undefined,
    })
  } catch (err) {
    console.error('[capi-enqueue] enqueueQualified error:', err instanceof Error ? err.message : err)
  }
}

export async function enqueuePurchase(
  orgId: string,
  opportunityId: string,
  options: { supabase?: Db } = {},
): Promise<void> {
  try {
    const supabase = (options.supabase ?? createServiceRoleClient()) as Db
    const config = await loadConfig(supabase, orgId)
    if (!config || !eventEnabled(config, 'purchase')) return

    const { data: opp } = await supabase
      .from('opportunities')
      .select('id, contact_id, value, currency')
      .eq('id', opportunityId)
      .maybeSingle()
    if (!opp?.contact_id) return

    const built = await userDataForContact(supabase, orgId, opp.contact_id)
    if (!built) return

    await insertOutbox(supabase, {
      orgId,
      eventName: EVENT_NAMES.purchase,
      eventId: `purchase_${opportunityId}`,
      actionSource: 'system_generated',
      sourceTable: 'opportunities',
      sourceId: opportunityId,
      userData: built.userData,
      customData: {
        value: Number(opp.value ?? 0),
        currency: opp.currency ?? config.default_currency,
      },
    })
  } catch (err) {
    console.error('[capi-enqueue] enqueuePurchase error:', err instanceof Error ? err.message : err)
  }
}
