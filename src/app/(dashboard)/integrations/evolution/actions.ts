'use server'

import { revalidatePath } from 'next/cache'

import { createClient, getUser } from '@/lib/supabase/server'
import { encrypt } from '@/lib/crypto'
import {
  listInstances,
  createInstance as evoCreateInstance,
  getInstanceStatus,
  getQRCode as evoGetQRCode,
  logoutInstance,
  deleteInstance as evoDeleteInstance,
} from '@/lib/evolution/client'
import { resolveEvolutionInstance } from '@/lib/evolution/credentials'
import { sendWhatsappMessage } from '@/lib/evolution/send-message'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EvolutionInstanceView {
  id: string
  instanceName: string
  baseUrl: string
  status: 'disconnected' | 'connecting' | 'connected' | 'qr_pending'
  phoneNumber: string | null
  connectedAt: string | null
  lastError: string | null
  hasWebhookSecret: boolean
}

export async function getEvolutionInstance(): Promise<EvolutionInstanceView | null> {
  const user = await getUser()
  if (!user) return null

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return null

  const { data } = await supabase
    .from('evolution_instances')
    .select('id, instance_name, base_url, status, phone_number, connected_at, last_error, webhook_secret_encrypted')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data) return null

  return {
    id: data.id,
    instanceName: data.instance_name,
    baseUrl: data.base_url,
    status: data.status,
    phoneNumber: data.phone_number,
    connectedAt: data.connected_at,
    lastError: data.last_error,
    hasWebhookSecret: data.webhook_secret_encrypted !== null,
  }
}

// ---------------------------------------------------------------------------
// Step 1: Save server config (base_url + token) — validates by listing instances
// ---------------------------------------------------------------------------

export interface SaveEvolutionConfigInput {
  baseUrl: string
  token: string
  webhookSecret?: string
  instanceName: string
}

export async function saveEvolutionConfig(
  input: SaveEvolutionConfigInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'Not authenticated.' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'No active organization.' }

  const baseUrl = input.baseUrl.trim().replace(/\/$/, '')
  const token = input.token.trim()
  const instanceName = input.instanceName.trim()

  if (!/^https?:\/\//.test(baseUrl)) {
    return { ok: false, error: 'base_url must start with http:// or https://' }
  }
  if (!token) return { ok: false, error: 'token is required' }
  if (!instanceName) return { ok: false, error: 'instance_name is required' }

  // Validate connection by listing instances on the Evolution Go server
  const probe = await listInstances({ baseUrl, token })
  if (!probe.ok) {
    return { ok: false, error: `Could not reach Evolution Go: ${probe.error ?? 'unknown error'}` }
  }

  const tokenEncrypted = await encrypt(token)
  const webhookSecretEncrypted = input.webhookSecret?.trim()
    ? await encrypt(input.webhookSecret.trim())
    : null

  // Upsert: one row per (org_id, instance_name)
  const { data: existing } = await supabase
    .from('evolution_instances')
    .select('id')
    .eq('org_id', orgId)
    .eq('instance_name', instanceName)
    .maybeSingle()

  let id: string
  if (existing) {
    const { error } = await supabase
      .from('evolution_instances')
      .update({
        base_url: baseUrl,
        token_encrypted: tokenEncrypted,
        webhook_secret_encrypted: webhookSecretEncrypted,
        is_active: true,
      })
      .eq('id', existing.id)
    if (error) return { ok: false, error: error.message }
    id = existing.id
  } else {
    const { data, error } = await supabase
      .from('evolution_instances')
      .insert({
        org_id: orgId,
        instance_name: instanceName,
        base_url: baseUrl,
        token_encrypted: tokenEncrypted,
        webhook_secret_encrypted: webhookSecretEncrypted,
        status: 'disconnected',
        created_by: user.id,
      })
      .select('id')
      .single()
    if (error || !data) return { ok: false, error: error?.message ?? 'insert failed' }
    id = data.id
  }

  revalidatePath('/integrations')
  revalidatePath('/integrations/evolution')
  return { ok: true, id }
}

// ---------------------------------------------------------------------------
// Step 2: Create the instance on the Evolution Go server (provisions QR)
// ---------------------------------------------------------------------------

