/**
 * ImportWorkerEntry | Hetzner-portable worker interface for the import pipeline.
 *
 * Contract: "any process that periodically claims contact_imports rows in 'queued'
 * state and processes them" (SEED-018 §Architecture).
 *
 * v1 implementation: SupabaseImportWorkerEntry (worker-supabase.ts) | runs as a
 * Supabase Edge Function (Deno) invoked by pg_cron every 10 seconds, matching the
 * supabase/functions/process-embeddings/ pattern.
 *
 * Post-Hetzner swap: SupabaseImportWorkerEntry is replaced by a Node worker
 * (worker-node.ts) managed by PM2/Docker, polling the same SQL contract
 * (SELECT ... FOR UPDATE SKIP LOCKED on contact_imports). Zero schema changes,
 * zero caller changes.
 */

/** Returned when the worker successfully claimed an import job. */
export type ClaimResult =
  | { claimed: true; importId: string }
  | { claimed: false }

export interface ImportWorkerEntry {
  /**
   * Attempt to claim the next queued import job and begin processing.
   *
   * Claim is atomic: UPDATE contact_imports SET status='processing'
   * WHERE status='queued' ... FOR UPDATE SKIP LOCKED LIMIT 1 RETURNING id.
   * Multiple concurrent workers are safe | SKIP LOCKED prevents double-claim.
   *
   * @param claimTimeoutMs - Max milliseconds to hold the claim lock before
   *   marking the job failed (guards against crashed workers leaving jobs stuck
   *   in 'processing'). Default: 300_000 (5 minutes).
   * @returns ClaimResult | { claimed: true, importId } if a job was picked up,
   *   { claimed: false } if the queue was empty or all slots are taken.
   */
  processNextImport(claimTimeoutMs?: number): Promise<ClaimResult>
}
