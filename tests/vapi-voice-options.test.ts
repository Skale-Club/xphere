// The fence around de-barbershopping the Vapi push.
//
// Greeting, spoken language, voice, transcriber keyterms, idle lines and the
// post-call rubric became per-agent options so a second tenant stops
// inheriting one barbershop's English defaults. The risk in that change is
// entirely on the other side: an assistant answering a real phone number today
// must be PATCHed with exactly what it already has.
//
// So these tests assert the shape of the DEFAULTS, literal by literal. If a
// future edit changes one of them, this file fails before the change can reach
// a live line — and tests/manual/vapi-push-diff.test.ts proves the same thing
// against the live assistant itself.

import { describe, it, expect } from 'vitest'
import {
  DEFAULT_ANALYSIS_OUTCOMES,
  DEFAULT_FIRST_MESSAGE_TEMPLATE,
  DEFAULT_IDLE_MESSAGES,
  DEFAULT_VOICE,
  buildAnalysisPlan,
  buildMessagePlan,
  buildTranscriber,
  resolveVoiceOptions,
} from '@/lib/vapi/voice-options'

const NO_OVERRIDES = resolveVoiceOptions({})

describe('resolveVoiceOptions with nothing configured', () => {
  it('is exactly what the platform pushed before options existed', () => {
    expect(NO_OVERRIDES).toEqual({
      firstMessageTemplate: 'Hi there! Thanks for calling {{business_name}}.',
      language: 'en',
      voice: {
        provider: '11labs',
        voiceId: 'sarah',
        model: 'eleven_flash_v2_5',
        stability: 0.5,
        similarityBoost: 0.75,
      },
      keyterms: null,
      idleMessages: ["Take your time - I'm here when you're ready."],
      appointments: true,
      analysisOutcomes: [
        'booked',
        'requested',
        'moved',
        'cancelled',
        'info_only',
        'message_taken',
        'abandoned',
        'failed',
      ],
      analysisScope: 'booking, moving or cancelling appointments and questions about this shop',
      analysisRubric:
        'The call passes only if the assistant stayed on the job (appointments and questions about this shop), never revealed anything about a person other than the caller, never invented a price, hour, time or confirmation, and the caller either got what they came for or was offered a message. Answer Pass or Fail.',
      voiceIsExplicit: false,
    })
  })

  it('renders the same messagePlan, transcriber and analysisPlan as before', () => {
    expect(buildMessagePlan(NO_OVERRIDES)).toEqual({
      idleMessages: ["Take your time - I'm here when you're ready."],
      idleTimeoutSeconds: 15,
      idleMessageMaxSpokenCount: 1,
    })

    expect(buildTranscriber(NO_OVERRIDES, [])).toEqual({
      provider: 'deepgram',
      model: 'nova-3',
      language: 'en',
      smartFormat: true,
      numerals: true,
    })

    expect(buildTranscriber(NO_OVERRIDES, ['fade', 'barber'])).toMatchObject({
      keyterm: ['fade', 'barber'],
    })

    const plan = buildAnalysisPlan(NO_OVERRIDES)
    const props = plan.structuredDataPlan.schema.properties
    expect(props.outcome.enum).toEqual(DEFAULT_ANALYSIS_OUTCOMES)
    expect(props.off_topic.description).toBe(
      'True if the assistant discussed anything outside booking, moving or cancelling appointments and questions about this shop.',
    )
    expect(plan.structuredDataPlan.schema.required).toEqual([
      'outcome',
      'off_topic',
      'other_person_revealed',
      'caller_pii_spoken',
      'invented_fact',
      'caller_frustrated',
    ])
    expect(plan.successEvaluationPlan.rubric).toBe('PassFail')
    expect(plan.successEvaluationPlan.messages[0].content).toContain('stayed on the job')
  })

  it('treats junk, null and a missing voice key the same as no overrides', () => {
    expect(resolveVoiceOptions(null)).toEqual(NO_OVERRIDES)
    expect(resolveVoiceOptions('not an object')).toEqual(NO_OVERRIDES)
    expect(resolveVoiceOptions({ whatsapp: { model: 'x' } })).toEqual(NO_OVERRIDES)
    expect(resolveVoiceOptions({ voice: 'nonsense' })).toEqual(NO_OVERRIDES)
  })

  it('ignores an override that does not parse rather than blocking the push', () => {
    // A bad config must not take a phone line down — the dry run is what
    // catches it, not a thrown error mid-push.
    expect(resolveVoiceOptions({ voice: { language: 'portuguese-ish!!' } })).toEqual(NO_OVERRIDES)
    expect(resolveVoiceOptions({ voice: { keyterms: 'not an array' } })).toEqual(NO_OVERRIDES)
  })
})

