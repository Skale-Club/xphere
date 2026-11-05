import { describe, expect, it } from 'vitest'

import { mergeActivityEvents } from '@/lib/dashboard/activity-merge'
import { mergeCampaignContacts, newestUpdatedAt } from '@/lib/campaigns/contact-merge'
import { hasActiveSyncJob, syncJobsSignature } from '@/components/admin/global-knowledge/sync-signature'
import { toPhase } from '@/hooks/use-outbound-call-status'
import type { ActivityFeedEvent } from '@/app/(dashboard)/activity-feed-types'
import type { Database } from '@/types/database'

type ContactRow = Database['public']['Tables']['campaign_contacts']['Row']

function event(id: string, timestamp: string): ActivityFeedEvent {
  return { id, type: 'message', title: id, timestamp }
}

function contact(over: Partial<ContactRow> & { id: string }): ContactRow {
  return {
    campaign_id: 'camp',
    organization_id: 'org',
    name: null,
    phone: '+15550100',
    custom_data: {},
    status: 'pending',
    vapi_call_id: null,
    error_detail: null,
    called_at: null,
    completed_at: null,
    retry_count: 0,
    next_attempt_at: null,
    created_at: '2026-11-05T10:00:00.000000+00:00',
    updated_at: '2026-11-05T10:00:00.000000+00:00',
    ...over,
  } as ContactRow
}

describe('mergeActivityEvents', () => {
  it('returns prev untouched when nothing is new', () => {
    const prev = [event('a', '2026-11-05T10:02:00Z'), event('b', '2026-11-05T10:01:00Z')]
    expect(mergeActivityEvents(prev, [...prev])).toBe(prev)
    expect(mergeActivityEvents(prev, [])).toBe(prev)
  })

  it('puts new events on top, newest first, and keeps loaded-more rows', () => {
    const prev = [event('b', '2026-11-05T10:01:00Z'), event('old', '2026-11-04T10:00:00Z')]
    const merged = mergeActivityEvents(prev, [
      event('c', '2026-11-05T10:03:00Z'),
      event('b', '2026-11-05T10:01:00Z'),
    ])
    expect(merged.map((e) => e.id)).toEqual(['c', 'b', 'old'])
  })

  it('caps the list', () => {
    const prev = [event('a', '2026-11-05T10:00:00Z'), event('b', '2026-11-05T09:00:00Z')]
    const merged = mergeActivityEvents(prev, [event('c', '2026-11-05T11:00:00Z')], 2)
    expect(merged.map((e) => e.id)).toEqual(['c', 'a'])
  })
})

describe('campaign contact merge', () => {
  it('finds the newest updated_at and keeps the original string', () => {
    const newest = '2026-11-05T10:05:00.123456+00:00'
    expect(
      newestUpdatedAt([
        contact({ id: '1' }),
        contact({ id: '2', updated_at: newest }),
        contact({ id: '3', updated_at: '2026-11-05T10:01:00.000000+00:00' }),
      ]),
    ).toBe(newest)
    expect(newestUpdatedAt([])).toBeNull()
  })

  it('merges changed rows in place, field by field, and appends unknown rows', () => {
    const prev = [contact({ id: '1', name: 'Ana' }), contact({ id: '2' })]
    const merged = mergeCampaignContacts(prev, [
      contact({ id: '2', status: 'completed', completed_at: '2026-11-05T10:06:00Z' }),
      contact({ id: '3' }),
    ])
    expect(merged.map((c) => [c.id, c.status])).toEqual([
      ['1', 'pending'],
      ['2', 'completed'],
      ['3', 'pending'],
    ])
    expect(merged[0]).toBe(prev[0])
  })

  it('returns prev when there are no updates', () => {
    const prev = [contact({ id: '1' })]
    expect(mergeCampaignContacts(prev, [])).toBe(prev)
  })
})

describe('knowledge sync signature', () => {
  const job = (id: string, status: string, error_detail: string | null = null) => ({ id, status, error_detail })

  it('changes when a job changes state or error, not when nothing changed', () => {
    const base = [job('j1', 'queued'), job('j0', 'succeeded')]
    expect(syncJobsSignature(base)).toBe(syncJobsSignature([job('j1', 'queued'), job('j0', 'succeeded')]))
    expect(syncJobsSignature(base)).not.toBe(syncJobsSignature([job('j1', 'processing'), job('j0', 'succeeded')]))
    expect(syncJobsSignature([job('j1', 'failed')])).not.toBe(syncJobsSignature([job('j1', 'failed', 'x')]))
    expect(syncJobsSignature([job('j2', 'queued'), ...base])).not.toBe(syncJobsSignature(base))
  })

  it('knows when a job is still active', () => {
    expect(hasActiveSyncJob([{ status: 'succeeded' }, { status: 'failed' }])).toBe(false)
    expect(hasActiveSyncJob([{ status: 'succeeded' }, { status: 'queued' }])).toBe(true)
    expect(hasActiveSyncJob([{ status: 'processing' }])).toBe(true)
  })
})

describe('outbound call status mapping', () => {
  it('maps Twilio statuses to UI phases', () => {
    expect(toPhase('queued')).toBe('initiating')
    expect(toPhase('ringing')).toBe('ringing')
    expect(toPhase('in-progress')).toBe('connected')
    expect(toPhase('completed')).toBe('ended')
    expect(toPhase('no-answer')).toBe('no-answer')
    expect(toPhase(null)).toBe('initiating')
  })
})
