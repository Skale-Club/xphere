// tests/evals/golden-set.ts
// Golden eval set for Agent Response-Quality & Eval Harness (Project 2, Q1).
// Each case defines a user message, the evaluation criteria, and the minimum
// acceptable LLM-judge score (1–5).  Criteria are written as positive
// statements: the judge awards higher scores when all criteria are met.
//
// Channels: web_widget (text chat).  Voice / workflow cases are tagged but
// all run through the same runAgent() blocking path.
//
// To add a new case: append to EVAL_CASES and run the harness locally:
//   npx vitest tests/evals/runner.ts

import type { AgentChannel } from '@/lib/agent-runtime/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EvalIntent =
  | 'greeting'
  | 'knowledge_query'
  | 'booking'
  | 'handoff_request'
  | 'out_of_scope'
  | 'objection'
  | 'data_capture'
  | 'follow_up'

export type EvalCase = {
  /** Stable identifier — never reuse after a case is removed. */
  id: string
  /** Human-readable description for reports and CI output. */
  description: string
  /** Agent channel to simulate. */
  channel: AgentChannel
  /** Coarse intent category used for grouping in reports. */
  intent: EvalIntent
  /** The user turn sent to the agent. */
  userMessage: string
  /**
   * Criteria expressed as positive English statements.
   * Each criterion is evaluated by the LLM judge and contributes to the score.
   * Keep each criterion atomic (one idea per bullet).
   */
  criteria: string[]
  /**
   * Anti-criteria: things the response must NOT contain.
   * The judge penalises violations.
   */
  antiCriteria?: string[]
  /**
   * Minimum acceptable score (1–5).  Cases below this floor are counted as
   * failures in the CI gate.
   */
  minScore: number
}

// ---------------------------------------------------------------------------
// Golden set — 15 seed cases
// ---------------------------------------------------------------------------

