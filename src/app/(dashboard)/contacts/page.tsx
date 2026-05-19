import { Suspense } from 'react'
import { Sparkles, Users } from 'lucide-react'

import { getContacts } from './actions'
import { getDefinitions } from '@/app/(dashboard)/settings/custom-fields/actions'
import { ContactsTable } from '@/components/contacts/contacts-table'
import { NewContactDialog } from '@/components/contacts/new-contact-dialog'
import { ImportWizardDialog } from '@/components/contacts/import-wizard-dialog'
import { EmptyContacts } from '@/components/empty-states/empty-contacts'
import { TableSkeleton } from '@/components/skeletons/table-skeleton'
import { CONTACT_SOURCES } from '@/lib/contacts/zod-schemas'

interface ContactsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function ContactsPage({ searchParams }: ContactsPageProps) {
  const sp = await searchParams

  const q = typeof sp.q === 'string' ? sp.q : undefined
  const tag = typeof sp.tag === 'string' ? sp.tag : undefined
  const sourceRaw = typeof sp.source === 'string' ? sp.source : undefined
  const source = sourceRaw && (CONTACT_SOURCES as readonly string[]).includes(sourceRaw)
    ? (sourceRaw as (typeof CONTACT_SOURCES)[number])
    : undefined
  const sortRaw = typeof sp.sort === 'string' ? sp.sort : undefined
  const sort = sortRaw === 'name' ? 'name' : 'recent'
  const pageRaw = typeof sp.page === 'string' ? parseInt(sp.page, 10) : 1
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1

  // Extract custom field filters from cff_* URL params
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
          <Sparkles className="h-3.5 w-3.5 text-accent" />
          <span>CRM</span>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <h1 className="text-[28px] sm:text-[32px] font-semibold tracking-tight text-text-primary">
              Contacts
            </h1>
            <p className="mt-1 text-[14px] text-text-secondary">
              Every person you talk to, in one place. Conversations and calls link here automatically.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ImportWizardDialog />
            <NewContactDialog />
          </div>
        </div>
      </div>

      <Suspense fallback={<TableSkeleton rows={8} columns={5} />}>
        <ContactsBody
          q={q}
          tag={tag}
          source={source}
          sort={sort}
          page={page}
          cfFilters={cfFilters}
        />
      </Suspense>
    </div>
  )
}

async function ContactsBody({
  q,
  tag,
  source,
  sort,
  page,
  cfFilters,
}: {
  q?: string
  tag?: string
  source?: (typeof CONTACT_SOURCES)[number]
  sort: 'recent' | 'name'
  page: number
  cfFilters: Record<string, string>
}) {
  const [result, defsResult] = await Promise.all([
    getContacts({ q, tag, source, sort, page, pageSize: 25 }, cfFilters),
    getDefinitions({ entity: 'contact', includeArchived: false }),
  ])
  const defs = defsResult.ok ? defsResult.data : []
  const visibleDefs = defs.filter((d) => d.visible_in_list)
  const filterableDefs = defs.filter((d) => d.filterable)

  // Show EmptyContacts ONLY for the true unfiltered empty state — otherwise we
  // still want the toolbar and search visible so the user can clear filters.
  const noFilters = !q && !tag && !source && page === 1
  if (result.total === 0 && noFilters) {
    return (
      <div className="rounded-[12px] border border-border bg-bg-secondary p-2">
        <EmptyContacts />
        <div className="mt-3 flex items-center justify-center gap-2 pb-4">
          <div className="text-[11.5px] text-text-tertiary inline-flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" />
            Contacts created from inbound messages will appear here automatically.
          </div>
        </div>
      </div>
    )
  }

  return (
    <ContactsTable
      rows={result.rows}
      total={result.total}
      page={result.page}
      pageSize={result.pageSize}
      allTags={result.allTags}
      currentTag={tag}
      currentSource={source}
      currentSort={sort}
      currentQuery={q}
      visibleDefs={visibleDefs}
      filterableDefs={filterableDefs}
      activeCfFilters={cfFilters}
    />
  )
}
