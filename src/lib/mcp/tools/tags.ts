// MCP tools for tag management.

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
    .slice(0, 64) || 'tag'
}

export const tagsTools: McpToolDef[] = [
  {
    name: 'tags_list',
    title: 'List tags',
    description: 'List all tags in the current org.',
    area: 'general_xphere',
    inputSchema: z.object({}).strict(),
    handler: async (_input, { auth }) => {
      const { data } = await db()
        .from('tags')
        .select('id, name, slug, color, created_at')
        .eq('org_id', auth.orgId)
        .order('name', { ascending: true })
      return { tags: data ?? [] }
    },
  },
  {
    name: 'tags_create',
    title: 'Create tag',
    description: 'Create a new tag. Slug is auto-generated from name.',
    area: 'general_xphere',
    inputSchema: z.object({
      name: z.string().min(1).max(64),
      color: z.string().optional(),
    }).strict(),
    handler: async ({ name, color }, { auth }) => {
      const { data, error } = await db()
        .from('tags')
        .insert({
          org_id: auth.orgId,
          name: name.trim(),
          slug: slugify(name),
          color: color ?? '#6366F1',
        })
        .select()
        .single()
      if (error) return { error: 'insert_failed', detail: error.message }
      return data
    },
  },
  {
    name: 'tags_update',
    title: 'Update tag',
    description: 'Rename or recolor a tag. If name changes, slug is regenerated.',
    area: 'general_xphere',
    inputSchema: z.object({
      tag_id: z.string().uuid(),
      name: z.string().min(1).max(64).optional(),
      color: z.string().optional(),
    }).strict(),
    handler: async ({ tag_id, name, color }, { auth }) => {
      const patch: Record<string, unknown> = {}
      if (name !== undefined) { patch.name = name.trim(); patch.slug = slugify(name) }
      if (color !== undefined) patch.color = color
      if (Object.keys(patch).length === 0) return { error: 'no_fields', detail: 'no fields to update' }
      const { error } = await db()
        .from('tags')
        .update(patch)
        .eq('id', tag_id)
        .eq('org_id', auth.orgId)
      if (error) return { error: 'update_failed', detail: error.message }
      return { updated: true }
    },
  },
  {
    name: 'tags_delete',
    title: 'Delete tag',
    description: 'Remove a tag from the org. Junction rows (contact_tags, opportunity_tags) are cascaded by the DB.',
    area: 'general_xphere',
    inputSchema: z.object({ tag_id: z.string().uuid() }).strict(),
    handler: async ({ tag_id }, { auth }) => {
      const { error } = await db()
        .from('tags')
        .delete()
        .eq('id', tag_id)
        .eq('org_id', auth.orgId)
      if (error) return { error: 'delete_failed', detail: error.message }
      return { deleted: true }
    },
  },
  {
    name: 'contact_tags_set',
    title: 'Set tags on a contact',
    description: 'Replace the full tag list on a contact. Both the denormalized contacts.tags array (names) and the contact_tags junction (ids) are updated.',
    area: 'general_xphere',
    inputSchema: z.object({
      contact_id: z.string().uuid(),
      tag_ids: z.array(z.string().uuid()),
    }).strict(),
    handler: async ({ contact_id, tag_ids }, { auth }) => {
      const supabase = db()

      // Verify the contact belongs to this org.
      const { data: contact } = await supabase
        .from('contacts')
        .select('id')
        .eq('id', contact_id)
        .eq('org_id', auth.orgId)
        .maybeSingle()
      if (!contact) return { error: 'not_found', status: 404 }

      // Resolve tag names (also ensures all ids belong to the org).
      const { data: tagRows } = tag_ids.length > 0
        ? await supabase
            .from('tags')
            .select('id, name')
            .in('id', tag_ids)
            .eq('org_id', auth.orgId)
        : { data: [] as { id: string; name: string }[] }

      if (tagRows!.length !== tag_ids.length) {
        return { error: 'invalid_tag_ids', detail: 'one or more tag ids do not belong to this org' }
      }

      // Replace junction rows.
      await supabase.from('contact_tags').delete().eq('contact_id', contact_id)
      if (tag_ids.length > 0) {
        await supabase
          .from('contact_tags')
          .insert(tag_ids.map((id: string) => ({ contact_id, tag_id: id })))
      }

      // Update the denormalized name array.
      const names = (tagRows ?? []).map((t: { name: string }) => t.name)
      await supabase.from('contacts').update({ tags: names }).eq('id', contact_id)

      return { updated: true, tag_count: names.length }
    },
  },
]
