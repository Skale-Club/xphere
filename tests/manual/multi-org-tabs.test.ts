/**
 * E2E — one browser, two tabs pinned to two different orgs (the agency
 * workflow behind migrations 1308/1309 and src/lib/org/*).
 *
 * Opt-in: drives a real Chromium against a running app and the linked DB.
 *
 *   E2E_EMAIL / E2E_PASSWORD  a user that belongs to at least two orgs
 *   E2E_BASE_URL              default http://localhost:4267 (`npm run dev`)
 *   E2E_ORG_A / E2E_ORG_B     default: the user's first two memberships
 *   E2E_ALLOW_WRITES=1        also run the write + Realtime checks — they create
 *                             a chat label and two notifications and delete
 *                             them again
 *   E2E_HEADED=1              watch it run
 *
 *   npx vitest run -c vitest.manual.config.ts tests/manual/multi-org-tabs.test.ts
 */
import pg from 'pg'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const BASE = (process.env.E2E_BASE_URL ?? 'http://localhost:4267').replace(/\/$/, '')
const EMAIL = process.env.E2E_EMAIL
const PASSWORD = process.env.E2E_PASSWORD
const WRITES = process.env.E2E_ALLOW_WRITES === '1'
const enabled = Boolean(EMAIL && PASSWORD && process.env.DATABASE_URL)

const ORG_URL = /\/o\/([0-9a-f-]{36})(\/|$)/

