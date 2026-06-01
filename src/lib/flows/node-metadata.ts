// Friendly labels + colored icons for trigger event types and action types.
// Used by the node-config-panel selects and by the canvas node cards.

import type { ComponentType } from 'react'
import {
  HandWaving,
  CalendarDots,
  WebhooksLogo,
  PhoneCall,
  ChatCircle,
  Camera,
  ChatTeardropDots,
  CalendarCheck,
  UserPlus,
  Globe,
  EnvelopeSimple,
  ClipboardText,
  Note,
  TrendUp,
  BookOpen,
  FlowArrow,
  AddressBook,
  MagnifyingGlass,
  PencilSimple,
  Trash,
} from '@phosphor-icons/react'

export type IntegrationKey =
  | 'whatsapp'
  | 'whatsapp_cloud'
  | 'vapi'
  | 'meta'
  | 'manychat'
  | 'ghl'
  | 'twilio'
  | 'resend'
  | 'evolution'
  | 'google_contacts'

type IconComponent = ComponentType<{ className?: string }>

export interface TriggerMetadata {
  key: string
  label: string
  description: string
  icon: IconComponent
  iconClass: string
  /** Path to brand logo in /public/logos/ — rendered with a white inner layer.
   *  Falls back to `icon` if the image fails to load. */
  logo?: string
  /** Integration name shown as a secondary label in the picker. */
  subtitle?: string
  /** Group heading in the picker dropdown. */
  group: string
  requiresIntegration?: IntegrationKey
}

export interface ActionMetadata {
  key: string
  label: string
  description: string
  icon: IconComponent
  iconClass: string
  /** Path to brand logo in /public/logos/ — rendered with a white inner layer.
   *  Falls back to `icon` if the image fails to load. */
  logo?: string
  /** Integration / platform name shown as a secondary label in the picker. */
  subtitle?: string
  /** Group heading in the picker dropdown. */
  group: string
  requiresIntegration?: IntegrationKey
}

export const TRIGGER_METADATA: TriggerMetadata[] = [
  {
    key: 'manual',
    label: 'Manual trigger',
    description: 'Run manually from the dashboard',
    icon: HandWaving,
    iconClass: 'bg-slate-500/15 text-slate-300',
    group: 'General',
  },
  {
    key: 'cron',
    label: 'Scheduled',
    description: 'Run on a schedule (cron)',
    icon: CalendarDots,
    iconClass: 'bg-amber-500/15 text-amber-300',
    group: 'General',
  },
  {
    key: 'webhook.custom',
    label: 'Webhook',
    description: 'Triggered by an inbound HTTP request',
    icon: WebhooksLogo,
    iconClass: 'bg-violet-500/15 text-violet-300',
    group: 'General',
  },
  {
    key: 'chat.message.received',
    label: 'Chat widget message',
    description: 'New chat widget message',
    icon: ChatCircle,
    iconClass: 'bg-emerald-500/15 text-emerald-300',
    subtitle: 'Chat widget',
    group: 'General',
  },
  {
    key: 'booking.created',
    label: 'Booking created',
    description: 'A new scheduling booking was made',
    icon: CalendarCheck,
    iconClass: 'bg-cyan-500/15 text-cyan-300',
    group: 'General',
  },
  {
    key: 'contact.created',
    label: 'Contact created',
    description: 'A new contact was added to Xphere',
    icon: UserPlus,
    iconClass: 'bg-rose-500/15 text-rose-300',
    group: 'General',
  },
  {
    key: 'vapi.call.ended',
    label: 'Call ended',
    description: 'After a Vapi AI call ends',
    icon: PhoneCall,
    iconClass: 'bg-indigo-500/15 text-indigo-300',
    logo: '/logos/vapi.svg',
    subtitle: 'Vapi',
    group: 'Vapi',
    requiresIntegration: 'vapi',
  },
  {
    key: 'manychat.inbound',
    label: 'Inbound message',
    description: 'New ManyChat conversation event',
    icon: ChatTeardropDots,
    iconClass: 'bg-blue-500/15 text-blue-300',
    logo: '/logos/manychat.svg',
    subtitle: 'ManyChat',
    group: 'ManyChat',
    requiresIntegration: 'manychat',
  },
  {
    key: 'meta.message.received',
    label: 'Instagram / Messenger',
    description: 'New Meta channel message',
    icon: Camera,
    iconClass: 'bg-pink-500/15 text-pink-300',
    logo: '/logos/meta.svg',
    subtitle: 'Meta',
    group: 'Meta',
    requiresIntegration: 'meta',
  },
]

