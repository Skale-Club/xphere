// SEED-026 Phase A: org-filtered workflow capability spec.
//
// Single source of truth for everything authorable in the workflow system.
// Consumed by:
//   - the in-app Copilot (system prompt + list_capabilities tool)
//   - external coding agents via /api/workflows/spec
//   - the validator (validate.ts)
//   - the manual workflow builder (palette filtering)
//
// The spec is filtered server-side per org so the AI cannot reference
// disconnected integrations. The list of triggers/nodes is static at the
// platform level; integration availability is dynamic per org.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { listAvailableIntegrations } from '@/lib/workflows/health'

export const SPEC_VERSION = '2026.05.20'

// ─── Trigger types ────────────────────────────────────────────────────────────

export interface TriggerSpec {
  type: string
  description: string
  variables: string[]                         // names exposed in scope
  config_schema?: Record<string, unknown>     // JSONSchema for trigger_config
}

export const TRIGGERS: TriggerSpec[] = [
  {
    type: 'tool_call',
    description:
      'Invoked by name from an AI agent, voice call, or chat handler. Use for actions ' +
      'that must be callable by an LLM (send_sms, lookup_contact, etc.).',
    variables: ['trigger.fired_at', 'input.*'],
    config_schema: {
      type: 'object',
      properties: { tool_name: { type: 'string', minLength: 1 } },
      required: ['tool_name'],
    },
  },
  {
    type: 'manual',
    description: 'Run only when explicitly invoked from the UI or API.',
    variables: ['trigger.fired_at', 'input.*'],
  },
  {
    type: 'webhook_url',
    description: 'Receives POST requests at a per-workflow URL. Body is exposed as input.*',
    variables: ['trigger.fired_at', 'input.*', 'trigger.headers'],
  },
  {
    type: 'schedule',
    description: 'Cron-driven recurring trigger. Use for nightly jobs, sweeps, retries.',
    variables: ['trigger.fired_at'],
    config_schema: {
      type: 'object',
      properties: { cron: { type: 'string' } },
      required: ['cron'],
    },
  },

  // ─── Calendar events (SEED-027 — only available once that seed ships;
  // declared here so the spec is the unified registry).
  {
    type: 'event:meeting.scheduled',
    description: 'A new booking row was inserted (any status).',
    variables: ['meeting.*', 'trigger.fired_at'],
  },
  {
    type: 'event:meeting.confirmed',
    description: 'A booking transitioned to confirmed.',
    variables: ['meeting.*', 'trigger.fired_at'],
  },
  {
    type: 'event:meeting.cancelled',
    description: 'A booking was cancelled.',
    variables: ['meeting.*', 'trigger.fired_at'],
  },
  {
    type: 'event:meeting.rescheduled',
    description: 'A booking start_at changed. Payload includes rescheduled_from and rescheduled_to.',
    variables: ['meeting.*', 'meeting.rescheduled_from', 'meeting.rescheduled_to', 'trigger.fired_at'],
  },
  {
    type: 'event:meeting.no_show',
    description: 'A booking was marked no_show.',
    variables: ['meeting.*', 'trigger.fired_at'],
  },
  {
    type: 'event:meeting.completed',
    description: 'A booking transitioned to completed.',
    variables: ['meeting.*', 'trigger.fired_at'],
  },
  {
    type: 'event:meeting.starts_in',
    description:
      'Time-based: fires N units before a booking start_at. Configure offset (e.g. "-5m", "-1h", "-24h").',
    variables: ['meeting.*', 'trigger.fired_at', 'trigger.offset_minutes'],
    config_schema: {
      type: 'object',
      properties: { offset: { type: 'string', pattern: '^-?\\d+[smhd]$' } },
      required: ['offset'],
    },
  },
  {
    type: 'event:meeting.ended',
    description: 'Time-based: fires when a booking end_at passes.',
    variables: ['meeting.*', 'trigger.fired_at'],
  },
]

// ─── Node types ───────────────────────────────────────────────────────────────

export interface NodeSpec {
  type: string
  kind: 'action' | 'condition' | 'wait' | 'agent' | 'end'
  description: string
  integration_required?: string[]             // matches integrations.provider
  params_schema?: Record<string, unknown>     // JSONSchema for node.data.config
  examples?: Array<Record<string, unknown>>
}