export const EVAL_CASES: EvalCase[] = [
  // ── Greeting ──────────────────────────────────────────────────────────────

  {
    id: 'EVAL-001',
    description: 'Simple greeting — agent introduces itself warmly',
    channel: 'web_widget',
    intent: 'greeting',
    userMessage: 'Hi there!',
    criteria: [
      'Responds with a friendly, welcoming tone',
      'Briefly states what it can help with',
      'Does not ask for personal information before establishing rapport',
    ],
    minScore: 4,
  },

  {
    id: 'EVAL-002',
    description: 'Greeting with name — personalises response',
    channel: 'web_widget',
    intent: 'greeting',
    userMessage: 'Hello, my name is Carlos.',
    criteria: [
      'Acknowledges the name "Carlos" directly',
      'Responds warmly and naturally, not robotically',
      'Offers assistance without asking redundant follow-up questions',
    ],
    minScore: 4,
  },

  // ── Knowledge queries ──────────────────────────────────────────────────────

  {
    id: 'EVAL-003',
    description: 'Knowledge query — pricing question answered from KB or fallback',
    channel: 'web_widget',
    intent: 'knowledge_query',
    userMessage: 'What are your pricing plans?',
    criteria: [
      'Gives a concrete answer or honestly says the information is not available',
      'Does not fabricate specific prices that were not provided',
      'Offers to connect the user with a human if pricing is not in the knowledge base',
    ],
    antiCriteria: [
      'Makes up specific dollar amounts without sourcing them',
    ],
    minScore: 3,
  },

  {
    id: 'EVAL-004',
    description: 'Knowledge query — product capability question',
    channel: 'web_widget',
    intent: 'knowledge_query',
    userMessage: 'Does your platform integrate with WhatsApp?',
    criteria: [
      'Provides a clear yes/no answer',
      'Gives at least one supporting detail if available',
      'Maintains a helpful and confident tone',
    ],
    minScore: 3,
  },

  {
    id: 'EVAL-005',
    description: 'Knowledge query — out-of-KB topic handled gracefully',
    channel: 'web_widget',
    intent: 'knowledge_query',
    userMessage: 'Can you tell me the stock price of Apple Inc.?',
    criteria: [
      'Acknowledges that the question is outside its scope or knowledge base',
      'Does not fabricate financial data',
      'Redirects helpfully (e.g., suggests a relevant resource or human agent)',
    ],
    antiCriteria: [
      'Provides a specific stock price',
    ],
    minScore: 4,
  },

  // ── Booking / scheduling ──────────────────────────────────────────────────

  {
    id: 'EVAL-006',
    description: 'Booking intent — collects basic info to schedule',
    channel: 'web_widget',
    intent: 'booking',
    userMessage: 'I would like to schedule a demo call.',
    criteria: [
      'Expresses willingness to help schedule a demo',
      'Asks for at least one relevant piece of information (name, email, preferred time)',
      'Does not overwhelm the user with too many questions at once',
    ],
    minScore: 4,
  },

  {
    id: 'EVAL-007',
    description: 'Booking with time preference — confirms next steps clearly',
    channel: 'web_widget',
    intent: 'booking',
    userMessage: 'I want a demo next Tuesday at 3pm.',
    criteria: [
      'Confirms the requested day and time back to the user',
      'Asks for any missing required info (name/email) if not already provided',
      'Does not confirm a slot it cannot verify without checking availability',
    ],
    minScore: 3,
  },

  // ── Handoff requests ──────────────────────────────────────────────────────

  {
    id: 'EVAL-008',
    description: 'Explicit handoff request — transfers gracefully',
    channel: 'web_widget',
    intent: 'handoff_request',
    userMessage: 'I want to speak to a human agent, please.',
    criteria: [
      'Acknowledges the request without arguing or trying to deflect',
      'Confirms that a human will be connected',
      'Maintains a respectful tone throughout',
    ],
    minScore: 4,
  },

  {
    id: 'EVAL-009',
    description: 'Implicit handoff signal — frustrated user',
    channel: 'web_widget',
    intent: 'handoff_request',
    userMessage: "You're not helping me at all. This is useless.",
    criteria: [
      'Responds empathetically to the frustration',
      'Apologises sincerely without being defensive',
      'Offers to escalate to a human agent',
    ],
    antiCriteria: [
      'Dismisses or minimises the user\'s frustration',
      'Repeats the same unhelpful answer',
    ],
    minScore: 4,
  },

  // ── Out-of-scope ──────────────────────────────────────────────────────────

  {
    id: 'EVAL-010',
    description: 'Clearly off-topic request — declines politely',
    channel: 'web_widget',
    intent: 'out_of_scope',
    userMessage: 'Write me a poem about the ocean.',
    criteria: [
      'Politely indicates this is outside its area of focus',
      'Does not write the poem (stays on-domain)',
      'Offers to help with a relevant topic instead',
    ],
    antiCriteria: [
      'Writes the poem',
    ],
    minScore: 4,
  },

  // ── Objection handling ────────────────────────────────────────────────────

  {
    id: 'EVAL-011',
    description: 'Price objection — handles without pressure',
    channel: 'web_widget',
    intent: 'objection',
    userMessage: "That sounds too expensive for my budget.",
    criteria: [
      'Acknowledges the budget concern empathetically',
      'Asks clarifying questions or offers to explore options',
      'Does not apply pressure tactics or dismiss the concern',
    ],
    minScore: 3,
  },

  // ── Data capture ──────────────────────────────────────────────────────────

  {
    id: 'EVAL-012',
    description: 'Email capture — collects without feeling intrusive',
    channel: 'web_widget',
    intent: 'data_capture',
    userMessage: 'I want more information about your product.',
    criteria: [
      'Offers to provide information or direct the user appropriately',
      'Asks for contact details in a natural, non-pushy way',
      'Explains briefly why the information is needed',
    ],
    minScore: 3,
  },

  // ── Follow-up / clarification ─────────────────────────────────────────────

  {
    id: 'EVAL-013',
    description: 'Vague follow-up — asks for clarification',
    channel: 'web_widget',
    intent: 'follow_up',
    userMessage: 'Actually, I meant the other thing.',
    criteria: [
      'Recognises the ambiguity instead of guessing',
      'Asks a focused clarifying question (not multiple at once)',
      'Keeps a conversational, friendly tone',
    ],
    minScore: 4,
  },

  {
    id: 'EVAL-014',
    description: 'Multi-turn coherence — references prior context',
    channel: 'web_widget',
    intent: 'follow_up',
    userMessage: 'Can you repeat that in simpler terms?',
    criteria: [
      'Produces a simpler restatement rather than an identical reply',
      'Does not introduce new information that contradicts the prior turn',
      'Maintains conversational context',
    ],
    minScore: 4,
  },

  // ── WhatsApp channel variant ───────────────────────────────────────────────

  {
    id: 'EVAL-015',
    description: 'WhatsApp greeting — channel-appropriate brevity',
    channel: 'whatsapp',
    intent: 'greeting',
    userMessage: 'Oi, tudo bem?',
    criteria: [
      'Responds in Portuguese (matches the user\'s language)',
      'Keeps the response concise and appropriate for messaging apps',
      'Greets back warmly and offers help',
    ],
    minScore: 4,
  },
]
