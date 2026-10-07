'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Bot, CheckCircle2, CircleMinus, ExternalLink, Loader2, Search, XCircle } from 'lucide-react'
import { toast } from 'sonner'

import { runAiVisibility, runCitations } from '@/app/(dashboard)/seo/local/actions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Citation = {
  directory: string
  domain: string
  found: boolean
  url: string | null
  listed_name: string | null
  name_match: boolean | null
  phone_match: boolean | null
  address_match: boolean | null
  error: string | null
  checked_at: string
}

type AiRow = {
  prompt: string
  model: string
  mentioned: boolean
  position: number | null
  competitors: string[]
  excerpt: string | null
  error: string | null
  checked_at: string
}

function Match({ v }: { v: boolean | null }) {
  if (v === null) return <CircleMinus className="h-4 w-4 text-text-tertiary" aria-label="unknown" />
  return v ? <CheckCircle2 className="h-4 w-4 text-success" aria-label="matches" /> : <XCircle className="h-4 w-4 text-danger" aria-label="does not match" />
}

export function VisibilityPanel({
  locationId,
  canManage,
  defaultArea,
  citations,
  ai,
  aiHistory,
}: {
  locationId: string
  canManage: boolean
  defaultArea: string
  citations: Citation[]
  ai: AiRow[]
  aiHistory: { at: string; mentioned: number; total: number }[]
}) {
  const router = useRouter()
  const [area, setArea] = useState(defaultArea)
  const [citBusy, startCit] = useTransition()
  const [aiBusy, startAi] = useTransition()

  function citationsRun() {
    startCit(async () => {
      const res = await runCitations(locationId, area)
      if ('error' in res) toast.error(res.error)
      else {
        toast.success(`Listed on ${res.found} of ${res.total} directories`)
        router.refresh()
      }
    })
  }

  function aiRun() {
    startAi(async () => {
      const res = await runAiVisibility(locationId, area)
      if ('error' in res) toast.error(res.error)
      else {
        toast.success(`Mentioned in ${res.mentioned} of ${res.total} answers`)
        router.refresh()
      }
    })
  }

  const prompts = [...new Set(ai.map((a) => a.prompt))]
  const models = [...new Set(ai.map((a) => a.model))]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="vis-area">City or area used in the searches</Label>
          <Input id="vis-area" className="w-[260px]" value={area} onChange={(e) => setArea(e.target.value)} placeholder="São Paulo" />
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base">Citations (NAP)</CardTitle>
              <CardDescription>
                Is the business listed on the directories that matter in its country, with the same name, phone and address? One
                search per directory, one scan point each.
              </CardDescription>
            </div>
            {canManage && (
              <Button size="sm" variant="secondary" onClick={citationsRun} disabled={citBusy}>
                {citBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Check citations
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {citations.length === 0 ? (
            <p className="text-sm text-text-secondary">Not checked yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-text-tertiary">
                    <th className="py-1.5 font-medium">Directory</th>
                    <th className="py-1.5 font-medium">Listed</th>
                    <th className="py-1.5 text-center font-medium">Name</th>
                    <th className="py-1.5 text-center font-medium">Phone</th>
                    <th className="py-1.5 text-center font-medium">Address</th>
                  </tr>
                </thead>
                <tbody>
                  {citations.map((c) => (
                    <tr key={c.domain} className="border-t border-border-subtle">
                      <td className="py-1.5">{c.directory}</td>
                      <td className="py-1.5">
                        {c.error ? (
                          <span className="text-danger">{c.error}</span>
                        ) : c.found && c.url ? (
                          <a href={c.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                            {c.listed_name ?? 'Listed'} <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          <Badge variant="warning">Not found</Badge>
                        )}
                      </td>
                      <td className="py-1.5 text-center">{c.found ? <Match v={c.name_match} /> : null}</td>
                      <td className="py-1.5 text-center">{c.found ? <Match v={c.phone_match} /> : null}</td>
                      <td className="py-1.5 text-center">{c.found ? <Match v={c.address_match} /> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-text-tertiary">
                Checked {new Date(citations[0].checked_at).toLocaleString()}. A dash means the search snippet did not show that
                field; open the listing to confirm.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base">AI assistants</CardTitle>
              <CardDescription>
                Asks web-searching AI models for the best options for your keywords in the area and checks whether this business is
                recommended.
              </CardDescription>
            </div>
            {canManage && (
              <Button size="sm" variant="secondary" onClick={aiRun} disabled={aiBusy}>
                {aiBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
                Ask the assistants
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {aiHistory.length > 1 && (
            <div className="flex flex-wrap gap-2 text-[12px]">
              {aiHistory.map((h) => (
                <span key={h.at} className="rounded-lg border border-border-subtle px-2.5 py-1">
                  <span className="font-semibold tabular-nums">{Math.round((h.mentioned / Math.max(1, h.total)) * 100)}%</span>
                  <span className="ml-1.5 text-text-tertiary">{new Date(h.at).toLocaleDateString()}</span>
                </span>
              ))}
            </div>
          )}
          {ai.length === 0 ? (
            <p className="text-sm text-text-secondary">Not checked yet.</p>
          ) : (
            prompts.map((prompt) => (
              <div key={prompt} className="space-y-2">
                <div className="text-[13px] font-medium text-text-primary">“{prompt}”</div>
                <div className="grid gap-2 md:grid-cols-2">
                  {models.map((model) => {
                    const r = ai.find((a) => a.prompt === prompt && a.model === model)
                    if (!r) return null
                    return (
                      <div key={model} className="space-y-1.5 rounded-lg border border-border-subtle p-3 text-[13px]">
                        <div className="flex items-center justify-between gap-2">
                          <code className="text-[11.5px] text-text-tertiary">{model}</code>
                          {r.error ? (
                            <Badge variant="danger">Error</Badge>
                          ) : r.mentioned ? (
                            <Badge variant="success">{r.position ? `Mentioned #${r.position}` : 'Mentioned'}</Badge>
                          ) : (
                            <Badge variant="warning">Not mentioned</Badge>
                          )}
                        </div>
                        {r.error && <p className="text-danger">{r.error}</p>}
                        {r.excerpt && <p className="line-clamp-3 text-text-secondary">{r.excerpt}</p>}
                        {r.competitors.length > 0 && (
                          <p className="text-text-tertiary">Also recommended: {r.competitors.slice(0, 5).join(', ')}</p>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
