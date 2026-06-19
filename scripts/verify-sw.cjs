#!/usr/bin/env node
// Post-build guard: assert the PWA service worker was actually generated.
//
// Why this exists: @serwist/next emits `public/sw.js` via a *Webpack* plugin.
// Next 16 defaults `next build` to Turbopack, which silently skips that plugin —
// the build still "succeeds" but ships no service worker, and Web Push dies
// (no SW → pushManager.subscribe can never run → zero push_subscriptions).
// `public/sw.js` is gitignored, so nothing else flags the gap. This guard turns
// that silent failure into a hard build error. Keep the build on `--webpack`.

const fs = require('node:fs')
const path = require('path')

const swPath = path.join(__dirname, '..', 'public', 'sw.js')

function fail(msg) {
  console.error('\n\x1b[31m[verify-sw] BUILD FAILED\x1b[0m')
  console.error(`[verify-sw] ${msg}\n`)
  console.error('[verify-sw] The PWA service worker (public/sw.js) was not produced by this build.')
  console.error('[verify-sw] Web Push notifications cannot work without it.')
  console.error('[verify-sw] Cause: the serwist Webpack plugin did not run.')
  console.error('[verify-sw] Fix:   ensure the build invokes `next build --webpack`')
  console.error('[verify-sw]        (Turbopack — the Next 16 default — skips serwist).\n')
  process.exit(1)
}

if (!fs.existsSync(swPath)) {
  fail('public/sw.js does not exist.')
}

const bytes = fs.statSync(swPath).size
if (bytes < 1000) {
  fail(`public/sw.js is suspiciously small (${bytes} bytes) — likely not a real service worker.`)
}

// Strong signal that this is *our* SW (src/sw.ts) with the push wiring intact.
// Event-name string literals survive minification, so this is stable.
const content = fs.readFileSync(swPath, 'utf8')
const hasPush = content.includes('push')
const hasClick = content.includes('notificationclick')
if (!hasPush || !hasClick) {
  console.warn(
    `\x1b[33m[verify-sw] WARNING\x1b[0m public/sw.js exists (${(bytes / 1024).toFixed(1)} KB) but the ` +
      `push wiring signal is missing (push:${hasPush} notificationclick:${hasClick}). ` +
      'Verify src/sw.ts still registers the push + notificationclick listeners.',
  )
}

console.log(`\x1b[32m[verify-sw] OK\x1b[0m — public/sw.js generated (${(bytes / 1024).toFixed(1)} KB).`)
