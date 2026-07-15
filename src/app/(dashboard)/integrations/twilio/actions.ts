'use server'
/**
 * Twilio integration server actions (per-org credentials).
 *
 * All Twilio Voice SDK + SIP + SMS credentials are stored PER ORG inside the
 * `integrations` table:
 *   - encrypted_api_key (JSON blob): account_sid, auth_token, api_key_sid, api_key_secret
 *   - config (JSONB):                twiml_app_sid, sip_domain
 *
 * Phone numbers themselves live in `twilio_phone_numbers` and are managed via
 * `numbers-actions.ts` / Calls > Phone Numbers.
 *
 * The encryption format is the standard AES-256-GCM from `@/lib/crypto`.
 * NEVER return decrypted credentials from the server actions in this file |
 * the UI receives masked / boolean-presence indicators only.
 */

import { revalidatePath } from 'next/cache'
import { createClient, getUser } from '@/lib/supabase/server'
import { encrypt, decrypt, maskApiKey } from '@/lib/crypto'
import type { Database } from '@/types/database'

type TwilioConfigUpdate = Database['public']['Tables']['integrations']['Update']['config']
type TwilioPhoneNumberRow = Database['public']['Tables']['twilio_phone_numbers']['Row']

const PROVIDER = 'twilio' as const

export interface TwilioIntegrationView {
  id: string | null
  name: string
  isActive: boolean
  /** Boolean presence | the actual values are never sent to the client. */
  hasAccountSid: boolean
  hasAuthToken: boolean
  hasApiKeySid: boolean
  hasApiKeySecret: boolean
  /** Masked snippets so the user can confirm which credential is on file. */
  accountSidHint: string | null
  apiKeySidHint: string | null
  twimlAppSid: string | null
  sipDomain: string | null
  /** Phone numbers managed via numbers-actions.ts. */
  numbers: TwilioPhoneNumberRow[]
  /** Public URL the user must paste into the TwiML App "A call comes in" field. */
  voiceWebhookUrl: string
  smsWebhookUrl: string
  /** Section-level readiness flags computed from the fields above. */
  smsConfigured: boolean
  voiceConfigured: boolean
  sipConfigured: boolean
}

const OPERATOR_ORIGIN =
  process.env.XPHERE_PUBLIC_ORIGIN ?? 'https://xphere.app'

function maskSnippet(value: string | null | undefined): string | null {
  if (!value) return null
  return maskApiKey(value)
}

interface DecryptedBlob {
  account_sid?: string
  auth_token?: string
  api_key_sid?: string
  api_key_secret?: string
}

interface TwilioConfig {
  twiml_app_sid?: string
  sip_domain?: string
}

