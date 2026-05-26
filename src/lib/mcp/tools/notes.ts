// MCP tools for the platform-wide notes table.
// Notes can be attached to a CRM entity (contact/account/opportunity) or standalone.

import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { McpToolDef } from '../tool-types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return createServiceRoleClient() as any }

const EntityType = z.enum(['contact', 'opportunity', 'account'])

export const notesTools: McpToolDef[] = [
  {
    name: 'notes_list',
    title: 'List notes',
    description: 'List notes in the org. Optionally scope to a specific CRM entity.',
    area: 'general_xphere',
    inputSchema: z.object({
      entity_type: EntityType.optional(),
      entity_id: z.string().uuid().optional(),
      pinned_only: z.boolean().optional(),
      limit: z.number().int().positive().max(200).optional(),
    }).strict(),
    handler: async ({ entity_type, entity_id, pinned_only, limit = 50 }, { auth }) => {
      let q = db()
        .from('notes')
        .select('id, title, content, pinned, entity_type, entity_id, created_by, created_at, updated_at')
        .eq('org_id', auth.orgId)
        .order('created_at', { ascending: false })
        .limit(limit)
      if (entity_type) q = q.eq('entity_type', entity_type)
      if (entity_id) q = q.eq('entity_id', entity_id)
      if (pinned_only) q = q.eq('pinned', true)
      const { data } = await q
      return { notes: data ?? [] }
    },
  },
  {
    name: 'notes_get',
    title: 'Get note',
    description: 'Fetch a single note by id.',
    area: 'general_xphere',
    inputSchema: z.object({ note_id: z.string().uuid() }).strict(),
    handler: async ({ note_id }, { auth }) => {
      const { data } = await db()
        .from('notes')
        .select('*')
        .eq('id', note_id)
        .eq('org_id', auth.orgId)
        .maybeSingle()
      if (!data) return { error: 'not_found', status: 404 }
      return data
    },
  },
  {
    name: 'notes_create',
    title: 'Create note',
    description: 'Create a note. Optionally attach it to a CRM entity (contact, opportunity, account).',
    area: 'general_xphere',
    inputSchema: z.object({
      content: z.string().min(1),
      title: z.string().optional(),
      entity_type: EntityType.optional(),
      entity_id: z.string().uuid().optional(),
      pinned: z.boolean().optional(),
    }).strict().refine(
      (v) => !v.entity_type || !!v.entity_id,
      { message: 'entity_id is required when entity_type is provided' },
    ),
    handler: async (input, { auth }) => {
      const { data, error } = await db()
        .from('notes')
        .insert({
          org_id: auth.orgId,
          title: input.title ?? null,
          content: input.content,
          entity_type: input.entity_type ?? null,
          entity_id: input.entity_id ?? null,
          pinned: input.pinned ?? false,
        })
        .select()
        .single()
      if (error) return { error: 'insert_failed', detail: error.message }
      return data
    },
  },
  {
    name: 'notes_update',
    title: 'Update note',
    description: 'Edit a note (content, title, pinned).',
    area: 'general_xphere',
    inputSchema: z.object({
      note_id: z.string().uuid(),
      content: z.string().min(1).optional(),
      title: z.string().nullable().optional(),
      pinned: z.boolean().optional(),
    }).strict(),
    handler: async (input, { auth }) => {
      const { note_id, ...patch } = input
      if (Object.keys(patch).length === 0) return { error: 'no_fields', detail: 'no fields to update' }
      const { error } = await db()
        .from('notes')
        .update(patch)
        .eq('id', note_id)
        .eq('org_id', auth.orgId)
      if (error) return { error: 'update_failed', detail: error.message }
      return { updated: true }
    },
  },
  {
    name: 'notes_delete',
    title: 'Delete note',
    description: 'Remove a note.',
    area: 'general_xphere',
    inputSchema: z.object({ note_id: z.string().uuid() }).strict(),
    handler: async ({ note_id }, { auth }) => {
      const { error } = await db()
        .from('notes')
        .delete()
        .eq('id', note_id)
        .eq('org_id', auth.orgId)
      if (error) return { error: 'delete_failed', detail: error.message }
      return { deleted: true }
    },
  },
]
