/**
 * Sync message templates from Meta into our `whatsapp_templates` cache.
 *
 * Reasons to sync periodically:
 *   - Template approval status can flip without user action (REJECTED, PAUSED)
 *   - Customers may add or edit templates directly in Business Manager
 *   - The campaign wizard reads from our cache (fast + works offline)
 */

import { metaFetch, MetaApiException } from './client'
import { getActiveCloudAccount } from './resolve-account'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { Json } from '@/types/database'
import type { MetaTemplate, MetaTemplateComponent } from './types'

interface SyncResult {
  ok: true
  inserted: number
  updated: number
  deleted: number
}

interface SyncErr {
  ok: false
  error: string
}

export async function syncTemplates(orgId: string): Promise<SyncResult | SyncErr> {
  const account = await getActiveCloudAccount(orgId)
  if (!account) {
    return { ok: false, error: 'No active WhatsApp Cloud account for this org' }
  }

  try {
    // Page through all templates (Meta uses cursor pagination).
    const all: MetaTemplate[] = []
    let after: string | undefined
    for (let i = 0; i < 20; i += 1) {
      const res = await metaFetch<{
        data: MetaTemplate[]
        paging?: { cursors?: { after?: string }; next?: string }
      }>(account, `/${account.wabaId}/message_templates`, {
        query: {
          fields: 'id,name,language,category,status,components',
          limit: 100,
          after,
        },
      })
      all.push(...(res.data ?? []))
      after = res.paging?.cursors?.after
      if (!after || !res.paging?.next) break
    }

    const supabase = createServiceRoleClient()
    const now = new Date().toISOString()

    // Read existing rows to compute insert vs update vs delete diff.
    const { data: existing } = await supabase
      .from('whatsapp_templates')
      .select('id, meta_template_id, cloud_account_id, name, language')
      .eq('cloud_account_id', account.id)
    const existingByMeta = new Map(
      (existing ?? []).map((row) => [`${row.name}::${row.language}`, row]),
    )

    let inserted = 0
    let updated = 0

    for (const tpl of all) {
      const key = `${tpl.name}::${tpl.language}`
      const bodyVars = countVariables(tpl.components, 'BODY')
      const headerVars = countVariables(tpl.components, 'HEADER')
      const row = {
        org_id: account.orgId,
        cloud_account_id: account.id,
        meta_template_id: tpl.id,
        name: tpl.name,
        language: tpl.language,
        category: tpl.category,
        status: tpl.status,
        components: tpl.components as unknown as Json,
        body_variable_count: bodyVars,
        header_variable_count: headerVars,
        synced_at: now,
      }
      if (existingByMeta.has(key)) {
        await supabase
          .from('whatsapp_templates')
          .update(row)
          .eq('id', existingByMeta.get(key)!.id)
        updated += 1
      } else {
        await supabase.from('whatsapp_templates').insert(row)
        inserted += 1
      }
    }

    // Anything in the DB that wasn't in this sync no longer exists on Meta's side.
    const seenKeys = new Set(all.map((t) => `${t.name}::${t.language}`))
    const toDelete = (existing ?? []).filter((row) => !seenKeys.has(`${row.name}::${row.language}`))
    if (toDelete.length > 0) {
      await supabase
        .from('whatsapp_templates')
        .delete()
        .in('id', toDelete.map((r) => r.id))
    }

    await supabase
      .from('whatsapp_cloud_accounts')
      .update({ last_synced_at: now })
      .eq('id', account.id)

    return { ok: true, inserted, updated, deleted: toDelete.length }
  } catch (err) {
    if (err instanceof MetaApiException) return { ok: false, error: err.metaError.message }
    return { ok: false, error: err instanceof Error ? err.message : 'Sync failed' }
  }
}

// ─────────────────────────── Create template ───────────────────────────