export const ACTION_METADATA: ActionMetadata[] = [
  // ── Xphere ──
  {
    key: 'create_contact',
    label: 'Create contact',
    description: 'Create a new contact in GoHighLevel',
    icon: UserPlus,
    iconClass: 'bg-rose-500/15 text-rose-300',
    logo: '/logos/gohighlevel.svg',
    subtitle: 'GoHighLevel',
    group: 'Xphere',
  },
  {
    key: 'create_task',
    label: 'Create task',
    description: 'Create a task in Xphere',
    icon: ClipboardText,
    iconClass: 'bg-amber-500/15 text-amber-300',
    subtitle: 'Xphere',
    group: 'Xphere',
  },
  {
    key: 'create_note',
    label: 'Create note',
    description: 'Create a note in Xphere',
    icon: Note,
    iconClass: 'bg-yellow-500/15 text-yellow-300',
    subtitle: 'Xphere',
    group: 'Xphere',
  },
  {
    key: 'update_pipeline_stage',
    label: 'Move pipeline stage',
    description: 'Move an opportunity to a new pipeline stage',
    icon: TrendUp,
    iconClass: 'bg-indigo-500/15 text-indigo-300',
    subtitle: 'Xphere',
    group: 'Xphere',
  },

  // ── Google Contacts ──
  {
    key: 'google_contacts_create',
    label: 'Create contact',
    description: 'Create a contact in the connected Google account',
    icon: AddressBook,
    iconClass: 'bg-blue-500/15 text-blue-300',
    logo: '/logos/google-contacts.svg',
    subtitle: 'Google Contacts',
    group: 'Google Contacts',
    requiresIntegration: 'google_contacts',
  },
  {
    key: 'google_contacts_update',
    label: 'Update contact',
    description: 'Update an existing Google contact located by email',
    icon: PencilSimple,
    iconClass: 'bg-blue-500/15 text-blue-300',
    logo: '/logos/google-contacts.svg',
    subtitle: 'Google Contacts',
    group: 'Google Contacts',
    requiresIntegration: 'google_contacts',
  },
  {
    key: 'google_contacts_find',
    label: 'Find contact',
    description: 'Search a Google contact by email or phone',
    icon: MagnifyingGlass,
    iconClass: 'bg-blue-500/15 text-blue-300',
    logo: '/logos/google-contacts.svg',
    subtitle: 'Google Contacts',
    group: 'Google Contacts',
    requiresIntegration: 'google_contacts',
  },
  {
    key: 'google_contacts_delete',
    label: 'Delete contact',
    description: 'Delete a Google contact located by email',
    icon: Trash,
    iconClass: 'bg-red-500/15 text-red-300',
    logo: '/logos/google-contacts.svg',
    subtitle: 'Google Contacts',
    group: 'Google Contacts',
    requiresIntegration: 'google_contacts',
  },

  // ── Communication ──
  {
    key: 'send_whatsapp',
    label: 'Send message',
    description: 'Send a WhatsApp message via Evolution / Z-API / W-API',
    icon: ChatCircle,
    iconClass: 'bg-emerald-500/15 text-emerald-300',
    logo: '/logos/whatsapp.svg',
    subtitle: 'WhatsApp',
    group: 'WhatsApp',
    requiresIntegration: 'whatsapp',
  },
  {
    key: 'send_whatsapp_template',
    label: 'Send template',
    description: 'Send a Meta-approved template via the official Cloud API',
    icon: ChatCircle,
    iconClass: 'bg-emerald-600/15 text-emerald-300',
    logo: '/logos/whatsapp.svg',
    subtitle: 'WhatsApp (Official)',
    group: 'WhatsApp',
    requiresIntegration: 'whatsapp_cloud',
  },
  {
    key: 'send_email',
    label: 'Send email',
    description: 'Send a transactional email via Resend',
    icon: EnvelopeSimple,
    iconClass: 'bg-blue-500/15 text-blue-300',
    logo: '/logos/resend.svg',
    subtitle: 'Resend',
    group: 'Email',
    requiresIntegration: 'resend',
  },

  // ── Automation ──
  {
    key: 'query_knowledge',
    label: 'Query knowledge base',
    description: 'Semantic search across uploaded documents',
    icon: BookOpen,
    iconClass: 'bg-violet-500/15 text-violet-300',
    subtitle: 'Knowledge',
    group: 'Automation',
  },
  {
    key: 'execute_flow',
    label: 'Execute another flow',
    description: 'Trigger a sub-flow by name',
    icon: FlowArrow,
    iconClass: 'bg-purple-500/15 text-purple-300',
    subtitle: 'Flow',
    group: 'Automation',
  },
  {
    key: 'http_request',
    label: 'HTTP request',
    description: 'Call any external HTTP endpoint',
    icon: Globe,
    iconClass: 'bg-slate-500/15 text-slate-300',
    subtitle: 'Webhook',
    group: 'Automation',
  },
]

export function getTriggerMetadata(key: string): TriggerMetadata | undefined {
  return TRIGGER_METADATA.find((m) => m.key === key)
}

export function getActionMetadata(key: string): ActionMetadata | undefined {
  return ACTION_METADATA.find((m) => m.key === key)
}

export function filterTriggers(active: Set<IntegrationKey>): TriggerMetadata[] {
  return TRIGGER_METADATA.filter((m) => !m.requiresIntegration || active.has(m.requiresIntegration))
}

export function filterActions(active: Set<IntegrationKey>): ActionMetadata[] {
  return ACTION_METADATA.filter((m) => !m.requiresIntegration || active.has(m.requiresIntegration))
}

export interface MetadataGroup<T> {
  label: string
  items: T[]
}

/** Returns filtered triggers grouped by `group`, preserving declaration order. */
export function groupedTriggers(active: Set<IntegrationKey>): MetadataGroup<TriggerMetadata>[] {
  return _group(filterTriggers(active))
}

/** Returns filtered actions grouped by `group`, preserving declaration order. */
export function groupedActions(active: Set<IntegrationKey>): MetadataGroup<ActionMetadata>[] {
  return _group(filterActions(active))
}

function _group<T extends { group: string }>(items: T[]): MetadataGroup<T>[] {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const g = item.group
    if (!map.has(g)) map.set(g, [])
    map.get(g)!.push(item)
  }
  return Array.from(map.entries()).map(([label, items]) => ({ label, items }))
}
