// src/lib/whatsapp/types.ts
// Shared types for the multi-provider WhatsApp abstraction (SEED-031).

export type WhatsAppProvider = 'evolution' | 'zapi' | 'wapi' | 'meta_cloud'

export type WhatsAppProviderStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'qr_pending'
  | 'error'

export type WhatsAppMessageType =
  | 'text'
  | 'image'
  | 'audio'
  | 'video'
  | 'document'
  | 'sticker'
  | 'location'

/**
 * Provider-specific configuration shapes (stored JSON-stringified and AES-256-GCM
 * encrypted inside whatsapp_providers.config_encrypted).
 */
export interface EvolutionProviderConfig {
  base_url: string
  token: string
  instance_name: string
}

export interface ZApiProviderConfig {
  instance_id: string
  token: string
  /** Z-API default is https://api.z-api.io | overridable for self-hosted. */
  base_url?: string
}

export interface WApiProviderConfig {
  instance_key: string
  token: string
  base_url: string
}

export type WhatsAppProviderConfig =
  | EvolutionProviderConfig
  | ZApiProviderConfig
  | WApiProviderConfig

/**
 * A row from whatsapp_providers with its decrypted config blob, ready to use
 * by adapters / sender. Never returned to client code | service-role only.
 */
export interface ResolvedProvider {
  id: string
  orgId: string
  provider: WhatsAppProvider
  displayName: string
  phoneNumber: string | null
  status: WhatsAppProviderStatus
  config: Record<string, string>
  webhookSecret: string | null
}

/**
 * Provider-agnostic representation of an inbound WhatsApp message.
 * All adapters normalize their webhook payloads into this shape.
 */
export interface NormalizedWhatsAppMessage {
  provider: WhatsAppProvider
  providerId: string
  orgId: string
  messageId: string
  fromJid: string
  fromPhone: string
  fromName: string | null
  isGroup: boolean
  isFromMe: boolean
  timestamp: number
  text: string
  messageType: WhatsAppMessageType
  /** Raw provider payload | used by adapter.fetchMedia(). */
  rawMessage: unknown
  /** Evolution-only: which instance produced the event. */
  instanceName?: string
}

export interface WhatsAppMediaAttachment {
  url: string
  mime_type: string
  size?: number
  filename?: string
  duration?: number
  width?: number
  height?: number
}

/**
 * Contract every provider adapter implements. The pipeline only ever talks to
 * this interface | never directly to Evolution / Z-API / W-API.
 */
export interface WhatsAppAdapter {
  normalize(payload: unknown, provider: ResolvedProvider): NormalizedWhatsAppMessage[]
  fetchMedia(
    msg: NormalizedWhatsAppMessage,
    provider: ResolvedProvider,
    conversationId: string,
  ): Promise<WhatsAppMediaAttachment[]>
}
