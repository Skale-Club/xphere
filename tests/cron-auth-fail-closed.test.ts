import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROUTES = [
  'src/app/api/cron/website-analyzer/route.ts',
  'src/app/api/cron/obs-alerts/route.ts',
  'src/app/api/cron/twilio-sms-reconcile/route.ts',
]

describe('sensitive cron authentication', () => {
  it.each(ROUTES)('%s fails closed when the secret is absent', (file) => {
    const source = readFileSync(resolve(process.cwd(), file), 'utf8')
    expect(source).toMatch(/if \(!CRON_SECRET\)[\s\S]*status: 503/)
    expect(source).not.toMatch(/if \(CRON_SECRET\)\s*\{/)
  })
})
