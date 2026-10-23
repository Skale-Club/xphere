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

  it('defines a connected org as one with an active xpot integration', () => {
    const fn = sql.slice(sql.indexOf('FUNCTION public.org_has_xpot'), sql.indexOf('REVOKE ALL ON FUNCTION public.org_has_xpot'))
    expect(fn).toContain(`i.provider::text = 'xpot'`)
    expect(fn).toContain('i.is_active')
  })

  it('drops outbox events of unconnected orgs before they are inserted', () => {
    expect(sql).toMatch(/BEFORE INSERT ON public\.xpot_task_sync_outbox[\s\S]*skip_xpot_sync_without_integration/)
    expect(sql).toMatch(/IF NOT public\.org_has_xpot\(NEW\.org_id\) THEN RETURN NULL;/)
  })

  it('closes, rather than deletes, rows already queued for unconnected orgs', () => {
    expect(sql).toMatch(/UPDATE public\.xpot_task_sync_outbox[\s\S]*status = 'failed'[\s\S]*NOT public\.org_has_xpot\(org_id\)/)
    expect(sql).not.toMatch(/DELETE FROM public\.xpot_task_sync_outbox/)
  })
})
