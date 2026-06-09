// GET /api/v1/accounts
// Read-only endpoint — lists accounts (companies) for the caller's org with
// optional filtering and pagination, optionally joined with their latest
// completed website analysis.
//
// Auth: Authorization: Bearer <token>
//   Token is SHA-256 hashed and looked up in api_keys.key_hash.
//   The key must hold the `prospects:enrich` scope.
//
// Query params:
//   status         — filter by lifecycle_stage (e.g. "prospect")
//   limit          — page size 1-200, default 50
//   offset         — skip N records, default 0
//   has_analysis   — "true" to return only accounts that have at least one
//                    completed website analysis
//
// Returns:
//   { accounts: [{ id, name, domain, score, qualification_status,
//                  lifecycle_stage, website_analysis? }], total }

import { createHash } from 'node:crypto'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { hasScope } from '@/lib/api-keys/scopes'
import type { CrmLifecycleStage } from '@/types/database'

export const runtime = 'nodejs'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function GET(request: Request): Promise<Response> {
  // ── 1. Auth ────────────────────────────────────────────────────────────────
  const auth = request.headers.get('authorization') ?? ''
  if (!auth.startsWith('Bearer ')) {
    return Response.json({ error: 'Missing Bearer token' }, { status: 401, headers: CORS_HEADERS })
  }
  const token = auth.slice(7).trim()
  if (!token) {
    return Response.json({ error: 'Missing Bearer token' }, { status: 401, headers: CORS_HEADERS })
  }

  const supabase = createServiceRoleClient()
  const { data: apiKey } = await supabase
    .from('api_keys')
    .select('id, org_id, scopes')
    .eq('key_hash', hashToken(token))
    .is('revoked_at', null)
    .maybeSingle()

  if (!apiKey) {
    return Response.json({ error: 'Invalid or revoked API key' }, { status: 401, headers: CORS_HEADERS })
  }
  if (!hasScope(apiKey.scopes, 'prospects:enrich')) {
    return Response.json(
      { error: 'API key is missing the prospects:enrich scope' },
      { status: 403, headers: CORS_HEADERS },
    )
  }

  // ── 2. Parse query params ─────────────────────────────────────────────────
  const url = new URL(request.url)
  const statusParam = url.searchParams.get('status') ?? null
  const limitRaw = parseInt(url.searchParams.get('limit') ?? '50', 10)
  const offsetRaw = parseInt(url.searchParams.get('offset') ?? '0', 10)
  const hasAnalysis = url.searchParams.get('has_analysis') === 'true'

  const limit = Number.isFinite(limitRaw) && limitRaw >= 1 ? Math.min(limitRaw, 200) : 50
  const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0

  // ── 3. Query accounts ─────────────────────────────────────────────────────
  let query = supabase
    .from('accounts')
    .select('id, name, domain, score, qualification_status, lifecycle_stage', { count: 'exact' })
    .eq('org_id', apiKey.org_id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (statusParam) {
    query = query.eq('lifecycle_stage', statusParam as CrmLifecycleStage)
  }

  const { data: accounts, error, count } = await query

  if (error) {
    console.error('[api/v1/accounts] query error:', error)
    return Response.json({ error: 'Failed to fetch accounts' }, { status: 500, headers: CORS_HEADERS })
  }

  if (!accounts || accounts.length === 0) {
    return Response.json({ accounts: [], total: count ?? 0 }, { status: 200, headers: CORS_HEADERS })
  }

  // ── 4. Optionally join latest completed website_analysis ──────────────────
  const accountIds = accounts.map((a) => a.id)

  // website_analyses is not in the generated types yet — use `as any` (same pattern as analyze/route.ts)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: analyses } = await (supabase as any)
    .from('website_analyses')
    .select(
      'id, account_id, status, lead_score, brand_colors, logo_url, services, pain_points, screenshot_desktop_url, screenshot_mobile_url, analyzed_at',
    )
    .in('account_id', accountIds)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })

  // Build a map: account_id → first (latest) analysis
  const analysisMap: Record<string, Record<string, unknown>> = {}
  if (Array.isArray(analyses)) {
    for (const a of analyses) {
      if (!analysisMap[a.account_id]) {
        analysisMap[a.account_id] = a
      }
    }
  }

  // ── 5. Compose response ───────────────────────────────────────────────────
  const rows = accounts
    .map((acc) => {
      const analysis = analysisMap[acc.id] ?? null
      if (hasAnalysis && !analysis) return null
      return {
        id: acc.id,
        name: acc.name,
        domain: acc.domain,
        score: acc.score,
        qualification_status: acc.qualification_status,
        lifecycle_stage: acc.lifecycle_stage,
        ...(analysis ? { website_analysis: analysis } : {}),
      }
    })
    .filter(Boolean)

  // Adjust total when has_analysis filter is applied client-side
  const total = hasAnalysis ? rows.length : (count ?? 0)

  // Touch last_used_at (fire-and-forget)
  supabase
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', apiKey.id)
    .then(() => {})

  return Response.json({ accounts: rows, total }, { status: 200, headers: CORS_HEADERS })
}
