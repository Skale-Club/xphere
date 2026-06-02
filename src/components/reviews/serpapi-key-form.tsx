'use client'

import { useState, useTransition } from 'react'
import { ExternalLink, KeyRound, Loader2, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'

import { saveSerpApiKey } from '@/app/(dashboard)/integrations/google-reviews/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface SerpApiKeyFormProps {
  currentHint: string | null
  /** Called after the key is successfully saved (used by the setup wizard). */
  onSaved?: () => void
}

export function SerpApiKeyForm({ currentHint, onSaved }: SerpApiKeyFormProps) {
  const [value, setValue] = useState('')
  const [isPending, startTransition] = useTransition()

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (value.trim().length < 20) {
      toast.error('API key looks too short.')
      return
    }
    startTransition(async () => {
      const res = await saveSerpApiKey({ apiKey: value })
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success('SerpAPI key saved.')
      setValue('')
      onSaved?.()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="serpapi-key" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          API Key
        </Label>
        <div className="relative">
          <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="serpapi-key"
            type="password"
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={currentHint ?? 'sk_••••••••••••••••••••••••••••••'}
            className="pl-9 font-mono text-sm"
          />
        </div>
        {currentHint ? (
          <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
            <ShieldCheck className="h-3.5 w-3.5" />
            Current key on file: <span className="font-mono">{currentHint}</span>
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Free tier includes 100 searches/month | one daily scrape consumes about 30.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <a
          href="https://serpapi.com/manage-api-key"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-primary underline-offset-4 hover:underline"
        >
          Get your free SerpAPI key
          <ExternalLink className="h-3 w-3" />
        </a>
        <Button type="submit" disabled={isPending || value.trim().length < 20} size="sm">
          {isPending ? (
            <>
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              Saving…
            </>
          ) : currentHint ? (
            'Update key'
          ) : (
            'Save key'
          )}
        </Button>
      </div>
    </form>
  )
}
