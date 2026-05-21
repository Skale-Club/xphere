// src/lib/whatsapp/resolve-provider.ts
// Lookup + decrypt whatsapp_providers rows. Service-role context (webhooks).
// Falls back to the legacy evolution_instances table for orgs that haven't
// migrated yet, so existing integrations keep working.

import { decrypt } from '@/lib/crypto'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import type {
  ResolvedProvider,
  WhatsAppProvider,
  WhatsAppProviderStatus,
} from './types'

interface WhatsAppProviderRow {
  id: string
  org_id: string
  provider: WhatsAppProvider
  display_name: string
  phone_number: string | null
  status: WhatsAppProviderStatus
  config_encrypted: string
  webhook_secret_encrypted: string | null
}

async function rowToResolved(row: WhatsAppProviderRow): Promise<ResolvedProvider | null> {
  try {
    const configJson = await decrypt(row.config_encrypted)
    const parsed = JSON.parse(configJson) as Record<string, string>
    const webhookSecret = row.webhook_secret_encrypted
      ? await decrypt(row.webhook_secret_encrypted)
      : null

    return {
      id: row.id,
      orgId: row.org_id,
      provider: row.provider,
      displayName: row.display_name,
      phoneNumber: row.phone_number,
      status: row.status,
      config: parsed,
      webhookSecret,
    }
  } catch (err) {
    console.error('[whatsapp/resolve] decrypt error:', err)
    return null
  }
}

/**
 * Build a ResolvedProvider from a legacy evolution_instances row when an org
 * hasn't migrated to whatsapp_providers yet. Returns null on decrypt failure.
 */
async function resolveLegacyEvolution(
  orgId: string,
): Promise<ResolvedProvider | null> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from('evolution_instances')
    .select(
      'id, org_id, instance_name, base_url, token_encrypted, webhook_secret_encrypted, status, phone_number',
    )
    .eq('org_id', orgId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) return null

  try {
    const token = await decrypt(data.token_encrypted)
    const webhookSecret = data.webhook_secret_encrypted
      ? await decrypt(data.webhook_secret_encrypted)
      : null

    return {
      id: data.id,
      orgId: data.org_id,
      provider: 'evolution',
      displayName: data.instance_name,
      phoneNumber: data.phone_number,
      status: data.status as WhatsAppProviderStatus,
      config: {
        base_url: data.base_url,
        token,
        instance_name: data.instance_name,
      },
      webhookSecret,
    }
  } catch (err) {
    console.error('[whatsapp/resolve] legacy decrypt error:', err)
    return null
  }
}

/**
 * The single active WhatsApp provider for an org. Falls back to legacy
 * evolution_instances if no row exists in whatsapp_providers.
 */
export async function resolveActiveProvider(
  orgId: string,
): Promise<ResolvedProvider | null> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from('whatsapp_providers')
    .select(
      'id, org_id, provider, display_name, phone_number, status, config_encrypted, webhook_secret_encrypted',
    )
    .eq('org_id', orgId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (!error && data) {
    return rowToResolved(data as WhatsAppProviderRow)
  }

  return resolveLegacyEvolution(orgId)
}

export async function resolveProviderById(id: string): Promise<ResolvedProvider | null> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from('whatsapp_providers')
    .select(
      'id, org_id, provider, display_name, phone_number, status, config_encrypted, webhook_secret_encrypted',
    )
    .eq('id', id)
    .maybeSingle()

  if (error || !data) return null
  return rowToResolved(data as WhatsAppProviderRow)
}

/**
 * Webhook helper | given an Evolution instance name, find which provider row
 * owns it. Falls back to the legacy evolution_instances table.
 */
export async function resolveProviderByInstanceName(
  name: string,
): Promise<ResolvedProvider | null> {
  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .from('whatsapp_providers')
    .select(
      'id, org_id, provider, display_name, phone_number, status, config_encrypted, webhook_secret_encrypted',
    )
    .eq('provider', 'evolution')
    .eq('is_active', true)
    .limit(50)

  if (data) {
    for (const row of data as WhatsAppProviderRow[]) {
      const resolved = await rowToResolved(row)
      if (resolved && resolved.config.instance_name === name) {
        return resolved
      }
    }
  }

  // Legacy fallback: look up evolution_instances by name directly
  const legacy = await supabase
    .from('evolution_instances')
    .select(
      'id, org_id, instance_name, base_url, token_encrypted, webhook_secret_encrypted, status, phone_number',
    )
    .eq('instance_name', name)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (legacy.error || !legacy.data) return null
  try {
    const token = await decrypt(legacy.data.token_encrypted)
    const webhookSecret = legacy.data.webhook_secret_encrypted
      ? await decrypt(legacy.data.webhook_secret_encrypted)
      : null
    return {
      id: legacy.data.id,
      orgId: legacy.data.org_id,
      provider: 'evolution',
      displayName: legacy.data.instance_name,
      phoneNumber: legacy.data.phone_number,
      status: legacy.data.status as WhatsAppProviderStatus,
      config: {
        base_url: legacy.data.base_url,
        token,
        instance_name: legacy.data.instance_name,
      },
      webhookSecret,
    }
  } catch (err) {
    console.error('[whatsapp/resolve] legacy by-name decrypt error:', err)
    return null
  }
}

export async function resolveProviderByZApiInstance(
  instanceId: string,
): Promise<ResolvedProvider | null> {
  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .from('whatsapp_providers')
    .select(
      'id, org_id, provider, display_name, phone_number, status, config_encrypted, webhook_secret_encrypted',
    )
    .eq('provider', 'zapi')
    .eq('is_active', true)
    .limit(50)

  if (!data) return null
  for (const row of data as WhatsAppProviderRow[]) {
    const resolved = await rowToResolved(row)
    if (resolved && resolved.config.instance_id === instanceId) {
      return resolved
    }
  }
  return null
}

export async function resolveProviderByWApiKey(
  instanceKey: string,
): Promise<ResolvedProvider | null> {
  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .from('whatsapp_providers')
    .select(
      'id, org_id, provider, display_name, phone_number, status, config_encrypted, webhook_secret_encrypted',
    )
    .eq('provider', 'wapi')
    .eq('is_active', true)
    .limit(50)

  if (!data) return null
  for (const row of data as WhatsAppProviderRow[]) {
    const resolved = await rowToResolved(row)
    if (resolved && resolved.config.instance_key === instanceKey) {
      return resolved
    }
  }
  return null
}
