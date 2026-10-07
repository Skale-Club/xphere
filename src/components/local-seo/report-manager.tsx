'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Copy, Download, FileText, Link2, Mail, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import {
  createReportLink,
  deleteReport,
  revokeReportLink,
  saveReport,
  sendReportNow,
  type ReportInput,
} from '@/app/(dashboard)/seo/local/report-actions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

type LinkView = { id: string; hint: string; expiresAt: string | null; views: number; lastViewedAt: string | null }
export type ReportView = Omit<ReportInput, 'intro'> & {
  id: string
  intro: string | null
  lastSentAt: string | null
  lastError: string | null
  links: LinkView[]
}

const SECTION_LABEL: Record<string, string> = {
  rankings: 'Geogrid maps',
  trends: 'Trends',
  competitors: 'Competitors',
  reviews: 'Reviews',
  performance: 'Profile performance',
  audit: 'Audit',
}

const EMPTY: ReportInput = {
  name: 'Monthly Local SEO report',
  locationIds: [],
  periodDays: 30,
  sections: ['rankings', 'trends', 'competitors', 'reviews', 'performance', 'audit'],
  intro: null,
  schedule: 'none',
  sendDay: 1,
  recipients: [],
}

export function ReportManager({ reports, locations, canManage }: { reports: ReportView[]; locations: { id: string; name: string }[]; canManage: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | undefined>()
  const [form, setForm] = useState<ReportInput>(EMPTY)
  const [recipients, setRecipients] = useState('')
  const [freshLink, setFreshLink] = useState<{ reportId: string; url: string } | null>(null)
  const [busy, start] = useTransition()
  const set = <K extends keyof ReportInput>(k: K, v: ReportInput[K]) => setForm((f) => ({ ...f, [k]: v }))

  function edit(r?: ReportView) {
    setEditingId(r?.id)
    const base = r ? { ...r } : EMPTY
    setForm({
      name: base.name,
      locationIds: base.locationIds,
      periodDays: base.periodDays,
      sections: base.sections,
      intro: base.intro,
      schedule: base.schedule,
      sendDay: base.sendDay,
      recipients: base.recipients,
    })
    setRecipients(base.recipients.join(', '))
    setOpen(true)
  }

  function act<T>(fn: () => Promise<T | { error: string }>, ok?: (r: T) => void) {
    start(async () => {
      const res = await fn()
      if (res && typeof res === 'object' && 'error' in res) toast.error((res as { error: string }).error)
      else {
        ok?.(res as T)
        router.refresh()
      }
    })
  }

  function save() {
    const list = recipients.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
    act(() => saveReport({ ...form, recipients: list }, editingId), () => {
      toast.success('Report saved')
      setOpen(false)
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-text-secondary">White-label reports with your logo and colours: share a link, download a PDF or email it every month.</p>
        {canManage && (
          <Button size="sm" onClick={() => edit()}>
            <Plus className="h-4 w-4" />
            New report
          </Button>
        )}
      </div>

      {reports.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-text-secondary">No reports yet.</div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {reports.map((r) => (
          <Card key={r.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4" />
                {r.name}
              </CardTitle>
              <CardDescription>
                Last {r.periodDays} days ·{' '}
                {r.locationIds.length ? `${r.locationIds.length} location(s)` : 'all locations'} ·{' '}
                {r.schedule === 'monthly' ? `emailed on day ${r.sendDay} to ${r.recipients.length} recipient(s)` : 'not scheduled'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-[13px]">
              {r.lastSentAt && <p className="text-text-tertiary">Last sent {new Date(r.lastSentAt).toLocaleString()}</p>}
              {r.lastError && <p className="text-danger">Last send failed: {r.lastError}</p>}
              {freshLink?.reportId === r.id && (
                <div className="flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/5 p-2">
                  <Input readOnly value={freshLink.url} className="h-8 text-xs" onFocus={(e) => e.target.select()} />
                  <Button size="sm" variant="secondary" onClick={() => navigator.clipboard.writeText(freshLink.url).then(() => toast.success('Copied'))}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              )}
              {r.links.length > 0 && (
                <ul className="space-y-1">
                  {r.links.map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-2 text-text-secondary">
                      <span>
                        <code className="text-[12px]">{l.hint}…</code> · {l.views} view(s)
                        {l.expiresAt ? ` · expires ${new Date(l.expiresAt).toLocaleDateString()}` : ' · no expiry'}
                      </span>
                      {canManage && (
                        <button type="button" className="text-[12px] text-danger hover:underline" onClick={() => act(() => revokeReportLink(l.id), () => toast.success('Link revoked'))}>
                          Revoke
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-2">
                {canManage && (
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => act(() => createReportLink(r.id, 30), (res) => setFreshLink({ reportId: r.id, url: (res as { url: string }).url }))}>
                    <Link2 className="h-4 w-4" />
                    Share link (30 days)
                  </Button>
                )}
                <Button asChild size="sm" variant="secondary">
                  <a href={`/api/local-seo/reports/${r.id}/pdf`}>
                    <Download className="h-4 w-4" />
                    PDF
                  </a>
                </Button>
                {canManage && r.recipients.length > 0 && (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(() => sendReportNow(r.id), () => toast.success('Report sent'))}>
                    <Mail className="h-4 w-4" />
                    Send now
                  </Button>
                )}
                {canManage && (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => edit(r)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(() => deleteReport(r.id), () => toast.success('Deleted'))} aria-label="Delete report">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit report' : 'New report'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="rp-name">Name</Label>
              <Input id="rp-name" value={form.name} onChange={(e) => set('name', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Locations</Label>
              <p className="text-xs text-text-tertiary">None selected = every active location.</p>
              <div className="max-h-36 space-y-1.5 overflow-y-auto rounded-lg border border-border-subtle p-2">
                {locations.map((l) => (
                  <label key={l.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={form.locationIds.includes(l.id)}
                      onCheckedChange={(v) => set('locationIds', v ? [...form.locationIds, l.id] : form.locationIds.filter((x) => x !== l.id))}
                    />
                    {l.name}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Sections</Label>
              <div className="grid grid-cols-2 gap-1.5">
                {Object.entries(SECTION_LABEL).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={form.sections.includes(key as ReportInput['sections'][number])}
                      onCheckedChange={(v) =>
                        set('sections', v ? [...form.sections, key as ReportInput['sections'][number]] : form.sections.filter((x) => x !== key))
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>Period</Label>
                <Select value={String(form.periodDays)} onValueChange={(v) => set('periodDays', Number(v) as 7 | 30 | 90)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">Last 7 days</SelectItem>
                    <SelectItem value="30">Last 30 days</SelectItem>
                    <SelectItem value="90">Last 90 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Select value={form.schedule} onValueChange={(v) => set('schedule', v as 'none' | 'monthly')}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Don’t email</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {form.schedule === 'monthly' && (
              <div className="grid grid-cols-[100px_1fr] gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="rp-day">Day</Label>
                  <Input id="rp-day" type="number" min={1} max={28} value={form.sendDay} onChange={(e) => set('sendDay', Number(e.target.value))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rp-to">Recipients</Label>
                  <Input id="rp-to" value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder="client@example.com, owner@example.com" />
                </div>
              </div>
            )}
            {form.schedule !== 'monthly' && (
              <div className="space-y-1.5">
                <Label htmlFor="rp-to2">Recipients (for Send now)</Label>
                <Input id="rp-to2" value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder="client@example.com" />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="rp-intro">Intro</Label>
              <Textarea id="rp-intro" rows={3} value={form.intro ?? ''} onChange={(e) => set('intro', e.target.value)} placeholder="A short note to the client at the top of the report." />
            </div>
            {form.schedule === 'monthly' && <Badge variant="info">The PDF is attached and a 30-day link included.</Badge>}
          </div>
          <DialogFooter>
            <Button onClick={save} loading={busy}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
