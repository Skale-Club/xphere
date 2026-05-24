'use client'

import * as React from 'react'
import { Search, Link2, Check, Briefcase } from 'lucide-react'
import { toast } from 'sonner'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { getOpportunities, linkContactToOpportunity } from '@/app/(dashboard)/pipeline/actions'
import { formatCurrency } from '@/lib/pipeline/format'
import { cn } from '@/lib/utils'

interface OpportunitySuggestion {
  id: string
  title: string
  value: number
  currency: string
  status: string
  stage?: { name: string; color: string } | null
  contact?: { name: string | null } | null
}

interface OpportunityLinkerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  contactId: string
  onLinked?: () => void
}

export function OpportunityLinkerDialog({
  open,
  onOpenChange,
  contactId,
  onLinked,
}: OpportunityLinkerDialogProps) {
  const [search, setSearch] = React.useState('')
  const [opportunities, setOpportunities] = React.useState<OpportunitySuggestion[]>([])
  const [loading, setLoading] = React.useState(false)
  const [linkingId, setLinkingId] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    setLoading(true)
    getOpportunities({}).then((rows) => {
      setLoading(false)
      setOpportunities(
        (rows as unknown[]).map((r: unknown) => {
          const row = r as Record<string, unknown>
          return {
            id: row.id as string,
            title: row.title as string,
            value: Number(row.value),
            currency: (row.currency as string) ?? 'USD',
            status: row.status as string,
            stage: (row.stage as { name: string; color: string } | null) ?? null,
            contact: (row.contact as { name: string | null } | null) ?? null,
          }
        }),
      )
    })
  }, [open])

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return opportunities
    return opportunities.filter((o) => o.title.toLowerCase().includes(q))
  }, [opportunities, search])

  async function handleLink(oppId: string) {
    setLinkingId(oppId)
    const res = await linkContactToOpportunity(oppId, contactId, false)
    setLinkingId(null)
    if (res && 'error' in res && res.error) {
      toast.error(res.error)
      return
    }
    toast.success('Contact linked to deal')
    onOpenChange(false)
    onLinked?.()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md flex flex-col max-h-[calc(100vh-2rem)]">
        <DialogHeader>
          <DialogTitle>Link existing deal</DialogTitle>
          <DialogDescription>
            Attach this contact to an existing opportunity in the pipeline.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-tertiary" />
          <Input
            placeholder="Search deals…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 pl-9 text-[13px]"
          />
        </div>

        <ScrollArea className="min-h-0 flex-1 -mx-2 px-2">
          <div className="flex flex-col gap-1.5 py-1">
            {loading && (
              <div className="space-y-2 animate-pulse">
                <div className="h-12 rounded-lg bg-bg-tertiary" />
                <div className="h-12 rounded-lg bg-bg-tertiary" />
                <div className="h-12 rounded-lg bg-bg-tertiary" />
              </div>
            )}

            {!loading && filtered.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <Briefcase className="h-8 w-8 text-text-tertiary" />
                <p className="text-[12.5px] text-text-secondary">
                  {search.trim() ? 'No deals match your search.' : 'No deals in the pipeline yet.'}
                </p>
              </div>
            )}

            {filtered.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => handleLink(o.id)}
                disabled={linkingId === o.id}
                className={cn(
                  'flex items-center gap-3 rounded-[8px] border border-border-subtle bg-bg-secondary px-3 py-2.5 text-left transition-colors',
                  'hover:border-border-strong hover:bg-bg-tertiary/40',
                  linkingId === o.id && 'opacity-60',
                )}
              >
                <div
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: o.stage?.color ?? '#6366F1' }}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-medium text-text-primary">
                    {o.title}
                  </div>
                  <div className="text-[11px] text-text-tertiary">
                    {o.stage?.name ?? 'Pipeline'} · {formatCurrency(o.value, o.currency)}
                  </div>
                </div>
                {linkingId === o.id ? (
                  <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                ) : (
                  <TooltipProvider delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Link2 className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
                      </TooltipTrigger>
                      <TooltipContent side="left">Link to this contact</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </button>
            ))}
          </div>
        </ScrollArea>

        <div className="flex justify-end gap-2 pt-2 border-t border-border-subtle">
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
