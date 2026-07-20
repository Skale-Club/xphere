// src/lib/integrations/registry.ts
// SEED-042 | Integration registry. Single source of truth for which
// integrations are surfaced in /integrations and how their config panels
// are rendered.
//
// Adding a new integration = adding a row here (+ optionally a CustomPanel).
// The page and side-Sheet are generated from this list.

import type { ComponentType } from 'react'

export type IntegrationCategory =
  | 'messaging'
  | 'email'
  | 'voice_sms'
  | 'crm'
  | 'ai'
  | 'calendar'
  | 'reviews'

export type PanelType =
  | 'api_key' // generic field form + Test + Save + Activate
  | 'custom' // bespoke React component (Twilio tabs, WhatsApp selector, etc.)
  | 'oauth' // OAuth handshake | opens the per-provider connect flow

export interface IntegrationField {
  key: string
  label: string
  type: 'text' | 'password' | 'url'
  placeholder?: string
  hint?: string
  required: boolean
  /**
   * MIR-08: optional client-side format check (e.g. Xkedule/Medusa's
   * "Connection Token" must be a Xphere-issued `xph_...` key). Checked only
   * when the field has a non-empty value — required-ness is handled
   * separately.
   */
  pattern?: RegExp
  patternError?: string
}

/**
 * Logo descriptor. Real brand SVGs aren't bundled yet, so each entry carries a
 * letter+color fallback that the `<IntegrationLogo>` component renders when
 * the SVG file is missing. New integrations should ship a `path` once the
 * brand asset is available.
 */
export interface IntegrationLogo {
  path?: string // `/logos/<id>.svg` when the file exists
  letter: string // single character avatar fallback (e.g. "W")
  color: string // tailwind bg-* class, eg "bg-emerald-500"
}

export interface CustomPanelProps {
  /** The integration registry entry. */
  definition: IntegrationDefinition
  /** Existing saved integration row (encrypted_api_key never exposed). */
  existing?: SavedIntegration
  /** Close the parent Sheet. */
  onClose: () => void
}

/**
 * Minimal shape passed to panels | UI-safe (no decrypted secrets).
 * Mirrors `IntegrationForDisplay` from the integrations actions.
 */
export interface SavedIntegration {
  id: string
  provider: string
  name: string
  masked_api_key: string
  location_id: string | null
  config: unknown
  is_active: boolean
}

export interface IntegrationDefinition {
  /** Matches the `integration_provider` enum value. */
  id: string
  name: string
  description: string
  category: IntegrationCategory
  logo: IntegrationLogo
  panelType: PanelType
  /** Whether the user can flip is_active on/off (false = always-on once saved). */
  canActivate: boolean
  /** Whether a Test button is shown that must pass before Save unlocks. */
  testable: boolean
  docsUrl?: string
  /** For panelType='api_key'. */
  fields?: IntegrationField[]
  /** For panelType='custom'. */
  CustomPanel?: ComponentType<CustomPanelProps>
  /** Optional URL the OAuth button navigates to (panelType='oauth'). */
  oauthHref?: string
}

// Custom panel components are loaded lazily where needed; the registry only
// keeps stable references. Real components are wired below the array.
import { WhatsAppPanel } from '@/components/integrations/panels/whatsapp-panel'
import { WhatsAppCloudPanel } from '@/components/integrations/panels/whatsapp-cloud-panel'
import { TwilioPanel } from '@/components/integrations/panels/twilio-panel'
import { OpenRouterPanel } from '@/components/integrations/panels/openrouter-panel'
import { GoogleContactsOAuthPanel } from '@/components/integrations/google-contacts-oauth-panel'
import { GoogleCalendarOAuthPanel } from '@/components/integrations/google-calendar-oauth-panel'

