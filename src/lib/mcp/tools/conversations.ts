// MCP tools for chat conversations.

import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { McpToolDef } from '../tool-types'
import { dispatchOutboundMessage } from '@/lib/messaging/dispatch-outbound'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return createServiceRoleClient() as any }

export const conversationsTools: McpToolDef[] = [
  {
    name: 'conversations_count',
    title: 'Count conversations',
    description:
      'Returns the total number of conversations in the current org, optionally filtered by status or contact. Use this to answer "how many conversations do I have".',
    area: 'general_xphere',
    inputSchema: z.object({
      status: z.string().optional(),
      contact_id: z.string().uuid().optional(),
    }).strict(),
    handler: async ({ status, contact_id }, { auth }) => {
      let q = db()
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', auth.orgId)
      if (status) q = q.eq('status', status)
      if (contact_id) q = q.eq('contact_id', contact_id)
      const { count, error } = await q
      if (error) return { error: 'count_failed', detail: error.message }
      return { count: count ?? 0 }
    },
  },
  {
    name: 'conversations_list',
    title: 'List conversations',
    description: 'List recent conversations. Optionally filter by status (e.g. open/closed).',
    area: 'general_xphere',
    inputSchema: z.object({
      status: z.string().optional(),
      contact_id: z.string().uuid().optional(),
      limit: z.number().int().positive().max(100).optional(),
    }).strict(),
    handler: async ({ status, contact_id, limit = 30 }, { auth }) => {
      let q = db()
        .from('conversations')
        .select('id, status, channel, visitor_name, visitor_email, visitor_phone, last_message, last_message_at, contact_id, created_at')
        .eq('org_id', auth.orgId)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(limit)
      if (status) q = q.eq('status', status)
      if (contact_id) q = q.eq('contact_id', contact_id)
      const { data } = await q
      return { conversations: data ?? [] }
    },
  },
  {
    name: 'conversations_get_messages',
    title: 'Get conversation messages',
    description: 'Fetch messages of a conversation in chronological order.',
    area: 'general_xphere',
    inputSchema: z.object({
      conversation_id: z.string().uuid(),
      limit: z.number().int().positive().max(500).optional(),
    }).strict(),
    handler: async ({ conversation_id, limit = 100 }, { auth }) => {
      const supabase = db()
      // Verify the conversation belongs to the caller's org before exposing messages.
      const { data: conv } = await supabase
        .from('conversations')
        .select('id')
        .eq('id', conversation_id)
        .eq('org_id', auth.orgId)
        .maybeSingle()
      if (!conv) return { error: 'not_found', status: 404 }

      const { data } = await supabase
        .from('conversation_messages')
        .select('id, role, content, created_at, message_type, channel, metadata')
        .eq('conversation_id', conversation_id)
        .order('created_at', { ascending: true })
        .limit(limit)
      return { messages: data ?? [] }
    },
  },
  {
    name: 'conversations_send_message',
    title: 'Send agent message',
    description:
      'Delivers a message on the conversation\'s real channel (WhatsApp, SMS, email, Meta, GHL, Zernio, etc.) — same routing as the inbox "reply" action, not just a DB insert. The MCP caller is recorded as the author in metadata.actor. Fails with a clear error (not a fake success) when the conversation has no deliverable channel, e.g. a "manual"/placeholder thread with no connected provider.',
    area: 'general_xphere',
    inputSchema: z.object({
      conversation_id: z.string().uuid(),
      content: z.string().min(1),
    }).strict(),
    handler: async ({ conversation_id, content }, { auth }) => {
      const supabase = db()
      const { data: conv } = await supabase
        .from('conversations')
        .select('id, channel, channel_metadata, visitor_phone, visitor_email, phone_number_id, contact_id, last_inbound_at')
        .eq('id', conversation_id)
        .eq('org_id', auth.orgId)
        .maybeSingle()
      if (!conv) return { error: 'not_found', status: 404 }

      const result = await dispatchOutboundMessage({
        supabase,
        orgId: auth.orgId,
        conversation: conv,
        content: content.trim(),
        role: 'agent',
        metadata: { source: 'mcp', actor: auth.actor },
      })

      if (!result.ok) {
        return { error: result.error, detail: result.message, status: result.status }
      }

      return result.message
    },
  },
]
