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
import { sendWhatsappTemplateAction } from '@/lib/action-engine/executors/send-whatsapp-template'
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
import { executeUpdateContact } from '@/lib/action-engine/executors/update-contact'
import { executeContactAddTag } from '@/lib/action-engine/executors/contact-tag-actions'
import { executeUpdateBookingStatus } from '@/lib/action-engine/executors/update-booking-status'
import {
  executeBookingConfirmAction,
  executeBookingCancelAction,
  executeBookingRescheduleAction,
  executeBookingMarkNoShowAction,
  executeBookingMarkCompleteAction,
} from '@/lib/action-engine/executors/booking-lifecycle-actions'
import { executeSendEmail } from '@/lib/action-engine/executors/send-email'
import { executeSendEmailTemplate } from '@/lib/action-engine/executors/send-email-template'
import { executeSendTenantEmail } from '@/lib/action-engine/executors/send-tenant-email'
import { executeSendPlatformEmail } from '@/lib/action-engine/executors/send-platform-email'
import { executeSendZernioDm } from '@/lib/action-engine/executors/send-zernio-dm'
import { getXkeduleCredentialsForOrg } from '@/lib/xkedule/credentials'
import { getXkeduleServices } from '@/lib/xkedule/actions/get-services'
import { checkXkeduleAvailability } from '@/lib/xkedule/actions/check-availability'
import { createXkeduleBooking } from '@/lib/xkedule/actions/create-booking'
import { getMedusaCredentialsForOrg } from '@/lib/medusa/credentials'
import { searchMedusaProducts } from '@/lib/medusa/actions/search-products'
import { getMedusaProduct } from '@/lib/medusa/actions/get-product'
import { getMedusaCart } from '@/lib/medusa/actions/get-cart'
import { addToCartMedusa } from '@/lib/medusa/actions/add-to-cart'
import { updateCartItemMedusa } from '@/lib/medusa/actions/update-cart-item'
import type { GhlCredentials } from '@/lib/ghl/client'
import type { Database, Json } from '@/types/database'
import type { SupabaseClient } from '@supabase/supabase-js'
import { checkDnd, dndBlockedMessage } from '@/lib/dnd'
import { isDemoOrg } from '@/lib/demo/config'
import { log } from '@/lib/logger'

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
  /** Phase 1085 DND: contact id to check before sending outbound messages */
  contactId?: string
  /** Phase 1085 DND: conversation id to write DND-blocked timeline events into */
  conversationId?: string
  /**
   * Phase 134 CRT-03: SSE emitter for commerce write events (`cart_created`/
   * `cart_updated`). Set ONLY on run-agent's STREAMING call site; the
   * blocking call site omits it entirely, so executors must null-check
   * (`ctx.emitStructured?.(...)`). Structurally compatible with
   * MedusaExecCtx.emitStructured, so passing `ctx` straight through to the
   * medusa write executors delivers it without a cast.
   */
  emitStructured?: (obj: Record<string, unknown>) => void
}

/** Insert a system timeline message into a conversation (best-effort, never throws). */
async function insertDndTimelineEvent(
  ctx: ActionContext,
  channel: string,
): Promise<void> {
  try {
    if (!ctx.conversationId || !ctx.organizationId || !ctx.supabase) return
    await ctx.supabase.from('conversation_messages').insert({
      conversation_id: ctx.conversationId,
      org_id: ctx.organizationId,
      role: 'system',
      content: dndBlockedMessage(channel),
      metadata: { type: 'dnd_blocked', channel, contact_id: ctx.contactId },
    })
  } catch {
    // best-effort
  }
}

