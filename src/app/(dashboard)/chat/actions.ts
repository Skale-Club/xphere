'use server'

import { createClient, getUser } from '@/lib/supabase/server'
import { resolveLiveContactId } from '@/lib/contacts/server'
import type { Database } from '@/types/database'
import type {
  ConversationPriority,
  ConversationStatus,
  ConversationSummary,
} from '@/types/chat'

export async function toggleBotStatus(
  conversationId: string,
  currentStatus: string
): Promise<{ botStatus: string } | { error: string }> {
  const user = await getUser()
  if (!user) return { error: 'Unauthorized' }

  const newStatus = currentStatus === 'active' ? 'paused' : 'active'
  const supabase = await createClient()
  const { error } = await supabase
    .from('conversations')
    .update({ bot_status: newStatus, updated_at: new Date().toISOString() })
    .eq('id', conversationId)

  if (error) return { error: 'Failed to update bot status' }

  // System message in the conversation feed so admins can see who toggled what.
  // Best-effort | failures are silent (don't block the toggle). Wrapped in
  // try/catch so test mocks that don't stub rpc/insert remain happy.
  try {
    const { data: orgId } = await supabase.rpc('get_current_org_id')
    if (orgId) {
      await supabase.from('conversation_messages').insert({
        conversation_id: conversationId,
        org_id: orgId as string,
        role: 'system',
        content: newStatus === 'paused' ? 'Bot paused by admin' : 'Bot resumed by admin',
        metadata: { type: 'bot_toggle', by: user.id, new_status: newStatus },
      })
    }
  } catch {
    // ignore | system message is best-effort UX
  }

  return { botStatus: newStatus }
}

/**
 * v2.2 | Pin/unpin a conversation. Pinned conversations always render first
 * in the inbox list (see /api/chat/conversations ordering).
 */
export async function pinConversation(
  conversationId: string,
  pinned: boolean,
): Promise<{ pinned: boolean } | { error: string }> {
  const user = await getUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('conversations')
    .update({ pinned, updated_at: new Date().toISOString() })
    .eq('id', conversationId)

  if (error) return { error: 'Failed to pin conversation' }
  return { pinned }
}

/**
 * SEED-035 | Star/unstar a conversation. Starred is a lightweight favorite
 * marker and is independent of pinned.
 */
export async function starConversation(
  conversationId: string,
  starred: boolean,
): Promise<{ starred: boolean } | { error: string }> {
  const user = await getUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('conversations')
    .update({ starred, updated_at: new Date().toISOString() })
    .eq('id', conversationId)

  if (error) return { error: 'Failed to star conversation' }
  return { starred }
}

/**
 * v2.2 | Set conversation priority. Triggers a colored left border on the
 * conversation card. 'normal' is the default and shows no decoration.
 */
