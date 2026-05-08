// src/lib/action-engine/execute-action.ts
// Dispatcher: routes action_type to the correct executor
// Phase 4: added 'knowledge_base' case with optional ctx parameter
// Phase 30: added custom_webhook executor; ActionContext gains optional toolConfig

import { createContact } from '@/lib/ghl/create-contact'
import { getAvailability } from '@/lib/ghl/get-availability'
import { createAppointment } from '@/lib/ghl/create-appointment'
import { queryKnowledge } from '@/lib/knowledge/query-knowledge'
import { setManychatField } from '@/lib/manychat/set-field'
import { addManychatTag } from '@/lib/manychat/add-tag'
import { triggerManychatFlow } from '@/lib/manychat/trigger-flow'
import { sendManychatMessage } from '@/lib/manychat/send-message'
import { createGoogleContact } from '@/lib/google-contacts/create-contact'
import { updateGoogleContact } from '@/lib/google-contacts/update-contact'
import { findGoogleContact } from '@/lib/google-contacts/find-contact'
import { deleteGoogleContact } from '@/lib/google-contacts/delete-contact'
import { executeWebhook } from '@/lib/custom-webhook/execute-webhook'
import { sendSms } from '@/lib/twilio/send-sms'
import type { GhlCredentials } from '@/lib/ghl/client'
import type { Database, Json } from '@/types/database'
import type { SupabaseClient } from '@supabase/supabase-js'

type ActionType = Database['public']['Enums']['action_type']

export interface ActionContext {
  organizationId: string
  supabase: SupabaseClient<Database>
  /** tool_configs.config JSONB — required for custom_webhook */
  toolConfig?: Json
}

export async function executeAction(
  actionType: ActionType,
  params: Record<string, unknown>,
  credentials: GhlCredentials,
  ctx?: ActionContext
): Promise<string> {
  switch (actionType) {
    case 'create_contact':
      return createContact(params, credentials)
    case 'get_availability':
      return getAvailability(params, credentials)
    case 'create_appointment':
      return createAppointment(params, credentials)
    case 'knowledge_base': {
      if (!ctx?.organizationId || !ctx?.supabase) {
        throw new Error('knowledge_base action requires ctx.organizationId and ctx.supabase')
      }
      const query = String(params.query ?? params.question ?? params.q ?? '')
      return queryKnowledge(query, ctx.organizationId, ctx.supabase)
    }
    case 'google_contacts_create': {
      if (!ctx?.organizationId || !ctx?.supabase) {
        throw new Error('google_contacts_create requires ctx.organizationId and ctx.supabase')
      }
      return createGoogleContact(params, ctx)
    }
    case 'google_contacts_update': {
      if (!ctx?.organizationId || !ctx?.supabase) {
        throw new Error('google_contacts_update requires ctx.organizationId and ctx.supabase')
      }
      return updateGoogleContact(params, ctx)
    }
    case 'google_contacts_find': {
      if (!ctx?.organizationId || !ctx?.supabase) {
        throw new Error('google_contacts_find requires ctx.organizationId and ctx.supabase')
      }
      return findGoogleContact(params, ctx)
    }
    case 'google_contacts_delete': {
      if (!ctx?.organizationId || !ctx?.supabase) {
        throw new Error('google_contacts_delete requires ctx.organizationId and ctx.supabase')
      }
      return deleteGoogleContact(params, ctx)
    }
    case 'send_sms': {
      if (!ctx?.organizationId || !ctx?.supabase) {
        throw new Error('send_sms requires ctx.organizationId and ctx.supabase')
      }
      return sendSms(params, ctx)
    }
    case 'custom_webhook': {
      if (!ctx?.toolConfig) {
        throw new Error('custom_webhook requires ctx.toolConfig (the tool_config.config JSONB)')
      }
      return executeWebhook(params, ctx.toolConfig)
    }
    case 'manychat_set_field':
      return setManychatField(params, credentials)
    case 'manychat_add_tag':
      return addManychatTag(params, credentials)
    case 'manychat_trigger_flow':
      return triggerManychatFlow(params, credentials)
    case 'manychat_send_message':
      return sendManychatMessage(params, credentials)
    default: {
      // TypeScript exhaustiveness check
      const _exhaustive: never = actionType
      throw new Error(`Unknown action type: ${String(_exhaustive)}`)
    }
  }
}
