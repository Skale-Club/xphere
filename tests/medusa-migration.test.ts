// tests/medusa-migration.test.ts
// Phase 132 Plan 01 — MED-01: verifies the 1259 enum migration (10 idempotent
// ADD VALUE statements, no transaction wrapper, no seed rows) and confirms
// every hand-maintained provider union in database.ts / actions.ts was
// widened to include 'medusa'. Node fs read, no mocks — this is a structural
// contract test, not a DB integration test.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const MIGRATION_PATH = path.join(process.cwd(), 'supabase/migrations/1259_medusa_integration.sql')
const DATABASE_TYPES_PATH = path.join(process.cwd(), 'src/types/database.ts')
const INTEGRATIONS_ACTIONS_PATH = path.join(process.cwd(), 'src/app/(dashboard)/integrations/actions.ts')

const MEDUSA_ACTION_TYPES = [
  'medusa_search_products',
  'medusa_get_product',
  'medusa_get_cart',
  'medusa_add_to_cart',
  'medusa_update_cart_item',
  'medusa_wishlist_add',
  'medusa_wishlist_remove',
  'medusa_wishlist_list',
  'medusa_get_order_status',
]

describe('1259_medusa_integration.sql', () => {
  const sql = fs.readFileSync(MIGRATION_PATH, 'utf-8')

  it('has exactly 10 ADD VALUE IF NOT EXISTS statements', () => {
    const matches = sql.match(/ADD VALUE IF NOT EXISTS/g)
    expect(matches).toHaveLength(10)
  })

  it('adds medusa to integration_provider', () => {
    expect(sql).toContain(`ALTER TYPE public.integration_provider ADD VALUE IF NOT EXISTS 'medusa';`)
  })

  it.each(MEDUSA_ACTION_TYPES)('adds action_type %s', (actionType) => {
    expect(sql).toContain(`ADD VALUE IF NOT EXISTS '${actionType}'`)
  })

  it('contains no INSERT, BEGIN, or COMMIT (enum add must run outside a txn, no seed rows)', () => {
    expect(sql).not.toMatch(/INSERT|BEGIN|COMMIT/)
  })
})

describe('database.ts provider unions widened for medusa', () => {
  const source = fs.readFileSync(DATABASE_TYPES_PATH, 'utf-8')

  it('widens integration_provider / provider unions (>= 3 lines with xkedule + medusa)', () => {
    const widenedLines = source
      .split('\n')
      .filter((line) => line.includes(`'xkedule'`) && line.includes(`| 'medusa'`))
    expect(widenedLines.length).toBeGreaterThanOrEqual(3)
  })

  it('does not touch the action_type union (send_zernio_dm-terminated lines stay untouched)', () => {
    const actionTypeLines = source.split('\n').filter((line) => line.includes(`'send_zernio_dm'`))
    expect(actionTypeLines.length).toBeGreaterThan(0)
    for (const line of actionTypeLines) {
      expect(line).not.toContain(`'medusa'`)
    }
  })
})

describe('IntegrationForDisplay.provider widened for medusa', () => {
  const source = fs.readFileSync(INTEGRATIONS_ACTIONS_PATH, 'utf-8')

  it('includes | \'medusa\' on the provider union line', () => {
    const providerLine = source.split('\n').find((line) => line.includes('provider:') && line.includes(`'xkedule'`))
    expect(providerLine).toBeDefined()
    expect(providerLine).toContain(`| 'medusa'`)
  })
})
