import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// send_email_template must route through sendTenantEmail (suppression list,
// compliance footer, List-Unsubscribe headers) instead of the platform sender.
vi.mock('@/lib/email/resend', () => ({
  sendTenantEmail: vi.fn(),
}))

import { sendTenantEmail } from '@/lib/email/resend'
import { executeSendEmailTemplate } from '@/lib/action-engine/executors/send-email-template'

// ---- Mock Supabase query chain: .from('email_templates').select().eq().eq().maybeSingle() ----
function makeSupabase(templateResult: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(templateResult)
  const eq2 = vi.fn().mockReturnValue({ maybeSingle })
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
  const select = vi.fn().mockReturnValue({ eq: eq1 })
  const from = vi.fn().mockReturnValue({ select })
  return { from } as unknown as SupabaseClient<Database>
}

function makeTemplateRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tpl-1',
    name: 'Welcome Email',
    status: 'published',
    html_snapshot: '<p>Hi {{contact.first_name}}</p>',
    plain_text_snapshot: 'Hi {{contact.first_name}}',
    ...overrides,
  }
}

const ORG_ID = 'org-1'

describe('send_email_template executor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects a draft template without allow_draft', async () => {
    const supabase = makeSupabase({ data: makeTemplateRow({ status: 'draft' }), error: null })

    await expect(
      executeSendEmailTemplate(
        { template_id: 'tpl-1', to: 'a@example.com', subject: 'Hello' },
        ORG_ID,
        supabase,
      ),
    ).rejects.toThrow(/publish the template first or pass allow_draft: true/)

    expect(sendTenantEmail).not.toHaveBeenCalled()
  })

  it('sends a draft template when allow_draft is true', async () => {
    const supabase = makeSupabase({ data: makeTemplateRow({ status: 'draft' }), error: null })
    vi.mocked(sendTenantEmail).mockResolvedValue({ id: 'em_draft' })

    const result = await executeSendEmailTemplate(
      { template_id: 'tpl-1', to: 'a@example.com', subject: 'Hello', allow_draft: true },
      ORG_ID,
      supabase,
    )

    expect(result).toContain('em_draft')
    expect(sendTenantEmail).toHaveBeenCalledOnce()
  })

  it('rejects a missing or empty subject', async () => {
    const supabase = makeSupabase({ data: makeTemplateRow(), error: null })

    await expect(
      executeSendEmailTemplate({ template_id: 'tpl-1', to: 'a@example.com' }, ORG_ID, supabase),
    ).rejects.toThrow(/requires "subject"/)

    await expect(
      executeSendEmailTemplate(
        { template_id: 'tpl-1', to: 'a@example.com', subject: '   ' },
        ORG_ID,
        supabase,
      ),
    ).rejects.toThrow(/requires "subject"/)

    expect(sendTenantEmail).not.toHaveBeenCalled()
  })

  it('rejects an invalid "kind" value', async () => {
    const supabase = makeSupabase({ data: makeTemplateRow(), error: null })

    await expect(
      executeSendEmailTemplate(
        { template_id: 'tpl-1', to: 'a@example.com', subject: 'Hi', kind: 'bulk' },
        ORG_ID,
        supabase,
      ),
    ).rejects.toThrow(/invalid "kind"/)

    expect(sendTenantEmail).not.toHaveBeenCalled()
  })

  it('returns a distinct "skipped" message instead of throwing when the recipient is suppressed', async () => {
    const supabase = makeSupabase({ data: makeTemplateRow(), error: null })
    vi.mocked(sendTenantEmail).mockResolvedValue({ skipped: true })

    const result = await executeSendEmailTemplate(
      { template_id: 'tpl-1', to: 'unsubbed@example.com', subject: 'Hello' },
      ORG_ID,
      supabase,
    )

    expect(result).toMatch(/skipped/i)
    expect(result).toContain('unsubbed@example.com')
  })

  it('happy path: calls sendTenantEmail with kind "marketing" (default) and the rendered text part', async () => {
    const supabase = makeSupabase({ data: makeTemplateRow(), error: null })
    vi.mocked(sendTenantEmail).mockResolvedValue({ id: 'em_123' })

    const result = await executeSendEmailTemplate(
      {
        template_id: 'tpl-1',
        to: 'ana@example.com',
        subject: 'Welcome, {{contact.first_name}}!',
        variables: { contact: { first_name: 'Ana' } },
      },
      ORG_ID,
      supabase,
    )

    expect(sendTenantEmail).toHaveBeenCalledWith(
      ORG_ID,
      'ana@example.com',
      'Welcome, Ana!',
      '<p>Hi Ana</p>',
      undefined,
      { kind: 'marketing', text: 'Hi Ana' },
    )
    expect(result).toContain('em_123')
  })

  it('honours the "transactional" escape hatch', async () => {
    const supabase = makeSupabase({ data: makeTemplateRow(), error: null })
    vi.mocked(sendTenantEmail).mockResolvedValue({ id: 'em_txn' })

    await executeSendEmailTemplate(
      { template_id: 'tpl-1', to: 'a@example.com', subject: 'Receipt', kind: 'transactional' },
      ORG_ID,
      supabase,
    )

    expect(sendTenantEmail).toHaveBeenCalledWith(
      ORG_ID,
      'a@example.com',
      'Receipt',
      expect.any(String),
      undefined,
      expect.objectContaining({ kind: 'transactional' }),
    )
  })

  it('propagates sendTenantEmail errors', async () => {
    const supabase = makeSupabase({ data: makeTemplateRow(), error: null })
    vi.mocked(sendTenantEmail).mockResolvedValue({ error: 'Tenant email integration not configured' })

    await expect(
      executeSendEmailTemplate({ template_id: 'tpl-1', to: 'a@example.com', subject: 'Hi' }, ORG_ID, supabase),
    ).rejects.toThrow(/Tenant email integration not configured/)
  })
})
