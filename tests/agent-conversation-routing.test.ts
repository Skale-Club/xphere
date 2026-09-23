// Pure routing rules for inbound chat agents (migration 1302):
// keyword activation, engagement, pause expiry, reply labels.

import { describe, it, expect } from 'vitest'
import {
  ENGAGEMENT_TTL_MS,
  HUMAN_TAKEOVER_PAUSE_MS,
  applyMessageLabel,
  decideInboundAgent,
  isBotPaused,
  liveEngagedAgentId,
  matchActivationKeyword,
  stripMessageLabel,
} from '@/lib/agent-runtime/conversation-routing'
import { activationKeywordsSchema } from '@/lib/agents/zod-schemas'

const NFC_KEYWORDS = ['chaveiro', 'chaveiros', 'keychain', 'keychains', 'key chain', 'nfc']
const NOW = new Date('2026-09-23T12:00:00Z')
const iso = (msFromNow: number) => new Date(NOW.getTime() + msFromNow).toISOString()

describe('matchActivationKeyword', () => {
  it.each([
    ['Oi, quero saber dos chaveiros', 'chaveiros'],
    ['CHAVEIRO com a minha logo?', 'chaveiro'],
    ['chavêiro', 'chaveiro'], // accents ignored
    ['How much are the keychains?', 'keychains'],
    ['do you make a key-chain?', 'key chain'], // punctuation collapses to spaces
    ['Vi o anúncio do NFC!', 'nfc'],
  ])('matches %j', (text, expected) => {
    expect(matchActivationKeyword(text, NFC_KEYWORDS)).toBe(expected)
  })

  it.each([
    'Quero um site novo',
    'chaveiroso', // not a whole word
    'nfcx',
    '',
  ])('does not match %j', (text) => {
    expect(matchActivationKeyword(text, NFC_KEYWORDS)).toBeNull()
  })

  it('no keywords never matches', () => {
    expect(matchActivationKeyword('chaveiro', [])).toBeNull()
    expect(matchActivationKeyword('chaveiro', null)).toBeNull()
  })
})

describe('isBotPaused', () => {
  it('active or missing conversation is not paused', () => {
    expect(isBotPaused(null, NOW)).toBe(false)
    expect(isBotPaused({ bot_status: 'active' }, NOW)).toBe(false)
  })

  it('paused without expiry stays paused (manual toggle, handoff, legacy rows)', () => {
    expect(isBotPaused({ bot_status: 'paused' }, NOW)).toBe(true)
    expect(isBotPaused({ bot_status: 'paused', bot_paused_until: null }, NOW)).toBe(true)
  })

  it('a human-reply pause lapses at bot_paused_until', () => {
    expect(isBotPaused({ bot_status: 'paused', bot_paused_until: iso(60_000) }, NOW)).toBe(true)
    expect(isBotPaused({ bot_status: 'paused', bot_paused_until: iso(-1) }, NOW)).toBe(false)
  })

  it('the human takeover window is 24h', () => {
    expect(HUMAN_TAKEOVER_PAUSE_MS).toBe(24 * 60 * 60 * 1000)
  })
})

describe('liveEngagedAgentId', () => {
  it('returns the agent while the engagement is fresh', () => {
    expect(liveEngagedAgentId({ engaged_agent_id: 'a1', engaged_at: iso(-60_000) }, NOW)).toBe('a1')
  })

  it('drops a lapsed engagement', () => {
    expect(
      liveEngagedAgentId({ engaged_agent_id: 'a1', engaged_at: iso(-ENGAGEMENT_TTL_MS - 1) }, NOW),
    ).toBeNull()
  })

  it('needs both id and timestamp', () => {
    expect(liveEngagedAgentId({ engaged_agent_id: 'a1', engaged_at: null }, NOW)).toBeNull()
    expect(liveEngagedAgentId({ engaged_agent_id: null, engaged_at: iso(0) }, NOW)).toBeNull()
  })
})

