// SEED-043 Phase 1 | Maps a workflow action_type (or trigger event_type) to
// the integration id used in `INTEGRATION_REGISTRY`. The integration entry
// supplies the brand logo path and colour the canvas renders on each node.
//
// Keep this list narrowly scoped: pipeline/internal actions (knowledge_base,
// pipeline_*, custom_webhook, http_request, etc.) intentionally fall through
// so the BaseNode renders the generic lucide icon + node-type colour.

import {
  getDefinitionByProvider,
  type IntegrationDefinition,
} from '@/lib/integrations/registry'

/**
 * Resolves an action_type string (`send_sms`, `create_contact`, ...) to an
 * integration id in the registry. Returns `undefined` when the action is
 * platform-generic (HTTP request, knowledge base, pipeline ops, etc.).
 */
export const ACTION_TO_INTEGRATION: Record<string, string> = {
  // Twilio
  send_sms: 'twilio',

  // WhatsApp (Evolution / Z-API / W-API – unified under the WhatsApp brand)
  send_whatsapp: 'whatsapp',
  send_whatsapp_message: 'whatsapp',
  send_whatsapp_mention_all: 'whatsapp',

  // GoHighLevel CRM
  create_contact: 'gohighlevel',
  // create_task and create_note are platform-native (tasks table) — no brand mapping
  update_pipeline_stage: 'gohighlevel',

  // Cal.com scheduling
  create_appointment: 'calcom',
  get_availability: 'calcom',

  // ManyChat
  manychat_set_field: 'manychat',
  manychat_add_tag: 'manychat',
  manychat_trigger_flow: 'manychat',
  manychat_send_message: 'manychat',

  // Google Contacts
  google_contacts_create: 'google_contacts',
  google_contacts_update: 'google_contacts',
  google_contacts_find: 'google_contacts',
  google_contacts_delete: 'google_contacts',

  // Telegram (no entry in the integration registry yet — handled via fallback)
  send_telegram_notification: 'telegram',
}

/**
 * Maps trigger event_type strings to integration ids. Triggers that are not
 * tied to a specific brand (manual, cron, generic webhook, contact.created,
 * booking.created) fall through to the generic amber Zap icon.
 */
export const TRIGGER_TO_INTEGRATION: Record<string, string> = {
  'vapi.call.ended': 'vapi',
  'vapi.call.started': 'vapi',
  'manychat.inbound': 'manychat',
  'meta.message.received': 'meta',
  'meta.comment.received': 'meta',
  'whatsapp.message.received': 'whatsapp',
  'whatsapp.inbound': 'whatsapp',
}

/**
 * Tailwind bg-* class → hex map. The integration registry stores brand colours
 * as Tailwind utility classes (`bg-emerald-500`) which are great for the
 * integrations page but unusable as inline `style.backgroundColor` values on
 * BaseNode's coloured tile. This table mirrors the classes currently in use.
 *
 * Missing classes fall back to the BaseNode default colour, so adding entries
 * here is a small, additive change.
 */
const TAILWIND_BG_TO_HEX: Record<string, string> = {
  'bg-emerald-500': '#10b981',
  'bg-emerald-600': '#059669',
  'bg-rose-500': '#f43f5e',
  'bg-rose-600': '#e11d48',
  'bg-blue-500': '#3b82f6',
  'bg-blue-600': '#2563eb',
  'bg-sky-500': '#0ea5e9',
  'bg-sky-600': '#0284c7',
  'bg-violet-500': '#8b5cf6',
  'bg-violet-600': '#7c3aed',
  'bg-amber-500': '#f59e0b',
  'bg-amber-600': '#d97706',
  'bg-yellow-500': '#eab308',
  'bg-indigo-500': '#6366f1',
  'bg-indigo-600': '#4f46e5',
  'bg-slate-500': '#64748b',
  'bg-slate-600': '#475569',
  'bg-slate-700': '#334155',
  'bg-purple-500': '#a855f7',
  'bg-pink-500': '#ec4899',
  'bg-cyan-500': '#06b6d4',
}

export interface NodeIntegrationVisual {
  /** Public URL for the brand SVG (may not exist on disk — caller must handle). */
  logo?: string
  /** Hex colour matching the integration brand. Falls back to a neutral grey. */
  color: string
  /** The registry definition, when one is found. Useful for tooltips/labels. */
  definition?: IntegrationDefinition
}

/**
 * Telegram is not (yet) in the integration registry but `send_telegram_*`
 * actions exist. Provide an inline visual so canvas rendering stays useful.
 */
const TELEGRAM_VISUAL: NodeIntegrationVisual = {
  logo: '/logos/telegram.svg',
  color: '#0088cc',
}

function visualForDefinition(def: IntegrationDefinition): NodeIntegrationVisual {
  const hex = TAILWIND_BG_TO_HEX[def.logo.color]
  return {
    logo: def.logo.path,
    color: hex ?? '#64748b',
    definition: def,
  }
}

/**
 * Returns logo + colour metadata for a given action_type, or undefined when
 * the action is platform-generic (HTTP, pipeline, knowledge base, ...).
 */
export function getActionIntegrationVisual(
  actionType: string | undefined | null,
): NodeIntegrationVisual | undefined {
  if (!actionType) return undefined
  const provider = ACTION_TO_INTEGRATION[actionType]
  if (!provider) return undefined
  if (provider === 'telegram') return TELEGRAM_VISUAL
  const def = getDefinitionByProvider(provider)
  return def ? visualForDefinition(def) : undefined
}

/**
 * Returns logo + colour metadata for a given trigger event_type, or undefined
 * when the trigger is not branded (manual, cron, generic webhook, etc.).
 */
export function getTriggerIntegrationVisual(
  eventType: string | undefined | null,
): NodeIntegrationVisual | undefined {
  if (!eventType) return undefined
  const provider = TRIGGER_TO_INTEGRATION[eventType]
  if (!provider) return undefined
  const def = getDefinitionByProvider(provider)
  return def ? visualForDefinition(def) : undefined
}