export async function getTwilioIntegration(): Promise<TwilioIntegrationView> {
  const empty: TwilioIntegrationView = {
    id: null,
    name: 'Twilio',
    isActive: false,
    hasAccountSid: false,
    hasAuthToken: false,
    hasApiKeySid: false,
    hasApiKeySecret: false,
    accountSidHint: null,
    apiKeySidHint: null,
    twimlAppSid: null,
    sipDomain: null,
    numbers: [],
    voiceWebhookUrl: `${OPERATOR_ORIGIN}/api/twilio/voice`,
    smsWebhookUrl: `${OPERATOR_ORIGIN}/api/twilio/sms`,
    smsConfigured: false,
    voiceConfigured: false,
    sipConfigured: false,
  }

  const user = await getUser()
  if (!user) return empty
  const supabase = await createClient()

  const [{ data: row }, { data: numbersData }] = await Promise.all([
    supabase
      .from('integrations')
      .select('id, name, encrypted_api_key, config, is_active')
      .eq('provider', PROVIDER)
      .limit(1)
      .maybeSingle(),
    supabase
      .from('twilio_phone_numbers')
      .select('*')
      .eq('is_active', true)
      .order('is_default', { ascending: false })
      .order('friendly_name', { ascending: true }),
  ])

  if (!row) return { ...empty, numbers: numbersData ?? [] }

  let blob: DecryptedBlob = {}
  try {
    blob = JSON.parse(await decrypt(row.encrypted_api_key)) as DecryptedBlob
  } catch {
    // Decryption failure | surface the row as "needs reconfiguration"
    blob = {}
  }

  const config = (row.config ?? {}) as TwilioConfig

  const hasAccountSid = Boolean(blob.account_sid)
  const hasAuthToken = Boolean(blob.auth_token)
  const hasApiKeySid = Boolean(blob.api_key_sid)
  const hasApiKeySecret = Boolean(blob.api_key_secret)
  const twimlAppSid = config.twiml_app_sid ?? null
  const sipDomain = config.sip_domain ?? null
  const numbers: TwilioPhoneNumberRow[] = numbersData ?? []
  const hasSmsCapableNumber = numbers.some((n) => n.is_active && n.capability_sms)
  const hasVoiceCapableNumber = numbers.some((n) => n.is_active && n.capability_voice)

  return {
    id: row.id,
    name: row.name,
    isActive: row.is_active,
    hasAccountSid,
    hasAuthToken,
    hasApiKeySid,
    hasApiKeySecret,
    accountSidHint: maskSnippet(blob.account_sid),
    apiKeySidHint: maskSnippet(blob.api_key_sid),
    twimlAppSid,
    sipDomain,
    numbers,
    voiceWebhookUrl: `${OPERATOR_ORIGIN}/api/twilio/voice`,
    smsWebhookUrl: `${OPERATOR_ORIGIN}/api/twilio/sms`,
    smsConfigured: hasAccountSid && hasAuthToken && hasSmsCapableNumber,
    voiceConfigured:
      hasAccountSid && hasApiKeySid && hasApiKeySecret && Boolean(twimlAppSid) && hasVoiceCapableNumber,
    sipConfigured: Boolean(sipDomain),
  }
}

export interface SaveTwilioInput {
  /** Optional new value | if blank/omitted, the existing value is kept. */
  accountSid?: string
  authToken?: string
  apiKeySid?: string
  apiKeySecret?: string
  twimlAppSid?: string
  sipDomain?: string
}

function nonBlank(value: string | undefined | null): string | null {
  if (value === undefined || value === null) return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

export async function saveTwilioIntegration(
  input: SaveTwilioInput,
): Promise<{ error?: string }> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()

  const { data: orgId, error: orgError } = await supabase.rpc('get_current_org_id')
  if (orgError || !orgId) return { error: 'No active organization.' }

  const { data: existing } = await supabase
    .from('integrations')
    .select('id, encrypted_api_key, config')
    .eq('organization_id', orgId)
    .eq('provider', PROVIDER)
    .limit(1)
    .maybeSingle()

  // Merge the existing credential blob with any new values; only blanks are
  // skipped so the user can rotate a single secret without re-typing the rest.
  let currentBlob: DecryptedBlob = {}
  if (existing) {
    try {
      currentBlob = JSON.parse(await decrypt(existing.encrypted_api_key)) as DecryptedBlob
    } catch {
      currentBlob = {}
    }
  }

  const newBlob: DecryptedBlob = {
    account_sid: nonBlank(input.accountSid) ?? currentBlob.account_sid,
    auth_token: nonBlank(input.authToken) ?? currentBlob.auth_token,
    api_key_sid: nonBlank(input.apiKeySid) ?? currentBlob.api_key_sid,
    api_key_secret: nonBlank(input.apiKeySecret) ?? currentBlob.api_key_secret,
  }

  if (!newBlob.account_sid) {
    return { error: 'Account SID is required.' }
  }
  if (!newBlob.auth_token) {
    return { error: 'Auth Token is required.' }
  }

  const currentConfig = (existing?.config ?? {}) as TwilioConfig
  // Phone numbers are managed via numbers-actions.ts → twilio_phone_numbers.
  // Nothing on this config row controls the From number anymore.
  const newConfig: TwilioConfig = {
    twiml_app_sid: nonBlank(input.twimlAppSid) ?? currentConfig.twiml_app_sid,
    sip_domain: nonBlank(input.sipDomain) ?? currentConfig.sip_domain,
  }

  const encrypted = await encrypt(JSON.stringify(newBlob))
  const keyHint = maskApiKey(newBlob.account_sid)

  // `integrations.config` is JSONB | Supabase generates a structural Json type
  // that requires an index signature. Casting through unknown keeps strict-mode
  // happy while preserving the field-level shape via TwilioConfig in our code.
  const configForDb = newConfig as unknown as TwilioConfigUpdate

  if (existing) {
    const { error } = await supabase
      .from('integrations')
      .update({
        encrypted_api_key: encrypted,
        key_hint: keyHint,
        config: configForDb,
        is_active: true,
      })
      .eq('id', existing.id)
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase.from('integrations').insert({
      organization_id: orgId,
      provider: PROVIDER,
      name: 'Twilio',
      encrypted_api_key: encrypted,
      key_hint: keyHint,
      config: configForDb,
      is_active: true,
    })
    if (error) return { error: error.message }
  }

  revalidatePath('/integrations')
  revalidatePath('/integrations/twilio')
  revalidatePath('/calls')
  return {}
}

