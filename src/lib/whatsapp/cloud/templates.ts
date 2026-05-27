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
