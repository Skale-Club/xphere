// tests/prospects-qualify-llm.test.ts
//
// Unit coverage for the LLM-backed qualification + opener path added to
// suggestQualification() (src/app/(dashboard)/prospects/actions.ts).
//
// Tier 1: pure JSON extraction/validation in src/lib/prospects/qualify-llm.ts
//         (no mocking — these are plain functions).
// Tier 2: suggestQualification's fallback contract — when the LLM call
//         throws (mocking generateText from 'ai'), the action must return
//         the deterministic heuristic result with source: 'heuristic' and
//         opener: null, never surfacing the LLM error to the caller.

import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  extractJsonBlock,
  parseLlmQualificationResponse,
  parseQualificationText,
} from '@/lib/prospects/qualify-llm'

// ─── Tier 1 — pure JSON extraction + validation ──────────────────────────────

describe('extractJsonBlock', () => {
  it('parses a raw unfenced JSON object', () => {
    const text = '{"intent_level":"high","qualification_status":"qualified"}'
    expect(extractJsonBlock(text)).toEqual({ intent_level: 'high', qualification_status: 'qualified' })
  })

  it('strips ```json fences', () => {
    const text = '```json\n{"intent_level":"low"}\n```'
    expect(extractJsonBlock(text)).toEqual({ intent_level: 'low' })
  })

  it('strips bare ``` fences (no json tag)', () => {
    const text = '```\n{"intent_level":"medium"}\n```'
    expect(extractJsonBlock(text)).toEqual({ intent_level: 'medium' })
  })

  it('tolerates leading/trailing prose-free whitespace', () => {
    const text = '\n\n  {"intent_level":"none"}  \n'
    expect(extractJsonBlock(text)).toEqual({ intent_level: 'none' })
  })

  it('throws on malformed JSON', () => {
    expect(() => extractJsonBlock('{intent_level: high}')).toThrow()
  })

  it('throws on prose with no JSON at all', () => {
    expect(() => extractJsonBlock('Sure, here is my answer: not qualified.')).toThrow()
  })
})

describe('parseLlmQualificationResponse', () => {
  const valid = {
    intent_level: 'high',
    qualification_status: 'qualified',
    recommended_channel: 'email',
    rationale: 'Replied with interest and has an email on file.',
    opener: 'Hi Jane, noticed your site loads slowly on mobile — happy to show a quick fix.',
  }

  it('accepts a fully valid response and maps to camelCase', () => {
    const result = parseLlmQualificationResponse(valid)
    expect(result).toEqual({
      intentLevel: 'high',
      qualificationStatus: 'qualified',
      recommendedChannel: 'email',
      rationale: valid.rationale,
      opener: valid.opener,
    })
  })

  it('accepts recommended_channel: null', () => {
    const result = parseLlmQualificationResponse({ ...valid, recommended_channel: null })
    expect(result.recommendedChannel).toBeNull()
  })

  it('rejects a non-object payload', () => {
    expect(() => parseLlmQualificationResponse('not an object')).toThrow()
    expect(() => parseLlmQualificationResponse(null)).toThrow()
  })

  it('rejects an invalid intent_level enum value', () => {
    expect(() => parseLlmQualificationResponse({ ...valid, intent_level: 'super-high' })).toThrow(/intent_level/)
  })

  it('rejects an invalid qualification_status enum value', () => {
    expect(() => parseLlmQualificationResponse({ ...valid, qualification_status: 'maybe' })).toThrow(
      /qualification_status/,
    )
  })

  it('rejects an invalid recommended_channel enum value', () => {
    expect(() => parseLlmQualificationResponse({ ...valid, recommended_channel: 'carrier_pigeon' })).toThrow(
      /recommended_channel/,
    )
  })

  it('rejects a missing/empty rationale', () => {
    expect(() => parseLlmQualificationResponse({ ...valid, rationale: '' })).toThrow(/rationale/)
    const { rationale: _drop, ...withoutRationale } = valid
    void _drop
    expect(() => parseLlmQualificationResponse(withoutRationale)).toThrow(/rationale/)
  })

  it('rejects a missing/empty opener', () => {
    expect(() => parseLlmQualificationResponse({ ...valid, opener: '   ' })).toThrow(/opener/)
    const { opener: _drop, ...withoutOpener } = valid
    void _drop
    expect(() => parseLlmQualificationResponse(withoutOpener)).toThrow(/opener/)
  })
})