/**
 * Clear a specific field group (used by the "Disconnect Voice SDK" button).
 * Keeps SMS credentials intact when only `voice` is cleared, etc.
 */
export async function clearTwilioFields(
  section: 'voice' | 'sip',
): Promise<{ error?: string }> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()

  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No active organization.' }

  const { data: existing } = await supabase
    .from('integrations')
    .select('id, encrypted_api_key, config')
    .eq('organization_id', orgId)
    .eq('provider', PROVIDER)
    .limit(1)
    .maybeSingle()
  if (!existing) return {}

  let blob: DecryptedBlob = {}
  try {
    blob = JSON.parse(await decrypt(existing.encrypted_api_key)) as DecryptedBlob
  } catch {
    blob = {}
  }
  const config = (existing.config ?? {}) as TwilioConfig

  if (section === 'voice') {
    delete blob.api_key_sid
    delete blob.api_key_secret
    delete config.twiml_app_sid
  } else if (section === 'sip') {
    delete config.sip_domain
  }

  const encrypted = await encrypt(JSON.stringify(blob))
  const { error } = await supabase
    .from('integrations')
    .update({ encrypted_api_key: encrypted, config: config as unknown as TwilioConfigUpdate })
    .eq('id', existing.id)
  if (error) return { error: error.message }

  revalidatePath('/integrations/twilio')
  revalidatePath('/calls')
  return {}
}

// ── Test endpoints ──────────────────────────────────────────────────────────

export interface TestSmsInput {
  to: string
  body?: string
  /** Specific `twilio_phone_numbers.id` to send From. Defaults to the org's default number. */
  fromNumberId?: string
}

