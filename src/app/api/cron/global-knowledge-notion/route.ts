import {
  enqueueDueGlobalKnowledgeReconciliations,
  processNextGlobalKnowledgeSyncJob,
  recoverStaleGlobalKnowledgeSyncJobs,
} from '@/lib/knowledge/notion-sync'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return Response.json({ ok: false, error: 'CRON_SECRET is not configured' }, { status: 503 })
  }
  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const recovered = await recoverStaleGlobalKnowledgeSyncJobs()
  const enqueued = await enqueueDueGlobalKnowledgeReconciliations()
  let processed = 0
  for (let index = 0; index < 3; index += 1) {
    const result = await processNextGlobalKnowledgeSyncJob()
    if (!result.claimed) break
    processed += 1
  }
  return Response.json({ ok: true, recovered, enqueued, processed })
}
