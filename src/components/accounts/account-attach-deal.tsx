'use client'

/**
 * "Attach deal" control for the company modal. Search existing open deals that
 * aren't on a company yet and attach them (sets opportunities.account_id), or
 * create a brand-new deal scoped to this company via AddOpportunityDialog.
 *
 * Reuses searchOpportunities + setOpportunityAccount.
 */

import * as React from 'react'
import { toast } from 'sonner'
import { Search, TrendingUp, Plus, X } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { formatCurrency } from '@/lib/pipeline/format'
import {
  searchOpportunities,
  setOpportunityAccount,
} from '@/app/(dashboard)/pipeline/actions'
import { AddOpportunityDialog } from './add-opportunity-dialog'

interface DealSuggestion {
  id: string
  title: string | null
  value: number | null
  stage_name: string | null
}

interface AccountContact {
  id: string
  first_name?: string | null
  last_name?: string | null
  name: string | null
  phone: string | null
  email: string | null
}

interface AccountAttachDealProps {
  accountId: string
  accountContacts: AccountContact[]
  /** Called after a deal is attached or created so the parent can re-fetch. */
  onChanged: () => void
}

export function AccountAttachDeal({
  accountId,
  accountContacts,
  onChanged,
}: AccountAttachDealProps) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [suggestions, setSuggestions] = React.useState<DealSuggestion[]>([])
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    const t = setTimeout(async () => {
      const rows = await searchOpportunities(query)
      if (!cancelled) setSuggestions(rows)
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query, open])

  function close() {
    setOpen(false)
    setQuery('')
    setSuggestions([])
  }

  async function attach(opportunityId: string) {
    setBusy(true)
    const res = await setOpportunityAccount(opportunityId, accountId)
    setBusy(false)
    if (res && 'error' in res && res.error) {
      toast.error(res.error || 'Could not attach deal')
      return
    }
    toast.success('Deal attached')
    close()
    onChanged()
  }

  return (
    <div className="space-y-2">
      {!open ? (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-[8px] border border-dashed border-border-subtle px-3 py-2 text-[12px] font-medium text-text-secondary transition-colors hover:border-border hover:bg-bg-tertiary/40 hover:text-text-primary"
          >
            <TrendingUp className="h-3.5 w-3.5" />
            Attach deal
          </button>
          <AddOpportunityDialog
            accountId={accountId}
            accountContacts={accountContacts}
            onCreated={onChanged}
          >
            <button
              type="button"
              className="flex items-center justify-center gap-1.5 rounded-[8px] border border-dashed border-border-subtle px-3 py-2 text-[12px] font-medium text-text-secondary transition-colors hover:border-border hover:bg-bg-tertiary/40 hover:text-text-primary"
            >
              <Plus className="h-3.5 w-3.5" />
              New deal
            </button>
          </AddOpportunityDialog>
        </div>
      ) : (
        <div className="rounded-[10px] border border-border-subtle bg-bg-secondary/40 p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-tertiary" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search open deals by title"
              className="h-9 pl-8 pr-8 text-[13px]"
            />
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-1 max-h-[220px] overflow-y-auto">
            {suggestions.length === 0 ? (
              <p className="px-2 py-2 text-[12px] italic text-text-tertiary">
                No unattached open deals found.
              </p>
            ) : (
              suggestions.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  disabled={busy}
                  onClick={() => void attach(d.id)}
                  className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left hover:bg-bg-tertiary/60 disabled:opacity-60"
                >
                  <TrendingUp className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-text-primary">
                    {d.title || <span className="italic text-text-tertiary">Untitled deal</span>}
                  </span>
                  {d.stage_name && (
                    <span className="shrink-0 text-[11px] text-text-tertiary">{d.stage_name}</span>
                  )}
                  <span className="shrink-0 text-[11px] tabular-nums text-text-tertiary">
                    {d.value ? formatCurrency(Number(d.value)) : ''}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
