// src/lib/telegram/process-update.ts
// Inbound pipeline for the Telegram automation bot. Mirrors the WhatsApp
// pipeline (upsert conversation → idempotency → media → insert message →
// bot gate → runAgent → reply). SEED-034.

import { after } from 'next/server'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { normalizeInbound } from '@/lib/messaging/normalize-inbound'
import { decrypt } from '@/lib/crypto'
import { runAgent } from '@/lib/agent-runtime/run-agent'
import { loadHistoryWindow } from '@/lib/agent-runtime/load-history'
import { findByPhone, findByChannelIdentity, attachChannelIdentity } from '@/lib/contacts/server'
import { normalisePhone } from '@/lib/contacts/zod-schemas'
import type { ChannelProvider } from '@/types/database'
import { getFile, getFileDownloadUrl, sendTelegramMessage } from './client'
import { sendTelegramReply } from './send-message'
import { storeTelegramMedia } from './storage'
import type {
  TelegramMediaKind,
  TelegramMessage,
  TelegramUpdate,
} from './types'
import type { MediaAttachment } from '@/types/chat'

// Lightweight shape of the telegram_bots row passed in by the webhook handler.
export interface TelegramBotContext {
  id: string
  org_id: string
  bot_token_encrypted: string
  automation_enabled: boolean
  agent_id: string | null
}

interface MediaPayload {
  fileId: string
  mimeType: string
  width?: number
  height?: number
  duration?: number
  filenameHint?: string
  kind: TelegramMediaKind
}

function pickLargestPhoto(
  photos: NonNullable<TelegramMessage['photo']>,
): { file_id: string; width: number; height: number } | null {
  if (photos.length === 0) return null
  return photos.reduce((best, p) => (p.width * p.height > best.width * best.height ? p : best))
}

function detectMediaPayload(msg: TelegramMessage): MediaPayload | null {
  if (msg.photo && msg.photo.length > 0) {
    const largest = pickLargestPhoto(msg.photo)
    if (largest) {
      return {
        fileId: largest.file_id,
        mimeType: 'image/jpeg',
        width: largest.width,
        height: largest.height,
        kind: 'image',
      }
    }
  }
  if (msg.voice) {
    return {
      fileId: msg.voice.file_id,
      mimeType: msg.voice.mime_type ?? 'audio/ogg',
      duration: msg.voice.duration,
      kind: 'audio',
    }
  }
  if (msg.audio) {
    return {
      fileId: msg.audio.file_id,
      mimeType: msg.audio.mime_type ?? 'audio/mpeg',
      duration: msg.audio.duration,
      filenameHint: msg.audio.file_name,
      kind: 'audio',
    }
  }
  if (msg.video) {
    return {
      fileId: msg.video.file_id,
      mimeType: msg.video.mime_type ?? 'video/mp4',
      duration: msg.video.duration,
      width: msg.video.width,
      height: msg.video.height,
      filenameHint: msg.video.file_name,
      kind: 'video',
    }
  }
  if (msg.document) {
    return {
      fileId: msg.document.file_id,
      mimeType: msg.document.mime_type ?? 'application/octet-stream',
      filenameHint: msg.document.file_name,
      kind: 'document',
    }
  }
  if (msg.sticker) {
    return {
      fileId: msg.sticker.file_id,
      mimeType: msg.sticker.mime_type ?? 'image/webp',
      width: msg.sticker.width,
      height: msg.sticker.height,
      kind: 'sticker',
    }
  }
  return null
}

function computeMessageType(
  media: MediaPayload | null,
  hasText: boolean,
): 'text' | 'image' | 'audio' | 'video' | 'document' | 'sticker' | 'mixed' {
  if (!media) return 'text'
  if (hasText) return 'mixed'
  return media.kind
}

/**
 * Top-level entrypoint. Wraps everything in try/catch | must never throw
 * because the webhook handler returns 200 unconditionally.
 */
