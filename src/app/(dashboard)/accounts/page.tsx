import { Suspense } from 'react'
import { Building2 } from 'lucide-react'

import { getAccounts } from './actions'
import { AccountsTable } from '@/components/accounts/accounts-table'
import { TableSkeleton } from '@/components/skeletons/table-skeleton'
import { ACCOUNT_SIZES, ACCOUNT_SOURCES } from '@/lib/accounts'
import type { AccountWithCounts } from '@/lib/accounts'

interface AccountsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function AccountsPage({ searchParams }: AccountsPageProps) {
  const sp = await searchParams

  const q = typeof sp.q === 'string' ? sp.q : undefined
  const industry = typeof sp.industry === 'string' ? sp.industry : undefined
  const sizeRaw = typeof sp.size === 'string' ? sp.size : undefined
  const size =
    sizeRaw && (ACCOUNT_SIZES as readonly string[]).includes(sizeRaw) ? sizeRaw : undefined
  const tag = typeof sp.tag === 'string' ? sp.tag : undefined
  const assignedTo = typeof sp.assigned_to === 'string' ? sp.assigned_to : undefined
  const sourceRaw = typeof sp.source === 'string' ? sp.source : undefined
  const source =
    sourceRaw && (ACCOUNT_SOURCES as readonly string[]).includes(sourceRaw)
      ? (sourceRaw as (typeof ACCOUNT_SOURCES)[number])
      : undefined
  const pageRaw = typeof sp.page === 'string' ? parseInt(sp.page, 10) : 1
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1

  return (
    <div className="mx-auto w-full max-w-none px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="animate-fade-in flex flex-col gap-2">
        <div className="flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
          <Building2 className="h-3.5 w-3.5 text-accent" />
          <span>CRM</span>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <h1 className="text-[28px] sm:text-[32px] font-semibold tracking-tight text-text-primary">
              Companies
            </h1>
            <p className="mt-1 text-[14px] text-text-secondary">
              Every company in your CRM, with linked contacts and open deals.
            </p>
          </div>
        </div>
      </div>

      <Suspense fallback={<TableSkeleton rows={8} columns={8} />}>
        <AccountsBody
          q={q}
          industry={industry}
          size={size}
          tag={tag}
          assignedTo={assignedTo}
          source={source}
          page={page}
        />
      </Suspense>
    </div>
  )
}

async function AccountsBody({
  q,
  industry,
  size,
  tag,
  assignedTo,
  source,
  page,
}: {
  q?: string
  industry?: string
  size?: string
  tag?: string
  assignedTo?: string
  source?: (typeof ACCOUNT_SOURCES)[number]
  page: number
}) {
  const result = await getAccounts({ q, industry, size, tag, assignedTo, source, page, pageSize: 25 })

  const rows: AccountWithCounts[] = result.ok ? result.data.rows : []
  const total = result.ok ? result.data.total : 0
  const currentPage = result.ok ? result.data.page : page
  const pageSize = result.ok ? result.data.pageSize : 25

  return (
    <AccountsTable
      rows={rows}
      total={total}
      page={currentPage}
      pageSize={pageSize}
    />
  )
}