describe('decideInboundAgent', () => {
  const nfc = { id: 'nfc', activation_keywords: NFC_KEYWORDS }
  const general = { id: 'general', activation_keywords: [] }
  const base = {
    engagedAgentId: null,
    keywordAgents: [nfc],
    defaultAgent: null,
    humanRecentlyActive: false,
  }

  it('a keyword pulls the keyword agent in', () => {
    expect(decideInboundAgent({ ...base, text: 'Quanto custa o chaveiro?' })).toEqual({
      kind: 'keyword',
      agentId: 'nfc',
      keyword: 'chaveiro',
      source: 'inbound',
    })
  })

  it('without a keyword and without a default, nobody answers (topic-scoped channel)', () => {
    expect(decideInboundAgent({ ...base, text: 'Oi, tudo bem?' })).toEqual({ kind: 'none' })
  })

  it('an engaged agent keeps answering follow-ups with no keyword', () => {
    expect(decideInboundAgent({ ...base, engagedAgentId: 'nfc', text: 'e 50 peças?' })).toEqual({
      kind: 'engaged',
      agentId: 'nfc',
    })
  })

  it('a reply to our campaign opener engages the agent', () => {
    expect(
      decideInboundAgent({
        ...base,
        text: 'Sim, quero!',
        lastAutomatedOutboundText: 'Oi! Vimos que você se interessou pelos chaveiros NFC. Posso ajudar?',
      }),
    ).toEqual({ kind: 'keyword', agentId: 'nfc', keyword: 'chaveiros', source: 'outbound' })
  })

  it('a keyword never pulls the bot into a conversation a human is handling', () => {
    expect(
      decideInboundAgent({ ...base, humanRecentlyActive: true, text: 'e o chaveiro?' }),
    ).toEqual({ kind: 'none' })
  })

  it('an always-on default agent still answers everything else', () => {
    expect(decideInboundAgent({ ...base, defaultAgent: general, text: 'Oi, tudo bem?' })).toEqual({
      kind: 'default',
      agentId: 'general',
    })
  })

  it('a keyword agent beats the always-on default on its topic', () => {
    expect(
      decideInboundAgent({ ...base, defaultAgent: general, text: 'quero chaveiros' }),
    ).toMatchObject({ kind: 'keyword', agentId: 'nfc' })
  })

  it('a keyword-activated channel default only answers on its keywords', () => {
    const scopedDefault = { ...base, keywordAgents: [nfc], defaultAgent: nfc }
    expect(decideInboundAgent({ ...scopedDefault, text: 'Oi' })).toEqual({ kind: 'none' })
    expect(decideInboundAgent({ ...scopedDefault, text: 'nfc?' })).toMatchObject({ kind: 'keyword' })
  })
})

describe('message labels', () => {
  const label = '🤖 Ana (assistente virtual)'

  it('prepends the label once', () => {
    const labelled = applyMessageLabel('Oi!', label)
    expect(labelled).toBe(`${label}\nOi!`)
    expect(applyMessageLabel(labelled, label)).toBe(labelled)
  })

  it('no label leaves the text alone', () => {
    expect(applyMessageLabel('Oi!', null)).toBe('Oi!')
    expect(applyMessageLabel('Oi!', '   ')).toBe('Oi!')
  })

  it('strip is the inverse of apply', () => {
    expect(stripMessageLabel(applyMessageLabel('Oi!\nTudo bem?', label), label)).toBe('Oi!\nTudo bem?')
    expect(stripMessageLabel('Oi!', label)).toBe('Oi!')
  })
})

describe('activationKeywordsSchema', () => {
  it('parses the settings textarea into a clean, de-duplicated list', () => {
    expect(activationKeywordsSchema.parse('chaveiro, Chaveiro,\n nfc ,, keychain')).toEqual([
      'chaveiro',
      'nfc',
      'keychain',
    ])
  })

  it('empty text means an always-on agent', () => {
    expect(activationKeywordsSchema.parse('')).toEqual([])
  })
})
