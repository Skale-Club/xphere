// GET /api/chat/conversations/[id]/messages | paginated message history
// POST /api/chat/conversations/[id]/messages | admin sends message
import { createClient, getUser } from '@/lib/supabase/server'
import { z } from 'zod'
import type { ConversationMessage } from '@/types/chat'
import { dispatchOutboundMessage } from '@/lib/messaging/dispatch-outbound'

export const runtime = 'nodejs'

const DEFAULT_MESSAGE_LIMIT = 30
const MAX_MESSAGE_LIMIT = 200

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const user = await getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { searchParams } = new URL(request.url)
  const limitRaw = parseInt(searchParams.get('limit') ?? String(DEFAULT_MESSAGE_LIMIT), 10)
  const limit = Math.min(
    Number.isNaN(limitRaw) ? DEFAULT_MESSAGE_LIMIT : limitRaw,
    MAX_MESSAGE_LIMIT,
  )
  const before = searchParams.get('before')
  const includeInternal = searchParams.get('includeInternal') === 'true'

  const supabase = await createClient()

  // Verify conversation belongs to org (RLS handles this but be explicit)
  const { data: conv } = await supabase
    .from('conversations')
    .select('id')
    .eq('id', id)
    .single()

  if (!conv) return Response.json({ error: 'Conversation not found' }, { status: 404 })

  // Cursor: if `before` provided, find the created_at of that message first
  let beforeCreatedAt: string | null = null
  if (before) {
    const { data: anchor } = await supabase
      .from('conversation_messages')
      .select('created_at')
      .eq('id', before)
      .single()
    if (anchor) beforeCreatedAt = anchor.created_at
  }

  let query = supabase
    .from('conversation_messages')
    .select('id, conversation_id, org_id, role, content, created_at, metadata, channel, email_subject, email_from, email_to, email_cc, email_message_id, email_delivery_status')
    .eq('conversation_id', id)
    .order('created_at', { ascending: false })
    .limit(limit + 1)  // fetch one extra to determine hasMore

  if (beforeCreatedAt) {
    query = query.lt('created_at', beforeCreatedAt)
  }

  if (!includeInternal) {
    // Filter out messages where metadata->>'internal' = 'true'
    query = query.or('metadata.is.null,metadata->>internal.neq.true')
  }

  const { data, error } = await query

  if (error) {
    console.error('[GET messages]', error)
    return Response.json({ error: 'Failed to load messages' }, { status: 500 })
  }

  const rows = data ?? []
  const hasMore = rows.length > limit
  const sliced = rows.slice(0, limit)

  const messages: ConversationMessage[] = sliced.reverse().map((row) => {
    const r = row as typeof row & {
      channel?: string | null
      email_subject?: string | null
      email_from?: string | null
      email_to?: string | null
      email_cc?: string | null
      email_message_id?: string | null
      email_delivery_status?: string | null
    }
    return {
      id: r.id,
      conversationId: r.conversation_id,
      role: r.role,
      content: r.content,
      createdAt: r.created_at,
      metadata: r.metadata as Record<string, unknown> | null,
      channel: r.channel ?? null,
      email_subject: r.email_subject ?? null,
      email_from: r.email_from ?? null,
      email_to: r.email_to ?? null,
      email_cc: r.email_cc ?? null,
      email_message_id: r.email_message_id ?? null,
      email_delivery_status: r.email_delivery_status ?? null,
    }
  })

  return Response.json({ messages, hasMore })
}

const MediaItemSchema = z.object({
  url: z.string().url(),
  mime_type: z.string(),
  size: z.number().optional(),
  filename: z.string().optional(),
})

const SendMessageSchema = z.object({
  content: z.string().default(''),
  role: z.literal('assistant'),
  channel: z.string().optional(),
  delivery_override: z.literal('evolution_manual_escape').optional(),
  // operator_prefix: true → prepend "Name:\n" to outbound GHL messages
  operator_prefix: z.boolean().optional().default(false),
  /** Optional media attachments (uploaded via /api/chat/upload beforehand). */
  media: z.array(MediaItemSchema).optional(),
  /** Email channel: subject line for the outbound email. */
  subject: z.string().optional(),
})

function sendError(
  error: string,
  message: string,
  status: number,
  extra?: Record<string, unknown>,
): Response {
  return Response.json({ error, message, ...extra }, { status })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const user = await getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const supabase = await createClient()

  // Verify conversation belongs to org via RLS
  const { data: conv } = await supabase
    .from('conversations')
    .select('id, org_id, channel, channel_metadata, assigned_user_id, visitor_phone, visitor_email, phone_number_id, contact_id, last_inbound_at')
    .eq('id', id)
    .single()

  if (!conv) return Response.json({ error: 'Conversation not found' }, { status: 404 })

  let body: unknown
  try { body = await request.json() } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = SendMessageSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: parsed.error.errors[0]?.message ?? 'Invalid request' }, { status: 400 })
  }

  const { content, role, operator_prefix, media, delivery_override, subject } = parsed.data

  // Require either content or media
  if (!content && (!media || media.length === 0)) {
    return Response.json({ error: 'Either content or media is required' }, { status: 400 })
  }

  // Resolve operator display name for the prefix feature
  const operatorName: string | null = operator_prefix
    ? (user.user_metadata?.full_name as string | undefined)
      ?? (user.user_metadata?.name as string | undefined)
      ?? user.email
      ?? null
    : null

  // All channel routing, provider dispatch, and persistence lives in the
  // shared dispatcher so the MCP `conversations_send_message` tool (and any
  // future caller) delivers messages the same way this route does.
  const result = await dispatchOutboundMessage({
    supabase,
    orgId: conv.org_id,
    conversation: conv,
    content,
    channel: parsed.data.channel,
    media,
    subject,
    deliveryOverride: delivery_override,
    operatorName,
    role,
  })

  if (!result.ok) {
    return sendError(result.error, result.message, result.status, result.extra)
  }

  const msg = result.message
  const message: ConversationMessage = {
    id: msg.id,
    conversationId: msg.conversation_id,
    role: msg.role,
    content: msg.content,
    createdAt: msg.created_at,
    metadata: msg.metadata as Record<string, unknown> | null,
    channel: msg.channel ?? null,
  }

  return Response.json({ message }, { status: 201 })
}
