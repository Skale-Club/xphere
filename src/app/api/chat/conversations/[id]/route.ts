// GET /api/chat/conversations/[id]  | single conversation detail
// DELETE /api/chat/conversations/[id] | delete conversation + messages (cascade)
import { createClient, getUser } from '@/lib/supabase/server'
import type { ConversationPriority, ConversationStatus, ConversationSummary } from '@/types/chat'

export const runtime = 'nodejs'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const user = await getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('conversations')
    .select('id, status, created_at, updated_at, last_message_at, last_inbound_at, visitor_name, visitor_email, visitor_phone, last_message, channel, channel_metadata, bot_status, contact_id, pinned, starred, priority, assigned_user_id, wait_until, phone_number_id, contacts:contact_id ( first_name, last_name, name, avatar_url, contact_verifications ( id ) ), phone_number:phone_number_id ( id, e164, friendly_name, inbox_label )')
    .eq('id', id)
    .single()

  if (error || !data) {
    return Response.json({ error: 'Conversation not found' }, { status: 404 })
  }

  const row = data as Record<string, unknown>
  const contact = row.contacts as {
    first_name?: string | null
    last_name?: string | null
    name?: string | null
    avatar_url?: string | null
    contact_verifications?: Array<{ id: string }> | null
  } | null
  const contactName =
    [contact?.first_name?.trim(), contact?.last_name?.trim()].filter(Boolean).join(' ') ||
    contact?.name?.trim() ||
    null
  const phoneNumber = row.phone_number as
    | { id: string; e164: string | null; friendly_name: string | null; inbox_label: string | null }
    | null
  const phoneNumberLabel = phoneNumber
    ? (phoneNumber.inbox_label?.trim() || phoneNumber.friendly_name?.trim() || phoneNumber.e164 || null)
    : null

  const conversation: ConversationSummary = {
    id: row.id as string,
    status: row.status as ConversationStatus,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    lastMessageAt: (row.last_message_at as string | null) ?? null,
    lastInboundAt: (row.last_inbound_at as string | null) ?? null,
    visitorName: (row.visitor_name as string | null) ?? null,
    visitorEmail: (row.visitor_email as string | null) ?? null,
    visitorPhone: (row.visitor_phone as string | null) ?? null,
    lastMessage: (row.last_message as string | null) ?? null,
    channel: (row.channel as string | null) ?? 'widget',
    channelMetadata: (row.channel_metadata as Record<string, string>) ?? {},
    botStatus: (row.bot_status as string) ?? 'active',
    channelAccountName: null,
    contactId: (row.contact_id as string | null) ?? null,
    contactName,
    contactAvatarUrl: contact?.avatar_url?.trim() || null,
    contactVerified:
      Array.isArray(contact?.contact_verifications) &&
      contact!.contact_verifications!.length > 0,
    pinned: Boolean(row.pinned),
    starred: Boolean(row.starred),
    priority: ((row.priority as string) ?? 'normal') as ConversationPriority,
    assignedUserId: (row.assigned_user_id as string | null) ?? null,
    waitUntil: (row.wait_until as string | null) ?? null,
    phoneNumberId: (row.phone_number_id as string | null) ?? null,
    phoneNumberLabel,
  }

  return Response.json({ conversation })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const user = await getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const supabase = await createClient()

  const { error } = await supabase
    .from('conversations')
    .delete()
    .eq('id', id)

  if (error) {
    console.error('[DELETE /api/chat/conversations/[id]]', error)
    return Response.json({ error: 'Failed to delete conversation' }, { status: 500 })
  }

  return Response.json({ ok: true })
}
