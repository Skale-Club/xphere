import { describe, expect, it } from 'vitest'
import { decidePermission } from '@/lib/rbac/decide'

const base = { isPlatformAdmin: false, hasOrg: true, permissionKey: 'seo.manage' }

describe('decidePermission', () => {
  it('lets platform admins and owners through', () => {
    expect(decidePermission({ ...base, role: null, isPlatformAdmin: true, grants: [] })).toBe(true)
    expect(decidePermission({ ...base, role: 'owner', grants: [{ permission_key: 'seo.manage', enabled: false, role: 'owner' }] })).toBe(true)
  })

  it('denies non-members and missing orgs', () => {
    expect(decidePermission({ ...base, role: null, grants: [] })).toBe(false)
    expect(decidePermission({ ...base, role: 'admin', hasOrg: false, grants: [] })).toBe(false)
  })

  it('is unrestricted until the org saves an RBAC configuration', () => {
    expect(decidePermission({ ...base, role: 'member', grants: [] })).toBe(true)
    expect(decidePermission({ ...base, role: 'member', grants: null })).toBe(true)
  })

  it('uses the stored grants, then role defaults', () => {
    const grants = [
      { permission_key: 'seo.manage', enabled: true, role: 'admin' },
      { permission_key: 'seo.manage', enabled: false, role: 'member' },
    ]
    expect(decidePermission({ ...base, role: 'admin', grants })).toBe(true)
    expect(decidePermission({ ...base, role: 'member', grants })).toBe(false)
    // Member has no rows of its own → DEFAULT_ROLE_PERMISSIONS (seo.manage is not a member default).
    expect(decidePermission({ ...base, role: 'member', grants: grants.slice(0, 1) })).toBe(false)
    expect(decidePermission({ ...base, role: 'member', permissionKey: 'chat.view', grants: grants.slice(0, 1) })).toBe(true)
  })
})
