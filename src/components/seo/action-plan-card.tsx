'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'
import { Loader2, Sparkles } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { generateSeoActionPlan } from '@/app/(dashboard)/seo/website/actions'
import type { ActionPlan } from '@/lib/seo/action-plan'

const LEVEL_BADGE = { high: 'danger', medium: 'warning', low: 'info' } as const
const EFFORT_BADGE = { low: 'success', medium: 'warning', high: 'danger' } as const

export function ActionPlanCard({ siteId, plan, canManage }: { siteId: string; plan: ActionPlan | null; canManage: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()

  function generate() {
    start(async () => {
      const res = await generateSeoActionPlan(siteId)
      if (!res.ok) return void toast.error(res.error)
      toast.success('Action plan ready')
      router.refresh()
    })
  }

  const button = canManage && (
    <Button size="sm" variant={plan ? 'outline' : 'default'} onClick={generate} disabled={pending}>
      {pending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}
      {pending ? 'Analyzing…' : plan ? 'Regenerate' : 'Generate action plan'}
    </Button>
  )

  return (
    <Card className="lg:col-span-3">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-2">
        <div>
          <CardTitle className="text-sm">AI action plan</CardTitle>
          <p className="text-xs text-text-tertiary">
            {plan
              ? `Generated ${formatDistanceToNow(new Date(plan.generated_at), { addSuffix: true })} from the latest audit`
              : 'The five fixes with the most impact, prioritised with your Search Console traffic, plus title and description rewrites. Uses AI credits.'}
          </p>
        </div>
        {button}
      </CardHeader>
      {plan && (
        <CardContent className="space-y-5">
          {plan.summary && <p className="text-sm text-text-secondary">{plan.summary}</p>}

          <ol className="space-y-3">
            {plan.actions.map((a, i) => (
              <li key={i} className="rounded-lg border border-border-subtle p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-text-primary">
                    {i + 1}. {a.title}
                  </span>
                  <Badge variant={LEVEL_BADGE[a.impact]}>impact: {a.impact}</Badge>
                  <Badge variant={EFFORT_BADGE[a.effort]}>effort: {a.effort}</Badge>
                </div>
                <p className="mt-1 text-sm text-text-secondary">{a.why}</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-text-primary">
                  {a.steps.map((s, j) => (
                    <li key={j}>{s}</li>
                  ))}
                </ul>
                {a.urls.length > 0 && (
                  <div className="mt-2 space-y-0.5">
                    {a.urls.map((u) => (
                      <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="block truncate text-xs text-text-tertiary hover:text-accent">
                        {u}
                      </a>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ol>

          {plan.rewrites.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-text-tertiary">Title & description rewrites</p>
              {plan.rewrites.map((r) => (
                <div key={r.url} className="space-y-1.5 rounded-lg border border-border-subtle p-3 text-sm">
                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="block truncate text-xs text-text-tertiary hover:text-accent">
                    {r.url}
                    {r.target_query ? ` · “${r.target_query}”` : ''}
                  </a>
                  <Rewrite label="Title" before={r.current_title} after={r.suggested_title} />
                  <Rewrite label="Description" before={r.current_description} after={r.suggested_description} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  )
}

function Rewrite({ label, before, after }: { label: string; before: string | null; after: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[90px_1fr]">
      <span className="text-xs text-text-tertiary">{label}</span>
      <div className="space-y-0.5">
        {before && <p className="text-xs text-text-tertiary line-through">{before}</p>}
        <p className="text-text-primary">
          {after} <span className="text-xs text-text-tertiary">({after.length})</span>
        </p>
      </div>
    </div>
  )
}
