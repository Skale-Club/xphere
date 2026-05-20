import { Suspense } from 'react'
import { Building2 } from 'lucide-react'

import { getAccounts } from './actions'
import { getDefinitions } from '@/app/(dashboard)/settings/custom-fields/actions'
import { AccountsTable } from '@/components/accounts/accounts-table'
import { AccountsFilters } from '@/components/accounts/accounts-filters'
import { AccountsExportButton } from '@/components/accounts/accounts-export-button'
import { TableSkeleton } from '@/components/skeletons/table-skeleton'
import { ACCOUNT_SIZES, ACCOUNT_SOURCES } from '@/lib/accounts'

interface AccountsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function AccountsPage({ searchParams }: AccountsPageProps) {
  const sp = await searchParams

  const q = typeof sp.q === 'string' ? sp.q : undefined
  const industry = typeof sp.industry === 'string' ? sp.industry : undefined
  const tag = typeof sp.tag === 'string' ? sp.tag : undefined

  const sizeRaw = typeof sp.size === 'string' ? sp.size : undefined
  const size = sizeRaw && (ACCOUNT_SIZES as readonly string[]).includes(sizeRaw)
    ? (sizeRaw as (typeof ACCOUNT_SIZES)[number])
    : undefined

  const sourceRaw = typeof sp.source === 'string' ? sp.source : undefined
  const source = sourceRaw && (ACCOUNT_SOURCES as readonly string[]).includes(sourceRaw)
    ? (sourceRaw as (typeof ACCOUNT_SOURCES)[number])
    : undefined

  const assignedTo = typeof sp.assigned_to === 'string' ? sp.assigned_to : undefined

  const pageRaw = typeof sp.page === 'string' ? parseInt(sp.page, 10) : 1
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1

  const cfFilters: Record<string, string> = {}
  for (const [key, val] of Object.entries(sp)) {
    if (key.startsWith('cff_') && typeof val === 'string' && val) {
      cfFilters[key.slice(4)] = val
    }
  }

  return (
    <div className="mx-auto w-full max-w-none px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Hero */}
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
          <div className="shrink-0">
            <AccountsExportButton />
          </div>
        </div>
      </div>

      <AccountsFilters
        currentQuery={q}
        currentIndustry={industry}
        currentSize={size}
        currentTag={tag}
        currentAssignedTo={assignedTo}
        currentSource={source}
      />

      <Suspense fallback={<TableSkeleton rows={8} columns={8} />}>
        <AccountsBody
          q={q}
          industry={industry}
          size={size}
          tag={tag}
          assignedTo={assignedTo}
          source={source}
          page={page}
          cfFilters={cfFilters}
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
  cfFilters,
}: {
  q?: string
  industry?: string
  size?: (typeof ACCOUNT_SIZES)[number]
  tag?: string
  assignedTo?: string
  source?: (typeof ACCOUNT_SOURCES)[number]
  page: number
  cfFilters: Record<string, string>
}) {
  const [result, defsResult] = await Promise.all([
    getAccounts({ q, industry, size, tag, assignedTo, source, page, pageSize: 25 }, cfFilters),
    getDefinitions({ entity: 'account', includeArchived: false }),
  ])
  const defs = defsResult.ok ? defsResult.data : []
  const visibleDefs = defs.filter((d) => d.visible_in_list)
  const filterableDefs = defs.filter((d) => d.filterable)

  if (!result.ok) {
    return (
      <AccountsTable
        rows={[]}
        total={0}
        page={1}
        pageSize={25}
        visibleDefs={visibleDefs}
        filterableDefs={filterableDefs}
        activeCfFilters={cfFilters}
      />
    )
  }

  return (
    <AccountsTable
      rows={result.data.rows}
      total={result.data.total}
      page={result.data.page}
      pageSize={result.data.pageSize}
      visibleDefs={visibleDefs}
      filterableDefs={filterableDefs}
      activeCfFilters={cfFilters}
    />
  )
}
