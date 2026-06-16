// src/lib/vapi/sync-assistants.ts
// Mirrors the org's Vapi account into the assistant_mappings registry so the
// user never has to register assistant IDs by hand. The registry stays the
// fast, multi-tenant index used by the webhook hot path (resolve-org.ts) — we
// just keep it populated automatically instead of through manual entry.
//
// Called automatically when the Vapi key is saved, and on demand from the
// "Sync from Vapi" button on the Connected Assistants page.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { decrypt } from '@/lib/crypto'

interface VapiAssistant {
  id: string
  name?: string | null
}

export interface SyncVapiAssistantsResult {
  ok: boolean
  imported?: number
  error?: string
}

export async function syncVapiAssistants(
  supabase: SupabaseClient<Database>,
  organizationId: string,
): Promise<SyncVapiAssistantsResult> {
  // 1. Load + decrypt the org's Vapi API key.
  const { data: integration } = await supabase
    .from('integrations')
    .select('encrypted_api_key')
    .eq('organization_id', organizationId)
    .eq('provider', 'vapi')
    .eq('is_active', true)
    .maybeSingle()

  if (!integration?.encrypted_api_key) {
    return { ok: false, error: 'Vapi integration not connected.' }
  }

  let apiKey: string
  try {
    apiKey = await decrypt(integration.encrypted_api_key)
  } catch {
    return { ok: false, error: 'Could not read the saved Vapi API key.' }
  }

  // 2. Fetch every assistant on the account.
  let assistants: VapiAssistant[]
  try {
    const res = await fetch('https://api.vapi.ai/assistant', {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!res.ok) {
      return { ok: false, error: `Vapi returned ${res.status}.` }
    }
    const data = await res.json()
    assistants = Array.isArray(data) ? (data as VapiAssistant[]) : []
  } catch {
    return { ok: false, error: 'Failed to reach Vapi.' }
  }

  const rows = assistants
    .filter((a) => a?.id)
    .map((a) => ({
      organization_id: organizationId,
      vapi_assistant_id: a.id,
      name: a.name?.trim() || a.id,
    }))

  if (rows.length === 0) {
    return { ok: true, imported: 0 }
  }

  // 3. Upsert into the registry. onConflict keeps each row's is_active intact
  //    (so a manual disable survives a re-sync) and only refreshes the name.
  const { error } = await supabase
    .from('assistant_mappings')
    .upsert(rows, { onConflict: 'vapi_assistant_id' })

  if (error) {
    return { ok: false, error: error.message }
  }

  return { ok: true, imported: rows.length }
}
