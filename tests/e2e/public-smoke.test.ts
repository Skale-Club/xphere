import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser } from 'playwright'

const baseUrl = process.env.E2E_BASE_URL

if (!baseUrl) {
  throw new Error('E2E_BASE_URL must be set by scripts/test-e2e.ts')
}

describe('public application smoke test', () => {
  let browser: Browser

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true })
  })

  afterAll(async () => {
    await browser?.close()
  })

  it('serves a healthy application endpoint', async () => {
    const response = await fetch(`${baseUrl}/api/health`)
    expect(response.ok).toBe(true)

    const body = await response.json() as { ok?: boolean }
    expect(body.ok).toBe(true)
  })

  it('renders the public entry page without a browser or server error', async () => {
    const page = await browser.newPage()
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))

    const response = await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })

    expect(response?.ok()).toBe(true)
    expect(await page.locator('body').innerText()).not.toHaveLength(0)
    expect(pageErrors).toEqual([])

    await page.close()
  })
})

