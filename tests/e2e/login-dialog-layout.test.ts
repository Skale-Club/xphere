import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import postcss from 'postcss'
import tailwindcss from '@tailwindcss/postcss'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Mount the real interactive dialog and Radix portal, but never send an SMS or
// load Firebase. A desktop browser cannot open an OS keyboard: model its visual
// viewport resize/pan separately from the unchanged layout viewport instead.
describe('login stays usable above the mobile keyboard', () => {
  let browser: Browser
  let css: string
  let script: string

  beforeAll(async () => {
    const from = path.resolve('src/app/globals.css')
    css = (await postcss([tailwindcss()]).process(await readFile(from, 'utf8'), { from })).css
    const bundle = await build({
      stdin: {
        contents: `import React from 'react';
          import { createRoot } from 'react-dom/client';
          import { LoginDialog } from './src/components/auth/login-dialog';
          createRoot(document.getElementById('root')).render(React.createElement(LoginDialog, { open: true }));`,
        resolveDir: process.cwd(), loader: 'tsx',
      },
      bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"' },
      plugins: [{
        name: 'offline-identity',
        setup(b) {
          b.onResolve({ filter: /google-identity-client$/ }, () => ({ path: 'identity', namespace: 'offline' }))
          b.onLoad({ filter: /.*/, namespace: 'offline' }, () => ({ contents: `
            export const prepareGoogleIdentity = async () => ({});
            export const cancelGooglePhoneChallenge = () => {};
            export const sendGooglePhoneCode = async () => {};
            export const confirmGooglePhoneCode = async () => { throw new Error('invalid code'); };
            export const googlePhoneError = () => 'wrong_code';
            export const signInGoogleAlternative = async () => '';`, loader: 'js' }))
        },
      }],
    })
    script = bundle.outputFiles[0].text
    browser = await chromium.launch({ headless: true })
  })

  afterAll(async () => { await browser?.close() })

  async function mount(page: Page, theme: string, mockViewport = true) {
    await page.route('https://login.test/**', async (route) => {
      if (route.request().url().endsWith('/api/auth/config')) {
        await route.fulfill({ json: { google: { enabled: true, projectId: 'offline' }, countryIso: 'US' } })
      } else if (route.request().resourceType() === 'document') {
        await route.fulfill({ contentType: 'text/html', body: `<html class="${theme}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div></body></html>` })
      } else await route.abort()
    })
    await page.goto('https://login.test/')
    if (mockViewport) {
      await page.evaluate(() => {
        const viewport = Object.assign(new EventTarget(), {
          offsetTop: 0, offsetLeft: 0, width: window.innerWidth, height: window.innerHeight, scale: 1,
        })
        Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
      })
    } else await page.evaluate(() => Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined }))
    await page.addScriptTag({ content: script })
    await page.locator('#login-phone').waitFor()
    await page.emulateMedia({ reducedMotion: 'reduce' })
  }

  async function keyboard(page: Page, height: number, top: number) {
    await page.evaluate(({ height, top }) => {
      Object.assign(window.visualViewport!, { height, offsetTop: top })
      window.visualViewport!.dispatchEvent(new Event('resize'))
      window.visualViewport!.dispatchEvent(new Event('scroll'))
    }, { height, top })
  }

  async function assertLayout(page: Page, field: string, height: number, top: number) {
    await expect.poll(async () => {
      const viewport = (await page.locator('.login-viewport').boundingBox())!
      return Math.abs(viewport.height - height) < 1 && Math.abs(viewport.y - top) < 1
    }).toBe(true)
    // Do not use scrollIntoView or Playwright's auto-scrolling click: the user
    // must see both controls together without dismissing the keyboard.
    const controls = [page.locator(field), page.locator('button[type="submit"]')]
    expect(await controls[0].evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16)
    for (const control of controls) {
      await expect.poll(async () => {
        const box = (await control.boundingBox())!
        return box.y >= top && box.y + box.height <= top + height
      }).toBe(true)
      const box = (await control.boundingBox())!
      expect(box.height).toBeGreaterThanOrEqual(44)
      expect(await control.evaluate((el) => {
        const r = el.getBoundingClientRect()
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
        return hit === el || el.contains(hit) ||
          (el instanceof HTMLButtonElement && el.disabled && hit === el.parentElement)
      })).toBe(true)
    }
    const panel = page.getByRole('dialog')
    const bounds = (await panel.boundingBox())!
    expect(bounds.y).toBeGreaterThanOrEqual(top)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(top + height + 1)
    expect(bounds.x).toBeGreaterThanOrEqual(8)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize()!.width - 8)
    expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    // Header and body share one solid surface, including in light theme.
    expect(await panel.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(8, 9, 10)')
    const logo = (await page.getByTestId('login-logo').boundingBox())!
    expect(Math.abs(logo.x + logo.width / 2 - (bounds.x + bounds.width / 2))).toBeLessThan(1)
    const close = (await page.getByRole('button', { name: 'Close', exact: true }).boundingBox())!
    expect(close.x + close.width).toBeLessThanOrEqual(bounds.x + bounds.width)
    expect(await page.locator('body').evaluate((el) => el.scrollWidth <= window.innerWidth)).toBe(true)
  }

  for (const theme of ['light', 'dark']) {
    for (const [width, height, visibleHeight, offsetTop] of [
      [320, 568, 280, 0], [390, 844, 360, 120], [430, 932, 420, 0], [667, 375, 260, 40],
    ]) {
      it(`${theme}: ${width}px phone, ${visibleHeight}px above keyboard, pan ${offsetTop}px`, async () => {
        const page = await browser.newPage({ viewport: { width, height }, isMobile: true, hasTouch: true })
        try {
          await mount(page, theme)
          await assertLayout(page, '#login-phone', height, 0)
          await page.locator('#login-phone').fill('5085550100')
          await keyboard(page, visibleHeight, offsetTop)
          await assertLayout(page, '#login-phone', visibleHeight, offsetTop)
          if (process.env.LOGIN_LAYOUT_SCREENSHOT_DIR && width === 390) {
            await page.screenshot({ path: path.join(process.env.LOGIN_LAYOUT_SCREENSHOT_DIR, `login-phone-keyboard-${theme}.png`) })
          }
          await page.locator('button[type="submit"]').click()
          await page.getByLabel('6-digit code').waitFor()
          await page.getByLabel('6-digit code').fill('123')
          await assertLayout(page, 'input[autocomplete="one-time-code"]', visibleHeight, offsetTop)
          // A server error must not displace either input or submit button.
          await page.getByLabel('6-digit code').fill('123456')
          await page.getByRole('alert').waitFor()
          await expect.poll(async () => {
            const message = (await page.getByRole('alert').boundingBox())!
            const context = (await page.locator('.login-context').boundingBox())!
            return message.y + message.height <= context.y + context.height + 1
          }).toBe(true)
          await assertLayout(page, 'input[autocomplete="one-time-code"]', visibleHeight, offsetTop)
          if (process.env.LOGIN_LAYOUT_SCREENSHOT_DIR && width === 390) {
            await page.screenshot({ path: path.join(process.env.LOGIN_LAYOUT_SCREENSHOT_DIR, `login-code-keyboard-${theme}.png`) })
          }
          await keyboard(page, height, 0)
          await assertLayout(page, 'input[autocomplete="one-time-code"]', height, 0)
          if (process.env.LOGIN_LAYOUT_SCREENSHOT_DIR && width === 390) {
            await page.screenshot({ path: path.join(process.env.LOGIN_LAYOUT_SCREENSHOT_DIR, `login-${theme}.png`) })
          }
        } finally { await page.close() }
      })
    }
  }

  it('handles a resizing browser without VisualViewport', async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    try {
      await mount(page, 'light', false)
      await page.locator('#login-phone').fill('5085550100')
      await page.setViewportSize({ width: 390, height: 300 })
      await assertLayout(page, '#login-phone', 300, 0)
      await page.setViewportSize({ width: 1280, height: 800 })
      await assertLayout(page, '#login-phone', 800, 0)
    } finally { await page.close() }
  })
})
