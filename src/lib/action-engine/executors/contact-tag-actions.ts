// Executor for the contact_add_tag workflow action node.
// Finds or creates a tag by name, then links it to the contact (idempotent).

import type { ActionContext } from '@/lib/action-engine/execute-action'

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
}

export async function executeContactAddTag(
  params: Record<string, unknown>,
  ctx: ActionContext,
): Promise<string> {
  const { supabase, organizationId: orgId } = ctx

  let contactId: string | null = null
  if (typeof params.contact_id === 'string' && params.contact_id) {
    contactId = params.contact_id
  } else if (typeof params.contact_phone === 'string' && params.contact_phone) {
    const { data } = await supabase
      .from('contacts')
      .select('id')
      .eq('org_id', orgId)
      .eq('phone_e164', params.contact_phone)
      .neq('identity_status', 'archived_duplicate')
      .maybeSingle()
    if (!data) throw new Error(`contact not found for phone ${params.contact_phone}`)
    contactId = data.id as string
  }
  if (!contactId) throw new Error('contact_add_tag requires contact_id or contact_phone')

  const tagName = String(params.tag_name ?? '').trim()
  if (!tagName) throw new Error('contact_add_tag requires tag_name')

  const slug = slugify(tagName)

  // Find or create tag (org-scoped, unique by slug).
  let tagId: string
  const { data: existing } = await supabase
    .from('tags')
    .select('id')
    .eq('org_id', orgId)
    .eq('slug', slug)
    .maybeSingle()

  if (existing) {
    tagId = existing.id as string
  } else {
    const { data: created, error: createErr } = await supabase
      .from('tags')
      .insert({ org_id: orgId, name: tagName, slug, color: '#6366f1' })
      .select('id')
      .single()
    if (createErr || !created) throw new Error(`failed to create tag "${tagName}": ${createErr?.message}`)
    tagId = (created as { id: string }).id
  }

  // Link tag to contact — idempotent.
  const { error: linkErr } = await supabase
    .from('contact_tags')
    .upsert({ contact_id: contactId, tag_id: tagId }, { onConflict: 'contact_id,tag_id' })

  if (linkErr) throw new Error(`failed to link tag to contact: ${linkErr.message}`)

  return `tag "${tagName}" added to contact ${contactId}`
}
