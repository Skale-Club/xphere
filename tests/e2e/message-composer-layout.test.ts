import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import postcss from 'postcss'
import tailwindcss from '@tailwindcss/postcss'
import { chromium, type Browser } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/(dashboard)/settings/signatures/actions', () => ({
  listSignatureOptions: vi.fn(async () => ({ ok: true, data: [] })),
}))

import { MessageComposer } from '@/components/chat/chat-area/message-composer'

// Render the real component with production CSS in a browser. No session,
// database, running server, or provider calls are needed to reproduce overflow.
describe('message composer responsive layout', () => {
  let browser: Browser
  let css: string

  beforeAll(async () => {
    const from = path.resolve('src/app/globals.css')
    css = (await postcss([tailwindcss()]).process(await readFile(from, 'utf8'), { from })).css
    browser = await chromium.launch({ headless: true })
  })

  afterAll(async () => { await browser?.close() })

  for (const viewportWidth of [390, 1440]) {
    for (const panelWidth of [280, 300, 360, 420, 640, 900].filter((w) => w <= viewportWidth)) {
      for (const mode of ['multiple', 'single', 'hint', 'email'] as const) {
        it(`${mode}: ${panelWidth}px panel in ${viewportWidth}px viewport keeps controls visible and separate`, async () => {
          const page = await browser.newPage({ viewport: { width: viewportWidth, height: 900 } })
          try {
            const channel = mode === 'email' ? 'email' : 'whatsapp'
            const label = mode === 'multiple' ? 'WhatsApp Business — Customer support' : 'WhatsApp'
            const html = renderToStaticMarkup(React.createElement(MessageComposer, {
              onSendMessage: async () => {},
              activeChannel: channel,
              availableChannels: mode === 'hint' ? [] : [
                { channel, label },
                ...(mode === 'multiple' ? [{ channel: 'sms', label: 'SMS' }] : []),
              ],
              channelLabel: mode === 'hint' ? 'WhatsApp Business — Customer support' : undefined,
              priority: 'normal',
              onPriorityCycle: () => {},
              onOperatorNamePrefixToggle: () => {},
              templateSupport: { available: true, outsideWindow: false },
              onSendTemplate: () => {},
              evolutionManualFallback: { available: true },
            }))
            await page.setContent(`<html class="dark"><head><style>${css}</style></head><body><main style="width:${panelWidth}px">${html}</main></body></html>`)
            const composer = page.locator('main > div')
            const bounds = (await composer.boundingBox())!
            const channelGroup = page.getByText('Channel', { exact: true }).locator('..')
            const statusGroup = page.getByText('Status', { exact: true }).locator('..')
            const a = (await channelGroup.boundingBox())!
            const b = (await statusGroup.boundingBox())!
            expect(a.x + a.width <= b.x + 1 || b.x + b.width <= a.x + 1 || a.y + a.height <= b.y + 1 || b.y + b.height <= a.y + 1).toBe(true)

            for (const locator of [channelGroup, statusGroup, page.locator('textarea'), ...await page.locator('button').all()]) {
              const box = await locator.boundingBox()
              if (!box) continue // Radix's hidden form controls aren't visible.
              expect(box.x).toBeGreaterThanOrEqual(bounds.x - 1)
              expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1)
            }
            expect(await composer.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
            expect((await page.locator('textarea').boundingBox())!.width).toBeGreaterThanOrEqual(96)
            const select = page.getByRole('combobox')
            if (await select.count()) {
              const trigger = (await select.boundingBox())!
              const content = (await select.locator('div').first().boundingBox())!
              expect(content.x + content.width).toBeLessThanOrEqual(trigger.x + trigger.width)
            }
            if (process.env.COMPOSER_LAYOUT_SCREENSHOT && mode === 'multiple' && panelWidth === 300 && viewportWidth === 1440) {
              await composer.screenshot({ path: process.env.COMPOSER_LAYOUT_SCREENSHOT })
            }
          } finally {
            await page.close()
          }
        })
      }
    }
  }
})
