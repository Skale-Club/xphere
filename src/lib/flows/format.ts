// SEED-043 Phase 1 | Display formatting helpers for flow canvas nodes.
// Converts machine-readable identifiers (snake_case action/event types) into
// human-readable Title Case strings, with special casing for common acronyms.

/**
 * Tokens that should always render fully uppercased instead of Title-Cased.
 * Add to this list when introducing new domain acronyms used in action_type /
 * event_type identifiers.
 */
const UPPERCASE_TOKENS = new Set<string>([
  'sms',
  'ai',
  'crm',
  'api',
  'url',
  'http',
  'https',
  'id',
  'sip',
  'dm',
  'faq',
  'pdf',
  'pdfs',
  'ui',
  'ux',
  'json',
  'xml',
  'csv',
])

/**
 * Tokens that have specific brand capitalisation. Matched case-insensitively
 * on the lowercased token and replaced with the canonical brand form.
 */
const BRAND_TOKENS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  twilio: 'Twilio',
  manychat: 'ManyChat',
  gohighlevel: 'GoHighLevel',
  ghl: 'GHL',
  calcom: 'Cal.com',
  vapi: 'Vapi',
  meta: 'Meta',
  google: 'Google',
  openrouter: 'OpenRouter',
  openai: 'OpenAI',
}

function formatToken(raw: string): string {
  if (!raw) return raw
  const lower = raw.toLowerCase()
  if (UPPERCASE_TOKENS.has(lower)) return lower.toUpperCase()
  if (BRAND_TOKENS[lower]) return BRAND_TOKENS[lower]
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

/**
 * Turn an internal identifier (snake_case, dot.notation, or kebab-case) into a
 * presentable title. Examples:
 *   "send_sms"                     → "Send SMS"
 *   "create_contact"               → "Create Contact"
 *   "manychat_send_message"        → "ManyChat Send Message"
 *   "send_telegram_notification"   → "Send Telegram Notification"
 *   "send_whatsapp_mention_all"    → "Send WhatsApp Mention All"
 *   "vapi.call.ended"              → "Vapi Call Ended"
 */
export function formatActionTitle(key: string | undefined | null): string {
  if (!key) return ''
  return key
    .split(/[_.\-\s]+/)
    .filter(Boolean)
    .map(formatToken)
    .join(' ')
}

/**
 * Pick the first config field that holds a human-readable preview and slice it
 * to `maxLength` (default 40). Returns undefined when no preview-worthy field
 * exists. Used by the canvas to show a contextual subtitle for action nodes.
 */
export function formatConfigSubtitle(
  config: Record<string, unknown> | undefined | null,
  maxLength = 40,
): string | undefined {
  if (!config || typeof config !== 'object') return undefined

  const previewKeys = ['template', 'message', 'body', 'text', 'prompt'] as const
  for (const key of previewKeys) {
    const raw = (config as Record<string, unknown>)[key]
    if (typeof raw !== 'string') continue
    const trimmed = raw.trim()
    if (!trimmed) continue
    return trimmed.length > maxLength
      ? `${trimmed.slice(0, maxLength).trimEnd()}…`
      : trimmed
  }
  return undefined
}
