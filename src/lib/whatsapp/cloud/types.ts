/**
 * Shared types for the WhatsApp Cloud API (Meta Official) integration.
 *
 * Naming convention: anything that comes from / goes to Meta uses the same
 * casing the API uses (snake_case for payloads); internal-only types use
 * camelCase.
 */

/** A fully-resolved cloud account ready to talk to the Meta API. */
export interface CloudAccount {
  id: string
  orgId: string
  displayName: string
  wabaId: string
  phoneNumberId: string
  phoneNumberE164: string | null
  /** Plaintext after decrypt — never persist. */
  accessToken: string
  /** Optional plaintext app secret used for HMAC webhook validation. */
  appSecret: string | null
  status: 'connected' | 'disconnected' | 'error'
}

/** Meta template component as returned by GET /{waba-id}/message_templates. */
export interface MetaTemplateComponent {
  type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS'
  format?: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'LOCATION'
  text?: string
  buttons?: Array<{
    type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER'
    text: string
    url?: string
    phone_number?: string
  }>
  example?: Record<string, unknown>
}

/** Meta template row. */
export interface MetaTemplate {
  id: string
  name: string
  language: string
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'
  status: 'APPROVED' | 'PENDING' | 'REJECTED' | 'PAUSED' | 'DISABLED'
  components: MetaTemplateComponent[]
}

/** A parameter value for a {{n}} placeholder when sending a template. */
export interface TemplateParameter {
  type: 'text' | 'currency' | 'date_time' | 'image' | 'video' | 'document'
  text?: string
}

/** Result from POST /{phone-number-id}/messages. */
export interface MetaSendResult {
  messages: Array<{ id: string }>
  contacts?: Array<{ input: string; wa_id: string }>
}

/** Structured Meta error envelope (returned in non-2xx responses). */
export interface MetaApiError {
  message: string
  type?: string
  code: number
  error_subcode?: number
  fbtrace_id?: string
}

/** A single status event from the Meta webhook. */
export interface MetaStatusEvent {
  id: string // wamid
  status: 'sent' | 'delivered' | 'read' | 'failed'
  timestamp: string
  recipient_id: string
  errors?: Array<{ code: number; title: string; message?: string }>
  conversation?: { id: string; origin?: { type: string } }
  pricing?: { category: string; pricing_model: string }
}

/** Full webhook payload envelope (after Meta dispatches). */
export interface MetaWebhookPayload {
  object: 'whatsapp_business_account'
  entry: Array<{
    id: string // WABA id
    changes: Array<{
      field: string
      value: {
        messaging_product?: 'whatsapp'
        metadata?: { display_phone_number?: string; phone_number_id: string }
        messages?: Array<MetaInboundMessage>
        statuses?: Array<MetaStatusEvent>
      }
    }>
  }>
}

/** A single inbound message from a customer (subset, expand as needed). */
export interface MetaInboundMessage {
  id: string
  from: string // E.164 digits, no '+'
  timestamp: string
  type: 'text' | 'image' | 'audio' | 'video' | 'document' | 'button' | 'interactive' | 'reaction' | 'location' | 'contacts' | 'sticker'
  text?: { body: string }
  image?: { id: string; mime_type: string; caption?: string }
  audio?: { id: string; mime_type: string }
  video?: { id: string; mime_type: string; caption?: string }
  document?: { id: string; mime_type: string; filename?: string; caption?: string }
  context?: { from?: string; id?: string }
  /** Present on Coexistence echoes (smb_message_echoes events). */
  echo?: { from_app?: boolean }
}
