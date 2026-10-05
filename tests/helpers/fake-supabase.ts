// Minimal in-memory stand-in for the supabase-js query builder, enough to run
// server modules (e.g. the Local SEO worker) end to end without a database.
// Supports select/insert/update/delete/upsert with eq/neq/in/is/not/lt/lte/
// gt/gte filters, order, limit, range, single/maybeSingle, count, and rpc()
// handlers supplied by the test. Column projections are ignored (full rows
// come back), which is fine for assertions.

import { randomUUID } from 'node:crypto'

type Row = Record<string, unknown>
type Filter = (r: Row) => boolean
type Defaults = (table: string, row: Row) => Row
type RpcHandler = (args: Record<string, unknown>, db: FakeDb) => unknown

export class FakeDb {
  tables = new Map<string, Row[]>()
  rpcs = new Map<string, RpcHandler>()
  private seq = 0
  constructor(private defaults: Defaults = (_t, r) => r) {}

  rows(table: string): Row[] {
    if (!this.tables.has(table)) this.tables.set(table, [])
    return this.tables.get(table)!
  }

  withDefaults(table: string, row: Row): Row {
    const now = new Date().toISOString()
    return this.defaults(table, { id: row.id ?? (table.endsWith('serp_results') ? ++this.seq : randomUUID()), created_at: now, ...row })
  }

  from(table: string) {
    return new Query(this, table)
  }

  async rpc(name: string, args: Record<string, unknown>) {
    const h = this.rpcs.get(name)
    if (!h) return { data: null, error: { message: `rpc ${name} not faked` } }
    return { data: h(args, this), error: null }
  }
}

class Query implements PromiseLike<{ data: unknown; error: unknown; count?: number | null }> {
  private op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select'
  private payload: Row | Row[] | null = null
  private filters: Filter[] = []
  private orders: { col: string; asc: boolean }[] = []
  private limitN: number | null = null
  private rangeFrom: number | null = null
  private rangeTo: number | null = null
  private mode: 'many' | 'single' | 'maybe' = 'many'
  private returning = false
  private wantCount = false
  private upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {}

  constructor(
    private db: FakeDb,
    private table: string,
  ) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (this.op === 'select') this.op = 'select'
    else this.returning = true
    if (opts?.count) this.wantCount = true
    return this
  }
  insert(p: Row | Row[]) {
    this.op = 'insert'
    this.payload = p
    return this
  }
  update(p: Row) {
    this.op = 'update'
    this.payload = p
    return this
  }
  upsert(p: Row | Row[], opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
    this.op = 'upsert'
    this.payload = p
    this.upsertOpts = opts
    return this
  }
  delete(opts?: { count?: string }) {
    this.op = 'delete'
    if (opts?.count) this.wantCount = true
    return this
  }
  eq(c: string, v: unknown) {
    this.filters.push((r) => r[c] === v)
    return this
  }
  neq(c: string, v: unknown) {
    this.filters.push((r) => r[c] !== v)
    return this
  }
  in(c: string, vs: unknown[]) {
    this.filters.push((r) => vs.includes(r[c]))
    return this
  }
  is(c: string, v: null) {
    this.filters.push((r) => (r[c] ?? null) === v)
    return this
  }
  not(c: string, op: string, v: unknown) {
    if (op !== 'is') throw new Error(`not(${op}) not faked`)
    this.filters.push((r) => (r[c] ?? null) !== v)
    return this
  }
  lt(c: string, v: never) {
    this.filters.push((r) => r[c] != null && (r[c] as never) < v)
    return this
  }
  lte(c: string, v: never) {
    this.filters.push((r) => r[c] != null && (r[c] as never) <= v)
    return this
  }
  gt(c: string, v: never) {
    this.filters.push((r) => r[c] != null && (r[c] as never) > v)
    return this
  }
  gte(c: string, v: never) {
    this.filters.push((r) => r[c] != null && (r[c] as never) >= v)
    return this
  }
  contains() {
    return this
  }
  order(col: string, opts: { ascending?: boolean } = {}) {
    this.orders.push({ col, asc: opts.ascending !== false })
    return this
  }
  limit(n: number) {
    this.limitN = n
    return this
  }
  range(a: number, b: number) {
    this.rangeFrom = a
    this.rangeTo = b
    return this
  }
  single() {
    this.mode = 'single'
    return this
  }
  maybeSingle() {
    this.mode = 'maybe'
    return this
  }

  private matched(): Row[] {
    return this.db.rows(this.table).filter((r) => this.filters.every((f) => f(r)))
  }

  private shape(rows: Row[]) {
    let out = [...rows]
    for (const o of [...this.orders].reverse()) {
      out.sort((x, y) => {
        const a = x[o.col] as never
        const b = y[o.col] as never
        if (a === b) return 0
        return (a < b ? -1 : 1) * (o.asc ? 1 : -1)
      })
    }
    if (this.rangeFrom !== null) out = out.slice(this.rangeFrom, (this.rangeTo ?? out.length) + 1)
    if (this.limitN !== null) out = out.slice(0, this.limitN)
    return out
  }

  private finish(rows: Row[] | null, count?: number) {
    const clone = rows?.map((r) => ({ ...r })) ?? null
    if (this.mode === 'many') return { data: clone, error: null, count: this.wantCount ? (count ?? clone?.length ?? 0) : null }
    if (!clone || clone.length === 0) {
      return this.mode === 'single'
        ? { data: null, error: { message: 'no rows', code: 'PGRST116' } }
        : { data: null, error: null }
    }
    if (clone.length > 1) return { data: null, error: { message: 'multiple rows', code: 'PGRST116' } }
    return { data: clone[0], error: null }
  }

  private run() {
    const rows = this.db.rows(this.table)
    switch (this.op) {
      case 'select':
        return this.finish(this.shape(this.matched()))
      case 'insert': {
        const list = (Array.isArray(this.payload) ? this.payload : [this.payload!]).map((r) => this.db.withDefaults(this.table, r))
        rows.push(...list)
        return this.finish(this.returning ? list : null)
      }
      case 'upsert': {
        const keys = (this.upsertOpts.onConflict ?? 'id').split(',')
        const out: Row[] = []
        for (const raw of Array.isArray(this.payload) ? this.payload : [this.payload!]) {
          const existing = rows.find((r) => keys.every((k) => r[k] === raw[k]))
          if (existing) {
            if (!this.upsertOpts.ignoreDuplicates) Object.assign(existing, raw)
            out.push(existing)
          } else {
            const row = this.db.withDefaults(this.table, raw)
            rows.push(row)
            out.push(row)
          }
        }
        return this.finish(this.returning ? out : null)
      }
      case 'update': {
        const hit = this.matched()
        for (const r of hit) Object.assign(r, this.payload)
        return this.finish(this.returning ? hit : null)
      }
      case 'delete': {
        const hit = this.matched()
        this.db.tables.set(this.table, rows.filter((r) => !hit.includes(r)))
        return this.finish(this.returning ? hit : null, hit.length)
      }
    }
  }

  then<T1 = { data: unknown; error: unknown }, T2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown; count?: number | null }) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve()
      .then(() => this.run())
      .then(onfulfilled, onrejected)
  }
}
