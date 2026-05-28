'use client'

/**
 * AccountDetailSheet.
 *
 * Dialog that opens when a row is clicked on the /companies (accounts) list.
 * Mirrors the chat info panel's inline-edit shape: every editable field is
 * its own InlineEditField — click, type, Save/Enter, Esc cancels. No big
 * Edit/Save toolbar at the bottom.
 *
 * What's in here today:
 *   - Header: name (inline, large)
 *   - Source / Added / Updated badges
 *   - Info grid (2 cols on md+):
 *       Domain · Website · Industry · Size · Phone · Address
 *   - Notes (multiline, full width)
 *   - Tags (display-only for now)
 *   - Stats row: contacts · open deals · pipeline value
 *   - Linked contacts list (jumps to /chat?contact=<id>)
 *   - Linked opportunities list (jumps to /pipeline/<id>)
 *   - Footer: "Open full page" → /accounts/<id>, plus Delete
 *
 * Out of scope for this iteration (still go to the full /accounts/<id> page):
 *   - Custom fields editor
 *   - Tasks / Notes / Activities tabs
 *   - Assigned-to picker, tag editor
 *
 * Server actions:
 *   - getAccountDetail(id)          loader
 *   - getAccountOpportunities(id)   opportunities for the stats + list
 *   - updateAccountField(id, …)     per-field inline edits
 *   - deleteAccount(id)             footer delete
 */

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Building2,
  Globe,
  Briefcase,
  Users,
  Phone,
  MapPin,
  FileText,
  TrendingUp,
  Trash2,
  ExternalLink,
  Loader2,
  Hash,
} from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { InlineEditField } from '@/components/chat/inline-edit-field'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { formatCurrency } from '@/lib/pipeline/format'
import { initialsFromContactName, displayContactName } from '@/lib/contacts/names'
import {
  updateAccountField,
  deleteAccount,
} from '@/app/(dashboard)/companies/actions'
import {
  getAccountDetail,
  getAccountOpportunities,
  type ContactRow,
  type OpportunityWithStage,
} from '@/app/(dashboard)/companies/[id]/actions'
import type { AccountRow } from '@/lib/accounts'

export interface AccountDetailSheetProps {
  accountId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after a successful delete or a saved field — lets the parent table refresh its counts. */
  onChanged?: () => void
}

interface DetailState {
  account: AccountRow
  contacts: ContactRow[]
  opportunities: OpportunityWithStage[]
}