export interface CreateTemplateInput {
  name: string
  language: string
  category: 'UTILITY' | 'MARKETING' | 'AUTHENTICATION'
  headerText?: string | null
  bodyText: string
  /** One example value per {{n}} placeholder in bodyText, in order. */
  bodyExamples?: string[]
  footerText?: string | null
  buttons?: Array<{ type: 'URL' | 'QUICK_REPLY'; text: string; url?: string }>
}

interface CreateResult {
  ok: true
  metaTemplateId: string
  status: string
}

/**
 * Create a message template on Meta and cache it locally (status usually
 * PENDING until Meta reviews). Body variables ({{1}}, {{2}}…) require an
 * `example.body_text` array or Meta rejects the create call.
 */
export async function createCloudTemplate(
  orgId: string,
  input: CreateTemplateInput,
): Promise<CreateResult | SyncErr> {
  const account = await getActiveCloudAccount(orgId)
  if (!account) {
    return { ok: false, error: 'No active WhatsApp Cloud account for this org' }
  }

  const bodyVarCount = (input.bodyText.match(/\{\{\d+\}\}/g) ?? []).length
  if (bodyVarCount > 0 && (input.bodyExamples ?? []).filter((v) => v.trim()).length < bodyVarCount) {
    return { ok: false, error: `Provide an example value for each of the ${bodyVarCount} body variable(s).` }
  }

  // Build Meta components payload.
  const components: MetaTemplateComponent[] = []
  if (input.headerText?.trim()) {
    components.push({ type: 'HEADER', format: 'TEXT', text: input.headerText.trim() })
  }
  const bodyComponent: MetaTemplateComponent = { type: 'BODY', text: input.bodyText }
  if (bodyVarCount > 0) {
    bodyComponent.example = { body_text: [input.bodyExamples!.slice(0, bodyVarCount)] }
  }
  components.push(bodyComponent)
  if (input.footerText?.trim()) {
    components.push({ type: 'FOOTER', text: input.footerText.trim() })
  }
  if (input.buttons && input.buttons.length > 0) {
    components.push({
      type: 'BUTTONS',
      buttons: input.buttons.map((b) =>
        b.type === 'URL'
          ? { type: 'URL' as const, text: b.text, url: b.url ?? '' }
          : { type: 'QUICK_REPLY' as const, text: b.text },
      ),
    })
  }

  try {
    const res = await metaFetch<{ id: string; status?: string; category?: string }>(
      account,
      `/${account.wabaId}/message_templates`,
      {
        method: 'POST',
        body: {
          name: input.name,
          language: input.language,
          category: input.category,
          components,
        },
      },
    )

    const status = (res.status as MetaTemplate['status']) ?? 'PENDING'
    const supabase = createServiceRoleClient()
    const now = new Date().toISOString()

    // Cache locally so it shows in the templates list immediately (PENDING).
    await supabase.from('whatsapp_templates').upsert(
      {
        org_id: account.orgId,
        cloud_account_id: account.id,
        meta_template_id: res.id,
        name: input.name,
        language: input.language,
        category: input.category,
        status,
        components: components as unknown as Json,
        body_variable_count: bodyVarCount,
        header_variable_count: input.headerText?.trim()
          ? (input.headerText.match(/\{\{\d+\}\}/g) ?? []).length
          : 0,
        synced_at: now,
      },
      { onConflict: 'cloud_account_id,name,language' },
    )

    return { ok: true, metaTemplateId: res.id, status }
  } catch (err) {
    if (err instanceof MetaApiException) return { ok: false, error: err.metaError.message }
    return { ok: false, error: err instanceof Error ? err.message : 'Create failed' }
  }
}

/**
 * Count `{{n}}` placeholders inside the text body of a specific component
 * type. Buttons and headers with media don't have `{{n}}` placeholders.
 */
function countVariables(components: MetaTemplateComponent[], type: 'HEADER' | 'BODY'): number {
  const block = components.find((c) => c.type === type)
  if (!block?.text) return 0
  const matches = block.text.match(/\{\{\d+\}\}/g)
  return matches ? matches.length : 0
}
