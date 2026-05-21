// src/lib/telegram/client.ts
// Thin wrappers around the Telegram Bot API. All calls return ok/error shapes
// | never throw | so callers (webhooks, executors) can fail soft. SEED-034.

import type { TelegramFile } from './types'

const TELEGRAM_API = 'https://api.telegram.org/bot'
const TELEGRAM_FILE_BASE = 'https://api.telegram.org/file/bot'

interface TelegramApiResponse<T> {
  ok: boolean
  result?: T
  description?: string
  error_code?: number
}

async function callTelegram<T>(
  botToken: string,
  method: string,
  body?: Record<string, unknown>,
): Promise<TelegramApiResponse<T>> {
  try {
    const url = `${TELEGRAM_API}${botToken}/${method}`
    const init: RequestInit = body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : { method: 'GET' }

    const res = await fetch(url, init)
    const json = (await res.json().catch(() => null)) as TelegramApiResponse<T> | null
    if (!json) {
      return { ok: false, description: `HTTP ${res.status} | non-JSON response` }
    }
    return json
  } catch (err) {
    return { ok: false, description: err instanceof Error ? err.message : String(err) }
  }
}

// ---------------------------------------------------------------------------
// sendMessage
// ---------------------------------------------------------------------------

export interface SendTelegramMessageParams {
  botToken: string
  chatId: string
  text: string
  parseMode?: 'HTML' | 'MarkdownV2'
  disableNotification?: boolean
}

export interface SendTelegramMessageResult {
  ok: boolean
  messageId?: number
  error?: string
}

export async function sendTelegramMessage(
  params: SendTelegramMessageParams,
): Promise<SendTelegramMessageResult> {
  const body: Record<string, unknown> = {
    chat_id: params.chatId,
    text: params.text,
  }
  if (params.parseMode) body.parse_mode = params.parseMode
  if (params.disableNotification) body.disable_notification = true

  const res = await callTelegram<{ message_id: number }>(params.botToken, 'sendMessage', body)
  if (!res.ok || !res.result) {
    return { ok: false, error: res.description ?? 'sendMessage failed' }
  }
  return { ok: true, messageId: res.result.message_id }
}

// ---------------------------------------------------------------------------
// getMe | validates the token and returns bot identity
// ---------------------------------------------------------------------------

export async function getMe(
  botToken: string,
): Promise<{ username: string; name: string } | null> {
  const res = await callTelegram<{ id: number; username?: string; first_name?: string }>(
    botToken,
    'getMe',
  )
  if (!res.ok || !res.result) return null
  return {
    username: res.result.username ?? '',
    name: res.result.first_name ?? '',
  }
}

// ---------------------------------------------------------------------------
// setWebhook / deleteWebhook
// ---------------------------------------------------------------------------

export async function setWebhook(botToken: string, url: string): Promise<boolean> {
  const res = await callTelegram<boolean>(botToken, 'setWebhook', {
    url,
    allowed_updates: ['message', 'edited_message'],
  })
  return res.ok === true
}

export async function deleteWebhook(botToken: string): Promise<boolean> {
  const res = await callTelegram<boolean>(botToken, 'deleteWebhook', {
    drop_pending_updates: false,
  })
  return res.ok === true
}

// ---------------------------------------------------------------------------
// getFile | resolves a file_id into a downloadable URL
// ---------------------------------------------------------------------------

export async function getFile(botToken: string, fileId: string): Promise<TelegramFile | null> {
  const res = await callTelegram<TelegramFile>(botToken, 'getFile', { file_id: fileId })
  if (!res.ok || !res.result) return null
  return res.result
}

/**
 * Builds the authenticated CDN URL for a Telegram file. The token is in the
 * URL | never log this string.
 */
export function getFileDownloadUrl(botToken: string, filePath: string): string {
  return `${TELEGRAM_FILE_BASE}${botToken}/${filePath}`
}