export const INTEGRATION_REGISTRY: IntegrationDefinition[] = [
  // ── Messaging ─────────────────────────────────────────────────────────────
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    description:
      'Meta Cloud API for compliant campaigns, plus Evolution Go / Z-API / W-API for 1:1 inbox.',
    category: 'messaging',
    logo: { path: '/logos/whatsapp.svg', letter: 'W', color: 'bg-emerald-500' },
    panelType: 'custom',
    canActivate: true,
    testable: false,
    CustomPanel: WhatsAppPanel,
  },
  // 'whatsapp_cloud' is intentionally kept in the registry (workflow specs and
  // active-integration detection still reference the key) but is hidden from
  // the integrations grid by `HIDDEN_INTEGRATION_IDS` below — the unified
  // WhatsApp card now exposes Meta Cloud as one of its provider tabs.
  {
    id: 'whatsapp_cloud',
    name: 'WhatsApp Official (Campaigns)',
    description:
      'Meta Cloud API for template-based outbound campaigns. Required for compliant bulk messaging.',
    category: 'messaging',
    logo: { path: '/logos/whatsapp.svg', letter: 'W', color: 'bg-emerald-600' },
    panelType: 'custom',
    canActivate: true,
    testable: false,
    CustomPanel: WhatsAppCloudPanel,
  },
  {
    id: 'meta',
    name: 'Meta Messaging',
    description: 'Messenger and Instagram DM via Facebook OAuth.',
    category: 'messaging',
    logo: { path: '/logos/meta.svg', letter: 'M', color: 'bg-blue-600' },
    panelType: 'oauth',
    canActivate: true,
    testable: false,
    oauthHref: '/integrations/meta',
  },
  {
    id: 'manychat',
    name: 'ManyChat',
    description: 'Receive subscriber events from ManyChat and route them to workflows.',
    category: 'messaging',
    logo: { path: '/logos/manychat.svg', letter: 'M', color: 'bg-sky-500' },
    panelType: 'api_key',
    canActivate: true,
    testable: true,
    docsUrl: 'https://manychat.com/api',
    fields: [
      {
        key: 'api_key',
        label: 'API Key',
        type: 'password',
        required: true,
        placeholder: 'mc-...',
        hint: 'Find it in ManyChat → Settings → API.',
      },
    ],
  },

  {
    id: 'zernio',
    name: 'Zernio',
    description: 'Inbox unificado de DMs e comentários para Instagram, Facebook, LinkedIn, TikTok e mais.',
    category: 'messaging',
    logo: { path: '/logos/zernio.svg', letter: 'Z', color: 'bg-[#EB3514]' },
    panelType: 'api_key',
    canActivate: true,
    testable: true,
    docsUrl: 'https://docs.zernio.com',
    fields: [
      {
        key: 'api_key',
        label: 'API Key',
        type: 'password',
        required: true,
        placeholder: 'ze_...',
        hint: 'Find it in Zernio → Settings → API Keys.',
      },
    ],
  },

  {
    id: 'telegram',
    name: 'Telegram',
    description: 'Bot notifications for workflows, plus an automation bot that replies to DMs.',
    category: 'messaging',
    logo: { letter: 'T', color: 'bg-cyan-500' },
    panelType: 'oauth',
    canActivate: false,
    testable: false,
    oauthHref: '/integrations/telegram',
  },

  {
    id: 'resend',
    name: 'Resend',
    description:
      'Tenant-owned email sending for conversations, campaigns and workflows.',
    category: 'email',
    logo: { path: '/logos/resend.svg', letter: 'R', color: 'bg-zinc-950' },
    panelType: 'api_key',
    canActivate: true,
    testable: true,
    docsUrl: 'https://resend.com/docs',
    fields: [
      {
        key: 'api_key',
        label: 'API Key',
        type: 'password',
        required: true,
        placeholder: 're_...',
        hint: 'Create or copy a tenant API key in Resend.',
      },
      {
        key: 'default_from_name',
        label: 'Default From Name',
        type: 'text',
        required: false,
        placeholder: 'Xphere Support',
      },
      {
        key: 'default_from_email',
        label: 'Default From Email',
        type: 'text',
        required: true,
        placeholder: 'support@example.com',
        hint: 'Domain authentication stays in Resend.',
      },
      {
        key: 'default_reply_to',
        label: 'Reply-To Email',
        type: 'text',
        required: false,
        placeholder: 'team@example.com',
      },
    ],
  },

  // ── Voice & SMS ───────────────────────────────────────────────────────────
  {
    id: 'twilio',
    name: 'Twilio',
    description: 'SMS, browser voice and SIP. Configure numbers per org.',
    category: 'voice_sms',
    logo: { path: '/logos/twilio.svg', letter: 'T', color: 'bg-rose-500' },
    panelType: 'custom',
    canActivate: true,
    testable: true,
    CustomPanel: TwilioPanel,
  },
  {
    id: 'vapi',
    name: 'Vapi',
    description: 'AI voice assistant with transcription and call analytics.',
    category: 'voice_sms',
    logo: { path: '/logos/vapi.svg', letter: 'V', color: 'bg-violet-500' },
    panelType: 'api_key',
    canActivate: true,
    testable: true,
    docsUrl: 'https://docs.vapi.ai/',
    fields: [
      {
        key: 'api_key',
        label: 'API Key',
        type: 'password',
        required: true,
        placeholder: 'vapi_...',
        hint: 'dashboard.vapi.ai → Account → API Keys.',
      },
    ],
  },

  // ── CRM ───────────────────────────────────────────────────────────────────
  {
    id: 'gohighlevel',
    name: 'GoHighLevel',
    description: 'CRM and marketing automation. SMS, contacts, appointments.',
    category: 'crm',
    logo: { path: '/logos/gohighlevel.svg', letter: 'G', color: 'bg-amber-500' },
    panelType: 'api_key',
    canActivate: true,
    testable: true,
    fields: [
      {
        key: 'api_key',
        label: 'API Key',
        type: 'password',
        required: true,
        placeholder: 'eyJ...',
      },
      {
        key: 'location_id',
        label: 'Location ID',
        type: 'text',
        required: true,
        hint: 'Settings → Business Profile → Location ID.',
      },
    ],
  },
  {
    id: 'google_contacts',
    name: 'Google Contacts',
    description: 'Create, update and sync contacts via Google People API.',
    category: 'crm',
    logo: { path: '/logos/google-contacts.svg', letter: 'G', color: 'bg-sky-600' },
    panelType: 'custom',
    CustomPanel: GoogleContactsOAuthPanel,
    canActivate: true,
    testable: false,
  },

  // ── AI ────────────────────────────────────────────────────────────────────
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description:
      'Multi-model gateway (OpenAI format). Access Claude, GPT-4, Gemini and more.',
    category: 'ai',
    logo: { path: '/logos/openrouter.svg', letter: 'O', color: 'bg-indigo-500' },
    panelType: 'custom',
    canActivate: true,
    testable: true,
    CustomPanel: OpenRouterPanel,
  },

  // ── Scheduling ───────────────────────────────────────────────────────────
  {
    id: 'google_calendar',
    name: 'Google Calendar',
    description:
      'Respeita horários ocupados ao gerar slots e cria eventos com Google Meet para bookings.',
    category: 'calendar',
    logo: { path: 'https://www.gstatic.com/images/branding/productlogos/calendar_2026_03/v2/png/calendar_2026_03_96dp.png', letter: 'C', color: 'bg-blue-500' },
    panelType: 'custom',
    CustomPanel: GoogleCalendarOAuthPanel,
    canActivate: true,
    testable: false,
  },
  {
    id: 'calcom',
    name: 'Cal.com',
    description: 'Online scheduling. Sync availability and bookings.',
    category: 'calendar',
    logo: { path: '/logos/calcom.svg', letter: 'C', color: 'bg-slate-700' },
    panelType: 'api_key',
    canActivate: true,
    testable: true,
    docsUrl: 'https://cal.com/docs/api',
    fields: [
      {
        key: 'api_key',
        label: 'API Key',
        type: 'password',
        required: true,
        placeholder: 'cal_live_...',
        hint: 'cal.com/settings/developer/api-keys.',
      },
    ],
  },

  {
    id: 'xkedule',
    name: 'Xkedule',
    description: 'Booking platform integration. Query availability, create bookings and sync contacts from AI agents.',
    category: 'calendar',
    logo: { path: '/logos/xkedule.png', letter: 'X', color: 'bg-blue-600' },
    panelType: 'api_key',
    canActivate: true,
    testable: false,
    fields: [
      {
        key: 'location_id',
        label: 'Tenant Base URL',
        type: 'url',
        required: true,
        placeholder: 'https://yourbusiness.xkedule.com',
        hint: 'The public URL of the Xkedule tenant (no trailing slash).',
      },
      {
        key: 'api_key',
        label: 'Connection Token',
        type: 'password',
        required: true,
        placeholder: 'xph_...',
        hint: 'A Xphere API key (Settings → API Keys). Paste the SAME token into the Xkedule admin (Integrations → Xphere). It authenticates both directions of this org’s connection — no env vars.',
        // MIR-08 (2026-07 audit): the save previously accepted any string —
        // "credencial meio-validada" — so a typo'd/wrong-field paste silently
        // half-worked (inbound OK, outbound dead). Reject it client-side
        // before it's ever saved.
        pattern: /^xph_.{8,}/,
        patternError: 'Must be a Xphere API key starting with "xph_" (Settings → API Keys).',
      },
    ],
  },

  {
    id: 'medusa',
    name: 'Medusa (Stuscle)',
    description: 'Connect your Medusa store so agents can search products and read carts with region-correct prices.',
    category: 'crm',
    logo: { letter: 'M', color: 'bg-neutral-900' },
    panelType: 'api_key',
    canActivate: true,
    testable: false,
    fields: [
      {
        key: 'location_id',
        label: 'Server URL',
        type: 'url',
        required: true,
        placeholder: 'http://localhost:9000',
        hint: 'Your Medusa backend base URL (no trailing slash).',
      },
      {
        key: 'publishable_key',
        label: 'Publishable Key',
        type: 'text',
        required: true,
        placeholder: 'pk_...',
        hint: 'Store publishable API key (sent as x-publishable-api-key).',
      },
      {
        key: 'api_key',
        label: 'Connection Token',
        type: 'password',
        required: true,
        placeholder: 'xph_...',
        hint: 'A Xphere API key with scope commerce:events. Same token is set in Stuscle env.',
      },
    ],
  },

  // ── Reviews ───────────────────────────────────────────────────────────────
  {
    id: 'google_reviews',
    name: 'Google Reviews',
    description: 'Daily scrape of Google Business reviews for an embeddable widget.',
    category: 'reviews',
    logo: { path: '/logos/google-reviews.svg', letter: 'G', color: 'bg-yellow-500' },
    panelType: 'oauth',
    canActivate: false,
    testable: false,
    oauthHref: '/integrations/google-reviews',
  },
]

export const CATEGORY_ORDER: IntegrationCategory[] = [
  'messaging',
  'email',
  'voice_sms',
  'crm',
  'ai',
  'calendar',
  'reviews',
]

export const CATEGORY_LABEL: Record<IntegrationCategory, string> = {
  messaging: 'Messaging',
  email: 'Email',
  voice_sms: 'Voice & SMS',
  crm: 'CRM',
  ai: 'AI',
  calendar: 'Calendar',
  reviews: 'Reviews',
}

export function getDefinitionByProvider(
  provider: string,
): IntegrationDefinition | undefined {
  return INTEGRATION_REGISTRY.find((d) => d.id === provider)
}

export function getDefinitionsByCategory(): Record<
  IntegrationCategory,
  IntegrationDefinition[]
> {
  const out: Record<IntegrationCategory, IntegrationDefinition[]> = {
    messaging: [],
    email: [],
    voice_sms: [],
    crm: [],
    ai: [],
    calendar: [],
    reviews: [],
  }
  for (const def of INTEGRATION_REGISTRY) {
    out[def.category].push(def)
  }
  return out
}
