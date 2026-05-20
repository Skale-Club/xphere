// Friendly labels + colored icons for trigger event types and action types.
// Used by the node-config-panel selects and by the canvas node cards.

import type { LucideIcon } from 'lucide-react'
import {
  Hand,
  CalendarClock,
  Webhook,
  PhoneCall,
  MessageCircle,
  Camera,
  MessagesSquare,
  CalendarCheck,
  UserPlus,
  Globe,
  Mail,
  ClipboardList,
  StickyNote,
  TrendingUp,
  BookOpen,
  Workflow,
} from 'lucide-react'

export type IntegrationKey =
  | 'whatsapp'
  | 'vapi'
  | 'meta'
  | 'manychat'
  | 'ghl'
  | 'twilio'
  | 'resend'
  | 'evolution'

export interface TriggerMetadata {
  key: string
  label: string
  description: string
  icon: LucideIcon
  /** Tailwind classes for the icon container (bg + text). */
  iconClass: string
  /** If set, this trigger only appears when the integration is active. */
  requiresIntegration?: IntegrationKey
}

export interface ActionMetadata {
  key: string
  label: string
  description: string
  icon: LucideIcon
  iconClass: string
  requiresIntegration?: IntegrationKey
}

export const TRIGGER_METADATA: TriggerMetadata[] = [
  {
    key: 'manual',
    label: 'Manual',
    description: 'Run manually from the dashboard',
    icon: Hand,
    iconClass: 'bg-slate-500/15 text-slate-300',
  },
  {
    key: 'cron',
    label: 'Scheduled',
    description: 'Run on a schedule (cron)',
    icon: CalendarClock,
    iconClass: 'bg-amber-500/15 text-amber-300',
  },
  {
    key: 'webhook.custom',
    label: 'Webhook',
    description: 'Triggered by an inbound HTTP request',
    icon: Webhook,
    iconClass: 'bg-violet-500/15 text-violet-300',
  },
  {
    key: 'vapi.call.ended',
    label: 'Vapi call ended',
    description: 'After a Vapi AI call ends',
    icon: PhoneCall,
    iconClass: 'bg-indigo-500/15 text-indigo-300',
    requiresIntegration: 'vapi',
  },
  {
    key: 'manychat.inbound',
    label: 'ManyChat inbound',
    description: 'New ManyChat conversation event',
    icon: MessagesSquare,
    iconClass: 'bg-blue-500/15 text-blue-300',
    requiresIntegration: 'manychat',
  },
  {
    key: 'meta.message.received',
    label: 'Instagram / Messenger',
    description: 'New Meta channel message',
    icon: Camera,
    iconClass: 'bg-pink-500/15 text-pink-300',
    requiresIntegration: 'meta',
  },
  {
    key: 'chat.message.received',
    label: 'Chat widget',
    description: 'New chat widget message',
    icon: MessageCircle,
    iconClass: 'bg-emerald-500/15 text-emerald-300',
  },
  {
    key: 'booking.created',
    label: 'Booking created',
    description: 'A new scheduling booking was made',
    icon: CalendarCheck,
    iconClass: 'bg-cyan-500/15 text-cyan-300',
  },
  {
    key: 'contact.created',
    label: 'Contact created',
    description: 'A new contact was added to the CRM',
    icon: UserPlus,
    iconClass: 'bg-rose-500/15 text-rose-300',
  },
]

export const ACTION_METADATA: ActionMetadata[] = [
  {
    key: 'http_request',
    label: 'HTTP request',
    description: 'Call any HTTP endpoint',
    icon: Globe,
    iconClass: 'bg-slate-500/15 text-slate-300',
  },
  {
    key: 'send_whatsapp',
    label: 'Send WhatsApp',
    description: 'Send a WhatsApp message',
    icon: MessageCircle,
    iconClass: 'bg-emerald-500/15 text-emerald-300',
    requiresIntegration: 'whatsapp',
  },
  {
    key: 'send_email',
    label: 'Send email',
    description: 'Send a transactional email',
    icon: Mail,
    iconClass: 'bg-blue-500/15 text-blue-300',
    requiresIntegration: 'resend',
  },
  {
    key: 'create_contact',
    label: 'Create contact',
    description: 'Create a new CRM contact',
    icon: UserPlus,
    iconClass: 'bg-rose-500/15 text-rose-300',
  },
  {
    key: 'create_task',
    label: 'Create task',
    description: 'Create a CRM task',
    icon: ClipboardList,
    iconClass: 'bg-amber-500/15 text-amber-300',
  },
  {
    key: 'create_note',
    label: 'Create note',
    description: 'Create a CRM note',
    icon: StickyNote,
    iconClass: 'bg-yellow-500/15 text-yellow-300',
  },
  {
    key: 'update_pipeline_stage',
    label: 'Update pipeline stage',
    description: 'Move an opportunity through the pipeline',
    icon: TrendingUp,
    iconClass: 'bg-indigo-500/15 text-indigo-300',
  },
  {
    key: 'query_knowledge',
    label: 'Query knowledge base',
    description: 'Semantic search across documents',
    icon: BookOpen,
    iconClass: 'bg-violet-500/15 text-violet-300',
  },
  {
    key: 'execute_flow',
    label: 'Execute another flow',
    description: 'Trigger another workflow',
    icon: Workflow,
    iconClass: 'bg-purple-500/15 text-purple-300',
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
