// tests/security-secdef-isolation.test.ts
// Security Review — Xphere | S13 Tenant Isolation (SECURITY DEFINER paths).
//
// The companion suite at tests/rls-isolation.test.ts already proves that direct
// SELECT/INSERT through anon+JWT clients respects org boundaries. This file
// targets the SECURITY DEFINER surface specifically: helpers that run with the
// function owner's privileges. A SECDEF function that accidentally returns
// rows scoped to another org would silently bypass RLS without raising any
// error, so the only way to catch it is to call the function from two users in
// two different orgs and confirm each sees only their own org's data.
//
// Functions covered here are the ones whose body or signature suggests they
// could leak cross-org if mis-implemented:
//   - public.get_current_org_id() | must equal the user's own active org
//   - public.get_user_org_ids() | must list only the orgs the caller belongs to
//   - public.get_org_member_profiles(p_org_id, p_page, p_per_page) | must reject
//     when p_org_id is not one of the caller's memberships
//   - public.get_tag_usage(p_org_id) | must not leak tag counts from other orgs
//
// Skipped automatically when SUPABASE_* env vars are absent.

import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const hasConfig = Boolean(url && anonKey && serviceKey)
const suite = hasConfig ? describe : describe.skip

suite('S13 SECDEF function isolation', () => {
  const suffix = Math.random().toString(36).slice(2, 10)
  const userAEmail = `secdef-a-${suffix}@example.test`
  const userBEmail = `secdef-b-${suffix}@example.test`
  const password = `Secdef-Test-${suffix}!`

  let admin: SupabaseClient
  let clientA: SupabaseClient
  let clientB: SupabaseClient

  let orgAId = ''
  let orgBId = ''
  let userAId = ''
  let userBId = ''

  beforeAll(async () => {
    admin = createClient(url!, serviceKey!, { auth: { persistSession: false } })

    const { data: orgA, error: orgAErr } = await admin
      .from('organizations')
      .insert({ name: `SECDEF A ${suffix}`, slug: `secdef-a-${suffix}`, widget_token: `secdef-tok-a-${suffix}` })
      .select('id')
      .single()
    if (orgAErr) throw orgAErr
    orgAId = orgA.id

    const { data: orgB, error: orgBErr } = await admin
      .from('organizations')
      .insert({ name: `SECDEF B ${suffix}`, slug: `secdef-b-${suffix}`, widget_token: `secdef-tok-b-${suffix}` })
      .select('id')
      .single()
    if (orgBErr) throw orgBErr
    orgBId = orgB.id

    const { data: uA } = await admin.auth.admin.createUser({ email: userAEmail, password, email_confirm: true })
    userAId = uA.user!.id
    const { data: uB } = await admin.auth.admin.createUser({ email: userBEmail, password, email_confirm: true })
    userBId = uB.user!.id

    await admin.from('org_members').insert([
      { user_id: userAId, organization_id: orgAId, role: 'admin' },
      { user_id: userBId, organization_id: orgBId, role: 'admin' },
    ])

    await admin.from('user_active_org').insert([
      { user_id: userAId, organization_id: orgAId },
      { user_id: userBId, organization_id: orgBId },
    ])

    clientA = createClient(url!, anonKey!, { auth: { persistSession: false } })
    clientB = createClient(url!, anonKey!, { auth: { persistSession: false } })
    await clientA.auth.signInWithPassword({ email: userAEmail, password })
    await clientB.auth.signInWithPassword({ email: userBEmail, password })
  }, 60000)

  afterAll(async () => {
    if (!admin) return
    await admin.from('user_active_org').delete().in('user_id', [userAId, userBId])
    await admin.from('org_members').delete().in('user_id', [userAId, userBId])
    if (userAId) await admin.auth.admin.deleteUser(userAId)
    if (userBId) await admin.auth.admin.deleteUser(userBId)
    if (orgAId) await admin.from('organizations').delete().eq('id', orgAId)
    if (orgBId) await admin.from('organizations').delete().eq('id', orgBId)
  })

  it('get_current_org_id() returns each user their own org, never the other', async () => {
    const { data: a } = await clientA.rpc('get_current_org_id' as never)
    const { data: b } = await clientB.rpc('get_current_org_id' as never)
    expect(a).toBe(orgAId)
    expect(b).toBe(orgBId)
    expect(a).not.toBe(b)
  })

  it('get_user_org_ids() lists only the caller\'s memberships', async () => {
    const { data: a } = await clientA.rpc('get_user_org_ids' as never)
    const { data: b } = await clientB.rpc('get_user_org_ids' as never)
    const aList = (a as unknown as string[]) ?? []
    const bList = (b as unknown as string[]) ?? []
    expect(aList).toContain(orgAId)
    expect(aList).not.toContain(orgBId)
    expect(bList).toContain(orgBId)
    expect(bList).not.toContain(orgAId)
  })

  it('get_org_member_profiles refuses to enumerate members of a foreign org', async () => {
    // User A asks for User B's org members. Either empty array or error is acceptable;
    // returning B's members would be a leak.
    const { data, error } = await clientA.rpc('get_org_member_profiles' as never, {
      p_org_id: orgBId,
      p_page: 1,
      p_per_page: 50,
    } as never)
    const rows = (data as unknown as Array<{ user_id: string }> | null) ?? []
    expect(rows.some(r => r.user_id === userBId)).toBe(false)
    // If the function chose to error out (preferred), that's fine too.
    if (error) expect(error).toBeTruthy()
  })

  it('get_tag_usage refuses to count tags from a foreign org', async () => {
    // Seed one tag per org so there is something to potentially leak.
    const { data: tagA } = await admin
      .from('tags')
      .insert({ organization_id: orgAId, name: `secdef-tag-a-${suffix}`, color: '#ff0000' })
      .select('id')
      .single()
    const { data: tagB } = await admin
      .from('tags')
      .insert({ organization_id: orgBId, name: `secdef-tag-b-${suffix}`, color: '#00ff00' })
      .select('id')
      .single()

    try {
      const { data, error } = await clientA.rpc('get_tag_usage' as never, { p_org_id: orgBId } as never)
      // Acceptable outcomes for A asking about B's tags:
      //   1. function returns empty / null
      //   2. function errors out
      //   3. function ignores the argument and returns A's own data
      // Unacceptable: rows that reference tagB.
      const rows = (data as unknown as Array<{ tag_id: string }> | null) ?? []
      if (tagB) {
        expect(rows.some(r => r.tag_id === tagB.id)).toBe(false)
      }
      if (error) expect(error).toBeTruthy()
    } finally {
      if (tagA) await admin.from('tags').delete().eq('id', tagA.id)
      if (tagB) await admin.from('tags').delete().eq('id', tagB.id)
    }
  })
})
