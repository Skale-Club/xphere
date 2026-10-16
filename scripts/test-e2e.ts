#!/usr/bin/env node

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const repoRoot = resolve(__dirname, '..')
const baseUrl = process.env.E2E_BASE_URL?.trim()

if (!baseUrl) {
  console.error([
    'E2E_BASE_URL is required.',
    'Start the app separately and point the test at it, for example:',
    '  PowerShell: $env:E2E_BASE_URL="http://127.0.0.1:4267"; npm run test:e2e',
    'This guard prevents an E2E command from hitting production accidentally.',
  ].join('\n'))
  process.exit(2)
}

let parsed: URL
try {
  parsed = new URL(baseUrl)
} catch {
  console.error(`E2E_BASE_URL is not a valid URL: ${baseUrl}`)
  process.exit(2)
}

if (!['http:', 'https:'].includes(parsed.protocol)) {
  console.error('E2E_BASE_URL must use http:// or https://.')
  process.exit(2)
}

const vitestEntrypoint = resolve(repoRoot, 'node_modules', 'vitest', 'vitest.mjs')
if (!existsSync(vitestEntrypoint)) {
  console.error('Vitest is not installed. Run npm install first.')
  process.exit(1)
}

const result = spawnSync(
  process.execPath,
  [vitestEntrypoint, 'run', '--config', 'vitest.e2e.config.ts'],
  {
    cwd: repoRoot,
    env: { ...process.env, E2E_BASE_URL: parsed.toString().replace(/\/$/, '') },
    stdio: 'inherit',
    shell: false,
  },
)

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}

process.exit(result.status ?? 1)

