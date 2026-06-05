'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Building2, CheckCircle2, Plus, UserRound } from 'lucide-react'
import { toast } from 'sonner'

import {
  convertProspectToContact,
  createProspect,
  importProspectsCsv,
  type ProspectKind,
  type ProspectRow,
} from '@/app/(dashboard)/prospects/actions'
import { EntityListTemplate } from '@/components/crm/entity-template'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

interface ProspectsTableProps {
  rows: ProspectRow[]
  total: number
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

function statusLabel(value: string): string {
  return value.replaceAll('_', ' ')
}

export function ProspectsTable({ rows, total }: ProspectsTableProps) {
  const router = useRouter()
  const [selected, setSelected] = React.useState<ProspectRow | null>(null)
  const [busyId, setBusyId] = React.useState<string | null>(null)

  async function handleConvert(row: ProspectRow) {
    setBusyId(row.id)
    const res = await convertProspectToContact(row.kind, row.id)
    setBusyId(null)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(row.kind === 'company' ? 'Company promoted to lead' : 'Prospect converted to lead')
    setSelected(null)
    router.refresh()
  }

  return (
    <EntityListTemplate
      scope={{ entity: 'prospect', lifecycleStage: 'prospect' }}
      toolbar={
        <div className="flex flex-row flex-nowrap items-center gap-2 px-4 pb-6 pt-6 sm:px-6 lg:px-8">
          <NewProspectDialog onCreated={() => router.refresh()} />
          <ImportProspectsDialog onImported={() => router.refresh()} />
          <div className="hidden sm:block flex-1" />
          <Badge variant="secondary">{total}</Badge>
        </div>
      }
      detail={
        <ProspectDetailDialog
          row={selected}
          busy={Boolean(selected && busyId === selected.id)}
          onOpenChange={(open) => {
            if (!open) setSelected(null)
          }}
          onConvert={handleConvert}
        />
      }
    >
      <div className="rounded-[12px] border border-border bg-bg-secondary overflow-hidden">
        <div className="hidden grid-cols-[1.5fr_1fr_1fr_1fr_1fr_90px] items-center gap-3 border-b border-border-subtle px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-text-tertiary sm:grid">
          <div>Prospect</div>
          <div>Source</div>
          <div>Engagement</div>
          <div>Intent</div>
          <div>Qualification</div>
          <div className="text-right">Added</div>
        </div>

        {rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13px] text-text-secondary">
            No prospects yet.
          </div>
        ) : (
          <div className="divide-y divide-border-subtle">
            {rows.map((row) => (
              <button
                key={`${row.kind}:${row.id}`}
                type="button"
                onClick={() => setSelected(row)}
                className={cn(
                  'grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-bg-tertiary/40',
                  'sm:grid-cols-[1.5fr_1fr_1fr_1fr_1fr_90px]',
                )}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-accent-muted text-accent">
                    {row.kind === 'company' ? (
                      <Building2 className="h-4 w-4" />
                    ) : (
                      <UserRound className="h-4 w-4" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium text-text-primary">
                      {row.name || <span className="italic text-text-tertiary">Unnamed prospect</span>}
                    </div>
                    <div className="truncate text-[11.5px] text-text-tertiary">
                      {row.company || row.email || row.phone || (row.kind === 'company' ? 'Company prospect' : 'Person prospect')}
                    </div>
                  </div>
                </div>

                <div className="hidden truncate text-[12.5px] text-text-secondary sm:block">
                  {row.sourceType || row.source}
                  {row.sourceId ? <span className="text-text-tertiary"> · {row.sourceId}</span> : null}
                </div>
                <div className="hidden text-[12.5px] capitalize text-text-secondary sm:block">
                  {statusLabel(row.engagementStatus)}
                </div>
                <div className="hidden text-[12.5px] capitalize text-text-secondary sm:block">
                  {row.intentLevel}
                </div>
                <div className="hidden text-[12.5px] capitalize text-text-secondary sm:block">
                  {statusLabel(row.qualificationStatus)}
                </div>
                <div className="text-right text-[11.5px] text-text-tertiary">
                  {relativeTime(row.createdAt)}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </EntityListTemplate>
  )
}

function ImportProspectsDialog({ onImported }: { onImported: () => void }) {
  const [open, setOpen] = React.useState(false)
  const [csv, setCsv] = React.useState('name,email,phone,company,source_id\n')
  const [pending, startTransition] = React.useTransition()

  function submit() {
    startTransition(async () => {
      const res = await importProspectsCsv(csv)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success(`Imported ${res.inserted} prospect${res.inserted === 1 ? '' : 's'}`)
      setOpen(false)
      onImported()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary" className="h-8">
          Import CSV
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Import prospects</DialogTitle>
          <DialogDescription>
            Paste CSV with headers such as name, email, phone, company, and source_id.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Textarea
            value={csv}
            onChange={(event) => setCsv(event.target.value)}
            className="min-h-[220px] font-mono text-[12px]"
          />
          <Button onClick={submit} disabled={pending || csv.trim().split('\n').length < 2} className="w-full">
            {pending ? 'Importing...' : 'Import prospects'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ProspectDetailDialog({
  row,
  busy,
  onOpenChange,
  onConvert,
}: {
  row: ProspectRow | null
  busy: boolean
  onOpenChange: (open: boolean) => void
  onConvert: (row: ProspectRow) => void
}) {
  return (
    <Dialog open={Boolean(row)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{row?.name || 'Prospect details'}</DialogTitle>
          <DialogDescription>
            Review the early-stage record before moving it into the normal CRM.
          </DialogDescription>
        </DialogHeader>
        {row && (
          <div className="space-y-4">
            <div className="grid gap-2 text-[13px] text-text-secondary">
              <DetailRow label="Type" value={row.kind === 'company' ? 'Company' : 'Person'} />
              <DetailRow label="Company" value={row.company} />
              <DetailRow label="Email" value={row.email} />
              <DetailRow label="Phone" value={row.phone} />
              <DetailRow label="Engagement" value={statusLabel(row.engagementStatus)} />
              <DetailRow label="Intent" value={row.intentLevel} />
              <DetailRow label="Qualification" value={statusLabel(row.qualificationStatus)} />
              <DetailRow label="Source" value={[row.sourceType || row.source, row.sourceId].filter(Boolean).join(' · ')} />
            </div>
            <div className="rounded-[10px] border border-border-subtle bg-bg-tertiary/30 p-3 text-[12px] text-text-tertiary">
              Converting moves this record out of Prospects and into the normal CRM as a lead. Existing source context and conversation links stay on the same record.
            </div>
            <Button
              onClick={() => onConvert(row)}
              disabled={busy}
              className="w-full"
            >
              <CheckCircle2 className="h-4 w-4" />
              {busy ? 'Converting...' : row.kind === 'company' ? 'Promote company to lead' : 'Convert to Contact'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function DetailRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-2">
      <span className="text-text-tertiary">{label}</span>
      <span className="truncate text-text-primary">{value || '-'}</span>
    </div>
  )
}

function NewProspectDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = React.useState(false)
  const [kind, setKind] = React.useState<ProspectKind>('person')
  const [name, setName] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [phone, setPhone] = React.useState('')
  const [company, setCompany] = React.useState('')
  const [sourceType, setSourceType] = React.useState('')
  const [pending, startTransition] = React.useTransition()

  function reset() {
    setKind('person')
    setName('')
    setEmail('')
    setPhone('')
    setCompany('')
    setSourceType('')
  }

  function submit() {
    startTransition(async () => {
      const res = await createProspect({
        kind,
        name,
        email,
        phone,
        company,
        sourceType,
      })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success('Prospect created')
      reset()
      setOpen(false)
      onCreated()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="h-8">
          <Plus className="h-3.5 w-3.5" />
          Prospect
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New prospect</DialogTitle>
          <DialogDescription>Create an early-stage record without exposing it in normal CRM views.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={kind} onValueChange={(value) => setKind(value as ProspectKind)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="person">Person</SelectItem>
                <SelectItem value="company">Company</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'company' ? 'Company name' : 'Person name'} />
          </div>
          {kind === 'person' && (
            <div className="space-y-1.5">
              <Label>Company</Label>
              <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Optional company" />
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Optional email" />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional phone" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Source</Label>
            <Input value={sourceType} onChange={(e) => setSourceType(e.target.value)} placeholder="manual, xcraper, csv, event..." />
          </div>
          <Button onClick={submit} disabled={pending || !name.trim()} className="w-full">
            {pending ? 'Creating...' : 'Create prospect'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
