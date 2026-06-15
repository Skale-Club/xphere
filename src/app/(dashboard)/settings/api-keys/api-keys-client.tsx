'use client'

import { useState, useTransition } from 'react'
import { KeyRound, Plus, Trash2, Copy, Check, Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { API_KEY_SCOPES, type ApiKeyScope } from '@/lib/api-keys/scopes'
import { generateApiKey, revokeApiKey, type ApiKeyRow } from './actions'

// ── helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function relativeDate(iso: string | null) {
  if (!iso) return 'Never'
  const diff = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diff / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days}d ago`
  return formatDate(iso)
}

// ── RevealKey — shows generated key once ────────────────────────────────────

function RevealKey({ value }: { value: string }) {
  const [visible, setVisible] = useState(false)
  const [copied, setCopied] = useState(false)

  async function copy() {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 rounded-lg border border-border bg-bg-secondary px-3 py-2 font-mono text-[13px]">
        <span className="min-w-0 flex-1 truncate text-text-primary">
          {visible ? value : '•'.repeat(Math.min(value.length, 48))}
        </span>
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="shrink-0 text-text-tertiary hover:text-text-primary transition-colors"
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={copy}
          className="shrink-0 text-text-tertiary hover:text-text-primary transition-colors"
        >
          {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
      <p className="text-[12px] text-amber-600 dark:text-amber-400">
        Copy this key now — it won&apos;t be shown again.
      </p>
    </div>
  )
}

// ── GenerateDialog ────────────────────────────────────────────────────────────

function GenerateDialog({ onCreated }: { onCreated: (row: ApiKeyRow) => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<ApiKeyScope[]>(['contacts:write'])
  const [generatedKey, setGeneratedKey] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function reset() {
    setName('')
    setScopes(['contacts:write'])
    setGeneratedKey(null)
  }

  function toggleScope(scope: ApiKeyScope) {
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    )
  }

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) reset()
  }

  function submit() {
    if (!name.trim() || scopes.length === 0) return
    startTransition(async () => {
      const { key, row, error } = await generateApiKey({ name: name.trim(), scopes })
      if (error || !key || !row) {
        toast.error(error ?? 'Failed to generate key')
        return
      }
      setGeneratedKey(key)
      onCreated(row)
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4 mr-1.5" />
          New API Key
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create API Key</DialogTitle>
          <DialogDescription>
            Name this key by its source — e.g. &ldquo;Skaleclub Forms&rdquo; or &ldquo;Typeform&rdquo;.
          </DialogDescription>
        </DialogHeader>

        {generatedKey ? (
          <div className="space-y-4 py-2">
            <p className="text-[13px] text-text-secondary">
              Your new API key has been created:
            </p>
            <RevealKey value={generatedKey} />
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="key-name">Name</Label>
              <Input
                id="key-name"
                placeholder="e.g. Skaleclub Forms"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>Scopes</Label>
              <div className="flex flex-col gap-1.5">
                {API_KEY_SCOPES.map((scope) => {
                  const active = scopes.includes(scope.key)
                  return (
                    <button
                      key={scope.key}
                      type="button"
                      onClick={() => toggleScope(scope.key)}
                      className={cn(
                        'flex items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors',
                        active
                          ? 'border-accent bg-accent-muted'
                          : 'border-border bg-bg-secondary hover:bg-bg-tertiary/50',
                      )}
                    >
                      <span
                        className={cn(
                          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                          active ? 'border-accent bg-accent text-white' : 'border-border',
                        )}
                      >
                        {active && <Check className="h-3 w-3" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block font-mono text-[12px] text-text-primary">{scope.key}</span>
                        <span className="block text-[11.5px] text-text-tertiary">{scope.description}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          {generatedKey ? (
            <Button onClick={() => handleOpenChange(false)}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => handleOpenChange(false)}>Cancel</Button>
              <Button onClick={submit} disabled={!name.trim() || scopes.length === 0 || pending}>
                {pending ? 'Generating…' : 'Generate'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── RevokeButton ──────────────────────────────────────────────────────────────

function RevokeButton({ id, name, onRevoked }: { id: string; name: string; onRevoked: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  function confirm() {
    startTransition(async () => {
      const { error } = await revokeApiKey(id)
      if (error) {
        toast.error(error)
        return
      }
      toast.success(`"${name}" revoked`)
      onRevoked(id)
      setOpen(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="text-text-tertiary hover:text-red-500 transition-colors"
          title="Revoke key"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Revoke API Key</DialogTitle>
          <DialogDescription>
            Revoke <span className="font-medium text-text-primary">&ldquo;{name}&rdquo;</span>? Any app using it will stop working immediately.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="destructive" onClick={confirm} disabled={pending}>
            {pending ? 'Revoking…' : 'Revoke'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── ApiKeysClient (main export) ───────────────────────────────────────────────

export function ApiKeysClient({ initial }: { initial: ApiKeyRow[] }) {
  const [keys, setKeys] = useState<ApiKeyRow[]>(initial)

  function handleCreated(row: ApiKeyRow) {
    setKeys((prev) => [row, ...prev])
  }

  function handleRevoked(id: string) {
    setKeys((prev) => prev.filter((k) => k.id !== id))
  }

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[13px] text-text-secondary">
            Use Bearer tokens to push contacts and prospects from external sources directly into your CRM.
          </p>
          <p className="mt-1 font-mono text-[12px] text-text-tertiary">
            POST https://xphere.app/api/v1/contacts · /api/v1/prospects
          </p>
        </div>
        <GenerateDialog onCreated={handleCreated} />
      </div>

      {/* Keys table */}
      {keys.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-12 text-center">
          <KeyRound className="h-8 w-8 text-text-tertiary mb-3" />
          <p className="text-[14px] font-medium text-text-secondary">No API keys yet</p>
          <p className="mt-1 text-[12px] text-text-tertiary">
            Generate a key to start receiving contacts from external sources.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border bg-bg-secondary">
                <th className="px-4 py-2.5 text-left font-medium text-text-tertiary">Name</th>
                <th className="px-4 py-2.5 text-left font-medium text-text-tertiary">Key</th>
                <th className="px-4 py-2.5 text-left font-medium text-text-tertiary">Scopes</th>
                <th className="px-4 py-2.5 text-left font-medium text-text-tertiary">Last used</th>
                <th className="px-4 py-2.5 text-left font-medium text-text-tertiary">Created</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {keys.map((k) => (
                <tr key={k.id} className="bg-bg-primary hover:bg-bg-secondary transition-colors">
                  <td className="px-4 py-3 font-medium text-text-primary">{k.name}</td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-[12px] text-text-secondary bg-bg-secondary px-1.5 py-0.5 rounded">
                      {k.key_prefix}…
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(k.scopes ?? []).map((s) => (
                        <span
                          key={s}
                          className="font-mono text-[11px] text-text-secondary bg-bg-secondary px-1.5 py-0.5 rounded"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-text-secondary">{relativeDate(k.last_used_at)}</td>
                  <td className="px-4 py-3 text-text-tertiary">{formatDate(k.created_at)}</td>
                  <td className="px-4 py-3 text-right">
                    <RevokeButton id={k.id} name={k.name} onRevoked={handleRevoked} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Usage example */}
      <details className="group">
        <summary className="cursor-pointer text-[12px] text-text-tertiary hover:text-text-secondary select-none list-none flex items-center gap-1.5">
          <span className="group-open:rotate-90 transition-transform inline-block">›</span>
          Quick start example
        </summary>
        <pre className="mt-3 overflow-x-auto rounded-lg border border-border bg-bg-secondary p-4 text-[12px] text-text-secondary leading-relaxed">
{`# Push a contact (scope: contacts:write)
curl -X POST https://xphere.app/api/v1/contacts \\
  -H "Authorization: Bearer xph_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "João Silva",
    "phone": "+5511987654321",
    "email": "joao@empresa.com",
    "source_label": "skaleclub",
    "tags": ["lead-quente"]
  }'

# Push a batch of prospects (scope: prospects:write)
curl -X POST https://xphere.app/api/v1/prospects \\
  -H "Authorization: Bearer xph_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "source": { "type": "xcraper", "external_run_id": "run_123" },
    "prospects": [
      { "kind": "company", "name": "Acme Cleaning", "domain": "acme.com",
        "source_id": "place_abc", "recommended_channel": "email" }
    ]
  }'`}
        </pre>
      </details>
    </div>
  )
}