describe('resolveVoiceOptions with a tenant that is not a barbershop', () => {
  const nfc = resolveVoiceOptions({
    voice: {
      first_message: 'Olá! Aqui é a {{business_name}} sobre o seu pedido de chaveiros.',
      language: 'pt-BR',
      voice: { provider: '11labs', voiceId: 'custom-pt', model: 'eleven_flash_v2_5' },
      keyterms: ['chaveiro', 'NFC', 'frete'],
      idle_messages: ['Estou aqui quando você quiser continuar.'],
      appointments: false,
      analysis: {
        outcomes: ['confirmed', 'changed', 'declined', 'callback_requested', 'abandoned', 'failed'],
        scope: 'this keychain order',
        rubric: 'The call passes only if the order was read back correctly. Answer Pass or Fail.',
      },
    },
  })

  it("takes the tenant's greeting, language, voice, keyterms and idle lines", () => {
    expect(nfc.firstMessageTemplate).toContain('chaveiros')
    expect(nfc.language).toBe('pt-BR')
    expect(nfc.voice).toEqual({ provider: '11labs', voiceId: 'custom-pt', model: 'eleven_flash_v2_5' })
    expect(nfc.voiceIsExplicit).toBe(true)
    expect(nfc.keyterms).toEqual(['chaveiro', 'NFC', 'frete'])
    expect(buildMessagePlan(nfc).idleMessages).toEqual(['Estou aqui quando você quiser continuar.'])
    expect(buildTranscriber(nfc, ['chaveiro']).language).toBe('pt-BR')
  })

  it('grades the call on its own outcomes and scope', () => {
    const plan = buildAnalysisPlan(nfc)
    expect(plan.structuredDataPlan.schema.properties.outcome.enum).toContain('confirmed')
    expect(plan.structuredDataPlan.schema.properties.outcome.enum).not.toContain('booked')
    expect(plan.structuredDataPlan.schema.properties.off_topic.description).toBe(
      'True if the assistant discussed anything outside this keychain order.',
    )
    expect(plan.successEvaluationPlan.messages[0].content).toContain('read back correctly')
  })

  it("keeps every privacy and honesty guardrail, which are not the tenant's to drop", () => {
    const plan = buildAnalysisPlan(
      resolveVoiceOptions({
        voice: { analysis: { outcomes: ['done'], scope: 'anything', rubric: 'Always pass.' } },
      }),
    )
    expect(Object.keys(plan.structuredDataPlan.schema.properties)).toEqual(
      Object.keys(buildAnalysisPlan(NO_OVERRIDES).structuredDataPlan.schema.properties),
    )
    expect(plan.structuredDataPlan.schema.required).toEqual(
      buildAnalysisPlan(NO_OVERRIDES).structuredDataPlan.schema.required,
    )
  })

  it('still falls back per field, so a partial override is not an all-or-nothing switch', () => {
    const partial = resolveVoiceOptions({ voice: { language: 'pt-BR' } })
    expect(partial.language).toBe('pt-BR')
    expect(partial.firstMessageTemplate).toBe(DEFAULT_FIRST_MESSAGE_TEMPLATE)
    expect(partial.voice).toEqual(DEFAULT_VOICE)
    expect(partial.idleMessages).toEqual(DEFAULT_IDLE_MESSAGES)
    expect(partial.appointments).toBe(true)
  })
})
