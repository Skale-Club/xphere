// MCP tools for contact CRM operations.

import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { McpToolDef } from '../tool-types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return createServiceRoleClient() as any }

const ContactSource = z.enum(['manual', 'whatsapp', 'sms', 'instagram', 'csv_import', 'ghl_sync'])

// Applies shared list/count filters onto a Supabase query builder. Returns the
// (possibly chained) builder.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyContactFilters(query: any, f: {
  tag?: string
  source?: z.infer<typeof ContactSource>
  has_email?: boolean
  has_phone?: boolean
  created_after?: string
  created_before?: string
}) {
  let q = query
  if (f.tag) q = q.contains('tags', [f.tag])
  if (f.source) q = q.eq('source', f.source)
  if (f.has_email === true) q = q.not('email', 'is', null)
  if (f.has_email === false) q = q.is('email', null)
  if (f.has_phone === true) q = q.not('phone', 'is', null)
  if (f.has_phone === false) q = q.is('phone', null)
  if (f.created_after) q = q.gte('created_at', f.created_after)
  if (f.created_before) q = q.lte('created_at', f.created_before)
  return q
}

export const contactsTools: McpToolDef[] = [
  {
    name: 'contacts_list',
    title: 'List contacts',
    description:
      'List contacts in the current org with pagination. Optional filters: tag, source, has_email, has_phone, created date range. No search term required — use contacts_search when the user gives one.',
    area: 'general_xphere',
    inputSchema: z.object({
      tag: z.string().optional(),
      source: ContactSource.optional(),
      has_email: z.boolean().optional(),
      has_phone: z.boolean().optional(),
      created_after: z.string().datetime().optional(),
      created_before: z.string().datetime().optional(),
      limit: z.number().int().positive().max(200).optional(),
      offset: z.number().int().nonnegative().optional(),
    }).strict(),
    handler: async (input, { auth }) => {
      const limit = input.limit ?? 50
      const offset = input.offset ?? 0
      let q = db()
        .from('contacts')
        .select('id, first_name, last_name, name, email, phone, company, tags, source, created_at')
        .eq('org_id', auth.orgId)
      q = applyContactFilters(q, input)
      const { data } = await q
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)
      return { contacts: data ?? [], limit, offset }
    },
  },
  {
    name: 'contacts_count',
    title: 'Count contacts',
    description:
      'Returns the total number of contacts in the current org, optionally filtered by tag, source, email/phone presence or created date range. Use this to answer "how many contacts do I have".',
    area: 'general_xphere',
    inputSchema: z.object({
      tag: z.string().optional(),
      source: ContactSource.optional(),
      has_email: z.boolean().optional(),
      has_phone: z.boolean().optional(),
      created_after: z.string().datetime().optional(),
      created_before: z.string().datetime().optional(),
    }).strict(),
    handler: async (input, { auth }) => {
      let q = db()
        .from('contacts')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', auth.orgId)
      q = applyContactFilters(q, input)
      const { count, error } = await q
      if (error) return { error: 'count_failed', detail: error.message }
      return { count: count ?? 0 }
    },
  },
  {
    name: 'contacts_search',
    title: 'Search contacts',
    description: 'Search contacts by name, email, phone or company (case-insensitive substring).',
    area: 'general_xphere',
    inputSchema: z.object({
      query: z.string().min(1),
      limit: z.number().int().positive().max(50).optional(),
    }).strict(),
    handler: async ({ query, limit = 20 }, { auth }) => {
      const escaped = query.replace(/[%_]/g, (m: string) => `\\${m}`)
      const term = `%${escaped}%`
      const { data } = await db()
        .from('contacts')
        .select('id, first_name, last_name, name, email, phone, company, tags, created_at')
        .eq('org_id', auth.orgId)
        .or(
          `name.ilike.${term},first_name.ilike.${term},last_name.ilike.${term},email.ilike.${term},phone.ilike.${term},company.ilike.${term}`,
        )
        .order('created_at', { ascending: false })
        .limit(limit)
      return { contacts: data ?? [] }
    },
  },
  {
    name: 'contacts_get',
    title: 'Get contact',
    description: 'Fetch a single contact by id with full fields.',
    area: 'general_xphere',
    inputSchema: z.object({ contact_id: z.string().uuid() }).strict(),
    handler: async ({ contact_id }, { auth }) => {
      const { data } = await db()
        .from('contacts')
        .select('*')
        .eq('id', contact_id)
        .eq('org_id', auth.orgId)
        .maybeSingle()
      if (!data) return { error: 'not_found', status: 404 }
      return data
    },
  },
  {
    name: 'contacts_create',
    title: 'Create contact',
    description: 'Create a new contact. At least one of name/first_name/last_name/email/phone must be provided.',
    area: 'general_xphere',
    inputSchema: z.object({
      first_name: z.string().optional(),
      last_name: z.string().optional(),
      name: z.string().optional(),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      company: z.string().optional(),
      tags: z.array(z.string()).optional(),
      notes: z.string().optional(),
    }).strict().refine(
      (v) => v.name || v.first_name || v.last_name || v.email || v.phone,
      { message: 'At least one of name/first_name/last_name/email/phone is required' },
    ),
    handler: async (input, { auth }) => {
      const { data, error } = await db()
        .from('contacts')
        .insert({
          org_id: auth.orgId,
          first_name: input.first_name ?? null,
          last_name: input.last_name ?? null,
          name: input.name ?? null,
          email: input.email ?? null,
          phone: input.phone ?? null,
          company: input.company ?? null,
          tags: input.tags ?? [],
          notes: input.notes ?? null,
          source: 'manual',
        })
        .select()
        .single()
      if (error) return { error: 'insert_failed', detail: error.message }
      return data
    },
  },
  {
    name: 'contacts_update',
    title: 'Update contact',
    description: 'Patch contact fields. Only supplied fields are changed.',
    area: 'general_xphere',
    inputSchema: z.object({
      contact_id: z.string().uuid(),
      first_name: z.string().nullable().optional(),
      last_name: z.string().nullable().optional(),
      name: z.string().nullable().optional(),
      email: z.string().nullable().optional(),
      phone: z.string().nullable().optional(),
      company: z.string().nullable().optional(),
      tags: z.array(z.string()).optional(),
      notes: z.string().nullable().optional(),
    }).strict(),
    handler: async (input, { auth }) => {
      const { contact_id, ...patch } = input
      if (Object.keys(patch).length === 0) {
        return { error: 'no_fields', detail: 'no fields to update' }
      }
      const { error } = await db()
        .from('contacts')
        .update(patch)
        .eq('id', contact_id)
        .eq('org_id', auth.orgId)
      if (error) return { error: 'update_failed', detail: error.message }
      return { updated: true }
    },
  },
]
