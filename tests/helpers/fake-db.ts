// Minimal chainable fake of the supabase-js query builder, for the Edge Function
// ports. Every awaited query is recorded and answered by `respond`.

export interface FakeCall {
  table: string
  op: 'select' | 'insert' | 'update' | 'delete' | 'upsert'
  payload?: unknown
  columns?: string
  filters: Array<[string, string, unknown]>
}

export type Reply = { data?: unknown; error?: { message: string } | null }

export function fakeDb(respond: (call: FakeCall) => Reply | undefined, rpc?: (name: string) => Reply) {
  const calls: FakeCall[] = []

  function builder(table: string) {
    const call: FakeCall = { table, op: 'select', filters: [] }
    const settle = (): Promise<{ data: unknown; error: unknown }> => {
      calls.push(call)
      const r = respond(call) ?? {}
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null })
    }
    const q: Record<string, unknown> = {
      select(columns?: string) {
        // select() after insert/update keeps the write op
        if (call.op === 'select') call.columns = columns
        return q
      },
      insert(payload: unknown) { call.op = 'insert'; call.payload = payload; return q },
      update(payload: unknown) { call.op = 'update'; call.payload = payload; return q },
      upsert(payload: unknown) { call.op = 'upsert'; call.payload = payload; return q },
      delete() { call.op = 'delete'; return q },
      eq(c: string, v: unknown) { call.filters.push([c, 'eq', v]); return q },
      in(c: string, v: unknown) { call.filters.push([c, 'in', v]); return q },
      ilike(c: string, v: unknown) { call.filters.push([c, 'ilike', v]); return q },
      limit() { return q },
      single: settle,
      maybeSingle: settle,
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        return settle().then(resolve, reject)
      },
    }
    return q
  }

  const db = {
    from: (table: string) => builder(table),
    rpc: (name: string) => {
      calls.push({ table: `rpc:${name}`, op: 'select', filters: [] })
      const r = rpc?.(name) ?? {}
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null })
    },
  }
  return { db: db as never, calls }
}

export const writes = (calls: FakeCall[], table: string, op: FakeCall['op']) =>
  calls.filter((c) => c.table === table && c.op === op)
