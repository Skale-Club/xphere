// src/lib/action-engine/executors/send-telegram-notification.ts
// Executor for the `send_telegram_notification` action node.
// Looks up the active telegram bot for the org, decrypts the token, and
// dispatches the message to either:
//   - the explicit `chatId` override, OR
//   - all chat IDs configured in `telegram_bots.notification_chat_ids`.
//
// IMPORTANT: this module is intentionally NOT wired into
// `src/lib/workflows/spec.ts` or `src/lib/action-engine/execute-action.ts` —
// SEED-033/parent integration will register it. This file only exposes the
// executor function so other modules can call it once the workflow node is
// registered. SEED-034.

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'
import { sendTelegramMessage } from '@/lib/telegram/client'
import type { TelegramParseMode } from '@/lib/telegram/types'

export interface ExecuteSendTelegramNotificationParams {
  orgId: string
  text: string
  /** Override target chat ID. If absent, falls back to notification_chat_ids. */
  chatId?: string
  parseMode?: TelegramParseMode
  disableNotification?: boolean
}

export interface ExecuteSendTelegramNotificationResult {
  ok: boolean
  error?: string
  messageIds: number[]
}

/**
 * Translates the user-facing `parseMode` value into what Telegram's API
 * accepts. 'plain' becomes `undefined` (no formatting).
 */
function normalizeParseMode(mode?: TelegramParseMode): 'HTML' | 'MarkdownV2' | undefined {
  if (!mode || mode === 'plain') return undefined
  if (mode === 'HTML') return 'HTML'
  return 'MarkdownV2'
}

export async function executeSendTelegramNotification(
  params: ExecuteSendTelegramNotificationParams,
): Promise<ExecuteSendTelegramNotificationResult> {
  const { orgId, text, chatId, parseMode, disableNotification } = params

  if (!text || !text.trim()) {
    return { ok: false, error: 'text is required', messageIds: [] }
  }

  const supabase = createServiceRoleClient()
  const { data: bot, error } = await supabase
    .from('telegram_bots')
    .select('bot_token_encrypted, notification_chat_ids')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .maybeSingle()

  if (error || !bot) {
    return { ok: false, error: 'no active telegram bot for org', messageIds: [] }
  }

  let botToken: string
  try {
    botToken = await decrypt(bot.bot_token_encrypted)
  } catch {
    return { ok: false, error: 'failed to decrypt bot token', messageIds: [] }
  }

  const targets = chatId
    ? [chatId]
    : Array.isArray(bot.notification_chat_ids)
      ? bot.notification_chat_ids.filter((id) => typeof id === 'string' && id.trim().length > 0)
      : []

  if (targets.length === 0) {
    return {
      ok: false,
      error: 'no target chat IDs configured (set notification_chat_ids or pass chatId)',
      messageIds: [],
    }
  }

  const apiParseMode = normalizeParseMode(parseMode)
  const messageIds: number[] = []
  const errors: string[] = []

  for (const target of targets) {
    const res = await sendTelegramMessage({
      botToken,
      chatId: target,
      text,
      parseMode: apiParseMode,
      disableNotification,
    })
    if (res.ok && res.messageId !== undefined) {
      messageIds.push(res.messageId)
    } else {
      errors.push(`${target}: ${res.error ?? 'unknown'}`)
    }
  }

  if (messageIds.length === 0) {
    return {
      ok: false,
      error: errors.join('; ') || 'all sends failed',
      messageIds,
    }
  }

  return {
    ok: true,
    messageIds,
    error: errors.length > 0 ? errors.join('; ') : undefined,
  }
}