export async function setConversationPriority(
  conversationId: string,
  priority: ConversationPriority,
): Promise<{ priority: ConversationPriority } | { error: string }> {
  const user = await getUser()
  if (!user) return { error: 'Unauthorized' }
  if (!['normal', 'high', 'urgent'].includes(priority)) {
    return { error: 'Invalid priority' }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('conversations')
    .update({ priority, updated_at: new Date().toISOString() })
    .eq('id', conversationId)

  if (error) return { error: 'Failed to update priority' }
  return { priority }
}

/**
 * v2.2 | Assign or unassign a conversation to a user in the same org.
 * Pass `null` to clear the assignment.
 */
export async function assignConversation(
  conversationId: string,
  userId: string | null,
): Promise<{ assignedUserId: string | null } | { error: string }> {
  const user = await getUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('conversations')
    .update({ assigned_user_id: userId, updated_at: new Date().toISOString() })
    .eq('id', conversationId)

  if (error) return { error: 'Failed to assign conversation' }
  return { assignedUserId: userId }
}

export interface OrgMember {
  userId: string
  email: string
  displayName: string | null
}

/**
 * Returns the list of users in the active org. Used by the "Assign to..."
 * dropdown in the chat header. RLS scopes to the active org automatically.
 */
export async function listOrgMembers(): Promise<OrgMember[]> {
  const user = await getUser()
  if (!user) return []

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return []

  // RLS on org_members only returns rows the caller can see (i.e., their org).
  // The `users` join is RLS-restricted too | we keep this best-effort. If the
  // join fails (e.g., no display_name on the join target), we still return the
  // user_id list with `?` placeholders so the dropdown is usable.
  const { data: members } = await supabase
    .from('org_members')
    .select('user_id')
    .eq('organization_id', orgId as string)

  if (!members || members.length === 0) return []

  const userIds = members.map((m) => m.user_id)
  // auth.users isn't readable via the user client | best we can do is return
  // user_id placeholders. Callers can resolve names from a separate fetch if
  // needed. For now we return user_id as both fields so the UI is functional.
  return userIds.map((id) => ({
    userId: id,
    email: id === user.id ? (user.email ?? id) : id,
    displayName: id === user.id ? (user.email ?? null) : null,
  }))
}

/**
 * Link an existing contact to a conversation. Used from the chat panel
 * when the visitor isn't tracked yet but matches a contact already in
 * the CRM (e.g. recurring customer reaching out from a new device).
 */
export async function linkContactToConversation(
  conversationId: string,
  contactId: string,
): Promise<{ error?: string }> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated' }
  const supabase = await createClient()

  const liveContactId = await resolveLiveContactId(contactId)

  // RLS will reject cross-org updates | both rows must belong to the current org.
  const { error } = await supabase
    .from('conversations')
    .update({ contact_id: liveContactId })
    .eq('id', conversationId)

  if (error) {
    // eslint-disable-next-line no-console
    console.error('[chat:link-contact]', error)
    return { error: error.message }
  }
  return {}
}

/**
 * Lightweight contact search for the link-contact picker. Returns up to 10
 * matches by name / phone / email. Excludes the result count for speed |
 * the picker is single-select, not a paginated list.
 */
export async function searchContactsForLink(query: string): Promise<Array<{
  id: string
  first_name: string | null
  last_name: string | null
  name: string | null
  phone: string | null
  email: string | null
  company: string | null
}>> {
  const user = await getUser()
  if (!user) return []
  const supabase = await createClient()

  const q = query.trim()
  let builder = supabase
    .from('contacts')
    .select('id, first_name, last_name, name, phone, email, company')
    .order('updated_at', { ascending: false })
    .limit(10)

  if (q) {
    const safe = q.replace(/[%_]/g, ' ')
    builder = builder.or(
      `first_name.ilike.%${safe}%,last_name.ilike.%${safe}%,name.ilike.%${safe}%,phone.ilike.%${safe}%,email.ilike.%${safe}%,company.ilike.%${safe}%`,
    )
  }

  const { data, error } = await builder
  if (error) {
    // eslint-disable-next-line no-console
    console.error('[chat:search-contacts]', error)
    return []
  }
  return data ?? []
}

// ─────────────────────── Start-a-conversation (no thread yet) ───────────────────────
//
// When an operator opens a contact that has no conversation (/chat?contact=ID),
// we resolve which REAL channels the contact is reachable on AND the org has
// connected, then create/open a conversation on the chosen channel so messages
// can actually be delivered. Falls back to a 'manual' ("Direct") placeholder.

/** Channels we can start a conversation on. 'manual' is the placeholder fallback. */
export type StartChannel = 'sms' | 'email' | 'whatsapp'

/** Channels with end-to-end create + deliver support wired today. */
export const IMPLEMENTED_START_CHANNELS: StartChannel[] = ['sms', 'email', 'whatsapp']

export interface StartChannelOption {
  channel: StartChannel
  label: string
  /** Contact has the address needed (phone / email). */
  reachable: boolean
  /** Org has the integration connected. */
  connected: boolean
  /** Contact DND blocks this channel. */
  blockedByDnd: boolean
  /** reachable && connected && !blockedByDnd && implemented. */
  available: boolean
}

