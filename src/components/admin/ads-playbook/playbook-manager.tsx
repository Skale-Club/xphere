'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, FileText, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
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
  global: 'Geral (todas as mídias)',
}

function getSourceType(mime: string, name: string): 'pdf' | 'text' | 'csv' {
  if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'pdf'
  if (mime === 'text/csv' || name.endsWith('.csv')) return 'csv'
  return 'text'
}

function StatusBadge({ status }: { status: Source['status'] }) {
  if (status === 'ready') return <Badge className="bg-green-500/15 text-green-600 dark:text-green-400">pronto</Badge>
  if (status === 'error') return <Badge variant="destructive">erro</Badge>
  return <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400">processando</Badge>
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
      <div className="rounded-lg border border-border-subtle p-5 space-y-5">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Mídia / Plataforma</Label>
          <Select value={platform} onValueChange={(v) => setPlatform(v as PlaybookPlatform)} disabled={disabled}>
            <SelectTrigger className="w-full sm:w-72"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="meta">Meta Ads</SelectItem>
              <SelectItem value="google">Google Ads</SelectItem>
              <SelectItem value="global">Geral (todas as mídias)</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-text-tertiary">
            &ldquo;Geral&rdquo; é consultado junto com qualquer mídia. Meta/Google só aparecem na sua respectiva mídia.
          </p>
        </div>

        {/* File upload */}
        <form onSubmit={handleFile} className="space-y-2">
          <Label htmlFor="file" className="text-xs font-medium">Enviar arquivo (PDF, TXT, CSV — máx 10MB)</Label>
          <div className="flex gap-2">
            <Input id="file" name="file" type="file" accept=".pdf,.txt,.csv,text/plain,text/csv,application/pdf"
              className="text-xs" required disabled={disabled || busy} />
            <Button type="submit" size="sm" disabled={disabled || busy || isPending}>
              {busy ? 'Enviando…' : 'Enviar'}
            </Button>
          </div>
        </form>

        <div className="border-t border-border-subtle" />

        {/* Paste text (course transcript) */}
        <form onSubmit={handleText} className="space-y-2">
          <Label htmlFor="textName" className="text-xs font-medium">Ou colar texto (ex.: transcrição de curso)</Label>
          <Input id="textName" value={textName} onChange={(e) => setTextName(e.target.value)}
            placeholder="Nome (ex.: Curso Meta Ads — Módulo 1)" className="text-xs" disabled={disabled} />
          <Textarea value={textBody} onChange={(e) => setTextBody(e.target.value)} rows={6}
            placeholder="Cole aqui o conteúdo completo…" className="text-xs" disabled={disabled} />
          <Button type="submit" size="sm" disabled={disabled || isPending || !textBody.trim()}>
            {isPending ? 'Salvando…' : 'Adicionar texto'}
          </Button>
        </form>

        {error && <p className="text-xs text-destructive">{error}</p>}
        {disabled && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Defina a chave OpenRouter global em <strong>Settings → AI Provider</strong> antes de enviar conteúdo.
          </p>
        )}
      </div>

      {/* Sources list */}
      <div className="rounded-lg border border-border-subtle">
        <div className="px-4 py-3 border-b border-border-subtle text-sm font-semibold text-text-primary">
          Fundamentos cadastrados ({sources.length})
        </div>
        {sources.length === 0 ? (
          <p className="px-4 py-6 text-sm text-text-tertiary">Nenhum conteúdo ainda.</p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {sources.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                <FileText className="h-4 w-4 shrink-0 text-text-tertiary" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-text-primary">{s.name}</p>
                  <p className="text-xs text-text-tertiary">
                    {PLATFORM_LABEL[s.platform]} · {s.source_type.toUpperCase()} · {s.chunk_count} trechos
                    {s.status === 'error' && s.error_detail ? ` · ${s.error_detail}` : ''}
                  </p>
                </div>
                <StatusBadge status={s.status} />
                <Button variant="ghost" size="icon-sm" onClick={() => handleDelete(s.id)} disabled={isPending}
                  aria-label="Excluir">
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