function relative(iso: string | null): string {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.round(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d ago`
  const mo = Math.round(d / 30)
  return `${mo}mo ago`
}

export function AccountDetailSheet({
  accountId,
  open,
  onOpenChange,
  onChanged,
}: AccountDetailSheetProps) {
  const router = useRouter()
  const [state, setState] = React.useState<DetailState | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)

  // Load fresh data each time the dialog opens for a new account. Two parallel
  // queries: account+contacts and opportunities (separate action because the
  // opportunities query has its own OR-on-contact-ids fan-out).
  React.useEffect(() => {
    if (!open || !accountId) {
      setState(null)
      return
    }
    let cancelled = false
    setLoading(true)
    ;(async () => {
      const [detail, oppsRes] = await Promise.all([
        getAccountDetail(accountId),
        getAccountOpportunities(accountId),
      ])
      if (cancelled) return
      if (!detail.ok) {
        toast.error('Could not load company')
        onOpenChange(false)
        setLoading(false)
        return
      }
      setState({
        account: detail.data.account,
        contacts: detail.data.contacts,
        opportunities: oppsRes.ok ? oppsRes.data : [],
      })
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [accountId, open, onOpenChange])

  // Per-field save handler that commits a single column and patches the
  // in-memory account so the next edit picks up the new baseline.
  const saveField = React.useCallback(
    (field: string) => async (next: string) => {
      if (!state) return
      const res = await updateAccountField(state.account.id, { field, value: next })
      if (!res.ok) throw new Error(res.error)
      setState((prev) =>
        prev
          ? {
              ...prev,
              account: {
                ...prev.account,
                // Persist what the server normalised by re-fetching just this row
                // would be cleaner, but for inline UX the locally-trimmed value
                // matches reality close enough until the parent revalidates.
                [field]: next.trim() === '' && field !== 'name' ? null : next.trim(),
              } as AccountRow,
            }
          : prev,
      )
      onChanged?.()
    },
    [state, onChanged],
  )

  const handleDelete = React.useCallback(async () => {
    if (!state) return
    setDeleting(true)
    const res = await deleteAccount(state.account.id)
    setDeleting(false)
    setConfirmDelete(false)
    if (!res.ok) {
      toast.error(res.error || 'Could not delete company')
      return
    }
    toast.success('Company deleted')
    onOpenChange(false)
    onChanged?.()
    router.refresh()
  }, [state, onOpenChange, onChanged, router])

  const account = state?.account
  const contacts = state?.contacts ?? []
  const opportunities = state?.opportunities ?? []
  const openDeals = opportunities.filter(
    (o) => !o.stage?.is_won && !o.stage?.is_lost,
  )
  const pipelineValue = openDeals.reduce(
    (sum, o) => sum + Number(o.value ?? 0),
    0,
  )

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className={cn(
            'p-0 sm:max-w-[640px]',
            'h-[min(820px,calc(100vh-2rem))] flex flex-col overflow-hidden',
          )}
        >
          {/* Radix requires a Title + Description for a11y even if we render
              our own header; keep them screen-reader only. */}
          <DialogTitle className="sr-only">
            {account?.name ?? 'Company details'}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Edit company info, view linked contacts and deals.
          </DialogDescription>

          {loading || !account ? (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" />
            </div>
          ) : (
            <>
              {/* ── Header ─────────────────────────────────────────────── */}
              <div className="shrink-0 border-b border-border-subtle px-6 pt-6 pb-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[10px] bg-bg-tertiary">
                    <Building2 className="h-5 w-5 text-text-secondary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <InlineEditField
                      value={account.name}
                      placeholder="Company name"
                      onSave={saveField('name')}
                      allowEmpty={false}
                      ariaLabel="Edit company name"
                      className="!px-1 [&_span]:text-[18px] [&_span]:font-semibold [&_span]:tracking-tight"
                    />
                    <div className="mt-1 flex flex-wrap items-center gap-2 px-1 text-[11.5px] text-text-tertiary">
                      <span className="inline-flex items-center gap-1">
                        <Hash className="h-3 w-3" />
                        {account.source ?? 'manual'}
                      </span>
                      <span>·</span>
                      <span>Added {relative(account.created_at)}</span>
                      {account.updated_at && account.updated_at !== account.created_at && (
                        <>
                          <span>·</span>
                          <span>Updated {relative(account.updated_at)}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Body (scrolls) ─────────────────────────────────────── */}
              <ScrollArea className="flex-1 min-h-0">
                <div className="px-6 py-4 space-y-5">
                  {/* Info grid: 1 col on small, 2 cols on md+ */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3">
                    <InlineRow icon={Globe} label="Domain">
                      <InlineEditField
                        value={account.domain}
                        placeholder="acme.com"
                        onSave={saveField('domain')}
                        ariaLabel="Edit domain"
                      />
                    </InlineRow>
                    <InlineRow icon={ExternalLink} label="Website">
                      <InlineEditField
                        value={account.website}
                        placeholder="https://acme.com"
                        type="text"
                        onSave={saveField('website')}
                        ariaLabel="Edit website"
                      />
                    </InlineRow>
                    <InlineRow icon={Briefcase} label="Industry">
                      <InlineEditField
                        value={account.industry}
                        placeholder="e.g. SaaS"
                        onSave={saveField('industry')}
                        ariaLabel="Edit industry"
                      />
                    </InlineRow>
                    <InlineRow icon={Users} label="Size">
                      <InlineEditField
                        value={account.size}
                        placeholder="e.g. 11-50"
                        onSave={saveField('size')}
                        ariaLabel="Edit size"
                      />
                    </InlineRow>
                    <InlineRow icon={Phone} label="Phone">
                      <InlineEditField
                        value={account.phone}
                        placeholder="+1 (555) 010-0000"
                        type="tel"
                        onSave={saveField('phone')}
                        ariaLabel="Edit phone"
                      />
                    </InlineRow>
                    <InlineRow icon={MapPin} label="Address" full>
                      <InlineEditField
                        value={account.address}
                        placeholder="Street, city, country"
                        onSave={saveField('address')}
                        ariaLabel="Edit address"
                      />
                    </InlineRow>
                  </div>

                  {/* Notes (multiline, full width) */}
                  <InlineRow icon={FileText} label="Notes" full>
                    <InlineEditField
                      value={account.notes}
                      placeholder="Add a note about this company"
                      multiline
                      onSave={saveField('notes')}
                      ariaLabel="Edit notes"
                    />
                  </InlineRow>

                  {/* Tags (display-only for now) */}
                  {account.tags && account.tags.length > 0 && (
                    <div className="space-y-1.5">
                      <Label>Tags</Label>
                      <div className="flex flex-wrap gap-1">
                        {account.tags.map((t) => (
                          <span
                            key={t}
                            className="inline-flex items-center rounded-full bg-accent-muted px-2 py-0.5 text-[10.5px] font-medium text-accent"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Stats row */}
                  <div className="grid grid-cols-3 gap-2 rounded-[10px] border border-border-subtle bg-bg-secondary/40 p-3">
                    <Stat label="Contacts" value={contacts.length} />
                    <Stat label="Open deals" value={openDeals.length} />
                    <Stat
                      label="Pipeline"
                      value={pipelineValue > 0 ? formatCurrency(pipelineValue) : '—'}
                    />
                  </div>

                  {/* Linked contacts */}
                  <Section title={`Contacts (${contacts.length})`}>
                    {contacts.length === 0 ? (
                      <EmptyHint>No contacts linked yet.</EmptyHint>
                    ) : (
                      <div className="divide-y divide-border-subtle rounded-[10px] border border-border-subtle">
                        {contacts.map((c) => (
                          <Link
                            key={c.id}
                            href={`/chat?contact=${c.id}`}
                            className="flex items-center gap-2.5 px-3 py-2 transition-colors hover:bg-bg-tertiary/40"
                            onClick={() => onOpenChange(false)}
                          >
                            <Avatar className="h-7 w-7 shrink-0">
                              {c.avatar_url ? <AvatarImage src={c.avatar_url} alt="" /> : null}
                              <AvatarFallback className="bg-accent-muted text-[10px] font-semibold text-accent">
                                {initialsFromContactName(c, c.email ?? c.phone ?? '?')}
                              </AvatarFallback>
                            </Avatar>
                            <span className="min-w-0 flex-1 truncate text-[12.5px] text-text-primary">
                              {displayContactName(c, '') || (
                                <span className="italic text-text-tertiary">Unnamed</span>
                              )}
                            </span>
                            <span className="shrink-0 truncate text-[11px] text-text-tertiary">
                              {c.email ?? c.phone ?? ''}
                            </span>
                          </Link>
                        ))}
                      </div>
                    )}
                  </Section>

                  {/* Linked opportunities */}
                  <Section title={`Deals (${opportunities.length})`}>
                    {opportunities.length === 0 ? (
                      <EmptyHint>No deals linked yet.</EmptyHint>
                    ) : (
                      <div className="divide-y divide-border-subtle rounded-[10px] border border-border-subtle">
                        {opportunities.map((o) => (
                          <Link
                            key={o.id}
                            href={`/pipeline/${o.id}`}
                            className="flex items-center gap-2.5 px-3 py-2 transition-colors hover:bg-bg-tertiary/40"
                            onClick={() => onOpenChange(false)}
                          >
                            <TrendingUp className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
                            <span className="min-w-0 flex-1 truncate text-[12.5px] text-text-primary">
                              {o.title || <span className="italic text-text-tertiary">Untitled deal</span>}
                            </span>
                            {o.stage && (
                              <span
                                className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                                style={{
                                  backgroundColor: `${o.stage.color}22`,
                                  color: o.stage.color,
                                }}
                              >
                                {o.stage.name}
                              </span>
                            )}
                            <span className="shrink-0 text-[11px] text-text-tertiary tabular-nums">
                              {o.value ? formatCurrency(Number(o.value)) : ''}
                            </span>
                          </Link>
                        ))}
                      </div>
                    )}
                  </Section>
                </div>
              </ScrollArea>

              {/* ── Footer ─────────────────────────────────────────────── */}
              <div className="shrink-0 flex items-center justify-between border-t border-border-subtle px-6 py-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmDelete(true)}
                  className="text-rose-400 hover:text-rose-300 gap-1.5"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </Button>
                <Button asChild variant="secondary" size="sm" className="gap-1.5">
                  <Link href={`/accounts/${account.id}`}>
                    Open full page <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Confirm delete — the server action blocks deletes that have references,
          so this is just a "are you sure" hurdle rather than the source of truth. */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this company?</AlertDialogTitle>
            <AlertDialogDescription>
              Linked contacts and deals will be unlinked, not deleted. If the
              company still has direct references, the server will block the
              delete and tell you what to clean up first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                void handleDelete()
              }}
              disabled={deleting}
              className="bg-rose-500 hover:bg-rose-600"
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function InlineRow({
  icon: Icon,
  label,
  full,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  full?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={cn('flex items-start gap-2', full && 'md:col-span-2')}>
      <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-bg-tertiary text-text-tertiary">
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10.5px] font-medium uppercase tracking-wide text-text-tertiary px-1">
          {label}
        </div>
        <div className="mt-0.5">{children}</div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{title}</Label>
      {children}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="text-center">
      <div className="text-[16px] font-semibold tabular-nums text-text-primary">
        {value}
      </div>
      <div className="text-[10.5px] uppercase tracking-wide text-text-tertiary">
        {label}
      </div>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10.5px] font-medium uppercase tracking-wide text-text-tertiary">
      {children}
    </div>
  )
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[12px] italic text-text-tertiary px-1">{children}</p>
  )
}
