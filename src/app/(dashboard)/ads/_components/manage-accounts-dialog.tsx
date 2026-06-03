'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Search } from 'lucide-react'
import { toast } from 'sonner'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  listManagedAdAccounts,
  setActiveAdAccounts,
  type ManagedAdAccount,
} from '@/app/(dashboard)/ads/_actions/account-selection'

export function ManageAccountsDialog({
  platform,
  open,
  onOpenChange,
}: {
  platform: 'meta' | 'google'
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [accounts, setAccounts] = React.useState<ManagedAdAccount[]>([])
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [query, setQuery] = React.useState('')

  React.useEffect(() => {
    if (!open) return
    setLoading(true)
    setQuery('')
    listManagedAdAccounts(platform)
      .then((a) => {
        setAccounts(a)
        setSelected(new Set(a.filter((x) => x.status === 'active').map((x) => x.ad_account_id)))
      })
      .catch(() => toast.error('Failed to load accounts'))
      .finally(() => setLoading(false))
  }, [open, platform])

  const filtered = accounts.filter((a) => {
    const q = query.toLowerCase()
    return (a.ad_account_name ?? a.ad_account_id).toLowerCase().includes(q) || a.ad_account_id.includes(q)
  })

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function save() {
    setSaving(true)
    try {
      const res = await setActiveAdAccounts(platform, [...selected])
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success('Accounts updated.')
      onOpenChange(false)
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Manage ad accounts</DialogTitle>
          <DialogDescription>
            Choose which accounts appear in this workspace. Unselected accounts stay connected but hidden.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" />
          </div>
        ) : accounts.length === 0 ? (
          <div className="py-8 text-center text-[13px] text-text-tertiary">No connected accounts found.</div>
        ) : (
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-tertiary" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search accounts..."
                className="w-full rounded-md border border-border-subtle bg-bg-secondary py-1.5 pl-8 pr-2 text-[12.5px] text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-text-tertiary">
              <span>{selected.size} of {accounts.length} selected</span>
              <div className="flex gap-3">
                <button
                  type="button"
                  className="hover:text-text-primary"
                  onClick={() => setSelected(new Set(accounts.map((a) => a.ad_account_id)))}
                >
                  Select all
                </button>
                <button
                  type="button"
                  className="hover:text-text-primary"
                  onClick={() => setSelected(new Set())}
                >
                  Clear
                </button>
              </div>
            </div>
            <div className="max-h-[45vh] space-y-0.5 overflow-y-auto">
              {filtered.map((a) => (
                <label
                  key={a.ad_account_id}
                  className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-bg-secondary"
                >
                  <Checkbox
                    checked={selected.has(a.ad_account_id)}
                    onCheckedChange={() => toggle(a.ad_account_id)}
                  />
                  <span className="truncate text-[13px] text-text-primary">
                    {a.ad_account_name ?? a.ad_account_id}
                  </span>
                </label>
              ))}
              {filtered.length === 0 && (
                <p className="px-2 py-4 text-center text-[12px] text-text-tertiary">No matches.</p>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || loading}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save selection
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
