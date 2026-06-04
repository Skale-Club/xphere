#!/usr/bin/env tsx
// scripts/meta-audience-sync.ts
// Hourly cron job — run on Hetzner (websites-prod). Syncs each org's CRM
// contacts to their Meta Custom Audience. Idempotent: re-running is safe
// (Meta deduplicates by hash). Reads incrementally using last_synced_at
// as the watermark; first run sends all eligible contacts.
//
// Usage (from repo root):
//   tsx scripts/meta-audience-sync.ts
//   tsx scripts/meta-audience-sync.ts --org <org-id>   # single org
//   tsx scripts/meta-audience-sync.ts --dry-run
//
// Required env vars:
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   META_SYSTEM_USER_TOKEN
//   ENCRYPTION_SECRET  (not used here — token comes from env, not DB)

import { createClient } from '@supabase/supabase-js'
import type { Database } from '../src/types/database'
import {
  AgencySystemUserProvider,
} from '../src/lib/meta/audience-provider'
import {
  createCustomAudience,
  syncUsersToAudience,
  type ContactHashEntry,
} from '../src/lib/meta/custom-audiences'

// ─── Config ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const SINGLE_ORG = args.includes('--org') ? args[args.indexOf('--org') + 1] : null
const PAGE_SIZE = 500

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  return createClient<Database>(url, key, { auth: { persistSession: false } })
}

// ─── Sync one org ─────────────────────────────────────────────────────────────

interface SyncStats {
  sent: number
  removed: number
  error_count: number
}

