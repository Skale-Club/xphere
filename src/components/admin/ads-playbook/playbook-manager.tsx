'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlignLeft, BookOpen, FileText, Loader2, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  insertPlaybookSource, addPlaybookText, deletePlaybookSource,
  type PlaybookPlatform,
} from '@/app/(admin)/admin/ads-playbook/_actions/playbook'

type Source = {
  id: string
  platform: PlaybookPlatform
  name: string
  source_type: string
  status: 'processing' | 'ready' | 'error'
  error_detail: string | null
  chunk_count: number
  created_at: string
}

const PLATFORM_LABEL: Record<PlaybookPlatform, string> = {
  meta: 'Meta Ads',
  google: 'Google Ads',
  global: 'All platforms',
}

function getSourceType(mime: string, name: string): 'pdf' | 'text' | 'csv' {
  if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'pdf'
  if (mime === 'text/csv' || name.endsWith('.csv')) return 'csv'
  return 'text'
}

function StatusBadge({ status }: { status: Source['status'] }) {
  if (status === 'ready') return <Badge className="bg-green-500/15 text-green-600 dark:text-green-400">Ready</Badge>
  if (status === 'error') return <Badge variant="destructive">Error</Badge>
  return <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400">Processing</Badge>
}

export function PlaybookManager({ sources, disabled }: { sources: Source[]; disabled: boolean }) {
  const router = useRouter()
  const [platform, setPlatform] = useState<PlaybookPlatform>('meta')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [textName, setTextName] = useState('')
  const [textBody, setTextBody] = useState('')
  const [isPending, startTransition] = useTransition()

  async function handleFile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const input = form.elements.namedItem('file')
    if (!(input instanceof HTMLInputElement)) return
    const file = input.files?.[0]
    if (!file) return

    setBusy(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('platform', platform)
      const res = await fetch('/api/admin/ads-playbook/upload', { method: 'POST', body: fd })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Upload failed')
      const { path, name } = await res.json()
      startTransition(async () => {
        await insertPlaybookSource(path, name, getSourceType(file.type, file.name), platform)
        form.reset()
        setBusy(false)
        router.refresh()
      })
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : 'Upload failed')
    }
  }

  function handleText(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!textBody.trim()) return
    setError(null)
    startTransition(async () => {
      try {
        await addPlaybookText(textName, textBody, platform)
        setTextName('')
        setTextBody('')
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to add text')
      }
    })
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      try {
        await deletePlaybookSource(id)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete')
      }
    })
  }

  return (
    <div className="space-y-6">
      {disabled && (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
          Add the platform OpenRouter key in <strong>Settings → AI Provider</strong> before adding knowledge sources.
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border-subtle">
        <div className="border-b border-border-subtle px-5 py-4">
          <h2 className="text-sm font-semibold text-text-primary">Add knowledge source</h2>
          <p className="mt-1 text-xs text-text-tertiary">
            Choose where the guidance applies, then upload a file or paste the source material.
          </p>
        </div>

        <div className="space-y-6 p-5">
          <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)] md:items-start">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">1. Choose scope</p>
              <p className="mt-1 text-xs text-text-tertiary">Controls which campaign analyses can use this source.</p>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-medium">Ad platform</Label>
              <Select value={platform} onValueChange={(v) => setPlatform(v as PlaybookPlatform)} disabled={disabled}>
                <SelectTrigger className="w-full md:max-w-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="meta">Meta Ads</SelectItem>
                  <SelectItem value="google">Google Ads</SelectItem>
                  <SelectItem value="global">All platforms</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-text-tertiary">
                Choose “All platforms” for principles that apply to every advertising channel.
              </p>
            </div>
          </div>

          <div className="border-t border-border-subtle" />

          <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)] md:items-start">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">2. Add content</p>
              <p className="mt-1 text-xs text-text-tertiary">Use original, trusted material with a clear source name.</p>
            </div>

            <Tabs defaultValue="file" className="min-w-0">
              <TabsList className="grid w-full grid-cols-2 sm:w-80">
                <TabsTrigger value="file" className="gap-2">
                  <Upload className="h-3.5 w-3.5" />
                  Upload file
                </TabsTrigger>
                <TabsTrigger value="text" className="gap-2">
                  <AlignLeft className="h-3.5 w-3.5" />
                  Paste text
                </TabsTrigger>
              </TabsList>

              <TabsContent value="file" className="mt-4">
                <form onSubmit={handleFile} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="file" className="text-xs font-medium">Source file</Label>
                    <Input
                      id="file"
                      name="file"
                      type="file"
                      accept=".pdf,.txt,.csv,text/plain,text/csv,application/pdf"
                      className="text-xs"
                      required
                      disabled={disabled || busy}
                    />
                    <p className="text-xs text-text-tertiary">PDF, TXT or CSV · maximum 10 MB</p>
                  </div>
                  <Button type="submit" size="sm" disabled={disabled || busy || isPending}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    {busy ? 'Uploading…' : 'Upload and process'}
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="text" className="mt-4">
                <form onSubmit={handleText} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="textName" className="text-xs font-medium">Source name</Label>
                    <Input
                      id="textName"
                      value={textName}
                      onChange={(e) => setTextName(e.target.value)}
                      placeholder="e.g. Meta Ads Course — Module 1"
                      className="text-xs"
                      disabled={disabled}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="textBody" className="text-xs font-medium">Source content</Label>
                    <Textarea
                      id="textBody"
                      value={textBody}
                      onChange={(e) => setTextBody(e.target.value)}
                      rows={8}
                      placeholder="Paste the complete course transcript, guide, or reference material…"
                      className="text-xs"
                      disabled={disabled}
                    />
                  </div>
                  <Button type="submit" size="sm" disabled={disabled || isPending || !textBody.trim()}>
                    {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlignLeft className="h-4 w-4" />}
                    {isPending ? 'Adding…' : 'Add and process'}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </div>

          {error && (
            <p role="alert" className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border-subtle">
        <div className="flex items-center justify-between gap-4 border-b border-border-subtle px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">Knowledge sources</h2>
            <p className="mt-1 text-xs text-text-tertiary">Processed sources available to Copilot and MCP.</p>
          </div>
          <Badge variant="outline">{sources.length}</Badge>
        </div>
        {sources.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg border border-border-subtle bg-bg-secondary">
              <BookOpen className="h-4 w-4 text-text-tertiary" />
            </div>
            <p className="text-sm font-medium text-text-secondary">No knowledge sources yet</p>
            <p className="mt-1 max-w-sm text-xs text-text-tertiary">
              Add a trusted file or paste source material above to make it available for campaign analysis.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {sources.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                <FileText className="h-4 w-4 shrink-0 text-text-tertiary" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-text-primary">{s.name}</p>
                  <p className="text-xs text-text-tertiary">
                    {PLATFORM_LABEL[s.platform]} · {s.source_type.toUpperCase()} · {s.chunk_count} chunks
                    {s.status === 'error' && s.error_detail ? ` · ${s.error_detail}` : ''}
                  </p>
                </div>
                <StatusBadge status={s.status} />
                <Button variant="ghost" size="icon-sm" onClick={() => handleDelete(s.id)} disabled={isPending}
                  aria-label={`Delete ${s.name}`}>
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
