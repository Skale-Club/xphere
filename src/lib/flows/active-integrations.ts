'use server'

import { createClient } from '@/lib/supabase/server'
import type { IntegrationKey } from './node-metadata'

/**
 * Returns the set of integration keys that are currently active for the
 * authenticated user's organization. Used to filter the trigger/action
 * picker so only relevant options appear.
 *
 * Detection rules (best-effort, fail-open):
 *  - `evolution` / `whatsapp` → at least one `evolution_instances` row exists
 *  - `meta`     → at least one active `meta_channels` row
 *  - `manychat` → at least one active `manychat_*` config row
 *  - `vapi`     → an active `integrations` row with provider 'vapi'
 *  - `twilio`   → an active `integrations` row with provider 'twilio'
 *  - `ghl`      → an active `integrations` row with provider 'gohighlevel'
 *  - `resend`   → an active tenant `integrations` row with provider 'resend'
 */
export async function getActiveIntegrations(): Promise<IntegrationKey[]> {
  const active = new Set<IntegrationKey>()

  try {
    const supabase = await createClient()

    // Generic integrations table
    try {
      const { data: ints } = await supabase
        .from('integrations')
        .select('provider, is_active')
        .eq('is_active', true)

      for (const row of ints ?? []) {
        const provider = (row.provider ?? '').toString().toLowerCase()
        if (provider === 'vapi') active.add('vapi')
        if (provider === 'twilio') active.add('twilio')
        if (provider === 'gohighlevel') active.add('ghl')
        if (provider === 'resend') active.add('resend')
      }
    } catch {
      /* table missing → ignore */
    }

    // Evolution / WhatsApp
    try {
      const { count } = await supabase
        .from('evolution_instances')
        .select('id', { count: 'exact', head: true })
      if ((count ?? 0) > 0) {
        active.add('evolution')
        active.add('whatsapp')
      }
    } catch {
      /* ignore */
    }

    // Meta channels
    try {
      const { count } = await supabase
        .from('meta_channels')
        .select('id', { count: 'exact', head: true })
        .eq('is_active', true)
      if ((count ?? 0) > 0) active.add('meta')
    } catch {
      /* ignore */
    }

    // ManyChat
    try {
      const { count } = await supabase
        .from('manychat_configs')
        .select('id', { count: 'exact', head: true })
      if ((count ?? 0) > 0) active.add('manychat')
    } catch {
      /* ignore */
    }
  } catch {
    /* DB failure → fall through with empty set */
  }

  return Array.from(active)
}
