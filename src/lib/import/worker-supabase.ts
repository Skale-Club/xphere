/**
 * SupabaseImportWorkerEntry | v1 implementation of ImportWorkerEntry.
 *
 * This stub will be fleshed out in Phase 75 (IMPORT-HISTORY-RETRY-TESTS) when
 * the full chunked, transactional, cancellable processing logic is added.
 * For Phase 73 the stub satisfies the interface contract and compiles cleanly.
 *
 * The actual claim SQL (SELECT ... FOR UPDATE SKIP LOCKED) and row-processing
 * loop live here. Post-Hetzner, this file is replaced by worker-node.ts; the
 * interface import in Phase 74/75 callers does not change.
 *
 * Invocation in v1: Supabase Edge Function (Deno) calls this on pg_cron tick.
 * Invocation post-Hetzner: Node worker process (PM2/Docker) calls this in a
 * setInterval loop with the same claimTimeoutMs parameter.
 */
import { createClient } from '@/lib/supabase/server'
import type { ClaimResult, ImportWorkerEntry } from './worker'

export class SupabaseImportWorkerEntry implements ImportWorkerEntry {
  async processNextImport(claimTimeoutMs = 300_000): Promise<ClaimResult> {
    // TODO (Phase 75): implement full chunked processing loop.
    // Stub: attempt to claim next queued import.
    const supabase = await createClient()

    // Atomic claim via UPDATE ... RETURNING (Postgres FOR UPDATE SKIP LOCKED
    // semantics are approximated here; the Edge Function version uses a raw
    // SQL RPC for true SKIP LOCKED).
    const { data, error } = await supabase
      .from('contact_imports')
      .update({ status: 'processing', started_at: new Date().toISOString() })
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .limit(1)
      .select('id')
      .single()

    if (error || !data) {
      // No rows in queued state (or concurrency collision | safe to return unclaimed)
      return { claimed: false }
    }

    // Phase 75 will add the actual row-processing loop here.
    // For now, mark the stub as a no-op and immediately return.
    void claimTimeoutMs // used in Phase 75 timeout guard

    return { claimed: true, importId: data.id }
  }
}