const START_CHANNEL_LABEL: Record<StartChannel, string> = {
  sms: 'SMS',
  email: 'Email',
  whatsapp: 'WhatsApp',
}

/** Columns selected when returning a ConversationSummary to the client. */
const CONVERSATION_SUMMARY_COLUMNS =
  'id, status, created_at, updated_at, last_message_at, visitor_name, visitor_email, visitor_phone, last_message, channel, channel_metadata, bot_status, contact_id, pinned, starred, priority, assigned_user_id, last_inbound_at, phone_number_id'

function mapConversationRow(row: Record<string, unknown>): ConversationSummary {
  return {
    id: row.id as string,
    status: ((row.status as string) ?? 'open') as ConversationStatus,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    lastMessageAt: (row.last_message_at as string | null) ?? null,
    visitorName: (row.visitor_name as string | null) ?? null,
    visitorEmail: (row.visitor_email as string | null) ?? null,
    visitorPhone: (row.visitor_phone as string | null) ?? null,
    lastMessage: (row.last_message as string | null) ?? null,
    channel: (row.channel as string) ?? 'manual',
    channelMetadata: (row.channel_metadata as Record<string, string>) ?? {},
    botStatus: (row.bot_status as string) ?? 'active',
    channelAccountName: null,
    contactId: (row.contact_id as string | null) ?? null,
    pinned: Boolean(row.pinned),
    starred: Boolean(row.starred),
    priority: ((row.priority as string) ?? 'normal') as ConversationPriority,
    assignedUserId: (row.assigned_user_id as string | null) ?? null,
    lastInboundAt: (row.last_inbound_at as string | null) ?? null,
    phoneNumberId: (row.phone_number_id as string | null) ?? null,
  }
}

/** Returns true when the given channel key is suppressed by the contact's DND. */
function dndBlocks(
  dndEnabled: boolean,
  dndChannels: string[] | null | undefined,
  key: string,
): boolean {
  if (!dndEnabled) return false
  const channels = dndChannels ?? []
  return channels.includes('all') || channels.includes(key)
}

/**
 * Resolve which real channels an operator can start a conversation on for a
 * given contact, considering contact reachability, org integrations, and DND.
 */
export async function resolveContactStartChannels(
  contactId: string,
): Promise<{ options: StartChannelOption[] } | { error: string }> {
  const user = await getUser()
  if (!user) return { error: 'Unauthorized' }
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No organization found.' }

  const liveContactId = await resolveLiveContactId(contactId)

  const { data: contact } = await supabase
    .from('contacts')
    .select('phone, phone_e164, email, dnd_enabled, dnd_channels')
    .eq('id', liveContactId)
    .maybeSingle()

  if (!contact) return { error: 'Contact not found.' }

  const hasPhone = Boolean(contact.phone_e164 || contact.phone)
  const hasEmail = Boolean(contact.email)
  const dndEnabled = Boolean(contact.dnd_enabled)
  const dndChannels = contact.dnd_channels ?? []

  // ── Org connectivity probes (parallel, best-effort) ──
  const [twilioInt, smsNumber, emailInt, evoInstance] = await Promise.all([
    supabase
      .from('integrations')
      .select('id')
      .eq('organization_id', orgId as string)
      .eq('provider', 'twilio')
      .eq('is_active', true)
      .maybeSingle(),
    supabase
      .from('twilio_phone_numbers')
      .select('id')
      .eq('organization_id', orgId as string)
      .eq('is_active', true)
      .eq('capability_sms', true)
      .limit(1)
      .maybeSingle(),
    supabase
      .from('tenant_email_integrations')
      .select('org_id')
      .eq('org_id', orgId as string)
      .eq('status', 'connected')
      .maybeSingle(),
    supabase
      .from('evolution_instances')
      .select('id')
      .eq('org_id', orgId as string)
      .eq('status', 'connected')
      .limit(1)
      .maybeSingle(),
  ])

  const smsConnected = Boolean(twilioInt.data && smsNumber.data)
  const emailConnected = Boolean(emailInt.data)
  const whatsappConnected = Boolean(evoInstance.data)

  const build = (
    channel: StartChannel,
    reachable: boolean,
    connected: boolean,
  ): StartChannelOption => {
    const blockedByDnd = dndBlocks(dndEnabled, dndChannels, channel)
    return {
      channel,
      label: START_CHANNEL_LABEL[channel],
      reachable,
      connected,
      blockedByDnd,
      available:
        reachable &&
        connected &&
        !blockedByDnd &&
        IMPLEMENTED_START_CHANNELS.includes(channel),
    }
  }

  // Priority order: SMS → Email → WhatsApp.
  const options: StartChannelOption[] = [
    build('sms', hasPhone, smsConnected),
    build('email', hasEmail, emailConnected),
    build('whatsapp', hasPhone, whatsappConnected),
  ]

  return { options }
}

