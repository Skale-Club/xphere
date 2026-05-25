'use client'

import { useState } from 'react'
import { Copy, Check, ExternalLink, Link2 } from 'lucide-react'

interface Props {
  link: string
  landingPage: string
}

export function CampaignTrackedLink({ link, landingPage }: Props) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="rounded-[12px] border border-border bg-bg-secondary p-5 shadow-elevation-sm">
      <div className="flex items-center gap-2 mb-3">
        <Link2 className="h-4 w-4 text-text-tertiary" />
        <h2 className="text-[13px] font-semibold text-text-primary">Tracked link</h2>
        <span className="text-[11px] text-text-tertiary">→ {landingPage}</span>
      </div>
      <div className="flex items-center gap-2">
        <p className="flex-1 truncate rounded-md bg-bg-tertiary px-3 py-2 text-xs font-mono text-text-secondary">
          {link}
        </p>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors shrink-0"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors shrink-0"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Open
        </a>
      </div>
      <p className="mt-2 text-[11px] text-text-tertiary">
        Share this link in SMS or email follow-ups to track campaign attribution in Traffic.
      </p>
    </div>
  )
}
