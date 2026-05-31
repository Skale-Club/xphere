'use client'

import * as React from 'react'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'

export function TwilioWebhookUrlCopy({ value }: { value: string }) {
  const [copied, setCopied] = React.useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
      toast.success('Webhook URL copied')
    } catch {
      toast.error('Clipboard unavailable')
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-border bg-bg-primary p-3 sm:flex-row sm:items-center">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[12.5px] text-text-primary">
        {value}
      </code>
      <button
        type="button"
        onClick={handleCopy}
        className="inline-flex h-8 shrink-0 items-center justify-center gap-2 rounded-[8px] border border-border-subtle bg-bg-tertiary px-3 text-[12px] font-medium text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-accent" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}
