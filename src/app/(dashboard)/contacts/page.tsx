import { Suspense } from 'react'
import { Users, Plus } from 'lucide-react'

import { getContacts } from './actions'
import { getDefinitions } from '@/app/(dashboard)/settings/custom-fields/actions'
import { ContactsTable } from '@/components/contacts/contacts-table'
import { NewContactDialog } from '@/components/contacts/new-contact-dialog'
import { EmptyContacts } from '@/components/empty-states/empty-contacts'
import { Button } from '@/components/ui/button'
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
  const sort = typeof sp.sort === 'string' ? sp.sort : undefined
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
  sort?: string
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

  // Show EmptyContacts ONLY for the true unfiltered empty state | otherwise we
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

  const addButton = (
    <NewContactDialog
      trigger={
        <Button size="sm" className="h-8">
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Contact</span>
        </Button>
      }
    />
  )

  return (
    <ContactsTable
      rows={result.rows}
      total={result.total}
      page={result.page}
      pageSize={result.pageSize}
      allTags={result.allTags}
      currentTag={tag}
      currentSource={source}
      currentSort={sort ?? 'recent'}
      currentQuery={q}
      visibleDefs={visibleDefs}
      filterableDefs={filterableDefs}
      activeCfFilters={cfFilters}
      addButton={addButton}
    />
  )
}
