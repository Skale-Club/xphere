import { beforeEach, describe, expect, it, vi } from 'vitest'

const { emitContactEventMock, runFlowSyncMock, runFlowMock, definitionHasWaitMock, resumeMatchingWaitsMock } =
  vi.hoisted(() => ({
    emitContactEventMock: vi.fn(async () => ({ dispatched: 0, dispatch_id: null })),
    runFlowSyncMock: vi.fn(async () => ({ status: 'succeeded' })),
    runFlowMock: vi.fn(async () => ({ runId: 'run-1', status: 'succeeded' })),
    definitionHasWaitMock: vi.fn(() => false),
    resumeMatchingWaitsMock: vi.fn(async () => undefined),
  }))

vi.mock('@/lib/contacts/events', () => ({ emitContactEvent: emitContactEventMock }))
vi.mock('@/lib/workflows/run-flow-sync', () => ({ runFlowSync: runFlowSyncMock }))
vi.mock('@/lib/flows/engine', () => ({
  runFlow: runFlowMock,
  definitionHasWait: definitionHasWaitMock,
}))
vi.mock('@/lib/flows/resume-waits', () => ({ resumeMatchingWaits: resumeMatchingWaitsMock }))

import { emitCommerceEvent, type CommerceOrderData, type CommerceCustomerData } from '@/lib/commerce/events'
import { TRIGGERS } from '@/lib/workflows/spec'

type Row = Record<string, unknown>
interface RecordedCall {
  table: string
  method: string
  args: unknown[]
}

function createSpyClient(config: {
  contactExisting?: Row | null
  contactInsertResult?: Row | null
  eventDispatchResult?: Row | null
  conversationExisting?: Row | null
  workflowsResult?: Row[]
  workflowsReject?: boolean
  versionsResult?: Row[]
} = {}) {
  const calls: RecordedCall[] = []

  function makeQuery(table: string) {
    const q: {
      select: (...args: unknown[]) => typeof q
      eq: (...args: unknown[]) => typeof q
      neq: (...args: unknown[]) => typeof q
      contains: (...args: unknown[]) => typeof q
      order: (...args: unknown[]) => typeof q
      limit: (...args: unknown[]) => typeof q
      in: (...args: unknown[]) => typeof q
      insert: (row: Row) => typeof q
      update: (row: Row) => typeof q
      maybeSingle: () => Promise<{ data: unknown; error: unknown }>
      single: () => Promise<{ data: unknown; error: unknown }>
      then: (resolve: (v: { data: unknown; error: unknown }) => void, reject?: (e: unknown) => void) => void
    } = {
      select(...args: unknown[]) { calls.push({ table, method: 'select', args }); return q },
      eq(...args: unknown[]) { calls.push({ table, method: 'eq', args }); return q },
      neq(...args: unknown[]) { calls.push({ table, method: 'neq', args }); return q },
      contains(...args: unknown[]) { calls.push({ table, method: 'contains', args }); return q },
      order(...args: unknown[]) { calls.push({ table, method: 'order', args }); return q },
      limit(...args: unknown[]) { calls.push({ table, method: 'limit', args }); return q },
      in(...args: unknown[]) { calls.push({ table, method: 'in', args }); return q },
      insert(row: Row) { calls.push({ table, method: 'insert', args: [row] }); return q },
      update(row: Row) { calls.push({ table, method: 'update', args: [row] }); return q },
      async maybeSingle() {
        if (table === 'contacts') return { data: config.contactExisting ?? null, error: null }
        if (table === 'event_dispatches') return { data: config.eventDispatchResult ?? { id: 'disp-1' }, error: null }
        if (table === 'conversations') return { data: config.conversationExisting ?? null, error: null }
        return { data: null, error: null }
      },
      async single() {
        if (table === 'contacts') return { data: config.contactInsertResult ?? { id: 'contact-new' }, error: null }
        return { data: null, error: null }
      },
      then(resolve, reject) {
        if (table === 'workflows') {
          if (config.workflowsReject) {
            (reject ?? (() => {}))(new Error('workflows query failed'))
            return
          }
          resolve({ data: config.workflowsResult ?? [], error: null })
          return
        }
        if (table === 'workflow_versions') {
          resolve({ data: config.versionsResult ?? [], error: null })
          return
        }
        resolve({ data: null, error: null })
      },
    }
    return q
  }

  return {
    client: { from: (table: string) => makeQuery(table) },
    calls,
  }
}