describe('parseQualificationText', () => {
  it('extracts + validates in one pass for a fenced LLM response', () => {
    const text =
      '```json\n' +
      JSON.stringify({
        intent_level: 'medium',
        qualification_status: 'needs_review',
        recommended_channel: 'whatsapp',
        rationale: 'Opened outreach, phone on file.',
        opener: 'Oi! Vi que seu site nao carrega bem no celular — posso te mostrar uma versao melhor?',
      }) +
      '\n```'
    const result = parseQualificationText(text)
    expect(result.qualificationStatus).toBe('needs_review')
    expect(result.recommendedChannel).toBe('whatsapp')
  })

  it('propagates the underlying parse error for malformed JSON', () => {
    expect(() => parseQualificationText('not json at all')).toThrow()
  })

  it('propagates the underlying validation error for a bad enum', () => {
    const text = JSON.stringify({
      intent_level: 'extreme',
      qualification_status: 'qualified',
      recommended_channel: null,
      rationale: 'x',
      opener: 'y',
    })
    expect(() => parseQualificationText(text)).toThrow(/intent_level/)
  })
})

// ─── Tier 2 — suggestQualification fallback contract ────────────────────────
//
// Mocks every collaborator suggestQualification touches so the test exercises
// the real control flow: auth gate -> fetch prospect row -> try LLM -> catch
// -> heuristic fallback. generateText (from 'ai') is mocked to reject, which
// is what a timeout/network failure looks like from qualifyProspectWithLlm's
// perspective.

vi.mock('ai', () => ({
  generateText: vi.fn().mockRejectedValue(new Error('simulated LLM failure')),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
}))

vi.mock('@/lib/rbac/server', () => ({
  getRbacContext: vi.fn().mockResolvedValue({
    userId: 'user-1',
    orgId: 'org-1',
    role: 'owner',
    isPlatformAdmin: false,
  }),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn().mockReturnValue({}),
}))

// resolveLlmProvider must find a key so the flow reaches generateText (and
// therefore the mocked rejection) instead of short-circuiting on no_llm_key
// — both are "LLM path failed", but this exercises the generateText branch
// specifically, per the task's "mock the 'ai' generateText import" ask.
vi.mock('@/lib/integrations/get-provider-key', () => ({
  getProviderKey: vi.fn().mockResolvedValue('fake-openrouter-key'),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { createClient, getUser } from '@/lib/supabase/server'
import { suggestQualification } from '@/app/(dashboard)/prospects/actions'

const mockGetUser = getUser as ReturnType<typeof vi.fn>
const mockCreateClient = createClient as ReturnType<typeof vi.fn>

function makeSupabase(baseRow: Record<string, unknown>) {
  return {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: baseRow, error: null }),
    rpc: vi.fn().mockResolvedValue({ data: 'org-1', error: null }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('suggestQualification — LLM failure falls back to the heuristic', () => {
  it('returns the heuristic suggestion (source: heuristic, opener: null) for a person prospect when generateText throws', async () => {
    mockGetUser.mockResolvedValue({ id: 'user-1', email: 'owner@acme.com' })
    const baseRow = {
      first_name: 'Jane',
      last_name: 'Doe',
      name: null,
      company: 'Acme Inc',
      engagement_status: 'not_contacted',
      score: 10,
      phone: '+15551234567',
      email: 'jane@acme.com',
      tags: ['vip'],
      custom_fields: { city: 'Austin', state: 'TX' },
      last_replied_at: null,
    }
    mockCreateClient.mockResolvedValue(makeSupabase(baseRow))

    const result = await suggestQualification('person', 'contact-1')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.suggestion.source).toBe('heuristic')
    expect(result.suggestion.opener).toBeNull()
    // Deterministic heuristic, unaffected by the failed LLM call: not
    // contacted + no reply + low score -> low-signal, but reachable by email.
    expect(result.suggestion.recommendedChannel).toBe('email')
    expect(result.suggestion.qualificationStatus).toBe('needs_review')
    expect(result.suggestion.rationale.length).toBeGreaterThan(0)
  })

  it('still returns the heuristic result for a company prospect with no reachable channel', async () => {
    mockGetUser.mockResolvedValue({ id: 'user-1', email: 'owner@acme.com' })
    const baseRow = {
      name: 'Acme Corp',
      engagement_status: 'unsubscribed',
      score: 5,
      phone: null,
      address: null,
      tags: [],
      custom_fields: {},
      last_replied_at: null,
    }
    mockCreateClient.mockResolvedValue(makeSupabase(baseRow))

    const result = await suggestQualification('company', 'account-1')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.suggestion.source).toBe('heuristic')
    expect(result.suggestion.opener).toBeNull()
    expect(result.suggestion.qualificationStatus).toBe('unqualified')
    expect(result.suggestion.recommendedChannel).toBeNull()
  })
})
