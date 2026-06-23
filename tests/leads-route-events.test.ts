import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LeadIngestionPayload } from '@/lib/leads/ingestion-schema'

const { ingestLeadMock, emitLeadCapturedMock, emitContactEventMock } = vi.hoisted(() => ({
  ingestLeadMock: vi.fn(),
  emitLeadCapturedMock: vi.fn(),
  emitContactEventMock: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => {
  const updateQuery = {
    update: () => updateQuery,
    eq: () => Promise.resolve({ data: null, error: null }),
  }
  return { createServiceRoleClient: () => ({ from: () => updateQuery }) }
})
vi.mock('@/lib/api-keys/verify', () => ({
  verifyApiKey: vi.fn(async () => ({
    ok: true,
    key: { keyId: 'key-1', orgId: 'org-1', scopes: ['leads:write'] },
  })),
}))
vi.mock('@/lib/leads/ingest', async () => {
  class LeadIngestionConflictError extends Error {}
  return { ingestLead: ingestLeadMock, LeadIngestionConflictError }
})
vi.mock('@/lib/leads/events', () => ({ emitLeadCaptured: emitLeadCapturedMock }))
vi.mock('@/lib/contacts/events', () => ({ emitContactEvent: emitContactEventMock }))

import { POST } from '@/app/api/v1/leads/route'

const payload: LeadIngestionPayload = {
  schema_version: '1.0',
  event_id: 'websites:mvp:event-1',
  occurred_at: '2026-06-20T15:04:05.000Z',
  source: {
    product: 'skaleclub_websites',
    tenant_ref: 'mvp',
    site_domain: 'mvpbuildergroup.com',
    form: 'primary_lead_form',
  },
  contact: { name: 'Jane Smith', email: 'jane@example.com' },
  lead: { status: 'new', answers: { project: 'Kitchen Remodel' } },
}

function request() {
  return new Request('https://xphere.app/api/v1/leads', {
    method: 'POST',
    headers: {
      authorization: 'Bearer xph_test',
      'content-type': 'application/json',
      'idempotency-key': payload.event_id,
    },
    body: JSON.stringify(payload),
  })
}

describe('lead route workflow emission', () => {
  beforeEach(() => vi.clearAllMocks())

  it('emits contact.created and lead.captured for a newly accepted contact', async () => {
    ingestLeadMock.mockResolvedValue({
      receiptId: 'receipt-1',
      contactId: 'contact-1',
      contactAction: 'created',
      eventAction: 'accepted',
    })

    const response = await POST(request())
    expect(response.status).toBe(201)
    expect(emitContactEventMock).toHaveBeenCalledOnce()
    expect(emitLeadCapturedMock).toHaveBeenCalledOnce()
  })

  it('does not emit workflow events for an idempotent replay', async () => {
    ingestLeadMock.mockResolvedValue({
      receiptId: 'receipt-1',
      contactId: 'contact-1',
      contactAction: 'unchanged',
      eventAction: 'duplicate',
    })

    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(emitContactEventMock).not.toHaveBeenCalled()
    expect(emitLeadCapturedMock).not.toHaveBeenCalled()
  })

  it('emits only lead.captured for a repeat inquiry from an existing contact', async () => {
    ingestLeadMock.mockResolvedValue({
      receiptId: 'receipt-2',
      contactId: 'contact-1',
      contactAction: 'updated',
      eventAction: 'accepted',
    })

    const response = await POST(request())
    expect(response.status).toBe(201)
    expect(emitContactEventMock).not.toHaveBeenCalled()
    expect(emitLeadCapturedMock).toHaveBeenCalledOnce()
  })
})