describe.skipIf(!enabled)('per-tab org: two orgs in two tabs of one browser', () => {
  let db: pg.Client
  let browser: Browser
  let context: BrowserContext
  let tabA: Page
  let tabB: Page
  let userId: string
  let orgA: { id: string; name: string }
  let orgB: { id: string; name: string }
  // Realtime diagnostics: postgres_changes frames each tab's socket received.
  const frames: Record<'A' | 'B', string[]> = { A: [], B: [] }
  const logs: string[] = []
  const watch = (page: Page, tab: 'A' | 'B') => {
    page.on('websocket', (ws) => {
      if (!ws.url().includes('/realtime/')) return
      ws.on('framereceived', (f) => {
        const text = String(f.payload)
        if (text.includes('postgres_changes') || text.includes('"phx_reply"') || text.includes('system')) {
          frames[tab].push(text.slice(0, 400))
        }
      })
    })
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${tab}] ${m.text().slice(0, 300)}`)
    })
  }

  const switcherName = (page: Page) =>
    page.getByRole('button', { name: 'Switch organization' }).first().innerText()
  const expectTabOrg = async (page: Page, org: { id: string; name: string }) => {
    await page.waitForURL((url) => ORG_URL.exec(url.pathname)?.[1] === org.id, { timeout: 15_000 })
    expect((await switcherName(page)).trim()).toContain(org.name)
  }
  const defaultOrg = async () =>
    (await db.query('select organization_id from user_active_org where user_id = $1', [userId])).rows[0]
      ?.organization_id as string | undefined
  const setDefaultOrg = (orgId: string) =>
    db.query(
      `insert into user_active_org (user_id, organization_id, updated_at) values ($1, $2, now())
       on conflict (user_id) do update set organization_id = excluded.organization_id, updated_at = now()`,
      [userId, orgId],
    )
  const insertNotification = async (orgId: string) =>
    (
      await db.query(
        `insert into notifications (org_id, user_id, type, payload) values ($1, $2, 'flow_failed', $3) returning id`,
        [orgId, userId, JSON.stringify({ title: 'E2E per-tab org check', e2e: true })],
      )
    ).rows[0].id as string
  const unreadBadge = async (page: Page) => {
    const badge = page.locator('[aria-label$="unread notifications"]').first()
    if (!(await badge.count())) return 0
    return Number.parseInt((await badge.getAttribute('aria-label')) ?? '0', 10) || 0
  }

  beforeAll(async () => {
    db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
    await db.connect()
    const { rows: users } = await db.query('select id from auth.users where email = $1', [EMAIL])
    userId = users[0]?.id
    if (!userId) throw new Error(`E2E user ${EMAIL} not found`)
    const { rows: orgs } = await db.query(
      `select o.id, o.name from org_members m join organizations o on o.id = m.organization_id
        where m.user_id = $1 and o.is_active order by o.name`,
      [userId],
    )
    const pick = (id: string | undefined, fallback: number) =>
      (id ? orgs.find((o) => o.id === id) : orgs[fallback]) as { id: string; name: string } | undefined
    orgA = pick(process.env.E2E_ORG_A, 0)!
    orgB = pick(process.env.E2E_ORG_B, 1)!
    if (!orgA || !orgB || orgA.id === orgB.id) throw new Error('E2E user needs two distinct orgs')

    browser = await chromium.launch({ headless: process.env.E2E_HEADED !== '1' })
    context = await browser.newContext() // shared cookies, like tabs of one browser
    tabA = await context.newPage()
    watch(tabA, 'A')
    await tabA.goto(`${BASE}/login`)
    await tabA.getByPlaceholder('Enter your email address').fill(EMAIL!)
    await tabA.locator('button[type="submit"]').first().click()
    await tabA.getByPlaceholder('Enter your password').fill(PASSWORD!)
    await tabA.getByRole('button', { name: /sign in/i }).click()
    await tabA.waitForURL(/\/dashboard/, { timeout: 30_000 })
    tabB = await context.newPage()
    watch(tabB, 'B')
  })

  afterAll(async () => {
    await browser?.close()
    await db?.end()
  })

  it('each tab renders its own org and keeps it across reloads', async () => {
    await tabA.goto(`${BASE}/o/${orgA.id}/dashboard`)
    await tabB.goto(`${BASE}/o/${orgB.id}/dashboard`)
    await expectTabOrg(tabA, orgA)
    await expectTabOrg(tabB, orgB)

    await tabA.reload()
    await tabB.reload()
    await expectTabOrg(tabA, orgA)
    await expectTabOrg(tabB, orgB)
  })

  it('soft navigation through plain links stays in the tab org', async () => {
    await tabA.locator('a[href="/contacts"]').first().click()
    await tabA.waitForURL(new RegExp(`/o/${orgA.id}/contacts`))
    await expectTabOrg(tabA, orgA)

    await tabB.locator('a[href="/contacts"]').first().click()
    await tabB.waitForURL(new RegExp(`/o/${orgB.id}/contacts`))
    await expectTabOrg(tabB, orgB)
  })

  it('server-side redirects keep the org prefix', async () => {
    await tabB.goto(`${BASE}/o/${orgB.id}/settings`) // page redirects to /settings/profile
    await tabB.waitForURL(new RegExp(`/o/${orgB.id}/settings/profile`))
    await expectTabOrg(tabB, orgB)

    await tabA.goto(`${BASE}/o/${orgA.id}`) // bare prefix → dashboard
    await tabA.waitForURL(new RegExp(`/o/${orgA.id}/dashboard`))
    await expectTabOrg(tabA, orgA)
  })

  it('the focused tab becomes the default org', async () => {
    await setDefaultOrg(orgA.id)
    await tabB.evaluate(() => localStorage.removeItem('xph_default_org'))
    await tabB.bringToFront()
    await tabB.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect.poll(defaultOrg, { timeout: 10_000 }).toBe(orgB.id)
  })

  it.skipIf(!WRITES)('a tab writes into its own org even when another org is the default', async () => {
    await setDefaultOrg(orgA.id)
    const name = `e2e-tab-org-${Date.now()}`
    const created = await tabB.evaluate(async (labelName) => {
      const res = await fetch('/api/chat/labels', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: labelName }),
      })
      return { status: res.status, body: (await res.json()) as { label?: { id: string } } }
    }, name)
    try {
      expect(created.status).toBe(200)
      const { rows } = await db.query('select org_id from conversation_labels where id = $1', [created.body.label!.id])
      expect(rows[0]?.org_id).toBe(orgB.id)
    } finally {
      await db.query('delete from conversation_labels where name = $1', [name])
    }
  })

  it.skipIf(!WRITES)('Realtime delivers each org only to its own tab, whatever the default', async () => {
    const since = new Date()
    await tabA.goto(`${BASE}/o/${orgA.id}/dashboard`)
    await tabB.goto(`${BASE}/o/${orgB.id}/dashboard`)
    await expectTabOrg(tabA, orgA)
    await expectTabOrg(tabB, orgB)
    await setDefaultOrg(orgA.id) // the non-B org is the default: B must still get its events
    // Both bells (one per tab) have joined their notifications channel.
    await expect
      .poll(
        async () =>
          (
            await db.query(
              `select count(*)::int n from realtime.subscription
                where entity = 'public.notifications'::regclass and claims->>'sub' = $1 and created_at >= $2`,
              [userId, since],
            )
          ).rows[0].n,
        { timeout: 20_000 },
      )
      .toBeGreaterThanOrEqual(2)
    await tabB.waitForTimeout(1_000)
    frames.A.length = 0
    frames.B.length = 0
    logs.length = 0

    const [a0, b0] = [await unreadBadge(tabA), await unreadBadge(tabB)]
    const ids: string[] = []
    const report = () =>
      console.log(
        JSON.stringify(
          { inserted: ids, badges: { a0, b0 }, framesA: frames.A, framesB: frames.B, consoleErrors: logs },
          null,
          2,
        ),
      )
    try {
      // Control: the default org's tab (A) — the pre-1309 path.
      ids.push(await insertNotification(orgA.id))
      await expect.poll(() => unreadBadge(tabA), { timeout: 15_000 }).toBe(a0 + 1)

      expect(await unreadBadge(tabB)).toBe(b0)

      // The point of 1309: B is NOT the default org and still gets its event.
      ids.push(await insertNotification(orgB.id))
      await expect.poll(() => unreadBadge(tabB), { timeout: 15_000 }).toBe(b0 + 1)
      expect(await unreadBadge(tabA)).toBe(a0 + 1)
    } catch (err) {
      report()
      throw err
    } finally {
      if (ids.length) await db.query('delete from notifications where id = any($1)', [ids])
    }
  })
})
