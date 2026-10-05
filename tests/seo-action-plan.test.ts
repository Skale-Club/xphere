import { beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'

const llm = vi.hoisted(() => ({ create: vi.fn(), meter: vi.fn(async () => ({ allowed: true, balanceAfter: 1 })) }))

vi.mock('@/lib/llm/openrouter', () => ({
  resolveOpenRouterCredential: vi.fn(async () => ({ apiKey: 'k', source: 'platform' })),
  createOpenRouterClient: () => ({ chat: { completions: { create: llm.create } } }),
}))
vi.mock('@/lib/billing/credits', () => ({ meterDebit: llm.meter }))

import { buildPlanPrompt, generateActionPlan, languageName, parsePlan } from '@/lib/seo/action-plan'
import { fakeSupabase } from './helpers/seo-fake-supabase'

describe('parsePlan', () => {
  it('keeps valid actions and rewrites, clamps lists and defaults bad enums', () => {
    const plan = parsePlan({
      summary: '  Fix the broken pages first. ',
      actions: [
        { title: 'Fix 404s', why: 'They get clicks', steps: ['Redirect /old', '', 3], impact: 'huge', effort: 'low', urls: ['https://a.com/old'] },
        { title: 'No steps', why: 'x', steps: [] },
        ...Array.from({ length: 6 }, (_, i) => ({ title: `A${i}`, why: 'w', steps: ['s'], impact: 'low', effort: 'high' })),
      ],
      rewrites: [
        { url: 'https://a.com/', suggested_title: 'Better title', suggested_description: 'Better description' },
        { url: '', suggested_title: 'x', suggested_description: 'y' },
      ],
    })
    expect(plan?.summary).toBe('Fix the broken pages first.')
    expect(plan?.actions).toHaveLength(5)
    expect(plan?.actions[0]).toMatchObject({ title: 'Fix 404s', steps: ['Redirect /old'], impact: 'medium', effort: 'low', issue_codes: [] })
    expect(plan?.rewrites).toEqual([
      { url: 'https://a.com/', current_title: null, suggested_title: 'Better title', current_description: null, suggested_description: 'Better description', target_query: null },
    ])
  })

  it('rejects garbage', () => {
    expect(parsePlan(null)).toBeNull()
    expect(parsePlan({ actions: 'nope' })).toBeNull()
  })
})

describe('prompt', () => {
  it('asks for the user language and embeds the data', () => {
    expect(languageName('pt-BR')).toBe('Brazilian Portuguese')
    expect(languageName('en-US')).toBe('English')
    const prompt = buildPlanPrompt(
      { host: 'acme.com', health_score: 61, pages_crawled: 10, issues: [], search_console: null, rewrite_candidates: [] },
      'pt-BR',
    )
    expect(prompt).toContain('Brazilian Portuguese')
    expect(prompt).toContain('"host":"acme.com"')
    expect(prompt).toMatch(/Never invent URLs/)
  })
})

describe('generateActionPlan', () => {
  beforeEach(() => vi.clearAllMocks())

  function seed() {
    const { db, client } = fakeSupabase()
    const site = { id: randomUUID(), org_id: 'org', host: 'acme.com', gsc_property: null }
    db.seo_sites.push(site)
    const audit = {
      id: randomUUID(),
      org_id: 'org',
      site_id: site.id,
      status: 'completed',
      health_score: 61,
      pages_crawled: 3,
      summary: { by_code: { http_4xx: 1, title_length: 1, lang_missing: 2 } },
      created_at: '2026-01-01',
    }
    db.seo_audits.push(audit)
    const page = { id: randomUUID(), audit_id: audit.id, url: 'https://acme.com/a', title: 'A', meta_description: null }
    db.seo_audit_pages.push(page)
    db.seo_audit_issues.push(
      { id: randomUUID(), audit_id: audit.id, page_id: null, url: 'https://acme.com/gone', code: 'http_4xx', severity: 'error' },
      { id: randomUUID(), audit_id: audit.id, page_id: page.id, url: 'https://acme.com/a', code: 'title_length', severity: 'warning' },
    )
    return { db, client, site, audit }
  }

  it('builds context from the latest audit, meters usage and stores the plan', async () => {
    const { db, client, site, audit } = seed()
    llm.create.mockResolvedValue({
      usage: { prompt_tokens: 2000, completion_tokens: 500 },
      choices: [
        {
          message: {
            tool_calls: [
              {
                type: 'function',
                function: {
                  name: 'record_action_plan',
                  arguments: JSON.stringify({
                    summary: 'One broken page.',
                    actions: [{ title: 'Fix /gone', why: 'http_4xx', steps: ['301 it'], impact: 'high', effort: 'low', issue_codes: ['http_4xx'], urls: ['https://acme.com/gone'] }],
                    rewrites: [{ url: 'https://acme.com/a', current_title: 'A', suggested_title: 'Acme services in Boston', suggested_description: 'x'.repeat(100) }],
                  }),
                },
              },
            ],
          },
        },
      ],
    })

    const plan = await generateActionPlan(client, 'org', site.id, 'pt-BR')
    expect(plan.actions[0].title).toBe('Fix /gone')
    expect(plan.locale).toBe('pt-BR')
    expect((db.seo_audits.find((a) => a.id === audit.id)!.action_plan as { summary: string }).summary).toBe('One broken page.')
    expect(llm.meter).toHaveBeenCalledWith('org', 'seo_action_plan', expect.any(Number), null)

    const prompt = llm.create.mock.calls[0][0].messages[0].content as string
    // Most severe issue first, with real example URLs; the title issue makes /a a rewrite candidate.
    expect(prompt.indexOf('http_4xx')).toBeLessThan(prompt.indexOf('title_length'))
    expect(prompt).toContain('https://acme.com/gone')
    expect(prompt).toContain('"rewrite_candidates":[{"url":"https://acme.com/a"')
  })

  it('fails without a completed audit and on unusable output', async () => {
    const { client, site, db } = seed()
    llm.create.mockResolvedValue({ usage: { prompt_tokens: 10, completion_tokens: 10 }, choices: [{ message: { tool_calls: [] } }] })
    await expect(generateActionPlan(client, 'org', site.id, 'en')).rejects.toThrow(/usable plan/)
    expect(llm.meter).toHaveBeenCalled()

    db.seo_audits.length = 0
    await expect(generateActionPlan(client, 'org', site.id, 'en')).rejects.toThrow(/Run an audit first/)
  })
})