export async function executeAction(
  actionType: ActionType,
  params: Record<string, unknown>,
  credentials: GhlCredentials,
  ctx?: ActionContext
): Promise<string> {
  const startMs = Date.now()

  // Demo safety invariant: the demo organization must never produce side effects
  // (no outbound sends, no internal mutations), regardless of who triggers it.
  if (isDemoOrg(ctx?.organizationId)) {
    throw new Error('Demo organization is read-only: action execution is disabled.')
  }

  // Log action execution start
  void log({
    event_type: 'action.executed',
    source: 'action-engine',
    severity: 'info',
    status: 'ok',
    org_id: ctx?.organizationId,
    actor_type: 'system',
    payload: { action_type: actionType, params_keys: Object.keys(params) },
  })

  try {
    const result = await _executeActionInner(actionType, params, credentials, ctx)
    void log({
      event_type: 'action.completed',
      source: 'action-engine',
      severity: 'info',
      status: 'ok',
      org_id: ctx?.organizationId,
      actor_type: 'system',
      duration_ms: Date.now() - startMs,
      payload: { action_type: actionType, result_length: result.length },
    })
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    void log({
      event_type: 'action.failed',
      source: 'action-engine',
      severity: 'error',
      status: 'failed',
      org_id: ctx?.organizationId,
      actor_type: 'system',
      duration_ms: Date.now() - startMs,
      error_message: message,
      payload: { action_type: actionType },
    })
    throw err
  }
}

