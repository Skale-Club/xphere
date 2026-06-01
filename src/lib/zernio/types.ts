// Current Zernio inbox webhook contract.
// Source: https://zernio.com/openapi.yaml (WebhookPayloadMessage / WebhookPayloadComment)

export type ZernioWebhookEventName = 'message.received' | 'comment.received'

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

export type ZernioWebhookPayload =
  | ZernioMessageReceivedPayload
  | ZernioCommentReceivedPayload
  | {
      id?: string
      event?: string
      [key: string]: unknown
    }
