// channelOverrideSchema rebuilds its output from a whitelist, so any key the
// transform forgets is DELETED the next time someone saves an agent's
// settings form — no error, no warning, no diff to look at.
//
// For `channel_overrides.voice` that failure is invisible and slow: an
// operator nudges a temperature weeks after the voice was configured, the
// options vanish, and the next config push quietly puts the English
// barbershop greeting and the English transcriber back on a Portuguese phone
// line. This file makes that a red test instead.

import { describe, it, expect } from 'vitest'
import { agentSchema, agentSettingsSchema, channelOverrideSchema } from '@/lib/agents/zod-schemas'

const voice = {
  first_message: 'Olá! Aqui é a {{business_name}}.',
  language: 'pt-BR',
  voice: { provider: '11labs', voiceId: 'custom-pt' },
  keyterms: ['chaveiro', 'NFC'],
  appointments: false,
  analysis: { outcomes: ['confirmed', 'declined'], scope: 'this order' },
}

const baseAgent = {
  name: 'Voz Skale Club',
  slug: 'voz-skale-club',
  description: null,
  system_prompt: 'You answer the phone.',
  model: 'anthropic/claude-sonnet-4-6',
  fallback_message: 'I cannot help with that right now.',
  max_history: 20,
  is_active: true,
  allowed_channels: ['voice'],
  channel_overrides: { voice: { voice } },
  tool_ids: [],
}

describe('channel_overrides.voice survives the form schemas', () => {
  it('is carried through channelOverrideSchema verbatim', () => {
    const parsed = channelOverrideSchema.parse({ voice, temperature: 0.3 })
    expect(parsed.voice).toEqual(voice)
    expect(parsed.temperature).toBe(0.3)
  })

  it('survives a full agent round-trip', () => {
    const parsed = agentSchema.parse(baseAgent)
    expect(parsed.channel_overrides.voice?.voice).toEqual(voice)
  })

  it('survives the settings-only save — the form that would have eaten it', () => {
    const { system_prompt: _prompt, tool_ids: _tools, ...settings } = baseAgent
    const parsed = agentSettingsSchema.parse(settings)
    expect(parsed.channel_overrides.voice?.voice).toEqual(voice)
  })

  it('still strips the keys the runtime treats as absent', () => {
    const parsed = channelOverrideSchema.parse({ system_prompt_suffix: '   ', voice })
    expect(parsed).not.toHaveProperty('system_prompt_suffix')
    expect(parsed.voice).toEqual(voice)
  })

  it('rejects a malformed voice block instead of storing it', () => {
    const result = channelOverrideSchema.safeParse({ voice: { language: 'not-a-language-code' } })
    expect(result.success).toBe(false)
  })
})