export async function processTelegramUpdate(
  update: TelegramUpdate,
  bot: TelegramBotContext,
): Promise<void> {
  try {
    const msg = update.message
    if (!msg) return

    // Decrypt the token once | used by /start handler and the agent pipeline
    let botToken: string
    try {
      botToken = await decrypt(bot.bot_token_encrypted)
    } catch (err) {
      console.error('[telegram/process] decrypt token failed:', err)
      return
    }

    // ----- 1. /start handler in groups: respond with the chat_id ---------
    const text = msg.text ?? msg.caption ?? ''
    if (
      (msg.chat.type === 'group' || msg.chat.type === 'supergroup' || msg.chat.type === 'channel') &&
      text.trim().toLowerCase().startsWith('/start')
    ) {
      const chatIdStr = String(msg.chat.id)
      const reply =
        `<b>Bot conectado</b>\nChat ID deste grupo: <code>${chatIdStr}</code>\n` +
        `Copie esse ID e cole nas configurações de notificação do Xphere.`
      after(() =>
        sendTelegramMessage({
          botToken,
          chatId: chatIdStr,
          text: reply,
          parseMode: 'HTML',
        }).catch((err) => {
          console.error('[telegram/process] /start reply failed:', err)
        }),
      )
      return
    }

    // ----- 2. Gate: only private chats trigger the automation bot --------
    if (msg.chat.type !== 'private') return
    if (!bot.automation_enabled || !bot.agent_id) return

    const supabase = createServiceRoleClient()
    const orgId = bot.org_id
    const chatId = String(msg.chat.id)
    const from = msg.from
    const visitorName = from
      ? [from.first_name, from.last_name].filter(Boolean).join(' ').trim() || from.username || null
      : null

    // ----- 3. Upsert conversation (shared normalizer, upsert-only) -------
    // Telegram bumps last_message AFTER media detection below, so updatePayload
    // is empty (no touch on existing) and skipMessage is set (the message write
    // + media are bespoke). Contact resolution runs lazily on the create path.
    const now = new Date().toISOString()

    const norm = await normalizeInbound({
      supabase,
      orgId,
      channel: 'telegram',
      match: { by: 'visitor_phone', phone: chatId },
      updatePayload: {},
      createPayload: async () => {
        // Phase 108 D-03 lookup-first: channel identity → phone → insert.
        // Pitfall 1: externalId is the raw chat_id string; do NOT normalise.
        let contactId: string | null = null
        const channelProvider: ChannelProvider = 'telegram'
        const externalId = chatId

        const channelHit = externalId
          ? await findByChannelIdentity(supabase, orgId, channelProvider, externalId)
          : null
        if (channelHit) {
          contactId = channelHit.contact_id
        } else {
          // Phase 107 back-compat: chat_id was stored in visitor_phone, so the
          // legacy phone fallback still uses it as the lookup key.
          const phoneNorm = normalisePhone(chatId)
          const { data: contact } = phoneNorm
            ? await supabase
                .from('contacts')
                .select('id')
                .eq('org_id', orgId)
                .eq('phone_e164', phoneNorm)
                .neq('identity_status', 'archived_duplicate')
                .limit(1)
                .maybeSingle()
            : { data: null }

          if (contact?.id) {
            contactId = contact.id
            // D-03b: attach channel identity to existing phone-rooted contact.
            if (externalId) {
              await attachChannelIdentity(supabase, orgId, contactId, channelProvider, externalId)
            }
          } else {
            // D-04a (Phase 110-02): Telegram updates carry no email field —
            // pure phone/channel provider (chatId acts as both). No
            // isBlockedEmail wiring needed here. If Telegram ever exposes user
            // email via a future API, gate with isBlockedEmail before write.
            const contactInsert: Record<string, unknown> = {
              org_id: orgId,
              name: visitorName,
              phone: chatId,
              // 'telegram' will be added to the ContactSource union in a future
              // migration; cast keeps this forward-compatible without touching
              // shared types files owned by other parallel agents.
              source: 'telegram',
            }
            const { data: created, error: insErr } = await supabase
              .from('contacts')
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              .insert(contactInsert as any)
              .select('id')
              .single()
            if (insErr?.code === '23505') {
              // D-03: race lost — look up the winner via findByPhone.
              const winner = await findByPhone(supabase, orgId, chatId)
              contactId = winner?.id ?? null
              if (winner) {
                console.log(
                  `[telegram/process] contact.unique_collision source=telegram org_id=${orgId} contact_id=${winner.id} matched_via=phone`,
                )
              }
            } else if (insErr) {
              console.error('[telegram/process] insert contact error:', insErr.message)
              contactId = null
            } else {
              contactId = created?.id ?? null
            }
            if (contactId && externalId) {
              await attachChannelIdentity(supabase, orgId, contactId, channelProvider, externalId)
            }
          }
        }

        return {
          widget_token: '',
          channel_metadata: {
            telegram_chat_id: chatId,
            telegram_user_id: from?.id ?? null,
            telegram_username: from?.username ?? null,
          },
          visitor_phone: chatId,
          visitor_name: visitorName,
          // TODO Phase 110: wrap with resolveLiveContactId
          contact_id: contactId,
          last_message_at: now,
          last_inbound_at: now,
        }
      },
      message: {},
      skipMessage: true,
    })

    if (norm.error) {
      console.error('[telegram/process] create conversation failed:', norm.error)
      return
    }
    const conversationId = norm.conversationId
    const existing = norm.existing

    // ----- 4. Idempotency by telegram_message_id ------------------------
    const { data: dup } = await supabase
      .from('conversation_messages')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('role', 'user')
      .contains('metadata', { telegram_message_id: msg.message_id })
      .limit(1)
      .maybeSingle()
    if (dup) return

    // ----- 5. Media download (best-effort) ------------------------------
    const mediaInfo = detectMediaPayload(msg)
    const mediaAttachments: MediaAttachment[] = []
    if (mediaInfo) {
      try {
        const file = await getFile(botToken, mediaInfo.fileId)
        if (file?.file_path) {
          const downloadUrl = getFileDownloadUrl(botToken, file.file_path)
          const att = await storeTelegramMedia(
            {
              downloadUrl,
              mimeType: mediaInfo.mimeType,
              orgId,
              conversationId,
              messageId: String(msg.message_id),
              idx: 0,
              filenameHint: mediaInfo.filenameHint,
              duration: mediaInfo.duration,
              width: mediaInfo.width,
              height: mediaInfo.height,
            },
            file.file_path,
          )
          if (att) mediaAttachments.push(att)
        }
      } catch (err) {
        console.error('[telegram/process] media download failed:', err)
      }
    }

    const hasText = text.length > 0
    const effectiveType = computeMessageType(mediaInfo, hasText)

    const metadata: Record<string, unknown> = {
      channel: 'telegram',
      telegram_message_id: msg.message_id,
      telegram_chat_id: chatId,
      telegram_user_id: from?.id ?? null,
    }
    if (from?.username) metadata.telegram_username = from.username
    if (mediaAttachments.length > 0) metadata.media = mediaAttachments

    // ----- 6. Insert inbound message -----------------------------------
    const insertMessage: Record<string, unknown> = {
      conversation_id: conversationId,
      org_id: orgId,
      role: 'user',
      content: text,
      message_type: effectiveType,
      metadata,
    }
    const { error: msgErr } = await supabase
      .from('conversation_messages')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .insert(insertMessage as any)
    if (msgErr) {
      console.error('[telegram/process] insert message error:', msgErr.message)
    }

    // Bump conversation freshness regardless of bot gate
    await supabase
      .from('conversations')
      .update({
        last_message: text || `[${mediaInfo?.kind ?? 'message'}]`,
        last_message_at: now,
        last_inbound_at: now,
        updated_at: now,
      })
      .eq('id', conversationId)

    // ----- 7. Bot gate -------------------------------------------------
    const botStatus = existing?.bot_status ?? 'active'
    if (botStatus !== 'active') return

    // ----- 8. runAgent + reply ----------------------------------------
    try {
      const userMessage = text || '[media message]'
      const historyWindow = await loadHistoryWindow({
        supabase,
        conversationId,
        currentUserMessage: userMessage,
      })
      const result = await runAgent({
        orgId,
        agentId: bot.agent_id,
        channel: 'telegram',
        userMessage,
        conversationId,
        historyWindow,
        stream: false,
      })

      if (!result.text) return

      await sendTelegramReply({
        orgId,
        chatId,
        text: result.text,
        conversationId,
      })
    } catch (err) {
      console.error('[telegram/process] runAgent/send error:', err)
    }
  } catch (err) {
    console.error('[telegram/process] outer error:', err)
  }
}
