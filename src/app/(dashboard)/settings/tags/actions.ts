'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient, getUser } from '@/lib/supabase/server'
import { resolveLiveContactId } from '@/lib/contacts/server'

const HEX_RE = /^#[0-9A-Fa-f]{6}$/

const tagWriteSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80, 'Name too long'),
  color: z.string().regex(HEX_RE, 'Color must be a 6-digit hex code like #10B981'),
})

function toSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export interface TagRow {
  id: string
  org_id: string
  name: string
  slug: string
  color: string
  created_at: string
  contact_count: number
  opportunity_count: number
}

export async function listTags(): Promise<TagRow[]> {
  const user = await getUser()
  if (!user) return []
  const supabase = await createClient()

  const { data: orgIdData } = await supabase.rpc('get_current_org_id')
  if (!orgIdData) return []

  const [{ data: tags }, { data: contactTagRows }, { data: oppTagRows }] = await Promise.all([
    supabase.from('tags').select('*').order('name'),
    supabase.from('contact_tags').select('tag_id'),
    supabase.from('opportunity_tags').select('tag_id'),
  ])

  const contactCounts = new Map<string, number>()
  for (const r of contactTagRows ?? []) {
    contactCounts.set(r.tag_id, (contactCounts.get(r.tag_id) ?? 0) + 1)
  }
  const oppCounts = new Map<string, number>()
  for (const r of oppTagRows ?? []) {
    oppCounts.set(r.tag_id, (oppCounts.get(r.tag_id) ?? 0) + 1)
  }

  return (tags ?? []).map((t) => ({
    ...t,
    contact_count: contactCounts.get(t.id) ?? 0,
    opportunity_count: oppCounts.get(t.id) ?? 0,
  }))
}

export async function createTag(
  input: unknown,
): Promise<{ ok: true; tag: TagRow } | { ok: false; error: string }> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }
  const parsed = tagWriteSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const { name, color } = parsed.data
  const slug = toSlug(name)
  if (!slug) return { ok: false, error: 'Name produces an empty slug' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'No organization' }

  const { data, error } = await supabase
    .from('tags')
    .insert({ org_id: orgId, name, slug, color, created_by: user.id })
    .select()
    .single()
  if (error) {
    if (error.code === '23505') return { ok: false, error: `Tag "${name}" already exists` }
    return { ok: false, error: error.message }
  }

  revalidatePath('/settings/tags')
  return { ok: true, tag: { ...data, contact_count: 0, opportunity_count: 0 } }
}

export async function updateTag(
  id: string,
  input: unknown,
): Promise<{ ok: true; tag: TagRow } | { ok: false; error: string }> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }
  const parsed = tagWriteSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const { name, color } = parsed.data
  const slug = toSlug(name)
  if (!slug) return { ok: false, error: 'Name produces an empty slug' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('tags')
    .update({ name, slug, color })
    .eq('id', id)
    .select()
    .single()
  if (error) {
    if (error.code === '23505') return { ok: false, error: `Tag "${name}" already exists` }
    return { ok: false, error: error.message }
  }

  revalidatePath('/settings/tags')
  revalidatePath('/contacts')
  revalidatePath('/pipeline')
  return { ok: true, tag: { ...data, contact_count: 0, opportunity_count: 0 } }
}

export async function deleteTag(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }
  const supabase = await createClient()
  const { error } = await supabase.from('tags').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/settings/tags')
  revalidatePath('/contacts')
  revalidatePath('/pipeline')
  return { ok: true }
}

// ─── Tag assignment actions ───────────────────────────────────────────────────

export async function setContactTags(
  contactId: string,
  tagIds: string[],
): Promise<{ ok: boolean; error?: string }> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }
  const supabase = await createClient()
  const liveContactId = await resolveLiveContactId(contactId)

  const { error: delErr } = await supabase
    .from('contact_tags')
    .delete()
    .eq('contact_id', liveContactId)
  if (delErr) return { ok: false, error: delErr.message }

  if (tagIds.length > 0) {
    const { error: insErr } = await supabase.from('contact_tags').insert(
      tagIds.map((tag_id) => ({ contact_id: liveContactId, tag_id, tagged_by: user.id })),
    )
    if (insErr) return { ok: false, error: insErr.message }
  }

  revalidatePath('/contacts')
  revalidatePath(`/contacts/${contactId}`)
  return { ok: true }
}

export async function getContactTagIds(contactId: string): Promise<string[]> {
  const user = await getUser()
  if (!user) return []
  const supabase = await createClient()
  const { data } = await supabase
    .from('contact_tags')
    .select('tag_id')
    .eq('contact_id', contactId)
  return (data ?? []).map((r) => r.tag_id)
}

export async function setOpportunityTags(
  opportunityId: string,
  tagIds: string[],
): Promise<{ ok: boolean; error?: string }> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }
  const supabase = await createClient()

  const { error: delErr } = await supabase
    .from('opportunity_tags')
    .delete()
    .eq('opportunity_id', opportunityId)
  if (delErr) return { ok: false, error: delErr.message }

  if (tagIds.length > 0) {
    const { error: insErr } = await supabase.from('opportunity_tags').insert(
      tagIds.map((tag_id) => ({ opportunity_id: opportunityId, tag_id, tagged_by: user.id })),
    )
    if (insErr) return { ok: false, error: insErr.message }
  }

  revalidatePath('/pipeline')
  revalidatePath(`/pipeline/${opportunityId}`)
  return { ok: true }
}

export async function getOpportunityTagIds(opportunityId: string): Promise<string[]> {
  const user = await getUser()
  if (!user) return []
  const supabase = await createClient()
  const { data } = await supabase
    .from('opportunity_tags')
    .select('tag_id')
    .eq('opportunity_id', opportunityId)
  return (data ?? []).map((r) => r.tag_id)
}