/**
 * Create (or reuse) a conversation for a contact on the given channel so the
 * operator can start chatting. Idempotent: returns an existing open thread on
 * the same channel when one already exists. `channel='manual'` is the
 * placeholder used when no real channel is available.
 */
export async function createContactConversation(
  contactId: string,
  channel: StartChannel | 'manual' = 'manual',
): Promise<{ conversation: ConversationSummary } | { error: string }> {
  const user = await getUser()
  if (!user) return { error: 'Unauthorized' }
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No organization found.' }

  const liveContactId = await resolveLiveContactId(contactId)

  // Idempotency: reuse an existing conversation on the same channel.
  const { data: existing } = await supabase
    .from('conversations')
    .select(CONVERSATION_SUMMARY_COLUMNS)
    .eq('contact_id', liveContactId)
    .eq('channel', channel)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()
  if (existing) return { conversation: mapConversationRow(existing) }

  const insert: Database['public']['Tables']['conversations']['Insert'] = {
    org_id: orgId as string,
    widget_token: '',
    contact_id: liveContactId,
    channel,
    status: 'open',
  }

  if (channel === 'sms' || channel === 'whatsapp') {
    const { data: contact } = await supabase
      .from('contacts')
      .select('phone, phone_e164')
      .eq('id', liveContactId)
      .maybeSingle()
    const phone = contact?.phone_e164 ?? contact?.phone ?? null
    if (!phone) return { error: 'Contact has no phone number.' }
    insert.visitor_phone = phone
    if (channel === 'sms') {
      insert.channel_metadata = { to_number: phone }
      // Best-effort: stamp the org's default SMS-capable Twilio number so the
      // outbound send uses it (send-sms also falls back to the default).
      const { data: num } = await supabase
        .from('twilio_phone_numbers')
        .select('id')
        .eq('organization_id', orgId as string)
        .eq('is_active', true)
        .eq('capability_sms', true)
        .order('is_default', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (num) insert.phone_number_id = num.id
    } else {
      // WhatsApp via Evolution (the provider we detect for "connected").
      insert.channel_metadata = { provider: 'evolution', to_number: phone }
    }
  } else if (channel === 'email') {
    const { data: contact } = await supabase
      .from('contacts')
      .select('email')
      .eq('id', liveContactId)
      .maybeSingle()
    const email = contact?.email ?? null
    if (!email) return { error: 'Contact has no email address.' }
    insert.visitor_email = email
  }

  const { data: created, error } = await supabase
    .from('conversations')
    .insert(insert)
    .select(CONVERSATION_SUMMARY_COLUMNS)
    .single()

  if (error || !created) {
    // eslint-disable-next-line no-console
    console.error('[chat:create-conversation]', error)
    return { error: error?.message ?? 'Failed to create conversation.' }
  }
  return { conversation: mapConversationRow(created) }
}
