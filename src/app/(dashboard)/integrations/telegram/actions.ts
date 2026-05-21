'use server'

import { revalidatePath } from 'next/cache'

import { createClient, getUser } from '@/lib/supabase/server'
import { encrypt } from '@/lib/crypto'
import { getMe, setWebhook, deleteWebhook } from '@/lib/telegram/client'

// ---------------------------------------------------------------------------
// View shape returned to the client component
// ---------------------------------------------------------------------------

export interface TelegramBotView {
  id: string
  botUsername: string | null
  botName: string | null
  notificationChatIds: string[]
  automationEnabled: boolean
  agentId: string | null
  webhookSet: boolean
  webhookUrl: string
  lastError: string | null
  createdAt: string
}

export interface AgentOption {
  id: string
  name: string
}

function buildWebhookUrl(orgId: string): string {
  const origin =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.XPHERE_PUBLIC_ORIGIN ??
    'https://xphere.app'
  return `${origin.replace(/\/$/, '')}/api/telegram/webhook/${orgId}`
}

// ---------------------------------------------------------------------------
// getTelegramBot | read the active row (or null)
// ---------------------------------------------------------------------------

export async function getTelegramBot(): Promise<TelegramBotView | null> {
  const user = await getUser()
  if (!user) return null

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return null

  const { data } = await supabase
    .from('telegram_bots')
    .select(
      'id, bot_username, bot_name, notification_chat_ids, automation_enabled, agent_id, webhook_set, last_error, created_at',
    )
    .eq('org_id', orgId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data) return null

  return {
    id: data.id,
    botUsername: data.bot_username,
    botName: data.bot_name,
    notificationChatIds: data.notification_chat_ids ?? [],
    automationEnabled: data.automation_enabled,
    agentId: data.agent_id,
    webhookSet: data.webhook_set,
    webhookUrl: buildWebhookUrl(orgId as string),
    lastError: data.last_error,
    createdAt: data.created_at,
  }
}

// ---------------------------------------------------------------------------
// listAgentsForSelect | used by the automation agent picker
// ---------------------------------------------------------------------------

export async function listAgentsForSelect(): Promise<AgentOption[]> {
  const user = await getUser()
  if (!user) return []

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return []

  const { data } = await supabase
    .from('agents')
    .select('id, name')
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .order('name', { ascending: true })

  if (!data) return []
  return data.map((a) => ({ id: a.id, name: a.name }))
}

// ---------------------------------------------------------------------------
// connectTelegramBot | validates token, sets webhook, persists row
// ---------------------------------------------------------------------------

export interface ConnectTelegramBotInput {
  botToken: string
}

export async function connectTelegramBot(
  input: ConnectTelegramBotInput,
): Promise<{ ok: true; botUsername: string } | { ok: false; error: string }> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'Not authenticated.' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'No active organization.' }

  const botToken = input.botToken.trim()
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(botToken)) {
    return { ok: false, error: 'Invalid bot token format.' }
  }

  // 1. Validate token via /getMe
  const me = await getMe(botToken)
  if (!me || !me.username) {
    return { ok: false, error: 'Telegram rejected the token. Check it with BotFather and try again.' }
  }

  // 2. Encrypt + upsert row (one active per org)
  const tokenEncrypted = await encrypt(botToken)
  const webhookUrl = buildWebhookUrl(orgId as string)

  const { data: existing } = await supabase
    .from('telegram_bots')
    .select('id, notification_chat_ids, automation_enabled, agent_id')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .maybeSingle()

  let rowId: string
  if (existing) {
    const { error: updErr } = await supabase
      .from('telegram_bots')
      .update({
        bot_token_encrypted: tokenEncrypted,
        bot_username: me.username,
        bot_name: me.name,
        last_error: null,
      })
      .eq('id', existing.id)
    if (updErr) return { ok: false, error: updErr.message }
    rowId = existing.id
  } else {
    const { data: inserted, error: insErr } = await supabase
      .from('telegram_bots')
      .insert({
        org_id: orgId as string,
        bot_token_encrypted: tokenEncrypted,
        bot_username: me.username,
        bot_name: me.name,
        is_active: true,
        webhook_set: false,
        created_by: user.id,
      })
      .select('id')
      .single()
    if (insErr || !inserted) return { ok: false, error: insErr?.message ?? 'insert failed' }
    rowId = inserted.id
  }

  // 3. Register the webhook with Telegram
  const webhookOk = await setWebhook(botToken, webhookUrl)

  await supabase
    .from('telegram_bots')
    .update({
      webhook_set: webhookOk,
      last_error: webhookOk ? null : 'setWebhook returned false',
    })
    .eq('id', rowId)

  revalidatePath('/integrations')
  revalidatePath('/integrations/telegram')

  if (!webhookOk) {
    return {
      ok: false,
      error: 'Bot token saved, but Telegram refused setWebhook. Confirm the public URL is reachable.',
    }
  }

  return { ok: true, botUsername: me.username }
}

// ---------------------------------------------------------------------------
// saveNotificationChats
// ---------------------------------------------------------------------------

export async function saveNotificationChats(
  chatIds: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'Not authenticated.' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'No active organization.' }

  const cleaned = Array.from(
    new Set(
      chatIds
        .map((id) => id.trim())
        .filter((id) => id.length > 0 && /^-?\d+$/.test(id)),
    ),
  )

  const { error } = await supabase
    .from('telegram_bots')
    .update({ notification_chat_ids: cleaned })
    .eq('org_id', orgId)
    .eq('is_active', true)

  if (error) return { ok: false, error: error.message }

  revalidatePath('/integrations/telegram')
  return { ok: true }
}

// ---------------------------------------------------------------------------
// toggleAutomation
// ---------------------------------------------------------------------------

export interface ToggleAutomationInput {
  enabled: boolean
  agentId?: string | null
}

export async function toggleAutomation(
  input: ToggleAutomationInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'Not authenticated.' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'No active organization.' }

  if (input.enabled && !input.agentId) {
    return { ok: false, error: 'Select an agent before enabling automation.' }
  }

  const { error } = await supabase
    .from('telegram_bots')
    .update({
      automation_enabled: input.enabled,
      agent_id: input.agentId ?? null,
    })
    .eq('org_id', orgId)
    .eq('is_active', true)

  if (error) return { ok: false, error: error.message }

  revalidatePath('/integrations/telegram')
  return { ok: true }
}

// ---------------------------------------------------------------------------
// disconnectTelegramBot | unset webhook + mark row inactive
// ---------------------------------------------------------------------------

export async function disconnectTelegramBot(): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'Not authenticated.' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'No active organization.' }

  const { data: bot } = await supabase
    .from('telegram_bots')
    .select('id, bot_token_encrypted')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .maybeSingle()

  if (!bot) return { ok: true }

  // Best-effort decrypt + deleteWebhook
  try {
    const { decrypt } = await import('@/lib/crypto')
    const token = await decrypt(bot.bot_token_encrypted)
    await deleteWebhook(token).catch(() => null)
  } catch (err) {
    console.error('[telegram/disconnect] deleteWebhook failed:', err)
  }

  const { error } = await supabase
    .from('telegram_bots')
    .update({ is_active: false, webhook_set: false })
    .eq('id', bot.id)

  if (error) return { ok: false, error: error.message }

  revalidatePath('/integrations')
  revalidatePath('/integrations/telegram')
  return { ok: true }
}
