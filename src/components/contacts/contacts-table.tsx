'use client'

import * as React from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Search, Filter, X, ChevronDown, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ContactDetailSheet } from './contact-detail-sheet'
import { CustomFieldsFilterBar } from '@/components/custom-fields/custom-fields-filter-bar'
import { deleteContacts, exportContactsCsv } from '@/app/(dashboard)/contacts/actions'
import type { Database } from '@/types/database'
import type { TagRow } from '@/app/(dashboard)/settings/tags/actions'
import type { CustomFieldDefinitionRow } from '@/app/(dashboard)/settings/custom-fields/actions'
import { FIELD_RENDER_CONFIG } from '@/lib/custom-fields/render-config'
import type { CustomFieldType } from '@/types/database'
import { CONTACT_SOURCES } from '@/lib/contacts/zod-schemas'
import { displayContactName, initialsFromContactName } from '@/lib/contacts/names'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { useBreadcrumbOverride } from '@/components/layout/breadcrumb-override-context'

type ContactRow = Database['public']['Tables']['contacts']['Row']

interface ContactsTableProps {
  rows: ContactRow[]
  total: number
  page: number
  pageSize: number
  allTags: TagRow[]
  currentTag?: string
  currentSource?: string
  currentSort: string
  currentQuery?: string
  visibleDefs?: CustomFieldDefinitionRow[]
  filterableDefs?: CustomFieldDefinitionRow[]
  activeCfFilters?: Record<string, string>
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.round(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

export function ContactsTable({
  rows,
  total,
  page,
  pageSize,
  allTags,
  currentTag,
  currentSource,
  currentSort,
  currentQuery,
  visibleDefs = [],
  filterableDefs = [],
  activeCfFilters = {},
}: ContactsTableProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { setSuffix } = useBreadcrumbOverride()

  React.useEffect(() => {
    setSuffix(<Badge variant="secondary">{total}</Badge>)
    return () => setSuffix(null)
  }, [total, setSuffix])

  const [query, setQuery] = React.useState(currentQuery ?? '')
  const [openId, setOpenId] = React.useState<string | null>(null)
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  // Optimistic "pending delete" set | rows fade out immediately on delete
  // and snap back if the server returns an error.
  const [pendingDelete, setPendingDelete] = React.useState<Set<string>>(new Set())

  // Reset selection when rows change
  React.useEffect(() => {
    setSelected(new Set())
    setPendingDelete(new Set())
  }, [rows])

  // Debounced search → URL
  React.useEffect(() => {
    if ((currentQuery ?? '') === query) return
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString())
      if (query) params.set('q', query)
      else params.delete('q')
      params.delete('page')
      router.replace(`${pathname}?${params.toString()}`)
    }, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  function setParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    if (key !== 'page') params.delete('page')
    router.replace(`${pathname}?${params.toString()}`)
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selected.size === rows.length && rows.length > 0) {
      setSelected(new Set())
    } else {
      setSelected(new Set(rows.map((r) => r.id)))
    }
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return
    if (!confirm(`Delete ${selected.size} contact(s)? This cannot be undone.`)) return
    const ids = [...selected]
    // Optimistic: mark rows as pending-delete so they fade out instantly.
    setPendingDelete(new Set(ids))
    const res = await deleteContacts(ids)
    if (res.error) {
      // Rollback the visual change on error.
      setPendingDelete(new Set())
      toast.error(res.error)
      return
    }
    toast.success(`Deleted ${res.deleted ?? 0} contact(s)`)
    setSelected(new Set())
    router.refresh()
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const showFilters = Boolean(currentTag || currentSource)

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
        <div className="relative flex-1 max-w-xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, phone, email or company…"
            className="pl-9 h-10 text-[13.5px]"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Select
            value={currentSource ?? 'all'}
            onValueChange={(v) => setParam('source', v === 'all' ? null : v)}
          >
            <SelectTrigger className="h-10 w-[140px] text-[12.5px]">
              <Filter className="h-3.5 w-3.5 text-text-tertiary" />
              <SelectValue placeholder="Source" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              {CONTACT_SOURCES.map((s) => (
                <SelectItem key={s} value={s}>
                  {sourceLabel(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={currentSort} onValueChange={(v) => setParam('sort', v === 'recent' ? null : v)}>
            <SelectTrigger className="h-10 w-[130px] text-[12.5px]">
              <ChevronDown className="h-3.5 w-3.5 text-text-tertiary" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">Most recent</SelectItem>
              <SelectItem value="name">By name</SelectItem>
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              const res = await exportContactsCsv()
              if (res.error) { toast.error(res.error); return }
              if (!res.csv) return
              const blob = new Blob([res.csv], { type: 'text/csv;charset=utf-8;' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url; a.download = 'contacts.csv'; a.click()
              URL.revokeObjectURL(url)
            }}
            className="text-[12.5px]"
          >
            Export CSV
          </Button>
        </div>
      </div>

      {filterableDefs.length > 0 && (
        <CustomFieldsFilterBar
          filterableDefs={filterableDefs}
          activeFilters={activeCfFilters}
          onChange={(key, value) => setParam(`cff_${key}`, value)}
        />
      )}

      {/* Tag chips */}
      {allTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-text-tertiary mr-1">Tags</span>
          {allTags.map((t) => (
            <TagChip
              key={t.id}
              label={t.name}
              color={t.color}
              active={currentTag === t.id || currentTag === t.name || currentTag === t.slug}
              onClick={() => setParam('tag', (currentTag === t.id || currentTag === t.name || currentTag === t.slug) ? null : t.id)}
            />
          ))}
        </div>
      )}

      {/* Bulk actions bar */}
      {selected.size > 0 && (
        <div className="flex items-center justify-between rounded-[10px] border border-accent/30 bg-accent-muted/40 px-3 py-2">
          <span className="text-[12.5px] text-text-primary">
            {selected.size} selected
          </span>
          <Button size="sm" variant="ghost" onClick={handleBulkDelete} className="text-rose-400 hover:text-rose-300">
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
        </div>
      )}

      {/* Table */}
      <div className="rounded-[12px] border border-border bg-bg-secondary overflow-hidden">
        <div
          className="grid items-center gap-3 px-4 py-2.5 border-b border-border-subtle bg-bg-secondary text-[11px] font-medium uppercase tracking-wide text-text-tertiary"
          style={{ gridTemplateColumns: `40px 2fr 1.5fr 1.2fr 1fr${visibleDefs.map(() => ' 1fr').join('')} 100px` }}
        >
          <Checkbox
            checked={selected.size === rows.length && rows.length > 0}
            onCheckedChange={toggleAll}
            aria-label="Select all"
          />
          <div>Contact</div>
          <div>Phone</div>
          <div>Email</div>
          <div>Tags</div>
          {visibleDefs.map((def) => (
            <div key={def.id}>{def.label}</div>
          ))}
          <div className="text-right">Added</div>
        </div>

        {rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13px] text-text-secondary">
            {showFilters || currentQuery
              ? 'No contacts match your filters.'
              : 'No contacts to show yet.'}
          </div>
        ) : (
          <div className="divide-y divide-border-subtle">
            {rows.map((c) => (
              <div
                key={c.id}
                role="button"
                tabIndex={0}
                onClick={() => setOpenId(c.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setOpenId(c.id)
                  }
                }}
                className={cn(
                  'grid items-center gap-3 px-4 py-3 cursor-pointer',
                  'transition-all duration-200 ease-out hover:bg-bg-tertiary/40 focus:outline-none focus-visible:bg-bg-tertiary/40',
                  pendingDelete.has(c.id) && 'opacity-30 -translate-x-2 pointer-events-none',
                )}
                style={{ gridTemplateColumns: `40px 2fr 1.5fr 1.2fr 1fr${visibleDefs.map(() => ' 1fr').join('')} 100px` }}
              >
                <div onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={selected.has(c.id)}
                    onCheckedChange={() => toggleRow(c.id)}
                    aria-label={`Select ${displayContactName(c, 'contact')}`}
                  />
                </div>
                <div className="flex items-center gap-2.5 min-w-0">
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarFallback className="text-[11px] font-semibold bg-accent-muted text-accent">
                      {initialsFromContactName(c, c.email ?? c.phone ?? '?')}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium text-text-primary">
                      {displayContactName(c, '') || <span className="italic text-text-tertiary">Unnamed</span>}
                    </div>
                    {c.company && (
                      <div className="truncate text-[11.5px] text-text-tertiary">{c.company}</div>
                    )}
                  </div>
                </div>
                <div className="truncate text-[12.5px] text-text-secondary tabular-nums">
                  {c.phone || '|'}
                </div>
                <div className="truncate text-[12.5px] text-text-secondary">{c.email || '|'}</div>
                <div className="flex flex-wrap gap-1 overflow-hidden">
                  {c.tags.slice(0, 2).map((tagName) => {
                    const tagObj = allTags.find((t) => t.name === tagName || t.slug === tagName.toLowerCase())
                    return tagObj ? (
                      <span
                        key={tagName}
                        className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium"
                        style={{
                          backgroundColor: `${tagObj.color}22`,
                          borderColor: `${tagObj.color}44`,
                          color: tagObj.color,
                        }}
                      >
                        <span className="h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: tagObj.color }} />
                        {tagName}
                      </span>
                    ) : (
                      <span
                        key={tagName}
                        className="inline-flex items-center rounded-full bg-accent-muted px-2 py-0.5 text-[10.5px] font-medium text-accent"
                      >
                        {tagName}
                      </span>
                    )
                  })}
                  {c.tags.length > 2 && (
                    <span className="text-[10.5px] text-text-tertiary">+{c.tags.length - 2}</span>
                  )}
                </div>
                {visibleDefs.map((def) => {
                  const cf = (c.custom_fields ?? {}) as Record<string, unknown>
                  const val = cf[def.key]
                  const config = FIELD_RENDER_CONFIG[def.type as CustomFieldType]
                  const display = val !== undefined && val !== null ? config.displayFormatter(val) : '|'
                  return (
                    <div key={def.id} className="truncate text-[12.5px] text-text-secondary">
                      {display}
                    </div>
                  )
                })}
                <div className="text-right text-[11.5px] text-text-tertiary">
                  {relativeTime(c.created_at)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-[12px] text-text-tertiary">
            Page {page} of {totalPages} · {total} total
          </span>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              disabled={page <= 1}
              onClick={() => setParam('page', String(page - 1))}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={page >= totalPages}
              onClick={() => setParam('page', String(page + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <ContactDetailSheet contactId={openId} onOpenChange={(o) => !o && setOpenId(null)} />
    </div>
  )
}

function TagChip({
  label,
  color,
  active,
  onClick,
}: {
  label: string
  color?: string
  active?: boolean
  onClick: () => void
}) {
  const style = active && color
    ? { backgroundColor: `${color}33`, borderColor: color, color }
    : color
    ? { backgroundColor: `${color}15`, borderColor: `${color}44`, color }
    : undefined

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11.5px] font-medium transition-colors duration-150',
        !color && (active
          ? 'border-accent bg-accent text-accent-foreground'
          : 'border-border-subtle bg-bg-secondary text-text-secondary hover:border-border-strong hover:text-text-primary'),
      )}
      style={style}
    >
      {color && <span className="h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />}
      {label}
      {active && <X className="h-3 w-3" />}
    </button>
  )
}

function sourceLabel(s: string): string {
  switch (s) {
    case 'manual':
      return 'Manual'
    case 'whatsapp':
      return 'WhatsApp'
    case 'sms':
      return 'SMS'
    case 'instagram':
      return 'Instagram'
    case 'csv_import':
      return 'CSV import'
    case 'ghl_sync':
      return 'GHL sync'
    default:
      return s
  }
}