async function syncOrg(
  supabase: ReturnType<typeof getSupabase>,
  provider: AgencySystemUserProvider,
  config: {
    id: string
    org_id: string
    meta_ad_account_id: string
    custom_audience_id: string | null
    audience_name: string | null
    last_synced_at: string | null
    consent_basis: string
  },
): Promise<SyncStats> {
  const stats: SyncStats = { sent: 0, removed: 0, error_count: 0 }
  const conn = await provider.getConnection(config.org_id, config.meta_ad_account_id)

  // 1. Ensure audience exists
  let audienceId = config.custom_audience_id
  if (!audienceId) {
    const name = config.audience_name ?? `Xphere CRM — ${config.org_id.slice(0, 8)}`
    if (!DRY_RUN) {
      const created = await createCustomAudience(config.meta_ad_account_id, conn.token, {
        name,
        consentBasis: config.consent_basis,
      })
      audienceId = created.id
      await supabase
        .from('meta_audience_config')
        .update({ custom_audience_id: audienceId })
        .eq('id', config.id)
      console.log(`  [${config.org_id}] Created audience ${audienceId}`)
    } else {
      console.log(`  [${config.org_id}] DRY-RUN: would create audience "${name}"`)
      return stats
    }
  }

  const watermark = config.last_synced_at ?? '1970-01-01T00:00:00Z'
  const syncStart = new Date().toISOString()

  // 2. ADD contacts updated since watermark (not DND, has email or phone_e164/phone)
  let addOffset = 0
  let addBatch: ContactHashEntry[] = []

  while (true) {
    const { data: contacts, error } = await supabase
      .from('contacts')
      .select('email, phone_e164, phone')
      .eq('org_id', config.org_id)
      .eq('dnd_enabled', false)
      .gt('updated_at', watermark)
      .not('email', 'is', null)
      .order('updated_at', { ascending: true })
      .range(addOffset, addOffset + PAGE_SIZE - 1)

    if (error) {
      console.error(`  [${config.org_id}] contacts query error:`, error.message)
      stats.error_count++
      break
    }
    if (!contacts || contacts.length === 0) break

    // also add contacts with phone but no email
    const phoneOnly: ContactHashEntry[] = []
    for (const c of contacts) {
      addBatch.push({ email: c.email, phone: c.phone_e164 ?? c.phone })
    }

    // flush when batch is large enough
    if (addBatch.length >= 5_000) {
      if (!DRY_RUN) {
        const r = await syncUsersToAudience(audienceId, conn.token, addBatch, 'ADD')
        stats.sent += r.sent
      } else {
        stats.sent += addBatch.length
      }
      addBatch = []
    }

    addOffset += PAGE_SIZE
    if (contacts.length < PAGE_SIZE) break
  }

  // also grab contacts with phone but no email (separate query since .not email is null would exclude them)
  let phoneOffset = 0
  while (true) {
    const { data: contacts, error } = await supabase
      .from('contacts')
      .select('email, phone_e164, phone')
      .eq('org_id', config.org_id)
      .eq('dnd_enabled', false)
      .gt('updated_at', watermark)
      .is('email', null)
      .not('phone_e164', 'is', null)
      .order('updated_at', { ascending: true })
      .range(phoneOffset, phoneOffset + PAGE_SIZE - 1)

    if (error) {
      stats.error_count++
      break
    }
    if (!contacts || contacts.length === 0) break

    for (const c of contacts) {
      addBatch.push({ email: null, phone: c.phone_e164 ?? c.phone })
    }

    phoneOffset += PAGE_SIZE
    if (contacts.length < PAGE_SIZE) break
  }

  // flush remaining add batch
  if (addBatch.length > 0) {
    if (!DRY_RUN) {
      const r = await syncUsersToAudience(audienceId, conn.token, addBatch, 'ADD')
      stats.sent += r.sent
    } else {
      stats.sent += addBatch.length
    }
  }

  // 3. REMOVE contacts that opted out since watermark
  let rmOffset = 0
  let removeBatch: ContactHashEntry[] = []

  while (true) {
    const { data: contacts, error } = await supabase
      .from('contacts')
      .select('email, phone_e164, phone')
      .eq('org_id', config.org_id)
      .eq('dnd_enabled', true)
      .gt('updated_at', watermark)
      .order('updated_at', { ascending: true })
      .range(rmOffset, rmOffset + PAGE_SIZE - 1)

    if (error) {
      stats.error_count++
      break
    }
    if (!contacts || contacts.length === 0) break

    for (const c of contacts) {
      if (c.email || c.phone_e164 || c.phone) {
        removeBatch.push({ email: c.email, phone: c.phone_e164 ?? c.phone })
      }
    }

    rmOffset += PAGE_SIZE
    if (contacts.length < PAGE_SIZE) break
  }

  if (removeBatch.length > 0) {
    if (!DRY_RUN) {
      const r = await syncUsersToAudience(audienceId, conn.token, removeBatch, 'REMOVE')
      stats.removed += r.sent
    } else {
      stats.removed += removeBatch.length
    }
  }

  // 4. Update watermark and stats
  if (!DRY_RUN) {
    await supabase
      .from('meta_audience_config')
      .update({
        last_synced_at: syncStart,
        last_sync_stats: stats as unknown as Record<string, unknown>,
      })
      .eq('id', config.id)
  }

  return stats
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const supabase = getSupabase()
  const provider = new AgencySystemUserProvider()

  console.log(`[meta-audience-sync] ${DRY_RUN ? 'DRY-RUN ' : ''}starting ${new Date().toISOString()}`)

  let query = supabase
    .from('meta_audience_config')
    .select('id, org_id, meta_ad_account_id, custom_audience_id, audience_name, last_synced_at, consent_basis')
    .eq('sync_enabled', true)

  if (SINGLE_ORG) query = query.eq('org_id', SINGLE_ORG)

  const { data: configs, error } = await query

  if (error) {
    console.error('[meta-audience-sync] failed to load configs:', error.message)
    process.exit(1)
  }

  if (!configs || configs.length === 0) {
    console.log('[meta-audience-sync] no orgs with sync_enabled=true')
    return
  }

  console.log(`[meta-audience-sync] processing ${configs.length} org(s)`)

  let totalErrors = 0
  for (const cfg of configs) {
    try {
      console.log(`  [${cfg.org_id}] syncing ad_account=${cfg.meta_ad_account_id}`)
      const stats = await syncOrg(supabase, provider, cfg)
      console.log(`  [${cfg.org_id}] done — sent=${stats.sent} removed=${stats.removed} errors=${stats.error_count}`)
      if (stats.error_count > 0) totalErrors += stats.error_count
    } catch (err) {
      console.error(`  [${cfg.org_id}] sync failed:`, err instanceof Error ? err.message : err)
      totalErrors++
    }
  }

  console.log(`[meta-audience-sync] finished. total errors: ${totalErrors}`)
  if (totalErrors > 0) process.exit(1)
}

main().catch((err) => {
  console.error('[meta-audience-sync] fatal:', err)
  process.exit(1)
})
