import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import postcss from 'postcss'
import tailwindcss from '@tailwindcss/postcss'
import { chromium, type Browser } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// The closed contact editor isn't part of the header layout regression.
vi.mock('@/components/contacts/contact-detail-sheet', () => ({ ContactDetailSheet: () => null }))

import { ChatHeader } from '@/components/chat/chat-area/chat-header'
import type { ConversationSummary } from '@/types/chat'

const conversation: ConversationSummary = {
  id: 'conversation-layout',
  status: 'open',
  createdAt: '2026-10-27T12:00:00Z',
  updatedAt: '2026-10-27T12:00:00Z',
  channel: 'whatsapp',
  channelMetadata: {},
  botStatus: 'active',
  contactId: 'contact-layout',
  contactName: 'Patricia — Customer support conversation',
  visitorPhone: '+12125550123',
  pinned: true,
  starred: true,
}

describe('chat header responsive layout', () => {
  let browser: Browser
  let css: string

  beforeAll(async () => {
    const from = path.resolve('src/app/globals.css')
    css = (await postcss([tailwindcss()]).process(await readFile(from, 'utf8'), { from })).css
    browser = await chromium.launch({ headless: true })
  })

  afterAll(async () => { await browser?.close() })

  for (const viewportWidth of [390, 1440]) {
    for (const panelWidth of [240, 280, 300, 420, 640, 900].filter((w) => w <= viewportWidth)) {
      it(`${panelWidth}px panel in ${viewportWidth}px viewport keeps actions off the contact avatar`, async () => {
        const page = await browser.newPage({ viewport: { width: viewportWidth, height: 900 } })
        try {
          const html = renderToStaticMarkup(React.createElement(ChatHeader, {
            conversation,
            onBack: () => {},
            onStatusChange: () => {},
            onDelete: () => {},
            onBotStatusToggle: () => {},
            isBotToggling: false,
            onPinToggle: () => {},
            onPriorityCycle: () => {},
            onAssign: () => {},
            onStarToggle: () => {},
            members: [],
            infoPanelOpen: true,
            onToggleInfoPanel: () => {},
            dndEnabled: true,
            dndChannels: ['all'],
          }))
          await page.setContent(`<html class="dark"><head><style>${css}</style></head><body><main style="width:${panelWidth}px">${html}</main></body></html>`)
          const header = page.locator('main > div')
          const bounds = (await header.boundingBox())!
          const avatar = (await page.getByText('P', { exact: true }).locator('..').boundingBox())!
          expect(avatar.width).toBe(40)
          const name = (await page.getByText(conversation.contactName!, { exact: true }).boundingBox())!
          expect(name.width).toBeGreaterThan(40)
          const controls = [avatar, name]
          for (const button of await header.locator('button').all()) {
            const box = await button.boundingBox()
            if (!box) continue // Hidden desktop/mobile alternatives.
            expect(box.x).toBeGreaterThanOrEqual(bounds.x)
            expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width)
            controls.push(box)
          }
          for (let i = 0; i < controls.length; i++) {
            for (const b of controls.slice(i + 1)) {
              const a = controls[i]
              expect(a.x + a.width <= b.x + 1 || b.x + b.width <= a.x + 1 || a.y + a.height <= b.y + 1 || b.y + b.height <= a.y + 1).toBe(true)
            }
          }
          expect(await header.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
          // Pin remains available in the toolbar on desktop; small mobile
          // viewports retain the established Pin action in the More menu.
          if (viewportWidth === 1440) expect(await page.getByRole('button', { name: 'Unpin', exact: true }).isVisible()).toBe(true)
          if (process.env.CHAT_HEADER_LAYOUT_SCREENSHOT && panelWidth === 280 && viewportWidth === 1440) {
            await header.screenshot({ path: process.env.CHAT_HEADER_LAYOUT_SCREENSHOT })
          }
        } finally {
          await page.close()
        }
      })
    }
  }
})
