// src/lib/evolution/credentials.ts
// Loads + decrypts an Evolution Go instance config for a given org.
//
// Used by:
//   - process-event (inbound webhook → which instance produced this event?)
//   - send-message (outbound → which instance should send?)
//   - executors (send_whatsapp_message, send_whatsapp_mention_all)

import { decrypt } from '@/lib/crypto'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { EvolutionConfig } from './client'

export interface EvolutionInstanceRow {
  id: string
  org_id: string
  instance_name: string
  base_url: string
  status: 'disconnected' | 'connecting' | 'connected' | 'qr_pending'
  phone_number: string | null
}

export interface ResolvedEvolutionInstance extends EvolutionInstanceRow {
  config: EvolutionConfig
  webhookSecret?: string | null
}

/**
 * Resolve the active Evolution Go instance for an org.
 * Returns null if none configured.
 *
 * If `instanceName` is provided, looks up that specific instance.
 * Otherwise returns the first active instance.
 */
export async function resolveEvolutionInstance(
  orgId: string,
  instanceName?: string,
  supabase?: SupabaseClient<Database>,
): Promise<ResolvedEvolutionInstance | null> {
  const client = supabase ?? createServiceRoleClient()

  let query = client
    .from('evolution_instances')
    .select('id, org_id, instance_name, base_url, token_encrypted, webhook_secret_encrypted, status, phone_number')
    .eq('org_id', orgId)
    .eq('is_active', true)

  if (instanceName) {
    query = query.eq('instance_name', instanceName)
  }

  const { data, error } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle()

  if (error || !data) {
    return null
  }

  const token = await decrypt(data.token_encrypted)
  const webhookSecret = data.webhook_secret_encrypted
    ? await decrypt(data.webhook_secret_encrypted)
    : null

  return {
    id: data.id,
    org_id: data.org_id,
    instance_name: data.instance_name,
    base_url: data.base_url,
    status: data.status,
    phone_number: data.phone_number,
    config: { baseUrl: data.base_url, token },
    webhookSecret,
  }
}

/**
 * Resolve instance by name (no org_id) | only used by the webhook handler
 * which has to identify the org *from* the instance name.
 */
export async function resolveEvolutionInstanceByName(
  instanceName: string,
): Promise<ResolvedEvolutionInstance | null> {
  const client = createServiceRoleClient()

  const { data, error } = await client
    .from('evolution_instances')
    .select('id, org_id, instance_name, base_url, token_encrypted, webhook_secret_encrypted, status, phone_number')
    .eq('instance_name', instanceName)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (error || !data) {
    return null
  }

  const token = await decrypt(data.token_encrypted)
  const webhookSecret = data.webhook_secret_encrypted
    ? await decrypt(data.webhook_secret_encrypted)
    : null

  return {
    id: data.id,
    org_id: data.org_id,
    instance_name: data.instance_name,
    base_url: data.base_url,
    status: data.status,
    phone_number: data.phone_number,
    config: { baseUrl: data.base_url, token },
    webhookSecret,
  }
}
