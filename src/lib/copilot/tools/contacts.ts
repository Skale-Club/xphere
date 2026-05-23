// Contact tools | query, get, create, update, delete, tag.

import type { CopilotToolRegistry, ToolContext, ToolResult } from './types'
import { composeContactName, splitContactName } from '@/lib/contacts/names'

const MAX_ROWS = 50

async function queryContacts(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const search = input.search as string | undefined
  const tag = input.tag as string | undefined
  const limit = Math.min(Number(input.limit ?? 25), MAX_ROWS)

  let query = ctx.supabase
    .from('contacts')
    .select('id, first_name, last_name, name, email, phone, company, tags, source, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (search && search.trim()) {
    const term = `%${search.trim()}%`
    query = query.or(`first_name.ilike.${term},last_name.ilike.${term},name.ilike.${term},email.ilike.${term},phone.ilike.${term}`)
  }
  if (tag) query = query.contains('tags', [tag])

  const { data, error } = await query
  if (error) return { success: false, error: error.message }
  return { success: true, data: { contacts: data, count: data?.length ?? 0 } }
}

async function getContact(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const id = input.id as string
  if (!id) return { success: false, error: 'id required' }
  const { data, error } = await ctx.supabase
    .from('contacts')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) return { success: false, error: error.message }
  if (!data) return { success: false, error: `contact ${id} not found` }
  return { success: true, data }
}

async function createContact(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const name = input.name as string | undefined
  const split = splitContactName(name)
  const firstName = (input.first_name as string | undefined) ?? split.firstName
  const lastName = (input.last_name as string | undefined) ?? split.lastName
  const displayName = composeContactName(firstName, lastName) ?? name
  const email = input.email as string | undefined
  const phone = input.phone as string | undefined
  if (!displayName && !email && !phone) {
    return { success: false, error: 'name, email, or phone required' }
  }
  const { data, error } = await ctx.supabase
    .from('contacts')
    .insert({
      org_id: ctx.orgId,
      first_name: firstName ?? null,
      last_name: lastName ?? null,
      name: displayName ?? null,
      email: email ?? null,
      phone: phone ?? null,
      company: (input.company as string | undefined) ?? null,
      source: 'manual',
      created_by: ctx.userId,
    })
    .select('id, first_name, last_name, name, email, phone')
    .single()
  if (error) return { success: false, error: error.message }
  return { success: true, data }
}

async function updateContact(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const id = input.id as string
  if (!id) return { success: false, error: 'id required' }
  const patch: Record<string, unknown> = {}
  for (const k of ['first_name', 'last_name', 'name', 'email', 'phone', 'company']) {
    if (input[k] !== undefined) patch[k] = input[k]
  }
  if (input.name !== undefined && input.first_name === undefined && input.last_name === undefined) {
    const split = splitContactName(input.name as string | undefined)
    patch.first_name = split.firstName
    patch.last_name = split.lastName
  }
  if (Object.keys(patch).length === 0) return { success: false, error: 'no fields to update' }

  const { data, error } = await ctx.supabase
    .from('contacts')
    .update(patch)
    .eq('id', id)
    .select('id, first_name, last_name, name, email, phone')
    .maybeSingle()
  if (error) return { success: false, error: error.message }
  if (!data) return { success: false, error: `contact ${id} not found` }
  return { success: true, data }
}

async function deleteContact(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const id = input.id as string
  if (!id) return { success: false, error: 'id required' }
  if (input.confirm_token !== 'CONFIRM') {
    return { success: false, error: 'destructive op requires confirm_token = "CONFIRM"' }
  }
  const { error } = await ctx.supabase.from('contacts').delete().eq('id', id)
  if (error) return { success: false, error: error.message }
  return { success: true, data: { deleted: id } }
}

