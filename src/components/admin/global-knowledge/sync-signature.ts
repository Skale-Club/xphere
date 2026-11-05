/**
 * A compact fingerprint of the most recent Notion sync jobs. The knowledge
 * manager polls it and refreshes the page only when it changes, which is what
 * the old Realtime subscription on global_knowledge_sync_jobs did on every
 * insert/update.
 */
export interface SyncJobLike {
  id: string
  status: string
  error_detail: string | null
}

export function syncJobsSignature(jobs: ReadonlyArray<SyncJobLike>): string {
  return jobs.map((j) => `${j.id}:${j.status}:${j.error_detail ?? ''}`).join('|')
}

/** True while any job is still waiting or running (poll faster). */
export function hasActiveSyncJob(jobs: ReadonlyArray<Pick<SyncJobLike, 'status'>>): boolean {
  return jobs.some((j) => j.status === 'queued' || j.status === 'processing')
}
