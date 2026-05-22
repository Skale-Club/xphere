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
import { sendSmsViaGhl } from '@/lib/ghl/send-sms'
import { sendWhatsappMessageAction } from '@/lib/action-engine/executors/send-whatsapp-message'
import { sendWhatsappMentionAllAction } from '@/lib/action-engine/executors/send-whatsapp-mention-all'
import { executeSendTelegramNotification } from '@/lib/action-engine/executors/send-telegram-notification'
import {
  executePipelineMoveOpportunity,
  executePipelineUpdateOpportunity,
  executePipelineMarkWon,
  executePipelineMarkLost,
  executePipelineAddNote,
  executePipelineAssignUser,
  executePipelineCreateOpportunity,
} from '@/lib/action-engine/executors/pipeline-actions'
import { executeCreateTask, executeCreateNote } from '@/lib/action-engine/executors/create-task'
import { executeSendEmail } from '@/lib/action-engine/executors/send-email'
import type { GhlCredentials } from '@/lib/ghl/client'
import type { Database, Json } from '@/types/database'
import type { SupabaseClient } from '@supabase/supabase-js'

type ActionType = Database['public']['Enums']['action_type']
type IntegrationProvider = Database['public']['Enums']['integration_provider']

export interface ActionContext {
  organizationId: string
  supabase: SupabaseClient<Database>
  /** tool_configs.config JSONB | required for custom_webhook */
  toolConfig?: Json
  /** Provider of the integration bound to this tool | dispatches send_sms to Twilio vs GHL */
  integrationProvider?: IntegrationProvider
  /** Phase 38 DELEG-07: ordered list of agentIds in the delegation chain | for intersection authorization logging */
  delegationChain?: string[]
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
      if (ctx.integrationProvider === 'gohighlevel') {
        return sendSmsViaGhl(params, credentials)
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
    case 'send_whatsapp_message': {
      if (!ctx?.organizationId || !ctx?.supabase) {
        throw new Error('send_whatsapp_message requires ctx.organizationId and ctx.supabase')
      }
      return sendWhatsappMessageAction(params, ctx)
    }
    case 'send_whatsapp_mention_all': {
      if (!ctx?.organizationId || !ctx?.supabase) {
        throw new Error('send_whatsapp_mention_all requires ctx.organizationId and ctx.supabase')
      }
      return sendWhatsappMentionAllAction(params, ctx)
    }
    case 'send_telegram_notification': {
      if (!ctx?.organizationId) {
        throw new Error('send_telegram_notification requires ctx.organizationId')
      }
      const rawParseMode = typeof params.parse_mode === 'string' ? params.parse_mode : undefined
      const parseMode: 'HTML' | 'MarkdownV2' | 'plain' | undefined =
        rawParseMode === 'HTML' ? 'HTML'
        : rawParseMode === 'Markdown' || rawParseMode === 'MarkdownV2' ? 'MarkdownV2'
        : rawParseMode === 'plain' ? 'plain'
        : undefined
      const result = await executeSendTelegramNotification({
        orgId: ctx.organizationId,
        text: String(params.text ?? ''),
        chatId: typeof params.chat_id === 'string' ? params.chat_id : undefined,
        parseMode,
        disableNotification: Boolean(params.disable_notification),
      })
      if (!result.ok) throw new Error(result.error ?? 'send_telegram_notification failed')
      return `Telegram sent. Message IDs: ${result.messageIds.join(', ')}`
    }
    case 'pipeline_move_opportunity':
      return executePipelineMoveOpportunity(params as unknown as Parameters<typeof executePipelineMoveOpportunity>[0], ctx)
    case 'pipeline_update_opportunity':
      return executePipelineUpdateOpportunity(params as unknown as Parameters<typeof executePipelineUpdateOpportunity>[0], ctx)
    case 'pipeline_mark_won':
      return executePipelineMarkWon(params as unknown as Parameters<typeof executePipelineMarkWon>[0], ctx)
    case 'pipeline_mark_lost':
      return executePipelineMarkLost(params as unknown as Parameters<typeof executePipelineMarkLost>[0], ctx)
    case 'pipeline_add_note':
      return executePipelineAddNote(params as unknown as Parameters<typeof executePipelineAddNote>[0], ctx)
    case 'pipeline_assign_user':
      return executePipelineAssignUser(params as unknown as Parameters<typeof executePipelineAssignUser>[0], ctx)
    case 'pipeline_create_opportunity':
      return executePipelineCreateOpportunity(params as unknown as Parameters<typeof executePipelineCreateOpportunity>[0], ctx)
    case 'create_task': {
      if (!ctx?.organizationId) {
        throw new Error('create_task requires ctx.organizationId')
      }
      return executeCreateTask(params, ctx.organizationId)
    }
    case 'create_note': {
      if (!ctx?.organizationId) {
        throw new Error('create_note requires ctx.organizationId')
      }
      return executeCreateNote(params, ctx.organizationId)
    }
    case 'send_email': {
      return executeSendEmail(params)
    }
    default: {
      // TypeScript exhaustiveness check
      const _exhaustive: never = actionType
      throw new Error(`Unknown action type: ${String(_exhaustive)}`)
    }
  }
}
