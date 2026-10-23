import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Structural check of migration 1332: Xphere -> Xpot task delivery is scoped
// to orgs that connected Xpot in Integrations, not every tenant.
const sql = fs.readFileSync(
  path.join(process.cwd(), 'supabase', 'migrations', '1332_xpot_per_org_integration.sql'),
  'utf-8',
)

describe('migration 1332 — Xpot per-org integration', () => {
  it('adds xpot to integration_provider', () => {
    expect(sql).toContain(`ALTER TYPE public.integration_provider ADD VALUE IF NOT EXISTS 'xpot';`)
  })

  it('queues a task only when its org has an active Xpot integration, before any other rule', () => {
    const body = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.enqueue_xpot_task_sync()'))
    const guard = body.indexOf(`i.provider::text = 'xpot'`)
    expect(guard).toBeGreaterThan(0)
    expect(body.slice(guard, guard + 80)).toContain('i.is_active')
    expect(guard).toBeLessThan(body.indexOf('INSERT INTO public.xpot_task_sync_outbox'))
  })

  it('closes, rather than deletes, rows already queued for unconnected orgs', () => {
    expect(sql).toMatch(/UPDATE public\.xpot_task_sync_outbox[\s\S]*status = 'failed'/)
    expect(sql).not.toMatch(/DELETE FROM public\.xpot_task_sync_outbox/)
  })
})
