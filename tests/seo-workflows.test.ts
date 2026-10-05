import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  queueAudit: vi.fn(),
  runFlowSync: vi.fn(async () => ({ ok: true })),
  runFlow: vi.fn(async () => ({ ok: true })),
  resume: vi.fn(async () => {}),
}))

vi.mock('@/lib/seo/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/seo/service')>()
  return { ...actual, queueAudit: mocks.queueAudit }
})
vi.mock('@/lib/workflows/run-flow-sync', () => ({ runFlowSync: mocks.runFlowSync }))
vi.mock('@/lib/flows/engine', () => ({ runFlow: mocks.runFlow, definitionHasWait: () => false }))
vi.mock('@/lib/flows/resume-waits', () => ({ resumeMatchingWaits: mocks.resume }))

import { executeSeoRunAudit } from '@/lib/action-engine/executors/seo-run-audit'
import { emitSeoEvent, type SeoEventPayload } from '@/lib/seo/events'
import { NODES, TRIGGERS, VARIABLE_NAMESPACES } from '@/lib/workflows/spec'
import { SeoServiceError } from '@/lib/seo/service'

describe('seo_run_audit action', () => {
  beforeEach(() => vi.clearAllMocks())

  it('queues an audit tagged as workflow and returns JSON', async () => {
    mocks.queueAudit.mockResolvedValue({ site_id: 's1', host: 'acme.com', audit_id: 'a1', status: 'pending', already_running: false })
    const out = JSON.parse(await executeSeoRunAudit({ site: ' acme.com ' }, { organizationId: 'org-1', supabase: {} as never }))
    expect(out).toMatchObject({ ok: true, audit_id: 'a1' })
    expect(mocks.queueAudit).toHaveBeenCalledWith({}, 'org-1', 'acme.com', 'workflow')
  })

  it('fails clearly without a site or for an unknown one', async () => {
    await expect(executeSeoRunAudit({}, { organizationId: 'org-1', supabase: {} as never })).rejects.toThrow(/"site" is required/)
    mocks.queueAudit.mockRejectedValue(new SeoServiceError('No SEO site matches "x".', 'not_found'))
    await expect(executeSeoRunAudit({ site: 'x' }, { organizationId: 'org-1', supabase: {} as never })).rejects.toThrow(/seo_run_audit: No SEO site/)
  })

  it('is in the workflow spec without an integration requirement', () => {
    const node = NODES.find((n) => n.type === 'seo_run_audit')
    expect(node?.kind).toBe('action')
    expect(node?.integration_required).toBeUndefined()
    expect((node?.params_schema as { required: string[] }).required).toEqual(['site'])
  })
})

describe('SEO workflow events', () => {
  beforeEach(() => vi.clearAllMocks())

  it('declares both triggers and the seo namespace', () => {
    for (const type of ['event:seo.audit_completed', 'event:seo.critical_issue_new']) {
      expect(TRIGGERS.find((t) => t.type === type)?.variables).toContain('seo.*')
    }
    expect(VARIABLE_NAMESPACES.seo).toMatch(/health_score/)
  })

  it('dispatches matching workflows with {event, seo} and audits the dispatch', async () => {
    const inserts: Array<Record<string, unknown>> = []
    const contains: unknown[] = []
    const chain = (rows: unknown) => {
      const q: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'in']) q[m] = () => q
      q.contains = (_c: string, v: unknown) => {
        contains.push(v)
        return q
      }
      q.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve)
      return q
    }
    const sb = {
      from: (table: string) => {
        if (table === 'workflows') return chain([{ id: 'wf1', current_version_id: 'v1' }])
        if (table === 'workflow_versions') return chain([{ id: 'v1', definition: { nodes: [] } }])
        return {
          insert: (row: Record<string, unknown>) => {
            inserts.push(row)
            return { select: () => ({ maybeSingle: async () => ({ data: { id: 'd1' }, error: null }) }) }
          },
        }
      },
    }
    const seo = { site_id: 's1', audit_id: 'a1', health_score: 72, new_issue_count: 2 } as SeoEventPayload

    const res = await emitSeoEvent(sb as never, 'org-1', 'seo.critical_issue_new', seo)
    expect(res).toEqual({ dispatched: 1, dispatchId: 'd1' })
    expect(contains).toEqual([{ event: 'seo.critical_issue_new' }])
    expect(inserts[0]).toMatchObject({ org_id: 'org-1', event_type: 'seo.critical_issue_new', source_table: 'seo_audits', source_id: 'a1', workflow_ids: ['wf1'] })
    expect(mocks.runFlowSync).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: 'wf1', triggerInput: { event: 'seo.critical_issue_new', seo }, context: { orgId: 'org-1' } }),
    )
  })

  it('never throws', async () => {
    const res = await emitSeoEvent({ from: () => { throw new Error('db down') } } as never, 'org-1', 'seo.audit_completed', {} as SeoEventPayload)
    expect(res).toEqual({ dispatched: 0, dispatchId: null })
  })
})