async function addContactTag(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const id = input.id as string
  const tag = input.tag as string
  if (!id || !tag) return { success: false, error: 'id and tag required' }
  const { data: row, error: fetchErr } = await ctx.supabase
    .from('contacts')
    .select('tags')
    .eq('id', id)
    .maybeSingle()
  if (fetchErr) return { success: false, error: fetchErr.message }
  if (!row) return { success: false, error: `contact ${id} not found` }
  const next = Array.from(new Set([...(row.tags ?? []), tag]))
  const { error: updErr } = await ctx.supabase
    .from('contacts').update({ tags: next }).eq('id', id)
  if (updErr) return { success: false, error: updErr.message }
  return { success: true, data: { id, tags: next } }
}

async function removeContactTag(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const id = input.id as string
  const tag = input.tag as string
  if (!id || !tag) return { success: false, error: 'id and tag required' }
  const { data: row, error: fetchErr } = await ctx.supabase
    .from('contacts')
    .select('tags')
    .eq('id', id)
    .maybeSingle()
  if (fetchErr) return { success: false, error: fetchErr.message }
  if (!row) return { success: false, error: `contact ${id} not found` }
  const next = (row.tags ?? []).filter((t: string) => t !== tag)
  const { error: updErr } = await ctx.supabase
    .from('contacts').update({ tags: next }).eq('id', id)
  if (updErr) return { success: false, error: updErr.message }
  return { success: true, data: { id, tags: next } }
}

export const contactTools: CopilotToolRegistry = {
  query_contacts: {
    mode: 'read',
    definition: {
      name: 'query_contacts',
      description: 'Search contacts by name/email/phone, filter by tag, paginated. Returns up to 50.',
      input_schema: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Substring match across name, email, phone' },
          tag: { type: 'string', description: 'Filter to contacts that carry this tag' },
          limit: { type: 'number', description: 'Max rows (1-50, default 25)' },
        },
      },
    },
    handler: queryContacts,
  },
  get_contact: {
    mode: 'read',
    definition: {
      name: 'get_contact',
      description: 'Fetch a single contact by id, including all custom fields.',
      input_schema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
    handler: getContact,
  },
  create_contact: {
    mode: 'write',
    definition: {
      name: 'create_contact',
      description: 'Create a new contact. Prefer first_name and last_name; name is still accepted. Provide at least one of name, email, phone.',
      input_schema: {
        type: 'object',
        properties: {
          first_name: { type: 'string' },
          last_name: { type: 'string' },
          name: { type: 'string' },
          email: { type: 'string' },
          phone: { type: 'string' },
          company: { type: 'string' },
        },
      },
    },
    handler: createContact,
  },
  update_contact: {
    mode: 'write',
    definition: {
      name: 'update_contact',
      description: 'Patch a contact. Pass only the fields you want to change.',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          first_name: { type: 'string' },
          last_name: { type: 'string' },
          name: { type: 'string' },
          email: { type: 'string' },
          phone: { type: 'string' },
          company: { type: 'string' },
        },
        required: ['id'],
      },
    },
    handler: updateContact,
  },
  delete_contact: {
    mode: 'destructive',
    definition: {
      name: 'delete_contact',
      description: 'Permanently delete a contact. Requires confirm_token = "CONFIRM" (ask the user first).',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          confirm_token: { type: 'string', description: 'Must equal "CONFIRM"' },
        },
        required: ['id', 'confirm_token'],
      },
    },
    handler: deleteContact,
  },
  add_contact_tag: {
    mode: 'write',
    definition: {
      name: 'add_contact_tag',
      description: 'Add a tag to a contact (no-op if already tagged).',
      input_schema: {
        type: 'object',
        properties: { id: { type: 'string' }, tag: { type: 'string' } },
        required: ['id', 'tag'],
      },
    },
    handler: addContactTag,
  },
  remove_contact_tag: {
    mode: 'write',
    definition: {
      name: 'remove_contact_tag',
      description: 'Remove a tag from a contact.',
      input_schema: {
        type: 'object',
        properties: { id: { type: 'string' }, tag: { type: 'string' } },
        required: ['id', 'tag'],
      },
    },
    handler: removeContactTag,
  },
}
