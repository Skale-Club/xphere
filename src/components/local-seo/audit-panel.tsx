'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, CircleAlert, CircleMinus, ClipboardCheck, ListTodo, Loader2, XCircle } from 'lucide-react'
import { toast } from 'sonner'

import { createAuditTasks, runLocationAudit } from '@/app/(dashboard)/local-seo/actions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { PILLAR_LABEL, type AuditCheck, type Pillar } from '@/lib/local-seo/audit-checks'
import { cn } from '@/lib/utils'

export type AuditView = {
  id: string
  score: number
  pillars: Record<Pillar, number | null>
  checks: AuditCheck[]
  createdAt: string
  tasksCreatedAt: string | null
}

const VERDICT = {
  good: { label: 'Good', icon: CheckCircle2, className: 'text-success' },
  ok: { label: 'OK', icon: CircleAlert, className: 'text-warning' },
  poor: { label: 'Poor', icon: XCircle, className: 'text-danger' },
  na: { label: 'N/A', icon: CircleMinus, className: 'text-text-tertiary' },
} as const

function scoreTone(n: number | null) {
  if (n === null) return 'text-text-tertiary'
  return n >= 75 ? 'text-success' : n >= 50 ? 'text-warning' : 'text-danger'
}

function ScoreRing({ score }: { score: number }) {
  const r = 40
  const c = 2 * Math.PI * r
  return (
    <div className="relative h-28 w-28">
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx={50} cy={50} r={r} fill="none" strokeWidth={10} className="stroke-bg-tertiary" />
        <circle cx={50} cy={50} r={r} fill="none" strokeWidth={10} strokeLinecap="round" className={cn('stroke-current', scoreTone(score))} strokeDasharray={`${(score / 100) * c} ${c}`} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-semibold tabular-nums text-text-primary">{score}</span>
        <span className="text-[11px] text-text-tertiary">of 100</span>
      </div>
    </div>
  )
}

export function AuditPanel({ locationId, audit, history, canManage }: { locationId: string; audit: AuditView | null; history: { id: string; score: number; createdAt: string }[]; canManage: boolean }) {
  const router = useRouter()
  const [running, startRun] = useTransition()
  const [creating, startCreate] = useTransition()
  const actionable = useMemo(() => (audit?.checks ?? []).filter((c) => (c.status === 'poor' || c.status === 'ok') && c.action), [audit])
  const [selected, setSelected] = useState<string[]>(() => actionable.filter((c) => c.status === 'poor').map((c) => c.id))

  function run() {
    startRun(async () => {
      const res = await runLocationAudit(locationId)
      if ('error' in res) toast.error(res.error)
      else {
        toast.success(`Audit done: ${res.score}/100`)
        router.refresh()
      }
    })
  }

  function tasks() {
    if (!audit) return
    startCreate(async () => {
      const res = await createAuditTasks(audit.id, locationId, selected)
      if ('error' in res) toast.error(res.error)
      else {
        toast.success(`${res.created} task(s) created in Tasks`)
        router.refresh()
      }
    })
  }

  const pillars = Object.keys(PILLAR_LABEL) as Pillar[]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-text-secondary">
          Checks the profile, reviews, website and map visibility against the competitors that outrank you.
        </p>
        {canManage && (
          <Button size="sm" onClick={run} disabled={running}>
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}
            {audit ? 'Run again' : 'Run audit'}
          </Button>
        )}
      </div>

      {!audit ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-text-secondary">No audit yet.</div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-6 rounded-xl border border-border-subtle p-5">
            <ScoreRing score={audit.score} />
            <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-5">
              {pillars.map((p) => (
                <div key={p}>
                  <div className="text-[12px] text-text-secondary">{PILLAR_LABEL[p]}</div>
                  <div className={cn('text-xl font-semibold tabular-nums', scoreTone(audit.pillars[p]))}>{audit.pillars[p] ?? '—'}</div>
                </div>
              ))}
            </div>
            <div className="text-[12px] text-text-tertiary">{new Date(audit.createdAt).toLocaleString()}</div>
          </div>

          {pillars.map((p) => {
            const items = audit.checks.filter((c) => c.pillar === p)
            if (!items.length) return null
            return (
              <section key={p} className="space-y-2">
                <h3 className="text-sm font-semibold text-text-primary">{PILLAR_LABEL[p]}</h3>
                <ul className="divide-y divide-border-subtle rounded-xl border border-border-subtle">
                  {items.map((c) => {
                    const v = VERDICT[c.status]
                    const pickable = canManage && !!c.action && (c.status === 'poor' || c.status === 'ok')
                    return (
                      <li key={c.id} className="flex gap-3 p-3 text-[13px]">
                        {pickable ? (
                          <Checkbox
                            className="mt-0.5"
                            checked={selected.includes(c.id)}
                            onCheckedChange={(on) => setSelected((cur) => (on ? [...cur, c.id] : cur.filter((x) => x !== c.id)))}
                            aria-label={`Create a task for ${c.label}`}
                          />
                        ) : (
                          <span className="w-4" />
                        )}
                        <v.icon className={cn('mt-0.5 h-4 w-4 shrink-0', v.className)} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-text-primary">{c.label}</span>
                            <Badge variant={c.status === 'good' ? 'success' : c.status === 'ok' ? 'warning' : c.status === 'poor' ? 'danger' : 'secondary'}>{v.label}</Badge>
                          </div>
                          <p className="text-text-secondary">{c.detail}</p>
                          {c.action && c.status !== 'good' && <p className="mt-1 text-text-primary">→ {c.action}</p>}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })}

          {canManage && actionable.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-bg-secondary p-3 text-[13px]">
              <span className="text-text-secondary">
                {audit.tasksCreatedAt ? `Tasks created ${new Date(audit.tasksCreatedAt).toLocaleDateString()}. ` : ''}
                {selected.length} item(s) selected.
              </span>
              <Button size="sm" variant="secondary" onClick={tasks} disabled={creating || selected.length === 0}>
                <ListTodo className="h-4 w-4" />
                Create tasks
              </Button>
            </div>
          )}

          {history.length > 1 && (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-text-primary">Previous audits</h3>
              <div className="flex flex-wrap gap-2">
                {history.map((h) => (
                  <span key={h.id} className="rounded-lg border border-border-subtle px-3 py-1.5 text-[12px]">
                    <span className={cn('font-semibold tabular-nums', scoreTone(h.score))}>{h.score}</span>
                    <span className="ml-2 text-text-tertiary">{new Date(h.createdAt).toLocaleDateString()}</span>
                  </span>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
