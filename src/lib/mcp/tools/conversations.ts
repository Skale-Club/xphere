// MCP tools for chat conversations.

import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { McpToolDef } from '../tool-types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return createServiceRoleClient() as any }

export const conversationsTools: McpToolDef[] = [
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
      'Insert an agent-side message into a conversation. The MCP caller is recorded as the author in metadata.actor.',
    area: 'general_xphere',
    inputSchema: z.object({
      conversation_id: z.string().uuid(),
      content: z.string().min(1),
    }).strict(),
    handler: async ({ conversation_id, content }, { auth }) => {
      const supabase = db()
      const { data: conv } = await supabase
        .from('conversations')
        .select('id, channel')
        .eq('id', conversation_id)
        .eq('org_id', auth.orgId)
        .maybeSingle()
      if (!conv) return { error: 'not_found', status: 404 }

      const now = new Date().toISOString()
      const { data, error } = await supabase
        .from('conversation_messages')
        .insert({
          conversation_id,
          org_id: auth.orgId,
          role: 'agent',
          content: content.trim(),
          message_type: 'text',
          channel: conv.channel ?? null,
          metadata: { source: 'mcp', actor: auth.actor },
        })
        .select()
        .single()
      if (error) return { error: 'insert_failed', detail: error.message }

      // Touch conversation last_message_at so the inbox surfaces it.
      await supabase
        .from('conversations')
        .update({ last_message: content.trim(), last_message_at: now })
        .eq('id', conversation_id)
        .eq('org_id', auth.orgId)

      return data
    },
  },
]
