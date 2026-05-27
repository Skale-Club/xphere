// src/types/chat.ts
// Admin chat inbox TypeScript types.
// These interfaces represent the shape returned by /api/chat/conversations/* endpoints.

export interface MediaAttachment {
  url: string
  mime_type: string
  size?: number
  filename?: string
  duration?: number
  width?: number
  height?: number
  thumbnail_url?: string
}

export type ConversationPriority = 'normal' | 'high' | 'urgent'

/** SEED-035: expanded conversation status. */
export type ConversationStatus =
  | 'open'
  | 'pending'
  | 'waiting'
  | 'resolved'
  | 'closed'

/** SEED-035: a label assigned to a conversation. */
export interface ConversationLabel {
  id: string
  name: string
  color: string
}

export interface ConversationSummary {
  id: string
  status: ConversationStatus
  createdAt: string
  updatedAt: string
  lastMessageAt?: string | null
  visitorName?: string | null
  visitorEmail?: string | null
  visitorPhone?: string | null
  lastMessage?: string | null
  channel: string                             // 'widget' | 'messenger' | 'instagram' | 'whatsapp' | 'sms'
  channelMetadata: Record<string, string>     // JSON from channel_metadata column
  botStatus: string                           // 'active' | 'paused'
  channelAccountName?: string | null          // page_name from meta_channels (null for widget)
  /** v2.2 | pin to the top of the inbox list. */
  pinned?: boolean
  /** v2.2 | 'normal' | 'high' | 'urgent'. Drives the colored left-border. */
  priority?: ConversationPriority
  /** v2.2 | Optional contact link. Used by the right-side ContactInfoPanel. */
  contactId?: string | null
  /** Resolved contact name (from contacts table JOIN). Preferred over visitorName in display. */
  contactName?: string | null
  /** v2.2 | User the conversation is assigned to (assigned_user_id). */
  assignedUserId?: string | null
  /** SEED-035 | starred (favorite). Independent of pinned. */
  starred?: boolean
  /** SEED-035 | true when the current user has not read the latest activity. */
  isUnread?: boolean
  /** SEED-035 | labels currently assigned to this conversation. */
  labels?: ConversationLabel[]
  /** SEED-035 | snooze deadline when status='waiting'. */
  waitUntil?: string | null
  /** phone-numbers Phase 4 | UUID of the org's twilio_phone_numbers row that received the inbound. */
  phoneNumberId?: string | null
  /** phone-numbers Phase 4 | inbox_label > friendly_name > e164 for the receiving number. */
  phoneNumberLabel?: string | null
  /** WhatsApp Cloud | timestamp of the last inbound from this contact (used to detect 24h window expiry). */
  lastInboundAt?: string | null
}

export interface ConversationMessage {
  id: string
  conversationId: string
  role: string                 // 'assistant' | 'visitor' | 'system'
  content: string
  createdAt: string
  metadata?: Record<string, unknown> | null
  /** SEED-030: primary content type (text | image | audio | video | document | sticker | location | mixed) */
  message_type?: string
  /**
   * SEED-039: origin channel for this individual message. Distinct from
   * `conversation.channel` because a single thread can intermix messages from
   * different transports (e.g. customer replies on WhatsApp then Instagram).
   * NULL on legacy rows | UI falls back to the conversation's primary channel.
   */
  channel?: string | null
  /** Resend email system: subject line for email-channel messages. */
  email_subject?: string | null
  /** Resend email system: sender address (from header). */
  email_from?: string | null
  /** Resend email system: primary recipient(s). */
  email_to?: string | null
  /** Resend email system: CC recipients. */
  email_cc?: string | null
  /** Resend email system: Resend message-id for delivery status tracking. */
  email_message_id?: string | null
  /** Resend email system: delivery status (delivered | bounced | complained | failed). */
  email_delivery_status?: string | null
}
