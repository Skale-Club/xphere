#!/usr/bin/env node

import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { getGateTestFiles, REPO_ROOT } from './release-gate'

export interface BatteryGroup {
  id: string
  purpose: string
  files: string[]
}

/**
 * Fast, deterministic regression coverage for Xphere's highest-risk paths.
 *
 * Membership is intentionally explicit. A glob would make the command grow
 * unpredictably as the repository grows and could pull live-provider probes
 * into a routine local run. tests/test-battery.test.ts protects this manifest
 * against missing files, duplicate membership, and accidental manual/E2E use.
 */
export const BATTERY_GROUPS: BatteryGroup[] = [
  {
    id: 'release-gate',
    purpose: 'Existing tenant, delegation, idempotency, and orchestration release contracts',
    files: getGateTestFiles(),
  },
  {
    id: 'harness-and-security',
    purpose: 'Test harness integrity plus auth, encryption, and fail-closed contracts',
    files: [
      'tests/test-battery.test.ts',
      'tests/release-gate.test.ts',
      'tests/auth.test.ts',
      'tests/org-switcher.test.tsx',
      'tests/org-request-org.test.ts',
      'tests/org-redirect.test.ts',
      'tests/crypto.test.ts',
      'tests/cron-auth-fail-closed.test.ts',
    ],
  },
  {
    id: 'action-engine',
    purpose: 'Shared executor dispatch and production regression contracts',
    files: [
      'tests/action-engine.test.ts',
      'tests/action-engine-booking.test.ts',
      'tests/action-engine-email-dnd.test.ts',
      'tests/action-engine-sms-undeliverable.test.ts',
    ],
  },
  {
    id: 'vapi-contract',
    purpose: 'Always-200 webhook behavior and mocked latency budget',
    files: [
      'tests/vapi-tools-http200-contract.test.ts',
      'tests/vapi-latency-profile.test.ts',
    ],
  },
  {
    id: 'workflows',
    purpose: 'Unified workflow schema, conversion, execution, and tenant-neutral seeds',
    files: [
      'tests/workflows/engine.test.ts',
      'tests/workflows/schema-validate.test.ts',
      'tests/workflows/yaml-to-flow.test.ts',
      'tests/workflows/run-flow-sync.test.ts',
      'tests/workflow-seeds-tenant-neutral.test.ts',
    ],
  },
  {
    id: 'public-api',
    purpose: 'Bearer-protected contact ingestion and external integration contracts',
    files: [
      'tests/xkedule-contacts-route.test.ts',
      'tests/xpot-integration-contract.test.ts',
    ],
  },
  {
    id: 'business-rules',
    purpose: 'Representative deterministic rules for scheduling, custom fields, and phone identity',
    files: [
      'tests/booking-validation.test.ts',
      'tests/customfields-validator.test.ts',
      'tests/phone-canonicalize.test.ts',
    ],
  },
]

export function getBatteryTestFiles(): string[] {
  return [...new Set(BATTERY_GROUPS.flatMap((group) => group.files))]
}

export function getMissingBatteryFiles(): string[] {
  return getBatteryTestFiles().filter((file) => !existsSync(resolve(REPO_ROOT, file)))
}

type Check = {
  label: string
  command: string
  args: string[]
}

function npmCheck(label: string, args: string[]): Check {
  const npmCliFromEnv = process.env.npm_execpath
  const bundledNpmCli = resolve(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  const npmCli = npmCliFromEnv && existsSync(npmCliFromEnv)
    ? npmCliFromEnv
    : bundledNpmCli

  if (existsSync(npmCli)) {
    return { label, command: process.execPath, args: [npmCli, ...args] }
  }

  return {
    label,
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args,
  }
}

function runCheck(check: Check): boolean {
  console.log(`\n▶ ${check.label}`)
  console.log(`  $ ${check.command} ${check.args.join(' ')}`)

  const result = spawnSync(check.command, check.args, {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: 'inherit',
    shell: false,
  })

  if (result.error) {
    console.error(`✗ ${check.label}: ${result.error.message}`)
    return false
  }

  if (result.status !== 0) {
    console.error(`✗ ${check.label} (exit ${result.status ?? 'unknown'})`)
    return false
  }

  console.log(`✓ ${check.label}`)
  return true
}

function printManifest(): void {
  console.log('Xphere deterministic test battery')
  for (const group of BATTERY_GROUPS) {
    console.log(`\n${group.id} — ${group.purpose}`)
    for (const file of group.files) console.log(`  - ${file}`)
  }
  console.log(`\n${getBatteryTestFiles().length} unique test files`)
}

function main(): void {
  const args = new Set(process.argv.slice(2))
  const listOnly = args.has('--list')
  const full = args.has('--full')
  const release = args.has('--release')

  if ([full, release].filter(Boolean).length > 1) {
    console.error('Choose only one battery profile: --full or --release.')
    process.exit(2)
  }

  if (listOnly) {
    printManifest()
    process.exit(0)
  }

  const missing = getMissingBatteryFiles()
  if (missing.length > 0) {
    console.error(`Test battery cannot start; declared file(s) are missing:\n${missing.map((file) => `  - ${file}`).join('\n')}`)
    process.exit(1)
  }

  const checks: Check[] = []

  if (full) {
    checks.push(npmCheck(
      'Complete automatic Vitest suite (manual and E2E probes excluded)',
      ['test'],
    ))
  } else {
    const vitestEntrypoint = resolve(REPO_ROOT, 'node_modules', 'vitest', 'vitest.mjs')
    if (!existsSync(vitestEntrypoint)) {
      console.error('Vitest is not installed. Run npm install before the battery.')
      process.exit(1)
    }
    checks.push({
      label: `Deterministic critical battery (${getBatteryTestFiles().length} files)`,
      command: process.execPath,
      args: [vitestEntrypoint, 'run', ...getBatteryTestFiles()],
    })
  }

  checks.push(npmCheck('Workflow definition validation', ['run', 'workflows:validate']))

  if (release) {
    checks.push(npmCheck('Production build', ['run', 'build']))
  }

  const results = checks.map((check) => ({ label: check.label, ok: runCheck(check) }))
  const failed = results.filter((result) => !result.ok)

  console.log('\nTest battery summary')
  for (const result of results) console.log(`${result.ok ? '✓' : '✗'} ${result.label}`)

  if (failed.length > 0) {
    console.error(`\nBATTERY FAILED: ${failed.length} check(s) failed.`)
    process.exit(1)
  }

  console.log('\nBATTERY PASSED')
}

const isMain = Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isMain) main()

