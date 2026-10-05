// In-memory stand-in for the Supabase client, covering the query-builder
// surface the SEO engine uses. Shared by the SEO engine and GSC sync tests.

import { randomUUID } from 'node:crypto'

export type Row = Record<string, unknown>
export const DEFAULTS: Record<string, Row> = {
  seo_sites: { audit_schedule: 'off', next_audit_at: null, crawl_max_pages: 200 },
  seo_audits: {
    status: 'pending', stage: 'setup', trigger: 'manual', max_pages: 200, pages_discovered: 0, pages_crawled: 0,
    health_score: null, summary: null, site_checks: {}, sitemap_urls: null, attempts: 0, next_attempt_at: null,
    lease_expires_at: null, last_tick_at: null, error_message: null, started_at: null, finished_at: null,
  },
  seo_audit_pages: {
    depth: 0, status: 'queued', in_sitemap: false, http_status: null, redirect_to: null, redirect_hops: 0, links: null,
    title: null, meta_description: null, content_hash: null, canonical: null, indexable: null, content_type: null, outlinks: null,
  },
  seo_audit_issues: { source: 'page', page_id: null, url: null, details: null },
}

export function fakeSupabase() {
  const db: Record<string, Row[]> = {
    seo_sites: [],
    seo_audits: [],
    seo_audit_pages: [],
    seo_audit_issues: [],
    seo_gsc_daily: [],
    seo_gsc_top: [],
  }
  let clock = 0
  const stamp = () => new Date(Date.UTC(2026, 0, 1) + clock++).toISOString()
  const make = (table: string, r: Row): Row => ({ id: randomUUID(), created_at: stamp(), ...(DEFAULTS[table] ?? {}), ...r })

  function builder(table: string) {
    let op: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select'
    let payload: Row[] = []
    let patch: Row = {}
    let upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {}
    let returning = false
    const filters: Array<(r: Row) => boolean> = []
    const orders: Array<[string, boolean]> = []
    let limitN: number | null = null
    let rangeAB: [number, number] | null = null
    let single: 'one' | 'maybe' | null = null

    const run = () => {
      const rows = db[table]
      const match = (r: Row) => filters.every((f) => f(r))
      let result: Row[] = []
      if (op === 'insert') {
        result = payload.map((p) => make(table, p))
        rows.push(...result)
      } else if (op === 'upsert') {
        const keys = (upsertOpts.onConflict ?? 'id').split(',')
        for (const p of payload) {
          const existing = rows.find((r) => keys.every((k) => r[k] === p[k]))
          if (existing) {
            if (!upsertOpts.ignoreDuplicates) Object.assign(existing, p)
          } else {
            const created = make(table, p)
            rows.push(created)
            result.push(created)
          }
        }
      } else if (op === 'update') {
        result = rows.filter(match)
        result.forEach((r) => Object.assign(r, patch))
      } else if (op === 'delete') {
        db[table] = rows.filter((r) => !match(r))
      } else {
        result = rows.filter(match)
        for (const [col, asc] of [...orders].reverse()) {
          result = [...result].sort((a, b) => {
            const x = a[col] as never, y = b[col] as never
            return (x === y ? 0 : x < y ? -1 : 1) * (asc ? 1 : -1)
          })
        }
        if (rangeAB) result = result.slice(rangeAB[0], rangeAB[1] + 1)
        if (limitN !== null) result = result.slice(0, limitN)
      }
      const data = op === 'select' || returning ? result.map((r) => ({ ...r })) : null
      if (single) {
        if (single === 'one' && data?.length !== 1) return { data: null, error: { message: 'not single' } }
        return { data: data?.[0] ?? null, error: null }
      }
      return { data, error: null }
    }

    const q = {
      select: () => { if (op !== 'select') returning = true; return q },
      insert: (rows: Row | Row[]) => { op = 'insert'; payload = [rows].flat(); return q },
      upsert: (rows: Row | Row[], opts = {}) => { op = 'upsert'; payload = [rows].flat(); upsertOpts = opts; return q },
      update: (p: Row) => { op = 'update'; patch = p; return q },
      delete: () => { op = 'delete'; return q },
      eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q },
      neq: (c: string, v: unknown) => { filters.push((r) => r[c] !== v); return q },
      in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return q },
      not: (c: string) => { filters.push((r) => r[c] !== null && r[c] !== undefined); return q },
      order: (c: string, o?: { ascending?: boolean }) => { orders.push([c, o?.ascending ?? true]); return q },
      limit: (n: number) => { limitN = n; return q },
      range: (a: number, b: number) => { rangeAB = [a, b]; return q },
      maybeSingle: () => { single = 'maybe'; return q },
      single: () => { single = 'one'; return q },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve().then(run).then(resolve, reject),
    }
    return q
  }

  const rpc = async (name: string, args: Record<string, number>) => {
    if (name === 'claim_seo_audits') {
      const now = Date.now()
      const claimable = db.seo_audits
        .filter((a) => ['pending', 'running'].includes(a.status as string))
        .filter((a) => !a.lease_expires_at || new Date(a.lease_expires_at as string).getTime() < now)
        .filter((a) => !a.next_attempt_at || new Date(a.next_attempt_at as string).getTime() <= now)
        .slice(0, args.p_limit)
      for (const a of claimable) {
        Object.assign(a, {
          status: 'running',
          started_at: a.started_at ?? new Date().toISOString(),
          lease_expires_at: new Date(now + args.p_lease_seconds * 1000).toISOString(),
          last_tick_at: new Date().toISOString(),
        })
      }
      return { data: claimable.map((a) => ({ ...a })), error: null }
    }
    if (name === 'claim_gsc_syncs') {
      const now = Date.now()
      const due = db.seo_sites
        .filter((s) => s.gsc_property && (!s.gsc_next_sync_at || new Date(s.gsc_next_sync_at as string).getTime() <= now))
        .slice(0, args.p_limit)
      for (const s of due) s.gsc_next_sync_at = new Date(now + 30 * 60_000).toISOString()
      return { data: due.map((s) => ({ ...s })), error: null }
    }
    return { data: 0, error: null }
  }

  return { db, client: { from: builder, rpc } as never }
}

