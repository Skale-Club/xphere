'use server'

/**
 * Server actions for the SEED-007 Call System.
 *
 * Distinct from /calls (Vapi AI calls). The new manual call history lives in
 * `call_logs` and the per-user routing config lives in `call_settings`.
 */

import { revalidatePath } from 'next/cache'
import { createClient, getUser } from '@/lib/supabase/server'
import { encrypt, decrypt } from '@/lib/crypto'
import type { Database, CallRoutingMode } from '@/types/database'
import {
  callSettingsFormSchema,
  normaliseE164,
  generateSipUsername,
  generateSipPassword,
  generateClientIdentity,
  type CallSettingsFormInput,
} from '@/lib/calls/zod-schemas'

type CallLogRow = Database['public']['Tables']['call_logs']['Row']

export interface CurrentCallSettings {
  id: string | null
  routing_mode: CallRoutingMode
  phone_forward: string | null
  sip_username: string | null
  sip_password: string | null   // decrypted, only included on freshly-rotated rows
  twilio_client_identity: string | null
  record_calls: boolean
}

export async function getCurrentCallSettings(): Promise<CurrentCallSettings | null> {
  const user = await getUser()
  if (!user) return null
  const supabase = await createClient()
  const { data } = await supabase
    .from('call_settings')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!data) {
    return {
      id: null,
      routing_mode: 'phone_forward',
      phone_forward: null,
      sip_username: null,
      sip_password: null,
      twilio_client_identity: null,
      record_calls: true,
    }
  }

  return {
    id: data.id,
    routing_mode: data.routing_mode,
    phone_forward: data.phone_forward,
    sip_username: data.sip_username,
    // We don't decrypt the password by default | exposed only via rotateSipPassword.
    sip_password: null,
    twilio_client_identity: data.twilio_client_identity,
    record_calls: data.record_calls,
  }
}

export async function saveCallSettings(
  input: CallSettingsFormInput,
): Promise<{ error?: string; settings?: CurrentCallSettings }> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const parsed = callSettingsFormSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }
  const data = parsed.data
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No active organization.' }

  // Read existing row so we preserve auto-generated credentials.
  const { data: existing } = await supabase
    .from('call_settings')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()

  const phoneForward = data.routing_mode === 'phone_forward'
    ? normaliseE164(data.phone_forward ?? null)
    : (existing?.phone_forward ?? null)

  // Auto-generate SIP creds when switching into SIP mode for the first time.
  let sipUsername = existing?.sip_username ?? null
  let sipPasswordEncrypted = existing?.sip_password_encrypted ?? null
  if (data.routing_mode === 'sip' && (!sipUsername || !sipPasswordEncrypted)) {
    const { data: org } = await supabase.from('organizations').select('slug').eq('id', orgId).single()
    sipUsername = generateSipUsername(org?.slug ?? 'org', user.id)
    const password = generateSipPassword()
    sipPasswordEncrypted = await encrypt(password)
  }

  // Auto-generate Twilio client identity when switching into browser mode.
  let identity = existing?.twilio_client_identity ?? null
  if (data.routing_mode === 'browser' && !identity) {
    identity = generateClientIdentity(user.id)
  }

  const payload = {
    org_id: orgId,
    user_id: user.id,
    routing_mode: data.routing_mode,
    phone_forward: phoneForward,
    sip_username: sipUsername,
    sip_password_encrypted: sipPasswordEncrypted,
    twilio_client_identity: identity,
    record_calls: data.record_calls,
  }

  if (existing) {
    const { error } = await supabase
      .from('call_settings')
      .update({
        routing_mode: payload.routing_mode,
        phone_forward: payload.phone_forward,
        sip_username: payload.sip_username,
        sip_password_encrypted: payload.sip_password_encrypted,
        twilio_client_identity: payload.twilio_client_identity,
        record_calls: payload.record_calls,
      })
      .eq('id', existing.id)
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase.from('call_settings').insert(payload)
    if (error) return { error: error.message }
  }

  revalidatePath('/settings/phone-numbers')
  revalidatePath('/voice')

  return {
    settings: {
      id: existing?.id ?? null,
      routing_mode: payload.routing_mode,
      phone_forward: payload.phone_forward,
      sip_username: payload.sip_username,
      sip_password: null,
      twilio_client_identity: payload.twilio_client_identity,
      record_calls: payload.record_calls,
    },
  }
}

/**
 * Rotates the SIP password and returns the plaintext ONE TIME so the user can
 * paste it into Zoiper. Future reads of `getCurrentCallSettings()` will surface
 * a null sip_password.
 */