async function _executeActionInner(
  actionType: ActionType,
  params: Record<string, unknown>,
  credentials: GhlCredentials,
  ctx?: ActionContext
): Promise<string> {
  // update_contact / contact_add_tag are not in the action_type DB enum — handled before the switch
  if ((actionType as string) === 'update_contact') {
    if (!ctx?.organizationId || !ctx?.supabase) {
      throw new Error('update_contact requires ctx.organizationId and ctx.supabase')
    }
    return executeUpdateContact(params, ctx)
  }

  if ((actionType as string) === 'contact_add_tag') {
    if (!ctx?.organizationId || !ctx?.supabase) {
      throw new Error('contact_add_tag requires ctx.organizationId and ctx.supabase')
    }
    return executeContactAddTag(params, ctx)
  }

  if ((actionType as string) === 'update_booking_status') {
    if (!ctx?.organizationId || !ctx?.supabase) {
      throw new Error('update_booking_status requires ctx.organizationId and ctx.supabase')
    }
    return executeUpdateBookingStatus(params, ctx.organizationId, ctx.supabase)
  }

  // booking_confirm/booking_cancel/booking_reschedule/booking_mark_no_show/
  // booking_mark_complete are not in the action_type DB enum -- handled
  // before the switch (mirrors update_booking_status above). Phase 127
  // LIFE-03: closes the wait-free dispatcher's "Unknown action type" gap for
  // every booking_* action node in a workflow with no wait node (the common
  // case), and every MCP/agent-tool-triggered flow, which always runs
  // through this dispatcher regardless of wait nodes.
  if ((actionType as string) === 'booking_confirm') {
    if (!ctx?.organizationId || !ctx?.supabase) {
      throw new Error('booking_confirm requires ctx.organizationId and ctx.supabase')
    }
    return executeBookingConfirmAction(params, ctx.organizationId, ctx.supabase)
  }

  if ((actionType as string) === 'booking_cancel') {
    if (!ctx?.organizationId || !ctx?.supabase) {
      throw new Error('booking_cancel requires ctx.organizationId and ctx.supabase')
    }
    return executeBookingCancelAction(params, ctx.organizationId, ctx.supabase)
  }

  if ((actionType as string) === 'booking_reschedule') {
    if (!ctx?.organizationId || !ctx?.supabase) {
      throw new Error('booking_reschedule requires ctx.organizationId and ctx.supabase')
    }
    return executeBookingRescheduleAction(params, ctx.organizationId, ctx.supabase)
  }

  if ((actionType as string) === 'booking_mark_no_show') {
    if (!ctx?.organizationId || !ctx?.supabase) {
      throw new Error('booking_mark_no_show requires ctx.organizationId and ctx.supabase')
    }
    return executeBookingMarkNoShowAction(params, ctx.organizationId, ctx.supabase)
  }

  if ((actionType as string) === 'booking_mark_complete') {
    if (!ctx?.organizationId || !ctx?.supabase) {
      throw new Error('booking_mark_complete requires ctx.organizationId and ctx.supabase')
    }
    return executeBookingMarkCompleteAction(params, ctx.organizationId, ctx.supabase)
  }

  // send_email_template is not in the action_type DB enum — handled before the
  // switch (mirrors update_contact/contact_add_tag), so it needs no enum migration.
  if ((actionType as string) === 'send_email_template') {
    if (!ctx?.organizationId || !ctx?.supabase) {
      throw new Error('send_email_template requires ctx.organizationId and ctx.supabase')
    }
    return executeSendEmailTemplate(params, ctx.organizationId, ctx.supabase)
  }

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
      // DND check: abort if contact has SMS blocked
      {
        const contactId = ctx.contactId ?? (typeof params.contact_id === 'string' ? params.contact_id : undefined)
        if (contactId) {
          const dnd = await checkDnd(contactId, 'sms', ctx.supabase)
          if (dnd.blocked) {
            void insertDndTimelineEvent(ctx, 'sms')
            return JSON.stringify({ ok: false, reason: dnd.reason, channel: 'sms' })
          }
        }
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
      // DND check: abort if contact has WhatsApp blocked
      {
        const contactId = ctx.contactId ?? (typeof params.contact_id === 'string' ? params.contact_id : undefined)
        if (contactId) {
          const dnd = await checkDnd(contactId, 'whatsapp', ctx.supabase)
          if (dnd.blocked) {
            void insertDndTimelineEvent(ctx, 'whatsapp')
            return JSON.stringify({ ok: false, reason: dnd.reason, channel: 'whatsapp' })
          }
        }
      }
      return sendWhatsappMessageAction(params, ctx)
    }
    case 'send_whatsapp_template': {
      if (!ctx?.organizationId || !ctx?.supabase) {
        throw new Error('send_whatsapp_template requires ctx.organizationId and ctx.supabase')
      }
      {
        const contactId = ctx.contactId ?? (typeof params.contact_id === 'string' ? params.contact_id : undefined)
        if (contactId) {
          const dnd = await checkDnd(contactId, 'whatsapp', ctx.supabase)
          if (dnd.blocked) {
            void insertDndTimelineEvent(ctx, 'whatsapp')
            return JSON.stringify({ ok: false, reason: dnd.reason, channel: 'whatsapp' })
          }
        }
      }
      return sendWhatsappTemplateAction(params, ctx)
    }
    case 'send_whatsapp_mention_all': {
      if (!ctx?.organizationId || !ctx?.supabase) {
        throw new Error('send_whatsapp_mention_all requires ctx.organizationId and ctx.supabase')
      }
      // DND check: abort if contact has WhatsApp blocked
      {
        const contactId = ctx.contactId ?? (typeof params.contact_id === 'string' ? params.contact_id : undefined)
        if (contactId) {
          const dnd = await checkDnd(contactId, 'whatsapp', ctx.supabase)
          if (dnd.blocked) {
            void insertDndTimelineEvent(ctx, 'whatsapp')
            return JSON.stringify({ ok: false, reason: dnd.reason, channel: 'whatsapp' })
          }
        }
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
      // DND check: abort if contact has email blocked
      if (ctx?.supabase) {
        const contactId = ctx.contactId ?? (typeof params.contact_id === 'string' ? params.contact_id : undefined)
        if (contactId) {
          const dnd = await checkDnd(contactId, 'email', ctx.supabase)
          if (dnd.blocked) {
            void insertDndTimelineEvent(ctx, 'email')
            return JSON.stringify({ ok: false, reason: dnd.reason, channel: 'email' })
          }
        }
      }
      return executeSendEmail(params)
    }
    case 'send_tenant_email': {
      if (!ctx?.organizationId) {
        throw new Error('send_tenant_email requires ctx.organizationId')
      }
      return executeSendTenantEmail(params, ctx.organizationId)
    }
    case 'send_platform_email': {
      return executeSendPlatformEmail(params)
    }
    case 'send_zernio_dm': {
      if (!ctx?.organizationId) {
        throw new Error('send_zernio_dm requires ctx.organizationId')
      }
      return executeSendZernioDm(params, ctx)
    }
    case 'xkedule_get_services': {
      if (!ctx?.organizationId || !ctx?.supabase) {
        throw new Error('xkedule_get_services requires ctx.organizationId and ctx.supabase')
      }
      const xkCreds = await getXkeduleCredentialsForOrg(ctx.organizationId, ctx.supabase)
      if (!xkCreds) throw new Error('Xkedule integration not configured for this organization')
      return getXkeduleServices(params, xkCreds)
    }
    case 'xkedule_check_availability': {
      if (!ctx?.organizationId || !ctx?.supabase) {
        throw new Error('xkedule_check_availability requires ctx.organizationId and ctx.supabase')
      }
      const xkCreds = await getXkeduleCredentialsForOrg(ctx.organizationId, ctx.supabase)
      if (!xkCreds) throw new Error('Xkedule integration not configured for this organization')
      return checkXkeduleAvailability(params, xkCreds)
    }
    case 'xkedule_create_booking': {
      if (!ctx?.organizationId || !ctx?.supabase) {
        throw new Error('xkedule_create_booking requires ctx.organizationId and ctx.supabase')
      }
      const xkCreds = await getXkeduleCredentialsForOrg(ctx.organizationId, ctx.supabase)
      if (!xkCreds) throw new Error('Xkedule integration not configured for this organization')
      return createXkeduleBooking(params, xkCreds)
    }
    // Medusa read tools (MED-03/MED-04): unlike xkedule above, these never
    // throw on missing ctx/creds -- they return friendly strings so a
    // misconfigured store never surfaces a raw error into the LLM turn.
    case 'medusa_search_products':
    case 'medusa_get_product':
    case 'medusa_get_cart': {
      if (!ctx?.organizationId || !ctx?.supabase) return 'The store is not available right now.'
      const medusaCreds = await getMedusaCredentialsForOrg(ctx.organizationId, ctx.supabase)
      if (!medusaCreds) return 'No store is connected to this workspace yet.'
      if (actionType === 'medusa_search_products') return searchMedusaProducts(params, medusaCreds, ctx)
      if (actionType === 'medusa_get_product') return getMedusaProduct(params, medusaCreds, ctx)
      return getMedusaCart(medusaCreds, ctx)
    }
    // Medusa write tools (Phase 134, CRT-01/CRT-02/CRT-03): same never-throw
    // friendly-string contract as the read tools above. `ctx` is passed
    // straight through to the executors -- it structurally satisfies
    // MedusaExecCtx (organizationId, supabase, conversationId,
    // emitStructured), so the streaming path's emitStructured reaches the
    // executor's `cart_created`/`cart_updated` emits, and the blocking path's
    // absence of emitStructured is a no-op there (executors null-check).
    case 'medusa_add_to_cart':
    case 'medusa_update_cart_item': {
      if (!ctx?.organizationId || !ctx?.supabase) return 'The store is not available right now.'
      const medusaCreds = await getMedusaCredentialsForOrg(ctx.organizationId, ctx.supabase)
      if (!medusaCreds) return 'No store is connected to this workspace yet.'
      if (actionType === 'medusa_add_to_cart') return addToCartMedusa(params, medusaCreds, ctx)
      return updateCartItemMedusa(params, medusaCreds, ctx)
    }
    // Not yet built (later phases: Wishlist Tools, Product Cards & Order
    // Status). Not registered in ACTION_DESCRIPTIONS or workflows/spec.ts
    // NODES, so the LLM can never select these -- this group exists solely
    // to keep the exhaustive switch below compiling now that database.ts
    // carries all nine medusa_* action types.
    case 'medusa_wishlist_add':
    case 'medusa_wishlist_remove':
    case 'medusa_wishlist_list':
    case 'medusa_get_order_status':
      return 'That commerce action is not available yet.'
    default: {
      // TypeScript exhaustiveness check
      const _exhaustive: never = actionType
      throw new Error(`Unknown action type: ${String(_exhaustive)}`)
    }
  }
}