export const NODES: NodeSpec[] = [
  // ─── Action — messaging
  {
    type: 'send_sms',
    kind: 'action',
    description: 'Send an SMS via a connected SMS integration (Twilio or GoHighLevel).',
    integration_required: ['twilio', 'gohighlevel'],
    params_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient phone (E.164 or {{variable}})' },
        body: { type: 'string', description: 'Message body, supports {{variables}}' },
      },
      required: ['to', 'body'],
    },
    examples: [
      { to: '{{contact.phone}}', body: 'Your appointment is in 5 min: {{meeting.link}}' },
    ],
  },
  {
    type: 'send_whatsapp_message',
    kind: 'action',
    description: 'Send a WhatsApp message via Evolution.',
    integration_required: ['evolution'],
    params_schema: {
      type: 'object',
      properties: {
        to: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['to', 'body'],
    },
  },
  {
    type: 'manychat_send_message',
    kind: 'action',
    description: 'Send a ManyChat message to a subscriber.',
    integration_required: ['manychat'],
    params_schema: {
      type: 'object',
      properties: {
        subscriber_id: { type: 'string' },
        message: { type: 'string' },
      },
      required: ['subscriber_id', 'message'],
    },
  },

  // ─── Action — CRM
  {
    type: 'create_contact',
    kind: 'action',
    description: 'Create a contact in GoHighLevel.',
    integration_required: ['gohighlevel'],
    params_schema: {
      type: 'object',
      properties: {
        firstName: { type: 'string' },
        lastName: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
      },
    },
  },
  {
    type: 'google_contacts_create',
    kind: 'action',
    description: 'Create a contact in the connected Google account.',
    integration_required: ['google_contacts'],
  },

  // ─── Action — knowledge
  {
    type: 'knowledge_base',
    kind: 'action',
    description: 'Query the org knowledge base; returns a string answer suitable for chat replies.',
    params_schema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },

  // ─── Action — webhook escape hatch
  {
    type: 'custom_webhook',
    kind: 'action',
    description: 'Send a configurable HTTP request to an external URL.',
    integration_required: ['custom_webhook'],
    params_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', format: 'uri' },
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] },
        headers: { type: 'object' },
        body: {},
      },
    },
  },

  // ─── Control flow
  {
    type: 'condition',
    kind: 'condition',
    description: 'Branch on a boolean expression. Use to gate downstream nodes.',
    params_schema: {
      type: 'object',
      properties: { expression: { type: 'string' } },
      required: ['expression'],
    },
  },
  {
    type: 'wait',
    kind: 'wait',
    description:
      'Pause execution for a duration ("5m", "1h", "24h") or until a future timestamp variable.',
    params_schema: {
      type: 'object',
      properties: {
        duration: { type: 'string' },
        until: { type: 'string', description: 'ISO datetime or {{variable}}' },
      },
    },
  },
  {
    type: 'end',
    kind: 'end',
    description: 'Terminal node. Marks a branch as completed successfully.',
  },
]

// ─── Variable namespaces ──────────────────────────────────────────────────────

export const VARIABLE_NAMESPACES = {
  trigger: 'Fields populated by the trigger that started this run.',
  input: 'Free-form payload passed to the trigger (tool-call args, webhook body, etc.).',
  contact: 'Contact CRM fields when the trigger has a linked contact.',
  meeting: 'Booking fields when the trigger is a calendar event (SEED-027).',
}

// ─── Spec assembly ────────────────────────────────────────────────────────────

export interface WorkflowSpec {
  version: string
  org_id: string
  available_integrations: string[]
  triggers: TriggerSpec[]
  nodes: NodeSpec[]
  variable_namespaces: typeof VARIABLE_NAMESPACES
}

// Build the org-filtered spec. Nodes are filtered out when their
// `integration_required` lists no available connected integration.
export async function getWorkflowSpec(
  orgId: string,
  supabase: SupabaseClient<Database>,
): Promise<WorkflowSpec> {
  const integrations = await listAvailableIntegrations(orgId, supabase)
  const availableProviders = new Set(integrations.map((i) => i.provider))

  const filteredNodes = NODES.filter((n) => {
    if (!n.integration_required || n.integration_required.length === 0) return true
    return n.integration_required.some((p) => availableProviders.has(p))
  })

  return {
    version: SPEC_VERSION,
    org_id: orgId,
    available_integrations: Array.from(availableProviders).sort(),
    triggers: TRIGGERS,
    nodes: filteredNodes,
    variable_namespaces: VARIABLE_NAMESPACES,
  }
}
