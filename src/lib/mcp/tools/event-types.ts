// MCP tools for scheduling event types.

import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { McpToolDef } from '../tool-types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return createServiceRoleClient() as any }

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || 'event'
}

const LocationType = z.enum(['video', 'phone', 'in_person'])

export const eventTypesTools: McpToolDef[] = [
  {
    name: 'event_types_list',
    title: 'List event types',
    description: 'List schedulable event types in the current org. Optional filters by owner user and active flag.',
    area: 'general_xphere',
    inputSchema: z.object({
      user_id: z.string().uuid().optional(),
      active_only: z.boolean().optional(),
    }).strict(),
    handler: async ({ user_id, active_only }, { auth }) => {
      let q = db()
        .from('event_types')
        .select('id, user_id, title, slug, description, duration_minutes, color, location_type, location_value, active, created_at')
        .eq('org_id', auth.orgId)
      if (user_id) q = q.eq('user_id', user_id)
      if (active_only) q = q.eq('active', true)
      const { data } = await q.order('created_at', { ascending: false })
      return { event_types: data ?? [] }
    },
  },
  {
    name: 'event_types_create',
    title: 'Create event type',
    description: 'Create a new schedulable event type for a user.',
    area: 'general_xphere',
    inputSchema: z.object({
      user_id: z.string().uuid(),
      title: z.string().min(1).max(120),
      duration_minutes: z.number().int().positive().max(480),
      description: z.string().optional(),
      color: z.string().optional(),
      location_type: LocationType.optional(),
      location_value: z.string().optional(),
    }).strict(),
    handler: async (input, { auth }) => {
      const { data, error } = await db()
        .from('event_types')
        .insert({
          org_id: auth.orgId,
          user_id: input.user_id,
          title: input.title.trim(),
          slug: slugify(input.title),
          description: input.description ?? null,
          duration_minutes: input.duration_minutes,
          color: input.color ?? '#6366F1',
          location_type: input.location_type ?? 'video',
          location_value: input.location_value ?? null,
          active: true,
        })
        .select()
        .single()
      if (error) return { error: 'insert_failed', detail: error.message }
      return data
    },
  },
  {
    name: 'event_types_update',
    title: 'Update event type',
    description: 'Patch event type fields (rename, change duration, deactivate, etc).',
    area: 'general_xphere',
    inputSchema: z.object({
      event_type_id: z.string().uuid(),
      title: z.string().min(1).max(120).optional(),
      description: z.string().nullable().optional(),
      duration_minutes: z.number().int().positive().max(480).optional(),
      color: z.string().optional(),
      location_type: LocationType.optional(),
      location_value: z.string().nullable().optional(),
      active: z.boolean().optional(),
    }).strict(),
    handler: async (input, { auth }) => {
      const { event_type_id, title, ...rest } = input
      const patch: Record<string, unknown> = { ...rest }
      if (title !== undefined) {
        patch.title = title.trim()
        patch.slug = slugify(title)
      }
      if (Object.keys(patch).length === 0) return { error: 'no_fields', detail: 'no fields to update' }
      const { error } = await db()
        .from('event_types')
        .update(patch)
        .eq('id', event_type_id)
        .eq('org_id', auth.orgId)
      if (error) return { error: 'update_failed', detail: error.message }
      return { updated: true }
    },
  },
]
