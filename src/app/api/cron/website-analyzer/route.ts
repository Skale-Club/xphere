// Cron: website-analyzer
// Finds prospect accounts with no completed website analysis in the last 7 days
// and kicks off analysis for up to 10 at a time.
//
// Auth: Authorization: Bearer $CRON_SECRET
// Triggered by .github/workflows/website-analyzer.yml (every 10 minutes)

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { createClient } from '@supabase/supabase-js'
import { runAnalysis } from '@/services/website-analyzer'
import { captureApiError } from '@/lib/api-error'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const CRON_SECRET = process.env.CRON_SECRET
const BATCH_SIZE = 10

export async function GET(request: Request): Promise<Response> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  if (CRON_SECRET) {
    const auth = request.headers.get('authorization') ?? ''
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return Response.json({ ok: false, error: 'Supabase env not set' }, { status: 500 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } }) as any

  // ── Find prospect accounts eligible for analysis ──────────────────────────
  // Eligible: lifecycle_stage='prospect', domain IS NOT NULL, and no completed
  // analysis in the last 7 days (avoids re-running recently analyzed accounts).
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3_600_000).toISOString()

  // Get accounts that have no recent completed analysis
  const { data: accounts, error: accountsError } = await supabase
    .from('accounts')
    .select('id, org_id, domain, name')
    .eq('lifecycle_stage', 'prospect')
    .not('domain', 'is', null)
    .neq('domain', '')
    .limit(50) // fetch more, we'll filter below

  if (accountsError) {
    console.error('[cron/website-analyzer] failed to fetch accounts:', accountsError)
    return Response.json({ ok: false, error: 'Failed to fetch accounts' }, { status: 500 })
  }

  if (!accounts?.length) {
    return Response.json({ ok: true, processed: 0, accounts: [] })
  }

  const accountIds: string[] = accounts.map((a: { id: string }) => a.id)

  // Find accounts that already have a completed analysis in the last 7 days
  const { data: recentAnalyses } = await supabase
    .from('website_analyses')
    .select('account_id')
    .in('account_id', accountIds)
    .eq('status', 'completed')
    .gte('analyzed_at', sevenDaysAgo)

  const recentlyAnalyzed = new Set<string>((recentAnalyses ?? []).map((r: { account_id: string }) => r.account_id))

  // Find accounts with a currently running/pending analysis (avoid duplicates)
  const { data: activeAnalyses } = await supabase
    .from('website_analyses')
    .select('account_id')
    .in('account_id', accountIds)
    .in('status', ['pending', 'running'])

  const currentlyActive = new Set<string>((activeAnalyses ?? []).map((r: { account_id: string }) => r.account_id))

  // Filter eligible accounts
  const eligible = (accounts as Array<{ id: string; org_id: string; domain: string; name: string }>)
    .filter((a) => !recentlyAnalyzed.has(a.id) && !currentlyActive.has(a.id))
    .slice(0, BATCH_SIZE)

  if (!eligible.length) {
    return Response.json({ ok: true, processed: 0, accounts: [] })
  }

  // ── Kick off analysis for each eligible account ───────────────────────────
  const processed: Array<{ id: string; domain: string }> = []

  for (const account of eligible) {
    try {
      // Create pending analysis row
      const { data: analysis, error: insertError } = await supabase
        .from('website_analyses')
        .insert({ org_id: account.org_id, account_id: account.id, status: 'pending' })
        .select('id')
        .single()

      if (insertError || !analysis) {
        console.error(`[cron/website-analyzer] failed to create analysis for account ${account.id}:`, insertError)
        continue
      }

      // Fire-and-forget
      runAnalysis({
        analysisId: analysis.id,
        orgId: account.org_id,
        accountId: account.id,
        domain: account.domain,
      }).catch((err) => {
        console.error(`[cron/website-analyzer] runAnalysis error for account=${account.id}:`, err)
        captureApiError(err)
      })

      processed.push({ id: account.id, domain: account.domain })
      console.log(`[cron/website-analyzer] triggered analysis for account_id=${account.id} domain=${account.domain}`)
    } catch (err) {
      console.error(`[cron/website-analyzer] unexpected error for account=${account.id}:`, err)
      captureApiError(err)
    }
  }

  return Response.json({ ok: true, processed: processed.length, accounts: processed })
}
