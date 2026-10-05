import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  canInOrg: vi.fn(),
  queueAudit: vi.fn(),
  listSites: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient: () => ({}) }))
vi.mock('@/lib/rbac/service-role', () => ({ userCanInOrg: mocks.canInOrg }))
vi.mock('@/lib/seo/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/seo/service')>()
  return { ...actual, queueAudit: mocks.queueAudit, listSites: mocks.listSites }
})

import { seoTools } from '@/lib/mcp/tools/seo'
import { ALL_MCP_TOOLS } from '@/lib/mcp/registry'
import { SeoServiceError } from '@/lib/seo/service'

const auth = { kind: 'oauth', orgId: 'org-1', userId: 'user-1', actor: 'x', scope: 'mcp' } as never
const tool = (name: string) => seoTools.find((t) => t.name === name)!

describe('SEO MCP tools', () => {
  beforeEach(() => vi.clearAllMocks())

  it('are registered on the MCP server', () => {
    const names = ALL_MCP_TOOLS.map((t) => t.name)
    for (const t of seoTools) expect(names).toContain(t.name)
  })

  it('lists sites for the caller org', async () => {
    mocks.listSites.mockResolvedValue([{ id: 's1' }])
    expect(await tool('seo_list_sites').handler({}, { auth })).toEqual({ sites: [{ id: 's1' }] })
    expect(mocks.listSites).toHaveBeenCalledWith(expect.anything(), 'org-1')
  })

  it('refuses to run an audit without seo.manage', async () => {
    mocks.canInOrg.mockResolvedValue(false)
    const res = await tool('seo_run_audit').handler({ site: 'acme.com' }, { auth })
    expect(res).toMatchObject({ error: 'forbidden', status: 403 })
    expect(mocks.queueAudit).not.toHaveBeenCalled()
  })

  it('queues an audit tagged as mcp', async () => {
    mocks.canInOrg.mockResolvedValue(true)
    mocks.queueAudit.mockResolvedValue({ audit_id: 'a1', already_running: false })
    const res = await tool('seo_run_audit').handler({ site: 'acme.com' }, { auth })
    expect(res).toEqual({ audit_id: 'a1', already_running: false })
    expect(mocks.canInOrg).toHaveBeenCalledWith('user-1', 'org-1', 'seo.manage')
    expect(mocks.queueAudit).toHaveBeenCalledWith(expect.anything(), 'org-1', 'acme.com', 'mcp', 'user-1')
  })

  it('maps an unknown site to not_found', async () => {
    mocks.canInOrg.mockResolvedValue(true)
    mocks.queueAudit.mockRejectedValue(new SeoServiceError('No SEO site matches "x".', 'not_found'))
    expect(await tool('seo_run_audit').handler({ site: 'x' }, { auth })).toMatchObject({ error: 'not_found', status: 404 })
  })
})