function orderData(overrides: Partial<CommerceOrderData> = {}): CommerceOrderData {
  return {
    order_id: 'order_01H...',
    display_id: 12,
    email: 'a@b.com',
    currency_code: 'eur',
    total: 123.45,
    cart_id: 'cart_9',
    items: [{ title: 'Sweatshirt', variant_id: 'variant_01H...', quantity: 1, unit_price: 35 }],
    ...overrides,
  }
}

function customerData(overrides: Partial<CommerceCustomerData> = {}): CommerceCustomerData {
  return {
    customer_id: 'cus_01H...',
    email: 'x@y.com',
    first_name: 'Jane',
    last_name: 'Doe',
    ...overrides,
  }
}

describe('emitCommerceEvent', () => {
  beforeEach(() => vi.clearAllMocks())

  it('order.placed queries workflows for the mapped event', async () => {
    const spy = createSpyClient({ contactExisting: { id: 'contact-1' } })
    await emitCommerceEvent(spy.client as never, 'org-1', 'rcpt-1', 'order.placed', orderData())

    const workflowCalls = spy.calls.filter((c) => c.table === 'workflows')
    expect(workflowCalls.some((c) => c.method === 'eq' && c.args[0] === 'trigger_type' && c.args[1] === 'event')).toBe(true)
    expect(workflowCalls.some((c) => c.method === 'eq' && c.args[0] === 'health_blocked' && c.args[1] === false)).toBe(true)
    expect(
      workflowCalls.some(
        (c) => c.method === 'contains' && c.args[0] === 'trigger_config' && (c.args[1] as { event: string }).event === 'commerce.order.placed',
      ),
    ).toBe(true)
  })

  it('customer.created maps to commerce.customer.created', async () => {
    const spy = createSpyClient({ contactExisting: { id: 'contact-1' } })
    await emitCommerceEvent(spy.client as never, 'org-1', 'rcpt-1', 'customer.created', customerData())

    const workflowCalls = spy.calls.filter((c) => c.table === 'workflows')
    expect(
      workflowCalls.some(
        (c) => c.method === 'contains' && (c.args[1] as { event: string }).event === 'commerce.customer.created',
      ),
    ).toBe(true)
  })

  it('event_dispatches audit is inserted with the mapped event_type + source_table', async () => {
    const spy = createSpyClient({ contactExisting: { id: 'contact-1' } })
    await emitCommerceEvent(spy.client as never, 'org-1', 'rcpt-1', 'order.placed', orderData())

    const insertCall = spy.calls.find((c) => c.table === 'event_dispatches' && c.method === 'insert')
    expect(insertCall).toBeDefined()
    expect(insertCall!.args[0]).toMatchObject({
      event_type: 'commerce.order.placed',
      source_table: 'commerce_event_receipts',
      source_id: 'rcpt-1',
    })
  })

  it('order.placed annotates the conversation via the `cart` key', async () => {
    const spy = createSpyClient({
      contactExisting: { id: 'contact-1' },
      conversationExisting: { id: 'convo-1', contact_id: 'contact-1', memory: { commerce: { cart: 'cart_9' } } },
    })
    await emitCommerceEvent(spy.client as never, 'org-1', 'rcpt-1', 'order.placed', orderData({ cart_id: 'cart_9', display_id: 12 }))

    const filterCall = spy.calls.find(
      (c) => c.table === 'conversations' && c.method === 'eq' && c.args[0] === 'memory->commerce->>cart',
    )
    expect(filterCall).toBeDefined()
    expect(filterCall!.args[1]).toBe('cart_9')

    const updateCall = spy.calls.find((c) => c.table === 'conversations' && c.method === 'update')
    expect(updateCall).toBeDefined()
    const memory = (updateCall!.args[0] as { memory: { commerce: { last_order_display_id: number } } }).memory
    expect(memory.commerce.last_order_display_id).toBe(12)
  })

  it('customer.created runs NO annotation query', async () => {
    const spy = createSpyClient({ contactExisting: { id: 'contact-1' } })
    await emitCommerceEvent(spy.client as never, 'org-1', 'rcpt-1', 'customer.created', customerData())

    const filterCall = spy.calls.find(
      (c) => c.table === 'conversations' && c.method === 'eq' && c.args[0] === 'memory->commerce->>cart',
    )
    expect(filterCall).toBeUndefined()
  })

  it('order.placed with cart_id null skips annotation', async () => {
    const spy = createSpyClient({ contactExisting: { id: 'contact-1' } })
    await emitCommerceEvent(spy.client as never, 'org-1', 'rcpt-1', 'order.placed', orderData({ cart_id: null }))

    const filterCall = spy.calls.find(
      (c) => c.table === 'conversations' && c.method === 'eq' && c.args[0] === 'memory->commerce->>cart',
    )
    expect(filterCall).toBeUndefined()
  })

  it('find-or-create contact by email — creates when missing, fires contact.created', async () => {
    const spy = createSpyClient({ contactExisting: null, contactInsertResult: { id: 'contact-new' } })
    await emitCommerceEvent(spy.client as never, 'org-1', 'rcpt-1', 'order.placed', orderData({ email: 'new@example.com' }))

    const insertCall = spy.calls.find((c) => c.table === 'contacts' && c.method === 'insert')
    expect(insertCall).toBeDefined()
    expect(insertCall!.args[0]).toMatchObject({ source: 'api', email: 'new@example.com' })
    expect(emitContactEventMock).toHaveBeenCalledOnce()
    expect(emitContactEventMock).toHaveBeenCalledWith('org-1', 'contact.created', 'contact-new', expect.anything())
  })

  it('find-or-create contact by email — no insert, no contact.created when contact already exists', async () => {
    const spy = createSpyClient({ contactExisting: { id: 'contact-1' } })
    await emitCommerceEvent(spy.client as never, 'org-1', 'rcpt-1', 'order.placed', orderData())

    const insertCall = spy.calls.find((c) => c.table === 'contacts' && c.method === 'insert')
    expect(insertCall).toBeUndefined()
    expect(emitContactEventMock).not.toHaveBeenCalled()
  })

  it('money stays major units in the trigger payload', async () => {
    const spy = createSpyClient({
      contactExisting: { id: 'contact-1' },
      workflowsResult: [{ id: 'wf-1', current_version_id: 'v-1' }],
      versionsResult: [{ id: 'v-1', definition: { nodes: [], edges: [] } }],
    })
    definitionHasWaitMock.mockReturnValueOnce(false)

    await emitCommerceEvent(
      spy.client as never,
      'org-1',
      'rcpt-1',
      'order.placed',
      orderData({ total: 123.45, items: [{ title: 'Sweatshirt', variant_id: 'v-1', quantity: 1, unit_price: 35 }] }),
    )

    expect(runFlowSyncMock).toHaveBeenCalledOnce()
    const triggerInput = runFlowSyncMock.mock.calls[0][0].triggerInput as { order: { total: number; items: Array<{ unit_price: number }> } }
    expect(triggerInput.order.total).toBe(123.45)
    expect(triggerInput.order.items[0].unit_price).toBe(35)
  })

  it('never throws — resolves to {dispatched:0, dispatchId:null} when the workflows query rejects', async () => {
    const spy = createSpyClient({ contactExisting: { id: 'contact-1' }, workflowsReject: true })
    const result = await emitCommerceEvent(spy.client as never, 'org-1', 'rcpt-1', 'order.placed', orderData())
    expect(result).toEqual({ dispatched: 0, dispatchId: null })
  })
})

describe('workflow spec TRIGGERS', () => {
  it('registers commerce.order.placed with order.*/contact.*/trigger.fired_at', () => {
    const trigger = TRIGGERS.find((t) => t.type === 'event:commerce.order.placed')
    expect(trigger).toBeDefined()
    expect(trigger!.variables).toEqual(expect.arrayContaining(['order.*', 'contact.*', 'trigger.fired_at']))
  })

  it('registers commerce.customer.created with customer.*/contact.*/trigger.fired_at', () => {
    const trigger = TRIGGERS.find((t) => t.type === 'event:commerce.customer.created')
    expect(trigger).toBeDefined()
    expect(trigger!.variables).toEqual(expect.arrayContaining(['customer.*', 'contact.*', 'trigger.fired_at']))
  })
})
