'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

import { Button } from '@/components/ui/button'

interface EmbedSnippetProps {
  baseUrl: string
  widgetToken: string
}

export function EmbedSnippet({ baseUrl, widgetToken }: EmbedSnippetProps) {
  const [copied, setCopied] = useState(false)
  const snippet = `<iframe
  src="${baseUrl}/widget/reviews/${widgetToken}?layout=grid&min_rating=4"
  width="100%"
  height="640"
  frameborder="0"
  style="border:0;border-radius:16px;"
  loading="lazy"
  title="Google reviews">
</iframe>`

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="relative rounded-lg border bg-zinc-950 text-zinc-100">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={copy}
        className="absolute right-2 top-2 h-8 gap-1.5"
      >
        {copied ? (
          <>
            <Check className="h-3.5 w-3.5" />
            Copied
          </>
        ) : (
          <>
            <Copy className="h-3.5 w-3.5" />
            Copy
          </>
        )}
      </Button>
      <pre className="overflow-x-auto p-4 pr-20 font-mono text-xs leading-relaxed">
        <code>{snippet}</code>
      </pre>
    </div>
  )
}
