/**
 * Adapter: Meta Cloud webhook payload → `NormalizedWhatsAppMessage`.
 *
 * Lets us reuse the existing `processWhatsAppMessage()` pipeline (contact
 * upsert, conversation create, agent dispatch) for inbound Cloud events.
 *
 * Coexistence: when a message is an "echo" (sent by the team via the mobile
 * Business App), we still surface it via the same pipeline but flag
 * `isFromMe=true` so the conversation thread reflects outbound from us.
 */

import type {
  NormalizedWhatsAppMessage,
  WhatsAppMessageType,
  ResolvedProvider,
} from '@/lib/whatsapp/types'
import type { MetaInboundMessage } from '../types'

/**
 * Normalize a list of Meta inbound messages (already extracted from
 * `entry[].changes[].value.messages`) into our internal format.
 */
export function normalizeMetaMessages(
  messages: MetaInboundMessage[],
  meta: {
    orgId: string
    providerId: string
    phoneNumberId: string
    waba_id?: string
  },
  options?: { isEcho?: boolean },
): NormalizedWhatsAppMessage[] {
  return messages.map((msg) => normalizeOne(msg, meta, options?.isEcho ?? false))
}

function normalizeOne(
  msg: MetaInboundMessage,
  meta: { orgId: string; providerId: string; phoneNumberId: string },
  isEcho: boolean,
): NormalizedWhatsAppMessage {
  const messageType = mapMessageType(msg.type)
  const text = extractText(msg)
  const fromPhone = msg.from.startsWith('+') ? msg.from : `+${msg.from}`

  return {
    provider: 'meta_cloud',
    providerId: meta.providerId,
    orgId: meta.orgId,
    messageId: msg.id,
    // Meta doesn't use JIDs — we keep a synthetic one based on phone for
    // compatibility with code that joins on `fromJid` (e.g. dedup).
    fromJid: `${msg.from}@meta_cloud`,
    fromPhone,
    fromName: null,
    isGroup: false,
    isFromMe: isEcho,
    timestamp: Number(msg.timestamp) * 1000,
    text,
    messageType,
    rawMessage: msg,
  }
}

function mapMessageType(type: MetaInboundMessage['type']): WhatsAppMessageType {
  switch (type) {
    case 'image':
      return 'image'
    case 'audio':
      return 'audio'
    case 'video':
      return 'video'
    case 'document':
      return 'document'
    case 'sticker':
      return 'sticker'
    case 'location':
      return 'location'
    default:
      return 'text'
  }
}

function extractText(msg: MetaInboundMessage): string {
  if (msg.text?.body) return msg.text.body
  if (msg.image?.caption) return msg.image.caption
  if (msg.video?.caption) return msg.video.caption
  if (msg.document?.caption) return msg.document.caption
  return ''
}

/**
 * Synthesize a `ResolvedProvider` row that the existing pipeline expects.
 * Cloud has no `webhookSecret` per-provider (it uses app_secret on the
 * Cloud account) and no `config` map — we leave both empty.
 */
export function metaCloudResolvedProvider(input: {
  orgId: string
  providerId: string
  phoneNumberId: string
  phoneNumberE164: string | null
  displayName: string
}): ResolvedProvider {
  return {
    id: input.providerId,
    orgId: input.orgId,
    provider: 'meta_cloud',
    displayName: input.displayName,
    phoneNumber: input.phoneNumberE164,
    status: 'connected',
    config: { phone_number_id: input.phoneNumberId },
    webhookSecret: null,
  }
}
