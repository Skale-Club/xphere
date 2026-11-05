// src/lib/edge-functions/switch.ts
// Env switch for the Edge Function -> Node port.
//
// EDGE_FUNCTIONS_IN_APP is a comma list of function names that run inside the
// Next.js app instead of the Supabase Edge Function. Unset or empty means every
// function keeps calling the Edge Function, exactly as before the port.
//
//   EDGE_FUNCTIONS_IN_APP=process-imports,process-embeddings,push-sender

import { after } from 'next/server'

export type PortedFunction = 'process-imports' | 'process-embeddings' | 'push-sender'

type Env = Record<string, string | undefined>

export function functionsRunningInApp(env: Env = process.env): Set<string> {
  return new Set(
    (env.EDGE_FUNCTIONS_IN_APP ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean),
  )
}

export function runsInApp(name: PortedFunction, env: Env = process.env): boolean {
  return functionsRunningInApp(env).has(name)
}

/**
 * Run long work after the response has gone out (Cloudflare cuts a response at
 * 100s). Uses next/server `after()` when there is a request scope and falls back
 * to a detached promise when there is not (a script, a test, a cron outside a
 * request). Errors are logged, never thrown: the caller already answered.
 */
export function runAfterResponse(work: () => Promise<unknown>, label: string): void {
  const guarded = async () => {
    try {
      await work()
    } catch (err) {
      console.error(`[${label}] background work failed:`, err)
    }
  }
  try {
    after(guarded)
  } catch {
    void guarded()
  }
}
