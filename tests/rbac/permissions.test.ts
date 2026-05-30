// tests/rbac/permissions.test.ts
// Unit tests for the RBAC permission catalog + pure config helpers
// (Roles, Permissions & Access Control project). No DB — pure functions only.

import { describe, it, expect } from 'vitest'

import {
  PERMISSION_GROUPS,
  ALL_PERMISSION_KEYS,
  ORG_PERMISSION_KEYS,
  DEFAULT_ROLE_PERMISSIONS,
  SEALED_GROUPS,
  ADMIN_SEAL_EXEMPT_GROUPS,
  CONFIGURABLE_ROLES,
  resolveRoleConfig,
  buildPermissionRows,
  isValidPermissionKey,
} from '@/lib/rbac/permissions'

describe('RBAC catalog invariants', () => {
  it('has no duplicate permission keys', () => {
    const seen = new Set<string>()
    for (const key of ALL_PERMISSION_KEYS) {
      expect(seen.has(key), `duplicate key: ${key}`).toBe(false)
      seen.add(key)
    }
  })

  it('every permission key is <group>.<action> and group-prefixed', () => {
    for (const group of PERMISSION_GROUPS) {
      for (const p of group.permissions) {
        expect(p.key.startsWith(`${group.key}.`), `${p.key} not under ${group.key}`).toBe(true)
      }
    }
  })

  it('ORG_PERMISSION_KEYS excludes platform-only group keys', () => {
    const platformKeys = PERMISSION_GROUPS.filter((g) => g.platformOnly).flatMap((g) =>
      g.permissions.map((p) => p.key),
    )
    expect(platformKeys.length).toBeGreaterThan(0)
    for (const k of platformKeys) expect(ORG_PERMISSION_KEYS).not.toContain(k)
  })

  it('ALL_PERMISSION_KEYS is a superset of ORG_PERMISSION_KEYS', () => {
    for (const k of ORG_PERMISSION_KEYS) expect(ALL_PERMISSION_KEYS).toContain(k)
  })

  it('admin default grants every org permission; member defaults are a valid subset', () => {
    expect([...DEFAULT_ROLE_PERMISSIONS.admin].sort()).toEqual([...ORG_PERMISSION_KEYS].sort())
    for (const k of DEFAULT_ROLE_PERMISSIONS.member) {
      expect(ORG_PERMISSION_KEYS, `member default ${k} not a real org key`).toContain(k)
    }
  })

  it('admin seal-exempt groups are a subset of sealed groups', () => {
    for (const g of ADMIN_SEAL_EXEMPT_GROUPS) expect(SEALED_GROUPS).toContain(g)
  })

  it('isValidPermissionKey reflects catalog membership', () => {
    expect(isValidPermissionKey('contacts.view')).toBe(true)
    expect(isValidPermissionKey('contacts.nope')).toBe(false)
    expect(isValidPermissionKey('')).toBe(false)
  })
})

describe('resolveRoleConfig', () => {
  it('falls back to role defaults when there are no stored rows', () => {
    const cfg = resolveRoleConfig('member', [], false)
    // Covers every org key, true only for the member defaults.
    expect(Object.keys(cfg.permissions).sort()).toEqual([...ORG_PERMISSION_KEYS].sort())
    for (const key of ORG_PERMISSION_KEYS) {
      expect(cfg.permissions[key]).toBe(DEFAULT_ROLE_PERMISSIONS.member.includes(key))
    }
    expect(cfg.restrictToAssigned).toBe(false)
  })

  it('uses stored rows verbatim and defaults missing keys to false', () => {
    const cfg = resolveRoleConfig(
      'admin',
      [
        { permission_key: 'contacts.view', enabled: true },
        { permission_key: 'contacts.manage', enabled: false },
      ],
      true,
    )
    expect(cfg.permissions['contacts.view']).toBe(true)
    expect(cfg.permissions['contacts.manage']).toBe(false)
    // A key with no stored row is off when the role has been configured.
    expect(cfg.permissions['pipeline.view']).toBe(false)
    expect(cfg.restrictToAssigned).toBe(true)
  })

  it('ignores unknown/stale stored keys', () => {
    const cfg = resolveRoleConfig('member', [{ permission_key: 'ghost.key', enabled: true }], false)
    expect(cfg.permissions).not.toHaveProperty('ghost.key')
  })
})

describe('buildPermissionRows', () => {
  it('emits exactly one row per org key with correct enabled flags', () => {
    const rows = buildPermissionRows('member', { 'contacts.view': true, 'chat.view': true })
    expect(rows).toHaveLength(ORG_PERMISSION_KEYS.length)
    expect(rows.every((r) => r.role === 'member')).toBe(true)
    const on = rows.filter((r) => r.enabled).map((r) => r.permission_key).sort()
    expect(on).toEqual(['chat.view', 'contacts.view'])
  })

  it('treats any non-true value as disabled', () => {
    // @ts-expect-error — intentionally passing a non-boolean to assert coercion
    const rows = buildPermissionRows('admin', { 'contacts.view': 'yes', 'chat.view': undefined })
    const view = rows.find((r) => r.permission_key === 'contacts.view')
    expect(view?.enabled).toBe(false)
  })
})

describe('CONFIGURABLE_ROLES', () => {
  it('is exactly admin + member', () => {
    expect([...CONFIGURABLE_ROLES].sort()).toEqual(['admin', 'member'])
  })
})
