import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BATTERY_GROUPS,
  getBatteryTestFiles,
  getMissingBatteryFiles,
} from '../scripts/test-battery'
import { getGateTestFiles, REPO_ROOT } from '../scripts/release-gate'

describe('test battery manifest', () => {
  it('declares the expected critical coverage groups', () => {
    expect(BATTERY_GROUPS.map((group) => group.id)).toEqual([
      'release-gate',
      'harness-and-security',
      'action-engine',
      'vapi-contract',
      'workflows',
      'public-api',
      'business-rules',
    ])
  })

  it('has no empty groups or duplicate file membership', () => {
    const allFiles = BATTERY_GROUPS.flatMap((group) => group.files)
    for (const group of BATTERY_GROUPS) expect(group.files.length, group.id).toBeGreaterThan(0)
    expect(new Set(allFiles).size).toBe(allFiles.length)
  })

  it('only includes existing automatic tests, never manual or E2E probes', () => {
    expect(getMissingBatteryFiles()).toEqual([])
    for (const file of getBatteryTestFiles()) {
      expect(file).toMatch(/^tests\/.+\.test\.tsx?$/)
      expect(file).not.toContain('/manual/')
      expect(file).not.toContain('/e2e/')
      expect(existsSync(resolve(REPO_ROOT, file))).toBe(true)
    }
  })

  it('contains every existing release-gate member', () => {
    const batteryFiles = new Set(getBatteryTestFiles())
    for (const file of getGateTestFiles()) expect(batteryFiles.has(file), file).toBe(true)
  })

  it('keeps the routine deterministic battery bounded', () => {
    expect(getBatteryTestFiles().length).toBeGreaterThanOrEqual(25)
    expect(getBatteryTestFiles().length).toBeLessThanOrEqual(50)
  })
})

describe('test battery npm wiring', () => {
  const pkg = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>
  }

  it('exposes routine, full, release, list, and E2E commands', () => {
    expect(pkg.scripts['test:battery']).toBe('tsx scripts/test-battery.ts')
    expect(pkg.scripts['test:battery:list']).toBe('tsx scripts/test-battery.ts --list')
    expect(pkg.scripts['test:battery:full']).toBe('tsx scripts/test-battery.ts --full')
    expect(pkg.scripts['test:battery:release']).toBe('tsx scripts/test-battery.ts --release')
    expect(pkg.scripts['test:e2e']).toBe('tsx scripts/test-e2e.ts')
  })
})

describe('test battery CI wiring', () => {
  it.each([
    '.github/workflows/release-gate.yml',
    '.github/workflows/build-deploy.yml',
  ])('%s runs the blocking battery', (file) => {
    const workflow = readFileSync(resolve(REPO_ROOT, file), 'utf8')
    expect(workflow).toMatch(/run:\s+npm run test:battery(?:\s|$)/)
  })
})

