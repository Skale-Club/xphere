import { describe, expect, it } from 'vitest'
import { ingestLead, LeadIngestionConflictError } from '@/lib/leads/ingest'
import type { LeadIngestionPayload } from '@/lib/leads/ingestion-schema'

type Row = Record<string, unknown>

function createMemoryClient() {
  const contacts: Row[] = []
  const receipts: Row[] = []
  let sequence = 0

  class Query {
    private operation: 'select' | 'insert' | 'update' = 'select'
    private values: Row = {}
    private filters: Array<[string, unknown, boolean]> = []

    constructor(private readonly table: string) {}
    select() { return this }
    insert(values: Row) { this.operation = 'insert'; this.values = values; return this }
    update(values: Row) { this.operation = 'update'; this.values = values; return this }
    eq(column: string, value: unknown) { this.filters.push([column, value, true]); return this }
    neq(column: string, value: unknown) { this.filters.push([column, value, false]); return this }

    private rows(): Row[] {
      return this.table === 'contacts' ? contacts : receipts
    }

    private matches(row: Row): boolean {
      return this.filters.every(([column, value, equal]) => equal ? row[column] === value : row[column] !== value)
    }

    private execute() {
      if (this.operation === 'update') {
        for (const row of this.rows().filter((item) => this.matches(item))) Object.assign(row, this.values)
      }
      return { data: null, error: null }
    }

    then(resolve: (value: { data: null; error: null }) => void) { resolve(this.execute()) }

    async maybeSingle() {
      return { data: this.rows().find((row) => this.matches(row)) ?? null, error: null }
    }

    async single() {
      if (this.operation !== 'insert') return { data: null, error: new Error('Unsupported operation') }
      const row: Row = { id: `${this.table}-${++sequence}`, ...this.values }
      if (this.table === 'contacts') {
        row.phone_e164 = row.phone
        row.email_normalized = typeof row.email === 'string' ? row.email.toLowerCase() : null
        row.identity_status = 'identified'
        contacts.push(row)
      } else {
        const duplicate = receipts.find((item) =>
          item.org_id === row.org_id &&
          item.source_product === row.source_product &&
          item.external_event_id === row.external_event_id,
        )
        if (duplicate) return { data: null, error: { code: '23505' } }
        receipts.push(row)
      }
      return { data: row, error: null }
    }
  }

  return {
    client: { from: (table: string) => new Query(table) },
    contacts,
    receipts,
  }
}

function payload(eventId: string, project = 'Kitchen Remodel'): LeadIngestionPayload {
  return {
    schema_version: '1.0',
    event_id: eventId,
    occurred_at: '2026-06-20T15:04:05.000Z',
    source: {
      product: 'skaleclub_websites',
      tenant_ref: 'mvp',
      site_domain: 'mvpbuildergroup.com',
      form: 'primary_lead_form',
    },
    contact: { name: 'Jane Smith', email: 'JANE@example.com', phone: '+1 (305) 555-0199' },
    lead: { status: 'new', answers: { project } },
  }
}

describe('ingestLead', () => {
  it('creates one contact and one receipt, then treats an identical replay as a duplicate', async () => {
    const memory = createMemoryClient()
    const first = await ingestLead(memory.client as never, 'org-a', payload('event-1'))
    const replay = await ingestLead(memory.client as never, 'org-a', payload('event-1'))

    expect(first).toMatchObject({ contactAction: 'created', eventAction: 'accepted' })
    expect(replay).toMatchObject({ receiptId: first.receiptId, contactId: first.contactId, eventAction: 'duplicate' })
    expect(memory.contacts).toHaveLength(1)
    expect(memory.receipts).toHaveLength(1)
  })

  it('keeps one contact while preserving two unique submissions', async () => {
    const memory = createMemoryClient()
    const first = await ingestLead(memory.client as never, 'org-a', payload('event-1'))
    const second = await ingestLead(memory.client as never, 'org-a', payload('event-2', 'Bathroom Remodel'))

    expect(second).toMatchObject({ contactId: first.contactId, contactAction: 'updated', eventAction: 'accepted' })
    expect(memory.contacts).toHaveLength(1)
    expect(memory.receipts).toHaveLength(2)
  })

  it('rejects reuse of an event ID with a different payload', async () => {
    const memory = createMemoryClient()
    await ingestLead(memory.client as never, 'org-a', payload('event-1'))
    await expect(ingestLead(memory.client as never, 'org-a', payload('event-1', 'Roofing')))
      .rejects.toBeInstanceOf(LeadIngestionConflictError)
  })

  it('isolates identical event IDs by organization', async () => {
    const memory = createMemoryClient()
    await ingestLead(memory.client as never, 'org-a', payload('event-1'))
    await ingestLead(memory.client as never, 'org-b', payload('event-1'))
    expect(memory.contacts).toHaveLength(2)
    expect(memory.receipts).toHaveLength(2)
  })
})
