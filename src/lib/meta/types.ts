// src/lib/meta/types.ts
// Shared Meta (Messenger + Instagram DM) webhook payload types.
// SEED-032: attachments[] and richer message shapes were previously ignored |
// the canonical interfaces live here so process-event.ts and downstream
// helpers (media.ts, send.ts) stay in sync.

export type MetaAttachmentType =
  | 'image'
  | 'audio'
  | 'video'
  | 'file'
  | 'sticker'
  | 'location'
  | 'template'
  | 'fallback'

export interface MetaAttachment {
  type: MetaAttachmentType
  payload?: {
    url?: string
    is_reusable?: boolean
    sticker_id?: number
    /** File attachments | Meta may include a filename hint. */
    name?: string
    /** Location attachments. */
    coordinates?: { lat: number; long: number }
  }
}

export interface MetaMessageReaction {
  action: 'react' | 'unreact'
  emoji?: string
}

export interface MetaStoryReply {
  story?: { id: string; url: string }
  mid?: string
}

export interface MetaMessage {
  mid?: string
  text?: string
  is_echo?: boolean
  attachments?: MetaAttachment[]
  reaction?: MetaMessageReaction
  reply_to?: MetaStoryReply
}

export interface MetaPostback {
  title: string
  payload: string
  mid: string
}

export interface MetaMessagingEntry {
  sender: { id: string }
  recipient?: { id: string }
  timestamp?: number
  message?: MetaMessage
  postback?: MetaPostback
}

export interface MetaWebhookPayload {
  /** 'page' (Messenger) | 'instagram' | … */
  object: string
  entry: Array<{
    id: string
    time?: number
    messaging: MetaMessagingEntry[]
  }>
}

/** Outbound media payload accepted by sendMetaMessage / sendMetaChannelMessage. */
export interface MetaOutboundMedia {
  url: string
  type: 'image' | 'audio' | 'video' | 'file'
}

/** Default MIME type to assume when Meta doesn't return a Content-Type header. */
export function inferMimeFromAttachmentType(type: MetaAttachmentType): string {
  switch (type) {
    case 'image':
    case 'sticker':
      return 'image/jpeg'
    case 'audio':
      return 'audio/mpeg'
    case 'video':
      return 'video/mp4'
    case 'file':
      return 'application/octet-stream'
    default:
      return 'application/octet-stream'
  }
}
