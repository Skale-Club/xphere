'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlignLeft, BookOpen, Check, ChevronDown, ChevronsUpDown, Database, FileText,
  Loader2, RefreshCw, Trash2, Unplug, Upload,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
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
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  addGlobalKnowledgeText,
  addNotionKnowledgeRoot,
  deleteGlobalKnowledgeSource,
  disconnectGlobalKnowledgeNotion,
  getAccessibleNotionPages,
  insertGlobalKnowledgeSource,
  removeNotionKnowledgeRoot,
  syncNotionKnowledgeRoot,
  type GlobalKnowledgePlatform,
} from '@/app/(admin)/admin/knowledge/_actions/knowledge'

type Source = {
  id: string
  platform: GlobalKnowledgePlatform
  name: string
  source_type: string
  status: 'processing' | 'ready' | 'error'
  error_detail: string | null
  chunk_count: number
  created_at: string
  notion_root_id: string | null
}

const PLATFORM_LABEL: Record<GlobalKnowledgePlatform, string> = {
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

type NotionState = {
  sourceMode: string
  connection: {
    id: string
    workspace_name: string | null
    status: string
    error_detail: string | null
    last_synced_at: string | null
  } | null
  roots: Array<{
    id: string
    title: string
    platform: GlobalKnowledgePlatform
    status: string
    error_detail: string | null
    last_full_sync_at: string | null
  }>
  jobs: Array<{
    id: string
    status: string
    job_type: string
    error_detail: string | null
  }>
}

type NotionPage = {
  id: string
  title: string
}

export function GlobalKnowledgeManager({
  sources,
  disabled,
  notionState,
}: {
  sources: Source[]
  disabled: boolean
  notionState: NotionState
}) {
  const router = useRouter()
  const [platform, setPlatform] = useState<GlobalKnowledgePlatform>('meta')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [textName, setTextName] = useState('')
  const [textBody, setTextBody] = useState('')
  const [notionPages, setNotionPages] = useState<NotionPage[]>([])
  const [selectedNotionPage, setSelectedNotionPage] = useState('')
  const [notionPickerOpen, setNotionPickerOpen] = useState(false)
  const [loadingPages, setLoadingPages] = useState(false)
  const [isPending, startTransition] = useTransition()
  const notionSourcesByRoot = useMemo(() => {
    const grouped = new Map<string, Source[]>()
    for (const source of sources) {
      if (source.source_type !== 'notion_page' || !source.notion_root_id) continue
      const rootSources = grouped.get(source.notion_root_id)
      if (rootSources) rootSources.push(source)
      else grouped.set(source.notion_root_id, [source])
    }
    return grouped
  }, [sources])
  const manualSources = useMemo(
    () => sources.filter((source) => source.source_type !== 'notion_page'),
    [sources],
  )
  const showStandaloneSources =
    notionState.sourceMode !== 'notion' || manualSources.length > 0 || notionState.roots.length === 0
  const selectedNotionPageTitle = notionPages.find(
    (page) => page.id === selectedNotionPage,
  )?.title

  useEffect(() => {
    const connectionId = notionState.connection?.id
    if (!connectionId) return
    const supabase = createClient()
    const channel = supabase
      .channel(`global-knowledge-sync-${connectionId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'global_knowledge_sync_jobs',
          filter: `connection_id=eq.${connectionId}`,
        },
        () => router.refresh(),
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [notionState.connection?.id, router])

  useEffect(() => {
    if (!notionState.connection?.id) {
      setNotionPages([])
      return
    }

    let cancelled = false
    setLoadingPages(true)
    getAccessibleNotionPages()
      .then((pages) => {
        if (!cancelled) setNotionPages(pages)
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load Notion pages')
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingPages(false)
      })

    return () => {
      cancelled = true
    }
  }, [notionState.connection?.id])

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
      const res = await fetch('/api/admin/global-knowledge/upload', { method: 'POST', body: fd })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Upload failed')
      const { path, name } = await res.json()
      startTransition(async () => {
        await insertGlobalKnowledgeSource(path, name, getSourceType(file.type, file.name), platform)
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
        await addGlobalKnowledgeText(textName, textBody, platform)
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
        await deleteGlobalKnowledgeSource(id)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete')
      }
    })
  }

  async function loadNotionPages() {
    setLoadingPages(true)
    setError(null)
    try {
      setNotionPages(await getAccessibleNotionPages())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Notion pages')
    } finally {
      setLoadingPages(false)
    }
  }

  function handleAddNotionRoot() {
    const page = notionPages.find((item) => item.id === selectedNotionPage)
    if (!page) return
    setError(null)
    startTransition(async () => {
      try {
        await addNotionKnowledgeRoot(page.id, page.title, platform)
        setSelectedNotionPage('')
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to add Notion root')
      }
    })
  }

  function handleSyncRoot(rootId: string) {
    startTransition(async () => {
      try {
        await syncNotionKnowledgeRoot(rootId)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to queue sync')
      }
    })
  }

  function handleRemoveRoot(rootId: string) {
    startTransition(async () => {
      try {
        await removeNotionKnowledgeRoot(rootId)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to remove Notion root')
      }
    })
  }

  function handleDisconnectNotion() {
    startTransition(async () => {
      try {
        await disconnectGlobalKnowledgeNotion()
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to disconnect Notion')
      }
    })
  }

  const manualDisabled = disabled || notionState.sourceMode === 'notion'

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

        <div className="space-y-6 p-4 sm:p-5">
          <div className="grid gap-4 lg:grid-cols-[190px_minmax(0,1fr)] lg:items-start xl:grid-cols-[220px_minmax(0,1fr)]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">1. Choose scope</p>
              <p className="mt-1 max-w-md text-pretty text-xs text-text-tertiary">
                Controls which campaign analyses can use this source.
              </p>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-medium">Ad platform</Label>
              <Select
                value={platform}
                onValueChange={(value) => setPlatform(value as GlobalKnowledgePlatform)}
                disabled={disabled}
              >
                <SelectTrigger className="w-full sm:max-w-sm"><SelectValue /></SelectTrigger>
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

          <div className="grid gap-4 lg:grid-cols-[190px_minmax(0,1fr)] lg:items-start xl:grid-cols-[220px_minmax(0,1fr)]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">2. Add content</p>
              <p className="mt-1 max-w-md text-pretty text-xs text-text-tertiary">
                Use original, trusted material with a clear source name.
              </p>
            </div>

            <Tabs
              defaultValue={notionState.connection ? 'notion' : 'file'}
              className="min-w-0 w-full"
            >
              <TabsList className="grid h-10 w-full max-w-xl grid-cols-3">
                <TabsTrigger value="file" className="min-w-0 gap-1.5 px-2 sm:gap-2 sm:px-3">
                  <Upload className="h-3.5 w-3.5" />
                  <span className="truncate">Upload file</span>
                </TabsTrigger>
                <TabsTrigger value="text" className="min-w-0 gap-1.5 px-2 sm:gap-2 sm:px-3">
                  <AlignLeft className="h-3.5 w-3.5" />
                  <span className="truncate">Paste text</span>
                </TabsTrigger>
                <TabsTrigger value="notion" className="min-w-0 gap-1.5 px-2 sm:gap-2 sm:px-3">
                  <Database className="h-3.5 w-3.5" />
                  <span className="truncate">Sync from Notion</span>
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
                      disabled={manualDisabled || busy}
                    />
                    <p className="text-xs text-text-tertiary">PDF, TXT or CSV · maximum 10 MB</p>
                  </div>
                  <Button type="submit" size="sm" disabled={manualDisabled || busy || isPending}>
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
                      disabled={manualDisabled}
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
                      disabled={manualDisabled}
                    />
                  </div>
                  <Button type="submit" size="sm" disabled={manualDisabled || isPending || !textBody.trim()}>
                    {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlignLeft className="h-4 w-4" />}
                    {isPending ? 'Adding…' : 'Add and process'}
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="notion" className="mt-4">
                {!notionState.connection ? (
                  <div className="rounded-lg border border-border-subtle bg-bg-secondary p-5">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border-subtle bg-bg-primary">
                      <Database className="h-5 w-5 text-text-secondary" />
                    </div>
                    <h3 className="mt-4 text-sm font-semibold text-text-primary">Notion is not connected</h3>
                    <p className="mt-1 max-w-lg text-xs leading-5 text-text-tertiary">
                      Connect with OAuth, choose the pages Xphere may read, then select one or more
                      roots below. Once the initial sync completes, Notion becomes the source of truth.
                    </p>
                    <Button asChild size="sm" className="mt-4" disabled={disabled}>
                      <a href="/api/admin/global-knowledge/notion/connect">Connect Notion</a>
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex flex-col gap-4 rounded-lg border border-border-subtle bg-bg-secondary p-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-text-primary">
                            {notionState.connection.workspace_name ?? 'Notion workspace'}
                          </p>
                          <Badge variant="outline">{notionState.connection.status}</Badge>
                          {notionState.sourceMode === 'notion' && (
                            <Badge className="bg-blue-500/15 text-blue-600 dark:text-blue-400">
                              Source of truth
                            </Badge>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-text-tertiary">
                          {notionState.connection.last_synced_at
                            ? `Last synced ${new Date(notionState.connection.last_synced_at).toLocaleString()}`
                            : 'Waiting for the first successful sync'}
                        </p>
                        {notionState.connection.error_detail && (
                          <p className="mt-2 text-xs text-destructive">
                            {notionState.connection.error_detail}
                          </p>
                        )}
                      </div>
                      <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex sm:items-center">
                        <Button asChild variant="outline" size="sm" className="min-w-0">
                          <a href="/api/admin/global-knowledge/notion/connect">Manage access</a>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleDisconnectNotion}
                          disabled={isPending}
                        >
                          <Unplug className="h-4 w-4" />
                          Disconnect
                        </Button>
                      </div>
                    </div>

                    <div className="rounded-lg border border-border-subtle p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <Label className="text-xs">Notion root page</Label>
                          <Popover open={notionPickerOpen} onOpenChange={setNotionPickerOpen}>
                            <PopoverTrigger asChild>
                              <Button
                                type="button"
                                variant="outline"
                                role="combobox"
                                aria-expanded={notionPickerOpen}
                                className="h-10 w-full justify-between px-3 font-normal"
                                disabled={loadingPages || isPending}
                              >
                                <span className="truncate">
                                  {loadingPages
                                    ? 'Loading pages…'
                                    : selectedNotionPageTitle ?? 'Choose a page'}
                                </span>
                                {loadingPages
                                  ? <Loader2 className="h-4 w-4 shrink-0 animate-spin opacity-60" />
                                  : <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent
                              align="start"
                              className="w-[var(--radix-popover-trigger-width)] p-0"
                            >
                              <Command>
                                <CommandInput
                                  placeholder="Search Notion pages…"
                                  className="h-9 text-xs"
                                />
                                <CommandList className="max-h-52">
                                  <CommandEmpty className="py-4 text-center text-xs text-text-tertiary">
                                    No page found.
                                  </CommandEmpty>
                                  <CommandGroup>
                                    {notionPages.map((page) => (
                                      <CommandItem
                                        key={page.id}
                                        value={page.title}
                                        onSelect={() => {
                                          setSelectedNotionPage(page.id)
                                          setNotionPickerOpen(false)
                                        }}
                                        className="text-xs"
                                      >
                                        <span className="min-w-0 flex-1 truncate">{page.title}</span>
                                        {selectedNotionPage === page.id && (
                                          <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                                        )}
                                      </CommandItem>
                                    ))}
                                  </CommandGroup>
                                </CommandList>
                              </Command>
                            </PopoverContent>
                          </Popover>
                        </div>
                        <div className="grid gap-2 sm:flex sm:shrink-0">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={loadNotionPages}
                            className="h-10 w-full whitespace-nowrap sm:w-auto"
                            disabled={loadingPages || isPending}
                          >
                            {loadingPages
                              ? <Loader2 className="h-4 w-4 animate-spin" />
                              : <RefreshCw className="h-4 w-4" />}
                            Load pages
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            onClick={handleAddNotionRoot}
                            className="h-10 w-full whitespace-nowrap sm:w-auto"
                            disabled={!selectedNotionPage || isPending || disabled}
                          >
                            Add root and sync
                          </Button>
                        </div>
                      </div>
                      <p className="mt-2 text-xs text-text-tertiary">
                        The selected media scope applies to the root and all descendant pages.
                      </p>
                    </div>

                    {notionState.roots.length > 0 && (
                      <ul className="space-y-3">
                        {notionState.roots.map((root) => {
                          const rootSources = notionSourcesByRoot.get(root.id) ?? []
                          return (
                          <Collapsible key={root.id} asChild>
                          <li key={root.id} className="overflow-hidden rounded-lg border border-border-subtle">
                            <div className="flex items-center gap-3 px-4 py-3">
                              <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-3 text-left">
                              <Database className="h-4 w-4 shrink-0 text-text-tertiary" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm text-text-primary">{root.title}</p>
                              <p className="text-xs text-text-tertiary">
                                {PLATFORM_LABEL[root.platform]} · {root.status}
                                {root.last_full_sync_at
                                  ? ` · ${new Date(root.last_full_sync_at).toLocaleString()}`
                                  : ''}
                              </p>
                              {root.error_detail && (
                                <p className="mt-1 truncate text-xs text-destructive">{root.error_detail}</p>
                              )}
                            </div>
                              <ChevronDown className="h-4 w-4 shrink-0 text-text-tertiary transition-transform group-data-[state=open]:rotate-180" />
                              </CollapsibleTrigger>
                              <Badge variant="outline">{rootSources.length}</Badge>
                              <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => handleSyncRoot(root.id)}
                              disabled={isPending}
                              aria-label={`Sync ${root.title}`}
                            >
                              <RefreshCw className="h-4 w-4" />
                            </Button>
                              <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => handleRemoveRoot(root.id)}
                              disabled={isPending}
                              aria-label={`Remove ${root.title}`}
                            >
                              <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>

                            <CollapsibleContent>
                            <div className="border-t border-border-subtle bg-bg-secondary/30">
                              <div className="px-4 py-2.5">
                                <p className="text-xs font-medium text-text-secondary">Synced pages</p>
                                <p className="text-xs text-text-tertiary">
                                  Content inherited from this Notion root.
                                </p>
                              </div>
                              {rootSources.length === 0 ? (
                                <p className="border-t border-border-subtle px-4 py-4 text-xs text-text-tertiary">
                                  Pages will appear here as the sync progresses.
                                </p>
                              ) : (
                                <ul className="divide-y divide-border-subtle border-t border-border-subtle">
                                  {rootSources.map((source) => (
                                    <li
                                      key={source.id}
                                      className="flex items-center gap-3 px-4 py-3 [contain-intrinsic-size:44px] [content-visibility:auto]"
                                    >
                                      <FileText className="h-4 w-4 shrink-0 text-text-tertiary" />
                                      <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm text-text-primary">{source.name}</p>
                                        <p className="text-xs text-text-tertiary">
                                          {source.chunk_count} chunks
                                          {source.status === 'error' && source.error_detail
                                            ? ` · ${source.error_detail}`
                                            : ''}
                                        </p>
                                      </div>
                                      <StatusBadge status={source.status} />
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                            </CollapsibleContent>
                          </li>
                          </Collapsible>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                )}
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

      {showStandaloneSources && (
      <div className="overflow-hidden rounded-lg border border-border-subtle">
        <div className="flex items-center justify-between gap-4 border-b border-border-subtle px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">
              {notionState.sourceMode === 'notion' ? 'Manual sources' : 'Knowledge sources'}
            </h2>
            <p className="mt-1 text-xs text-text-tertiary">Processed sources available to Copilot and MCP.</p>
          </div>
          <Badge variant="outline">{manualSources.length}</Badge>
        </div>
        {manualSources.length === 0 ? (
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
            {manualSources.map((s) => (
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
                {s.source_type !== 'notion_page' && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleDelete(s.id)}
                    disabled={isPending}
                    aria-label={`Delete ${s.name}`}
                  >
                    {isPending
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <Trash2 className="h-4 w-4" />}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      )}
    </div>
  )
}