export async function createEvolutionInstance(): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'Not authenticated.' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'No active organization.' }

  const instance = await resolveEvolutionInstance(orgId, undefined, supabase)
  if (!instance) return { ok: false, error: 'Save the server config first.' }

  // Build webhook URL — defaults to xphere.app, overridable via env
  const origin = process.env.XPHERE_PUBLIC_ORIGIN ?? 'https://xphere.app'
  const webhookUrl = `${origin}/api/evolution/webhook`

  const res = await evoCreateInstance(instance.config, instance.instance_name, webhookUrl, true)
  if (!res.ok) {
    // Some Evolution Go servers return 409 if the instance already exists — that's fine
    if (res.status !== 409) {
      await supabase
        .from('evolution_instances')
        .update({ last_error: res.error ?? 'createInstance failed' })
        .eq('id', instance.id)
      return { ok: false, error: res.error ?? 'createInstance failed' }
    }
  }

  await supabase
    .from('evolution_instances')
    .update({ status: 'qr_pending', last_error: null })
    .eq('id', instance.id)

  revalidatePath('/integrations/evolution')
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Step 3: QR + status polling
// ---------------------------------------------------------------------------

export interface QRCodeView {
  base64: string | null
  code: string | null
  status: 'disconnected' | 'connecting' | 'connected' | 'qr_pending'
  phoneNumber: string | null
}

export async function getEvolutionQRCode(): Promise<{ ok: true; data: QRCodeView } | { ok: false; error: string }> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'Not authenticated.' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'No active organization.' }

  const instance = await resolveEvolutionInstance(orgId, undefined, supabase)
  if (!instance) return { ok: false, error: 'No instance configured.' }

  // Status first
  const statusRes = await getInstanceStatus(instance.config, instance.instance_name)
  let domainStatus: QRCodeView['status'] = instance.status
  let phone = instance.phone_number

  if (statusRes.ok && statusRes.data?.state) {
    const s = statusRes.data.state
    if (s === 'open') domainStatus = 'connected'
    else if (s === 'qr') domainStatus = 'qr_pending'
    else if (s === 'connecting') domainStatus = 'connecting'
    else domainStatus = 'disconnected'

    // Persist if changed
    if (domainStatus !== instance.status) {
      await supabase
        .from('evolution_instances')
        .update({
          status: domainStatus,
          connected_at: domainStatus === 'connected' ? new Date().toISOString() : instance.status === 'connected' ? undefined : null,
        })
        .eq('id', instance.id)
    }
  }

  if (domainStatus === 'connected') {
    return { ok: true, data: { base64: null, code: null, status: 'connected', phoneNumber: phone } }
  }

  const qrRes = await evoGetQRCode(instance.config, instance.instance_name)
  if (!qrRes.ok) {
    return {
      ok: true,
      data: { base64: null, code: null, status: domainStatus, phoneNumber: phone },
    }
  }

  return {
    ok: true,
    data: {
      base64: qrRes.data?.base64 ?? null,
      code: qrRes.data?.code ?? null,
      status: domainStatus,
      phoneNumber: phone,
    },
  }
}

// ---------------------------------------------------------------------------
// Disconnect (logout + soft-delete row)
// ---------------------------------------------------------------------------

export async function disconnectEvolutionInstance(): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'Not authenticated.' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'No active organization.' }

  const instance = await resolveEvolutionInstance(orgId, undefined, supabase)
  if (!instance) return { ok: false, error: 'No instance configured.' }

  await logoutInstance(instance.config, instance.instance_name).catch(() => null)
  await evoDeleteInstance(instance.config, instance.instance_name).catch(() => null)

  await supabase
    .from('evolution_instances')
    .update({
      status: 'disconnected',
      phone_number: null,
      connected_at: null,
      is_active: false,
    })
    .eq('id', instance.id)

  revalidatePath('/integrations')
  revalidatePath('/integrations/evolution')
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Send test message
// ---------------------------------------------------------------------------

export async function sendEvolutionTestMessage(
  to: string,
  text: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'Not authenticated.' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'No active organization.' }

  const result = await sendWhatsappMessage({
    orgId,
    to,
    text,
    splitIntoChunks: false,
  })

  if (!result.ok) return { ok: false, error: result.error ?? 'send failed' }
  return { ok: true }
}