export async function testSendSms(
  input: TestSmsInput,
): Promise<{ success: boolean; error?: string; sid?: string }> {
  const user = await getUser()
  if (!user) return { success: false, error: 'Not authenticated.' }
  const supabase = await createClient()

  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { success: false, error: 'No active organization.' }

  const { data: org } = await supabase
    .from('organizations')
    .select('name')
    .eq('id', orgId as string)
    .maybeSingle()

  const { data: row } = await supabase
    .from('integrations')
    .select('encrypted_api_key')
    .eq('organization_id', orgId)
    .eq('provider', PROVIDER)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()
  if (!row) return { success: false, error: 'Twilio is not configured for this org.' }

  let blob: DecryptedBlob
  try {
    blob = JSON.parse(await decrypt(row.encrypted_api_key)) as DecryptedBlob
  } catch {
    return { success: false, error: 'Failed to decrypt Twilio credentials.' }
  }

  if (!blob.account_sid || !blob.auth_token) {
    return { success: false, error: 'Account SID or Auth Token missing.' }
  }

  // Resolve the From number: specific id > org default.
  let fromNumber: string | null = null
  if (input.fromNumberId) {
    const { data: numberRow } = await supabase
      .from('twilio_phone_numbers')
      .select('e164, is_active, capability_sms')
      .eq('id', input.fromNumberId)
      .maybeSingle()
    if (!numberRow) return { success: false, error: 'Selected phone number not found.' }
    if (!numberRow.is_active) return { success: false, error: 'Selected phone number is inactive.' }
    if (!numberRow.capability_sms) {
      return { success: false, error: `Number ${numberRow.e164} does not have SMS capability enabled.` }
    }
    fromNumber = numberRow.e164
  } else {
    const { data: defaultRow } = await supabase
      .from('twilio_phone_numbers')
      .select('e164, capability_sms')
      .eq('is_default', true)
      .eq('is_active', true)
      .maybeSingle()
    if (defaultRow) {
      if (!defaultRow.capability_sms) {
        return { success: false, error: `Default number ${defaultRow.e164} does not have SMS capability.` }
      }
      fromNumber = defaultRow.e164
    }
  }
  if (!fromNumber) {
    return {
      success: false,
      error: 'No phone number configured. Add one in Calls > Phone Numbers.',
    }
  }

  const to = input.to.trim()
  if (!to) return { success: false, error: 'Provide a destination phone number.' }
  const orgName = org?.name?.trim() || 'Xphere'
  const body =
    input.body?.trim() || `Test SMS from ${orgName} | Twilio integration is connected.`

  const basicAuth = btoa(`${blob.account_sid}:${blob.auth_token}`)
  const url = `https://api.twilio.com/2010-04-01/Accounts/${blob.account_sid}/Messages.json`

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: fromNumber, Body: body }).toString(),
      cache: 'no-store',
    })
    if (!res.ok) {
      const text = await res.text().catch(() => `status ${res.status}`)
      return { success: false, error: `Twilio responded ${res.status}: ${text}` }
    }
    const data = (await res.json()) as { sid: string }
    return { success: true, sid: data.sid }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error.' }
  }
}

export async function testVoiceConfig(): Promise<{ success: boolean; error?: string; identity?: string }> {
  const user = await getUser()
  if (!user) return { success: false, error: 'Not authenticated.' }
  const supabase = await createClient()

  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { success: false, error: 'No active organization.' }

  const { data: row } = await supabase
    .from('integrations')
    .select('encrypted_api_key, config')
    .eq('organization_id', orgId)
    .eq('provider', PROVIDER)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()
  if (!row) return { success: false, error: 'Twilio is not configured.' }

  let blob: DecryptedBlob
  try {
    blob = JSON.parse(await decrypt(row.encrypted_api_key)) as DecryptedBlob
  } catch {
    return { success: false, error: 'Failed to decrypt Twilio credentials.' }
  }
  const config = (row.config ?? {}) as TwilioConfig

  if (!blob.account_sid) return { success: false, error: 'Account SID missing.' }
  if (!blob.api_key_sid || !blob.api_key_secret) {
    return {
      success: false,
      error: 'Voice SDK requires api_key_sid and api_key_secret. Create an API Key in the Twilio console and paste them here.',
    }
  }
  if (!config.twiml_app_sid) {
    return {
      success: false,
      error: 'TwiML App SID missing. Create a TwiML App in Twilio and paste its SID here.',
    }
  }

  // Generate a transient token to validate the credentials work end-to-end.
  const { generateVoiceToken } = await import('@/lib/twilio/access-token')
  try {
    const result = await generateVoiceToken({
      accountSid: blob.account_sid,
      apiKeySid: blob.api_key_sid,
      apiKeySecret: blob.api_key_secret,
      twimlAppSid: config.twiml_app_sid,
      identity: `test-${user.id.slice(0, 8)}`,
      ttlSeconds: 60,
    })
    return { success: true, identity: result.identity }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Token generation failed.' }
  }
}

export async function testSipConfig(): Promise<{ success: boolean; error?: string; sipDomain?: string }> {
  const view = await getTwilioIntegration()
  if (!view.sipDomain) {
    return { success: false, error: 'SIP domain not configured. Paste the *.sip.twilio.com domain from your Twilio console.' }
  }
  // No remote-side check available without provisioning a SIP endpoint | surface
  // the configured domain so the user can confirm it matches Twilio.
  return { success: true, sipDomain: view.sipDomain }
}
