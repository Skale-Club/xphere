import Link from 'next/link'
import { Building2 } from 'lucide-react'

import { createClient } from '@/lib/supabase/server'
import { WidgetCard } from '@/components/dashboard/widget-card'
import { WidgetEmpty } from '@/components/dashboard/widget-empty'
import { formatCurrency } from '@/lib/pipeline/format'

interface TopAccount {
  id: string
  name: string
  open_opportunity_count: number
  pipeline_value: number
}

/**
 * Top Companies widget: shows up to 5 accounts ranked by open opportunity
 * count DESC, breaking ties by pipeline value DESC. Queries open opportunities
 * directly (two Supabase calls) to avoid schema changes on AccountRow.
 *
 * Satisfies ACC-18 (v2.4 Phase 66-05).
 */
export async function TopCompanies() {
  let topAccounts: TopAccount[] = []

  try {
    const supabase = await createClient()

    // Fetch all accounts (name + id only — lightweight)
    const { data: accounts } = await supabase
      .from('accounts')
      .select('id, name')
      .order('name', { ascending: true, nullsFirst: false })
      .limit(200)

    if (accounts && accounts.length > 0) {
      // Fetch open opportunities with value for the same org (RLS-scoped)
      const { data: opps } = await supabase
        .from('opportunities')
        .select('account_id, value')
        .eq('status', 'open')
        .not('account_id', 'is', null)

      // Aggregate per account
      const byAccount = new Map<string, { count: number; value: number }>()
      for (const opp of opps ?? []) {
        if (!opp.account_id) continue
        const cur = byAccount.get(opp.account_id) ?? { count: 0, value: 0 }
        cur.count += 1
        cur.value += Number(opp.value) || 0
        byAccount.set(opp.account_id, cur)
      }

      // Only include accounts with at least one open opportunity
      topAccounts = accounts
        .map((a) => {
          const agg = byAccount.get(a.id) ?? { count: 0, value: 0 }
          return {
            id: a.id,
            name: a.name,
            open_opportunity_count: agg.count,
            pipeline_value: agg.value,
          }
        })
        .filter((a) => a.open_opportunity_count > 0)
        // Sort by open deal count DESC, then pipeline value DESC for ties
        .sort((a, b) => {
          const byDeals = b.open_opportunity_count - a.open_opportunity_count
          if (byDeals !== 0) return byDeals
          return b.pipeline_value - a.pipeline_value
        })
        .slice(0, 5)
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[dashboard:top-companies]', err)
  }

  if (topAccounts.length === 0) {
    return (
      <WidgetCard title="Top Companies" icon={Building2} href="/accounts" hrefLabel="View all">
        <WidgetEmpty
          icon={Building2}
          title="No active deals yet"
          description="Companies with open opportunities will appear here."
          cta={{ label: 'View companies', href: '/accounts' }}
        />
      </WidgetCard>
    )
  }

  return (
    <WidgetCard title="Top Companies" icon={Building2} href="/accounts" hrefLabel="View all">
      <div className="flex flex-col gap-1.5">
        {topAccounts.map((account, i) => (
          <Link
            key={account.id}
            href={`/accounts/${account.id}`}
            className="group flex items-center gap-3 rounded-[8px] px-2 py-2 transition-colors hover:bg-bg-tertiary"
          >
            <span className="w-5 text-center text-[11.5px] font-semibold text-text-tertiary tabular-nums">
              {i + 1}
            </span>
            <span className="flex-1 truncate text-[13px] font-medium text-text-primary">
              {account.name}
            </span>
            <span className="shrink-0 text-[12px] text-text-tertiary tabular-nums">
              {account.open_opportunity_count}{' '}
              {account.open_opportunity_count === 1 ? 'deal' : 'deals'}
            </span>
            <span className="shrink-0 text-[12px] text-text-secondary tabular-nums">
              {formatCurrency(account.pipeline_value)}
            </span>
          </Link>
        ))}
      </div>
    </WidgetCard>
  )
}
