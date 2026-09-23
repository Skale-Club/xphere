// src/lib/agent-runtime/conversation-routing.ts
//
// Pure decision rules for which agent (if any) answers an inbound chat
// message. No I/O here so the rules are unit-testable; the Supabase wiring
// lives in ./inbound-agent.ts and ./human-takeover.ts.
//
// Three concepts (migration 1302):
//   - Pause: bot_status='paused'. A pause with bot_paused_until set lapses on
//     its own (a human replied); one without it lasts until someone turns the
//     bot back on (manual toggle or agent handoff).
//   - Keyword activation: an agent with activation_keywords only takes a
//     conversation when a message contains one of them.
//   - Engagement: once a keyword agent has taken a conversation, follow-ups
//     without the keyword still go to it until ENGAGEMENT_TTL_MS of silence.

/** A human reply pauses the bot for this long (each new human reply extends it). */
export const HUMAN_TAKEOVER_PAUSE_MS = 24 * 60 * 60 * 1000

/** A keyword agent keeps the conversation this long after its last turn. */
export const ENGAGEMENT_TTL_MS = 72 * 60 * 60 * 1000

/**
 * A keyword never pulls a bot into a conversation a human has been handling
 * this recently — the operator is mid-conversation and the keyword is almost
 * certainly part of it.
 */
export const HUMAN_ACTIVITY_GUARD_MS = 12 * 60 * 60 * 1000

export interface PauseState {
  bot_status?: string | null
  bot_paused_until?: string | null
}

/** True when the bot must stay quiet for this conversation right now. */
export function isBotPaused(conv: PauseState | null | undefined, now: Date = new Date()): boolean {
  if (!conv) return false
  if ((conv.bot_status ?? 'active') === 'active') return false
  const until = conv.bot_paused_until ? Date.parse(conv.bot_paused_until) : NaN
  // No (valid) expiry → indefinite pause (manual toggle, handoff, legacy rows).
  if (Number.isNaN(until)) return true
  return until > now.getTime()
}

/** Lowercase, strip accents, collapse everything that is not a letter/digit to one space. */
export function normalizeForKeywordMatch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Returns the first keyword found in `text` as a whole word/phrase (after
 * normalisation), or null. "chaveiro" matches "Chaveiro!" and "chavêiro", but
 * not "chaveiroso"; list plurals explicitly ("chaveiros").
 */
export function matchActivationKeyword(
  text: string | null | undefined,
  keywords: readonly string[] | null | undefined,
): string | null {
  if (!text || !keywords || keywords.length === 0) return null
  const haystack = ` ${normalizeForKeywordMatch(text)} `
  if (haystack.trim().length === 0) return null
  for (const keyword of keywords) {
    const needle = normalizeForKeywordMatch(keyword)
    if (needle && haystack.includes(` ${needle} `)) return keyword
  }
  return null
}

export interface EngagementState {
  engaged_agent_id?: string | null
  engaged_at?: string | null
}

/** The engaged agent id when the engagement has not lapsed, else null. */
export function liveEngagedAgentId(
  conv: EngagementState | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!conv?.engaged_agent_id || !conv.engaged_at) return null
  const at = Date.parse(conv.engaged_at)
  if (Number.isNaN(at)) return null
  return now.getTime() - at <= ENGAGEMENT_TTL_MS ? conv.engaged_agent_id : null
}

export interface RoutableAgent {
  id: string
  activation_keywords: string[] | null
}

export type InboundAgentDecision =
  | { kind: 'none' }
  /** Keep answering with the agent already holding the conversation. */
  | { kind: 'engaged'; agentId: string }
  /**
   * A keyword agent takes the conversation now. `source` says where the keyword
   * was: the customer's message, or our last automated message they are
   * replying to (a campaign opener like "Oi! Quer saber dos chaveiros NFC?").
   */
  | { kind: 'keyword'; agentId: string; keyword: string; source: 'inbound' | 'outbound' }
  /** The channel's default (always-on) agent answers. */
  | { kind: 'default'; agentId: string }

export function isKeywordActivated(agent: Pick<RoutableAgent, 'activation_keywords'>): boolean {
  return (agent.activation_keywords?.length ?? 0) > 0
}

/**
 * Decide who answers. Assumes the pause gate already ran.
 *
 * Order: live engagement → keyword match → channel default. A channel default
 * that is itself keyword-activated only ever answers through a keyword match,
 * so an org can make its whole channel topic-scoped by picking such an agent.
 */
export function decideInboundAgent(params: {
  text: string
  /** Engaged agent id after liveEngagedAgentId(); must still be an active agent. */
  engagedAgentId: string | null
  /** Active keyword-activated agents allowed on this channel. */
  keywordAgents: RoutableAgent[]
  defaultAgent: RoutableAgent | null
  /** A human sent a message in this conversation within HUMAN_ACTIVITY_GUARD_MS. */
  humanRecentlyActive: boolean
  /**
   * Text of our latest automated (non-human) outbound message, when it went out
   * within ENGAGEMENT_TTL_MS. Lets a campaign opener engage the agent even
   * though the customer's reply ("sim, quero!") has no keyword in it.
   */
  lastAutomatedOutboundText?: string | null
}): InboundAgentDecision {
  const { text, engagedAgentId, keywordAgents, defaultAgent, humanRecentlyActive } = params

  if (engagedAgentId) return { kind: 'engaged', agentId: engagedAgentId }

  if (!humanRecentlyActive) {
    for (const agent of keywordAgents) {
      const keyword = matchActivationKeyword(text, agent.activation_keywords)
      if (keyword) return { kind: 'keyword', agentId: agent.id, keyword, source: 'inbound' }
    }
    for (const agent of keywordAgents) {
      const keyword = matchActivationKeyword(params.lastAutomatedOutboundText, agent.activation_keywords)
      if (keyword) return { kind: 'keyword', agentId: agent.id, keyword, source: 'outbound' }
    }
  }

  if (defaultAgent && !isKeywordActivated(defaultAgent)) {
    return { kind: 'default', agentId: defaultAgent.id }
  }
  return { kind: 'none' }
}

/**
 * Prepend the agent's customer-facing label ("🤖 Ana (assistente virtual)")
 * to a reply. Idempotent: an already-labelled text is returned unchanged.
 */
export function applyMessageLabel(text: string, label: string | null | undefined): string {
  const trimmed = label?.trim()
  if (!trimmed || !text) return text
  if (text.startsWith(trimmed)) return text
  return `${trimmed}\n${text}`
}

/** Inverse of applyMessageLabel, used when replaying history to the model. */
export function stripMessageLabel(text: string, label: string | null | undefined): string {
  const trimmed = label?.trim()
  if (!trimmed || !text.startsWith(trimmed)) return text
  return text.slice(trimmed.length).replace(/^\s*\n/, '')
}
