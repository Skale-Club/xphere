import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import postcss from 'postcss'
import tailwindcss from '@tailwindcss/postcss'
import { chromium, type Browser } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { MessageList } from '@/components/chat/chat-area/message-list'
import type { ConversationMessage } from '@/types/chat'

describe('audio messages keep a visible waveform', () => {
  let browser: Browser
  let css: string

  beforeAll(async () => {
    const from = path.resolve('src/app/globals.css')
    css = (await postcss([tailwindcss()]).process(await readFile(from, 'utf8'), { from })).css
    browser = await chromium.launch({ headless: true })
  })

  afterAll(async () => { await browser?.close() })

  for (const theme of ['dark', 'light']) {
    for (const viewportWidth of [390, 1440]) {
      for (const panelWidth of [280, 320, 420, 640, 900].filter((w) => w <= viewportWidth)) {
        for (const role of ['visitor', 'assistant']) {
          it(`${theme}, ${role}: ${panelWidth}px panel in ${viewportWidth}px viewport`, async () => {
            const page = await browser.newPage({ viewport: { width: viewportWidth, height: 800 } })
            try {
              const messages: ConversationMessage[] = [28, 5, 15].map((duration, i) => ({
                id: `audio-${i}`,
                conversationId: 'audio-layout',
                role,
                content: '',
                createdAt: '2026-10-27T12:00:00Z',
                metadata: { media: [{ url: `/test-audio-${i}.ogg`, mime_type: 'audio/ogg', duration }] },
              }))
              const html = renderToStaticMarkup(React.createElement(MessageList, {
                messages,
                isLoading: false,
                visitorInitial: 'P',
              }))
              await page.setContent(`<html class="${theme}"><head><style>${css}</style></head><body><main style="width:${panelWidth}px;height:700px;display:flex;flex-direction:column">${html}</main></body></html>`)
              const bounds = (await page.locator('main').boundingBox())!
              const waveforms = await page.getByRole('slider', { name: 'Seek', exact: true }).all()
              expect(waveforms).toHaveLength(3)
              for (const waveform of waveforms) {
                const box = (await waveform.boundingBox())!
                expect(box.width).toBeGreaterThanOrEqual(48)
                expect(box.height).toBeGreaterThanOrEqual(24)
                const bars = await waveform.locator('svg rect, :scope > div').all()
                expect(bars.length).toBeGreaterThanOrEqual(12)
                for (const bar of bars) {
                  const barBox = (await bar.boundingBox())!
                  expect(barBox.width).toBeGreaterThan(0.5)
                  expect(barBox.height).toBeGreaterThan(0)
                }
              }
              for (const control of [...waveforms, ...await page.locator('button').all()]) {
                const box = await control.boundingBox()
                if (!box) continue
                expect(box.x).toBeGreaterThanOrEqual(bounds.x)
                expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width)
              }
              expect(await page.locator('main').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
              if (process.env.AUDIO_MESSAGE_LAYOUT_SCREENSHOT_DIR && role === 'visitor' && panelWidth === 280 && viewportWidth === 1440) {
                await page.locator('main').screenshot({ path: path.join(process.env.AUDIO_MESSAGE_LAYOUT_SCREENSHOT_DIR, `audio-messages-${theme}-280px.png`) })
              }
            } finally {
              await page.close()
            }
          })
        }
      }
    }
  }
})
