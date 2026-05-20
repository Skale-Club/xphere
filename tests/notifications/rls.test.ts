import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const hasConfig = Boolean(url && anonKey && serviceKey)
const suite = hasConfig ? describe : describe.skip

// NOTIF-01 acceptance gate — cross-org/cross-user notification isolation via RLS.
// Seeds two orgs + two users with the service-role client, then issues
// queries through authenticated (anon + JWT) clients to verify policies hold.
suite('NOTIF-01: Notifications RLS isolation', () => {
  const suffix = Math.random().toString(36).slice(2, 10)
  const userAEmail = `notif-a-${suffix}@example.test`
  const userBEmail = `notif-b-${suffix}@example.test`
  const password = `Notif-Test-${suffix}!`

  let admin: SupabaseClient
  let clientA: SupabaseClient
  let clientB: SupabaseClient

  let orgAId = ''
  let orgBId = ''
  let userAId = ''
  let userBId = ''
  let notifId = ''

  beforeAll(async () => {
    admin = createClient(url!, serviceKey!, { auth: { persistSession: false } })

    // Create Org A
    const { data: orgA, error: orgAErr } = await admin
      .from('organizations')
      .insert({
        name: `Notif A ${suffix}`,
        slug: `notif-a-${suffix}`,
        widget_token: `notif-tok-a-${suffix}`,
      })
      .select('id')
      .single()
    if (orgAErr) throw orgAErr
    orgAId = orgA.id

    // Create Org B
    const { data: orgB, error: orgBErr } = await admin
      .from('organizations')
      .insert({
        name: `Notif B ${suffix}`,
        slug: `notif-b-${suffix}`,
        widget_token: `notif-tok-b-${suffix}`,
      })
      .select('id')
      .single()
    if (orgBErr) throw orgBErr
    orgBId = orgB.id

    // Create User A (in Org A)
    const { data: uA, error: uAErr } = await admin.auth.admin.createUser({
      email: userAEmail,
      password,
      email_confirm: true,
    })
    if (uAErr) throw uAErr
    userAId = uA.user!.id

    // Create User B (in Org B)
    const { data: uB, error: uBErr } = await admin.auth.admin.createUser({
      email: userBEmail,
      password,
      email_confirm: true,
    })
    if (uBErr) throw uBErr
    userBId = uB.user!.id

    // Add org memberships
    const { error: memErr } = await admin.from('org_members').insert([
      { user_id: userAId, organization_id: orgAId, role: 'admin' },
      { user_id: userBId, organization_id: orgBId, role: 'admin' },
    ])
    if (memErr) throw memErr

    // Set active org for each user (required for get_current_org_id())
    const { error: activeOrgAErr } = await admin.from('user_active_org').upsert(
      { user_id: userAId, organization_id: orgAId },
      { onConflict: 'user_id' }
    )
    if (activeOrgAErr) throw activeOrgAErr

    const { error: activeOrgBErr } = await admin.from('user_active_org').upsert(
      { user_id: userBId, organization_id: orgBId },
      { onConflict: 'user_id' }
    )
    if (activeOrgBErr) throw activeOrgBErr

    // Insert one notification for User A in Org A via admin (service-role bypass)
    const { data: notif, error: notifErr } = await admin
      .from('notifications')
      .insert({
        org_id: orgAId,
        user_id: userAId,
        type: 'missed_call',
        payload: { call_log_id: 'test-call-001' },
      })
      .select('id')
      .single()
    if (notifErr) throw notifErr
    notifId = notif.id

    // Create authenticated clients
    const makeClient = () =>
      createClient(url!, anonKey!, { auth: { persistSession: false } })
    clientA = makeClient()
    clientB = makeClient()

    const signIns = await Promise.all([
      clientA.auth.signInWithPassword({ email: userAEmail, password }),
      clientB.auth.signInWithPassword({ email: userBEmail, password }),
    ])
    for (const { error } of signIns) if (error) throw error
  }, 60000)

  afterAll(async () => {
    if (!admin) return
    // Delete seeded notifications first (FK constraint)
    if (orgAId) await admin.from('notifications').delete().eq('org_id', orgAId)
    if (orgBId) await admin.from('notifications').delete().eq('org_id', orgBId)
    // Delete org memberships
    if (orgAId) await admin.from('org_members').delete().eq('organization_id', orgAId)
    if (orgBId) await admin.from('org_members').delete().eq('organization_id', orgBId)
    // Delete users
    const cleanups: Promise<unknown>[] = []
    if (userAId) cleanups.push(admin.auth.admin.deleteUser(userAId))
    if (userBId) cleanups.push(admin.auth.admin.deleteUser(userBId))
    await Promise.allSettled(cleanups)
    // Delete orgs
    if (orgAId) await admin.from('organizations').delete().eq('id', orgAId)
    if (orgBId) await admin.from('organizations').delete().eq('id', orgBId)
  }, 60000)

  it('User A can SELECT their own notification in Org A', async () => {
    const { data, error } = await clientA
      .from('notifications')
      .select('id, user_id, org_id')
      .eq('id', notifId)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data![0].id).toBe(notifId)
    expect(data![0].user_id).toBe(userAId)
    expect(data![0].org_id).toBe(orgAId)
  })

  it('User B cannot SELECT User A notification (cross-org isolation)', async () => {
    const { data, error } = await clientB
      .from('notifications')
      .select('id')
      .eq('id', notifId)
    // RLS should filter out the row — no error, just empty result
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it('Service role can INSERT notifications without RLS restriction', async () => {
    // Admin inserts a notification for UserB in OrgB (service-role bypasses RLS)
    const { data, error } = await admin
      .from('notifications')
      .insert({
        org_id: orgBId,
        user_id: userBId,
        type: 'new_conversation',
        payload: { conversation_id: 'test-conv-001' },
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    expect(data).toBeTruthy()
    expect(data!.id).toBeTruthy()
  })
})
