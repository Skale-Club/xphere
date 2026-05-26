// MCP tools for accounts (companies).

import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { McpToolDef } from '../tool-types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return createServiceRoleClient() as any }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyAccountFilters(q: any, f: { industry?: string; tag?: string; assigned_to?: string }) {
  if (f.industry) q = q.eq('industry', f.industry)
  if (f.tag) q = q.contains('tags', [f.tag])
  if (f.assigned_to) q = q.eq('assigned_to', f.assigned_to)
  return q
}

export const accountsTools: McpToolDef[] = [
  {
    name: 'accounts_list',
    title: 'List accounts',
    description: 'List accounts (companies) in the current org with pagination and optional filters.',
    area: 'general_xphere',
    inputSchema: z.object({
      industry: z.string().optional(),
      tag: z.string().optional(),
      assigned_to: z.string().uuid().optional(),
      limit: z.number().int().positive().max(200).optional(),
      offset: z.number().int().nonnegative().optional(),
    }).strict(),
    handler: async (input, { auth }) => {
      const limit = input.limit ?? 50
      const offset = input.offset ?? 0
      let q = db()
        .from('accounts')
        .select('id, name, domain, website, industry, size, phone, tags, source, assigned_to, created_at')
        .eq('org_id', auth.orgId)
      q = applyAccountFilters(q, input)
      const { data } = await q.order('created_at', { ascending: false }).range(offset, offset + limit - 1)
      return { accounts: data ?? [], limit, offset }
    },
  },
  {
    name: 'accounts_count',
    title: 'Count accounts',
    description: 'Returns the total number of accounts in the current org, optionally filtered. Use this to answer "how many companies do I have".',
    area: 'general_xphere',
    inputSchema: z.object({
      industry: z.string().optional(),
      tag: z.string().optional(),
      assigned_to: z.string().uuid().optional(),
    }).strict(),
    handler: async (input, { auth }) => {
      let q = db()
        .from('accounts')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', auth.orgId)
      q = applyAccountFilters(q, input)
      const { count, error } = await q
      if (error) return { error: 'count_failed', detail: error.message }
      return { count: count ?? 0 }
    },
  },
  {
    name: 'accounts_get',
    title: 'Get account',
    description: 'Fetch a single account by id with full fields.',
    area: 'general_xphere',
    inputSchema: z.object({ account_id: z.string().uuid() }).strict(),
    handler: async ({ account_id }, { auth }) => {
      const { data } = await db()
        .from('accounts')
        .select('*')
        .eq('id', account_id)
        .eq('org_id', auth.orgId)
        .maybeSingle()
      if (!data) return { error: 'not_found', status: 404 }
      return data
    },
  },
  {
    name: 'accounts_create',
    title: 'Create account',
    description: 'Create a new account (company). Only name is required.',
    area: 'general_xphere',
    inputSchema: z.object({
      name: z.string().min(1),
      domain: z.string().optional(),
      website: z.string().url().optional(),
      industry: z.string().optional(),
      size: z.string().optional(),
      phone: z.string().optional(),
      address: z.string().optional(),
      tags: z.array(z.string()).optional(),
      notes: z.string().optional(),
      assigned_to: z.string().uuid().optional(),
    }).strict(),
    handler: async (input, { auth }) => {
      const { data, error } = await db()
        .from('accounts')
        .insert({
          org_id: auth.orgId,
          name: input.name,
          domain: input.domain ?? null,
          website: input.website ?? null,
          industry: input.industry ?? null,
          size: input.size ?? null,
          phone: input.phone ?? null,
          address: input.address ?? null,
          tags: input.tags ?? [],
          notes: input.notes ?? null,
          assigned_to: input.assigned_to ?? null,
          source: 'manual',
        })
        .select()
        .single()
      if (error) return { error: 'insert_failed', detail: error.message }
      return data
    },
  },
  {
    name: 'accounts_update',
    title: 'Update account',
    description: 'Patch account fields. Only supplied fields are changed.',
    area: 'general_xphere',
    inputSchema: z.object({
      account_id: z.string().uuid(),
      name: z.string().optional(),
      domain: z.string().nullable().optional(),
      website: z.string().url().nullable().optional(),
      industry: z.string().nullable().optional(),
      size: z.string().nullable().optional(),
      phone: z.string().nullable().optional(),
      address: z.string().nullable().optional(),
      tags: z.array(z.string()).optional(),
      notes: z.string().nullable().optional(),
      assigned_to: z.string().uuid().nullable().optional(),
    }).strict(),
    handler: async (input, { auth }) => {
      const { account_id, ...patch } = input
      if (Object.keys(patch).length === 0) return { error: 'no_fields', detail: 'no fields to update' }
      const { error } = await db()
        .from('accounts')
        .update(patch)
        .eq('id', account_id)
        .eq('org_id', auth.orgId)
      if (error) return { error: 'update_failed', detail: error.message }
      return { updated: true }
    },
  },
]
