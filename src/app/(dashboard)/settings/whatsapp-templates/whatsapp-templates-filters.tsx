'use client'

import { useMemo, useState } from 'react'

import { Input } from '@/components/ui/input'

// ── Types ────────────────────────────────────────────────────────────────────

interface FilterableTemplate {
  id: string
  name: string
  language: string
  category: string
  status: string
}

interface WhatsAppTemplatesFiltersProps<T extends FilterableTemplate> {
  templates: T[]
  statusOrder: string[]
  renderCard: (tpl: T) => React.ReactNode
}

// ── Component ────────────────────────────────────────────────────────────────

export function WhatsAppTemplatesFilters<T extends FilterableTemplate>({
  templates,
  statusOrder,
  renderCard,
}: WhatsAppTemplatesFiltersProps<T>) {
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [languageFilter, setLanguageFilter] = useState('')

  const categoryOptions = useMemo(
    () => Array.from(new Set(templates.map((t) => t.category))).sort(),
    [templates],
  )
  const languageOptions = useMemo(
    () => Array.from(new Set(templates.map((t) => t.language))).sort(),
    [templates],
  )

  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    return templates.filter((tpl) => {
      if (term && !tpl.name.toLowerCase().includes(term)) return false
      if (statusFilter && tpl.status.toUpperCase() !== statusFilter) return false
      if (categoryFilter && tpl.category !== categoryFilter) return false
      if (languageFilter && tpl.language !== languageFilter) return false
      return true
    })
  }, [templates, searchTerm, statusFilter, categoryFilter, languageFilter])

  const grouped = useMemo(() => groupByStatus(filtered, statusOrder), [filtered, statusOrder])

  const hasActiveFilter = Boolean(searchTerm || statusFilter || categoryFilter || languageFilter)
  const selectClassName =
    'w-full h-9 px-3 rounded-[8px] border border-border bg-bg-secondary text-[13px] text-text-primary'

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Input
          type="text"
          placeholder="Search by name…"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="max-w-xs"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className={`${selectClassName} w-auto`}
        >
          <option value="">All statuses</option>
          {statusOrder.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className={`${selectClassName} w-auto`}
        >
          <option value="">All categories</option>
          {categoryOptions.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
        <select
          value={languageFilter}
          onChange={(e) => setLanguageFilter(e.target.value)}
          className={`${selectClassName} w-auto`}
        >
          <option value="">All languages</option>
          {languageOptions.map((language) => (
            <option key={language} value={language}>
              {language}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 && hasActiveFilter ? (
        <p className="text-[13px] text-text-tertiary py-6 text-center">
          No templates match your filters.
        </p>
      ) : (
        <div className="space-y-6">
          {statusOrder.map((status) => {
            const list = grouped[status]
            if (!list || list.length === 0) return null
            return (
              <section key={status} className="space-y-2">
                <h2 className="text-[12px] font-medium uppercase tracking-wide text-text-tertiary">
                  {status} ({list.length})
                </h2>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {list.map((tpl) => renderCard(tpl))}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function groupByStatus<T extends FilterableTemplate>(
  rows: T[],
  statusOrder: string[],
): Record<string, T[]> {
  const out: Record<string, T[]> = {}
  for (const status of statusOrder) out[status] = []
  for (const r of rows) {
    const key = r.status?.toUpperCase()
    if (out[key]) out[key].push(r)
  }
  return out
}
