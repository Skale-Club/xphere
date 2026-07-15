// POST /api/email-templates/assets/cleanup | deletes unreferenced images
// from the org's prefix in the email-assets bucket.
// email-builder-hardening PLAN.md Phase 5 (orphan-asset cleanup).
//
// Manual-trigger for now: no schedule wired up. A follow-up can call this
// from a scheduled GitHub Action the same way the existing cron-tick /
// keepalive workflows hit their endpoints (see .github/workflows/) — this
// route is written to be safely re-run repeatedly (idempotent: it only
// ever deletes objects it can prove are unreferenced and old enough).
//
// Auth: signed-in user (401 otherwise). Requires an explicit
// `{ "confirm": true }` JSON body (400 otherwise) since this is a delete.
//
// Algorithm: list every Storage object under the org's prefix, build a
// haystack of every email_templates.document/html_snapshot and
// email_section_templates.document row for the org, and delete objects
// whose storage path does NOT appear in that haystack AND were created more
// than 7 days ago (grace period so an asset uploaded seconds before a save
// completes is never caught mid-flight). See
// src/lib/email/asset-references.ts for the pure matching/partition logic.

import { getUser, createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { partitionOrphanAssets, buildReferenceHaystack, type OrphanCandidate } from '@/lib/email/asset-references'

export const runtime = 'nodejs'

const LIST_PAGE_SIZE = 1000
const MAX_LIST_PAGES = 20 // safety bound: up to 20k objects per org per run
const REMOVE_CHUNK_SIZE = 100

export async function POST(request: Request): Promise<Response> {
  const user = await getUser()
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body || typeof body !== 'object' || (body as { confirm?: unknown }).confirm !== true) {
    return Response.json({ error: 'Request body must be { "confirm": true }' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: orgData } = await supabase.rpc('get_current_org_id' as never)
  const orgId = orgData as string | null
  if (!orgId) {
    return Response.json({ error: 'No active org' }, { status: 400 })
  }

  try {
    const admin = createServiceRoleClient()

    // ── Collect every asset reference for the org ──────────────────────────
    const [templatesRes, sectionsRes] = await Promise.all([
      admin.from('email_templates').select('document, html_snapshot').eq('org_id', orgId),
      admin.from('email_section_templates').select('document').eq('org_id', orgId),
    ])

    if (templatesRes.error || sectionsRes.error) {
      const msg = templatesRes.error?.message ?? sectionsRes.error?.message ?? 'unknown_error'
      console.error('[email-templates/assets/cleanup] Reference query error:', msg)
      return Response.json({ error: 'Cleanup failed' }, { status: 500 })
    }

    const haystack = buildReferenceHaystack([
      ...(templatesRes.data ?? []).flatMap((t) => [t.document, t.html_snapshot]),
      ...(sectionsRes.data ?? []).map((s) => s.document),
    ])

    // ── List every Storage object under the org's prefix (paginated) ───────
    const candidates: OrphanCandidate[] = []
    for (let page = 0; page < MAX_LIST_PAGES; page++) {
      const { data, error } = await admin.storage
        .from('email-assets')
        .list(orgId, { limit: LIST_PAGE_SIZE, offset: page * LIST_PAGE_SIZE })

      if (error) {
        console.error('[email-templates/assets/cleanup] Storage list error:', error.message)
        return Response.json({ error: 'Cleanup failed' }, { status: 500 })
      }
      if (!data || data.length === 0) break

      for (const obj of data) {
        if (!obj.id) continue // folder placeholder entries have a null id
        candidates.push({ path: `${orgId}/${obj.name}`, createdAt: obj.created_at })
      }

      if (data.length < LIST_PAGE_SIZE) break
    }

    // ── Partition + delete ──────────────────────────────────────────────────
    const { toDelete, toKeep } = partitionOrphanAssets(candidates, haystack)

    let deleted = 0
    for (let i = 0; i < toDelete.length; i += REMOVE_CHUNK_SIZE) {
      const chunkPaths = toDelete.slice(i, i + REMOVE_CHUNK_SIZE).map((c) => c.path)
      const { error: removeError } = await admin.storage.from('email-assets').remove(chunkPaths)
      if (removeError) {
        console.error('[email-templates/assets/cleanup] Remove error:', removeError.message)
        continue
      }
      deleted += chunkPaths.length
    }

    return Response.json({ deleted, kept: toKeep.length + (toDelete.length - deleted) }, { status: 200 })
  } catch (err) {
    console.error('[email-templates/assets/cleanup] Unexpected error:', err)
    return Response.json({ error: 'Cleanup failed' }, { status: 500 })
  }
}
