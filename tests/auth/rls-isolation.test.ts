import { describe, it, expect } from 'vitest'

/**
 * RLS Isolation Tests
 *
 * These tests verify the INTENT of the RLS policies on org_invites.
 * They check that our server actions correctly scope queries to the current org
 * and that cross-org access is refused at the action layer.
 *
 * Full RLS integration tests require a live Supabase instance with test fixtures.
 * Run those manually with: npx supabase test
 */

describe('RLS isolation (action-layer checks)', () => {
  it('revokeInvite includes org_id safety check in query', async () => {
    // Static analysis: verify the source code contains .eq('org_id', orgId)
    // This is a build-time guarantee — the RLS policy is the runtime guarantee.
    const fs = await import('fs')
    const source = fs.readFileSync(
      new URL('../../src/app/(dashboard)/members/actions.ts', import.meta.url),
      'utf-8'
    )
    expect(source).toContain(".eq('org_id', orgId)")
  })

  it('removeMember includes organization_id safety check in query', async () => {
    const fs = await import('fs')
    const source = fs.readFileSync(
      new URL('../../src/app/(dashboard)/members/actions.ts', import.meta.url),
      'utf-8'
    )
    expect(source).toContain(".eq('organization_id', orgId)")
  })

  it('org_invites RLS policies use get_current_org_id() pattern', async () => {
    const fs = await import('fs')
    const migration = fs.readFileSync(
      new URL('../../supabase/migrations/046_org_invites.sql', import.meta.url),
      'utf-8'
    )
    // All 4 policies must use the SECURITY DEFINER helper
    const policyCount = (migration.match(/get_current_org_id\(\)/g) ?? []).length
    expect(policyCount).toBeGreaterThanOrEqual(4)
  })
})

describe('Email/password regression (static check)', () => {
  it('login page still contains signInWithPassword call', async () => {
    const fs = await import('fs')
    const loginPage = fs.readFileSync(
      new URL('../../src/app/(auth)/login/page.tsx', import.meta.url),
      'utf-8'
    )
    expect(loginPage).toContain('signInWithPassword')
  })

  it('login page still contains zodResolver', async () => {
    const fs = await import('fs')
    const loginPage = fs.readFileSync(
      new URL('../../src/app/(auth)/login/page.tsx', import.meta.url),
      'utf-8'
    )
    expect(loginPage).toContain('zodResolver')
  })

  it('login page contains Sign in with Google button', async () => {
    const fs = await import('fs')
    const loginPage = fs.readFileSync(
      new URL('../../src/app/(auth)/login/page.tsx', import.meta.url),
      'utf-8'
    )
    expect(loginPage).toContain('signInWithOAuth')
    expect(loginPage).toContain("provider: 'google'")
  })
})