export async function rotateSipPassword(): Promise<{ error?: string; password?: string; username?: string }> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No active organization.' }

  const { data: existing } = await supabase
    .from('call_settings')
    .select('id, sip_username')
    .eq('user_id', user.id)
    .maybeSingle()

  let username = existing?.sip_username ?? null
  if (!username) {
    const { data: org } = await supabase.from('organizations').select('slug').eq('id', orgId).single()
    username = generateSipUsername(org?.slug ?? 'org', user.id)
  }

  const password = generateSipPassword()
  const encrypted = await encrypt(password)

  if (existing) {
    await supabase
      .from('call_settings')
      .update({ sip_username: username, sip_password_encrypted: encrypted })
      .eq('id', existing.id)
  } else {
    await supabase.from('call_settings').insert({
      org_id: orgId,
      user_id: user.id,
      routing_mode: 'sip',
      sip_username: username,
      sip_password_encrypted: encrypted,
    })
  }

  revalidatePath('/settings/phone-numbers')
  return { password, username }
}

export async function getSipDomain(): Promise<string | null> {
  const user = await getUser()
  if (!user) return null
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return null
  const { data: integration } = await supabase
    .from('integrations')
    .select('config')
    .eq('organization_id', orgId)
    .eq('provider', 'twilio')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()
  if (!integration) return null
  const config = integration.config as { sip_domain?: string } | null
  return config?.sip_domain ?? null
}

// ─── Call history ────────────────────────────────────────────────────────────

export interface CallLogWithContact extends CallLogRow {
  contact_name: string | null
}

export interface CallListResult {
  rows: CallLogWithContact[]
  total: number
}

export async function listCallLogs(filters?: {
  direction?: 'inbound' | 'outbound' | 'missed' | 'all'
  contactId?: string
  limit?: number
}): Promise<CallListResult> {
  const user = await getUser()
  if (!user) return { rows: [], total: 0 }
  const supabase = await createClient()

  const limit = Math.min(filters?.limit ?? 100, 200)
  let query = supabase
    .from('call_logs')
    .select('*, contacts!call_logs_contact_id_fkey(name)', { count: 'exact' })
    .order('started_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(limit)

  if (filters?.contactId) query = query.eq('contact_id', filters.contactId)
  if (filters?.direction === 'inbound') query = query.eq('direction', 'inbound')
  if (filters?.direction === 'outbound') query = query.eq('direction', 'outbound')
  if (filters?.direction === 'missed') {
    query = query.eq('direction', 'inbound').in('status', ['no-answer', 'busy', 'failed', 'canceled'])
  }

  const { data, count } = await query
  if (!data) return { rows: [], total: 0 }

  const rows: CallLogWithContact[] = data.map((row) => {
    const r = row as CallLogRow & { contacts: { name: string | null } | null }
    return { ...(row as CallLogRow), contact_name: r.contacts?.name ?? null }
  })

  return { rows, total: count ?? 0 }
}

export async function getCallLog(id: string): Promise<(CallLogWithContact & { contact_phone: string | null }) | null> {
  const user = await getUser()
  if (!user) return null
  const supabase = await createClient()
  const { data } = await supabase
    .from('call_logs')
    .select('*, contacts!call_logs_contact_id_fkey(name, phone)')
    .eq('id', id)
    .maybeSingle()
  if (!data) return null
  const row = data as CallLogRow & { contacts: { name: string | null; phone: string | null } | null }
  return {
    ...(data as CallLogRow),
    contact_name: row.contacts?.name ?? null,
    contact_phone: row.contacts?.phone ?? null,
  }
}

export async function updateCallNotes(
  id: string,
  notes: string,
): Promise<{ error?: string }> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()
  const { error } = await supabase.from('call_logs').update({ notes }).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath(`/voice/${id}`)
  return {}
}

export async function getCallLogsForContact(
  contactId: string,
  limit = 20,
): Promise<CallLogRow[]> {
  const user = await getUser()
  if (!user) return []
  const supabase = await createClient()
  const { data } = await supabase
    .from('call_logs')
    .select('*')
    .eq('contact_id', contactId)
    .order('started_at', { ascending: false, nullsFirst: false })
    .limit(limit)
  return data ?? []
}

// Exported for tests
export { decrypt }

// ─── Dial-pad panel helpers ──────────────────────────────────────────────────

export interface OrgPhoneNumber {
  id: string
  e164: string
  friendly_name: string
  is_default: boolean
}

export async function getOrgPhoneNumbers(): Promise<OrgPhoneNumber[]> {
  const user = await getUser()
  if (!user) return []
  const supabase = await createClient()
  const { data } = await supabase
    .from('twilio_phone_numbers')
    .select('id, e164, friendly_name, is_default')
    .eq('is_active', true)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true })
  return data ?? []
}

export async function toggleRecordCalls(record: boolean): Promise<{ error?: string }> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()
  const { data: existing } = await supabase
    .from('call_settings')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (existing) {
    const { error } = await supabase
      .from('call_settings')
      .update({ record_calls: record })
      .eq('id', existing.id)
    if (error) return { error: error.message }
  } else {
    const { data: orgId } = await supabase.rpc('get_current_org_id')
    if (!orgId) return { error: 'No active organization.' }
    const { error } = await supabase.from('call_settings').insert({
      org_id: orgId,
      user_id: user.id,
      routing_mode: 'phone_forward',
      record_calls: record,
    })
    if (error) return { error: error.message }
  }
  return {}
}
