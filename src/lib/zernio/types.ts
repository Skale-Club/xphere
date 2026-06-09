// Current Zernio inbox webhook contract.
// Source: https://zernio.com/openapi.yaml (WebhookPayloadMessage / WebhookPayloadComment)

export type ZernioWebhookEventName =
  | 'message.received'
  | 'message.sent'
  | 'message.delivered'
  | 'message.read'
  | 'message.failed'
  | 'comment.received'
  // Zernio's OpenAPI lists `status_updated`; older payloads used `status_changed`.
  // Accept both so we handle whatever production actually emits.
  | 'whatsapp.template.status_updated'
  | 'whatsapp.template.status_changed'

// Outbound delivery lifecycle, in ascending precedence. `failed` is terminal.
export type ZernioDeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed'

export interface ZernioWebhookAccount {
  id: string
  platform: string
  username?: string
  displayName?: string
}

export interface ZernioWebhookMessage {
  id: string
  conversationId: string
  platform: 'instagram' | 'facebook' | 'telegram' | 'whatsapp' | string
  platformMessageId: string
  direction: 'incoming' | 'outgoing'
  text: string | null
  attachments: Array<{
    type: string
    url: string
    payload?: Record<string, unknown>
  }>
  sender: {
    id: string
    contactId?: string
    name?: string
    username?: string
    picture?: string
    phoneNumber?: string | null
    businessScopedUserId?: string
    parentBusinessScopedUserId?: string
    whatsappUsername?: string
    instagramProfile?: Record<string, unknown>
  }
  sentAt: string
  isRead: boolean
  metadata?: Record<string, unknown>
}

export interface ZernioWebhookConversation {
  id: string
  platformConversationId: string
  participantId?: string
  participantName?: string
  participantUsername?: string
  participantPicture?: string
  status: 'active' | 'archived' | string
  contactId?: string
}

export interface ZernioMessageReceivedPayload {
  id: string
  event: 'message.received'
  message: ZernioWebhookMessage
  conversation: ZernioWebhookConversation
  account: ZernioWebhookAccount
  timestamp: string
}

// Outbound message echo. Same WebhookPayloadMessage schema as message.received,
// but emitted when a message is sent (incl. replies sent from the WhatsApp app
// that Zernio captures via the Cloud API). direction is always 'outgoing'.
export interface ZernioMessageSentPayload {
  id: string
  event: 'message.sent'
  message: ZernioWebhookMessage
  conversation: ZernioWebhookConversation
  account: ZernioWebhookAccount
  timestamp: string
}

// Delivery lifecycle events for an outbound message (delivered/read/failed).
// They reference the prior message.sent by its id / platformMessageId so we can
// update the stored row's delivery_status.
export interface ZernioMessageStatusPayload {
  id: string
  event: 'message.delivered' | 'message.read' | 'message.failed'
  message: Pick<ZernioWebhookMessage, 'id' | 'platformMessageId' | 'conversationId' | 'platform'> &
    Partial<ZernioWebhookMessage>
  conversation?: ZernioWebhookConversation
  account: ZernioWebhookAccount
  timestamp: string
}

export interface ZernioWebhookComment {
  id: string
  postId: string | null
  platformPostId: string
  platform: 'instagram' | 'facebook' | 'twitter' | 'youtube' | 'linkedin' | 'bluesky' | 'reddit' | string
  text: string
  author: {
    id: string
    username?: string
    name?: string
    picture?: string | null
  }
  createdAt: string
  isReply: boolean
  parentCommentId: string | null
  ad?: {
    id?: string
    title?: string
    promotionStatus?: string
  }
}

export interface ZernioCommentReceivedPayload {
  id: string
  event: 'comment.received'
  comment: ZernioWebhookComment
  post: {
    id: string | null
    platformPostId: string
  }
  account: ZernioWebhookAccount
  timestamp: string
}

export interface ZernioTemplateStatusChangedPayload {
  id: string
  event: 'whatsapp.template.status_updated' | 'whatsapp.template.status_changed'
  account: ZernioWebhookAccount
  template: {
    name: string
    status: string      // APPROVED | REJECTED | DISABLED | PENDING
    language: string
    category?: string
    reason?: string | null  // rejection reason when REJECTED
  }
  timestamp: string
}

export type ZernioWebhookPayload =
  | ZernioMessageReceivedPayload
  | ZernioMessageSentPayload
  | ZernioMessageStatusPayload
  | ZernioCommentReceivedPayload
  | ZernioTemplateStatusChangedPayload
  | {
      id?: string
      event?: string
      [key: string]: unknown
    }
