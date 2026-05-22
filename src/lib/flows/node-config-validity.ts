// SEED-043 Phase 1 | Lightweight per-action required-field check.
// Returns false when a node is missing fields a runtime executor would refuse
// to run with. Intentionally tolerant: actions not listed below default to
// "complete" so legacy / unknown action_types don't paint the whole canvas
// amber.
//
// Mirror this list as new action executors are added; the runtime is still the
// final arbiter (see src/lib/action-engine/execute-action.ts).

type Config = Record<string, unknown> | undefined | null

function hasNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function hasAnyOf(config: Config, keys: string[]): boolean {
  if (!config || typeof config !== 'object') return false
  return keys.some((k) => hasNonEmptyString((config as Record<string, unknown>)[k]))
}

function hasAllOf(config: Config, keys: string[]): boolean {
  if (!config || typeof config !== 'object') return false
  return keys.every((k) => hasNonEmptyString((config as Record<string, unknown>)[k]))
}

/**
 * Returns true when a wait node has enough configuration to plausibly run.
 * For wait_for_event mode, an event_type is required.
 */
export function isWaitNodeComplete(mode: string | undefined, eventType: string | undefined): boolean {
  if (mode === 'wait_for_event') return hasNonEmptyString(eventType)
  return true
}

/**
 * Returns true when the config has enough fields to plausibly run.
 * Unknown action types default to true (we don't want to flag every legacy
 * workflow as incomplete).
 */
export function isNodeConfigComplete(
  actionType: string | undefined | null,
  config: Config,
): boolean {
  if (!actionType) return true

  switch (actionType) {
    case 'send_sms':
      return hasAllOf(config, ['to', 'body'])

    case 'send_telegram_notification':
      return hasAllOf(config, ['chat_id', 'message'])

    case 'create_contact':
      return hasAnyOf(config, ['phone', 'email', 'name', 'first_name', 'last_name'])

    case 'send_whatsapp':
    case 'send_whatsapp_message':
      return hasAllOf(config, ['to']) && hasAnyOf(config, ['message', 'body', 'template'])

    case 'send_email':
      return hasAllOf(config, ['to']) && hasAnyOf(config, ['subject', 'template'])

    case 'http_request':
    case 'custom_webhook':
      return hasAnyOf(config, ['url', 'endpoint'])

    case 'manychat_send_message':
      return hasAllOf(config, ['subscriber_id']) && hasAnyOf(config, ['message', 'text'])

    case 'manychat_set_field':
      return hasAllOf(config, ['subscriber_id', 'field_name'])

    case 'manychat_add_tag':
      return hasAllOf(config, ['subscriber_id', 'tag_name'])

    case 'manychat_trigger_flow':
      return hasAllOf(config, ['subscriber_id', 'flow_ns'])

    case 'create_task':
      return hasNonEmptyString(config?.title)

    case 'create_note':
      return hasAnyOf(config, ['content', 'text'])

    default:
      return true
  }
}
