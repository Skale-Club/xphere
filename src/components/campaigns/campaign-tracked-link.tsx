'use client'

import { useState } from 'react'
import { Copy, Check, ExternalLink, Link2 } from 'lucide-react'
import { buildUTMLink, campaignToUTMParams } from '@/lib/traffic/utm'

interface Props {
  campaign: {
    name: string
    landing_page_url: string | null
    utm_source: string | null
    utm_medium: string | null
    utm_campaign_tag: string | null
    utm_content: string | null
    utm_term: string | null
  }
}

export function CampaignTrackedLink({ campaign }: Props) {
  const [copied, setCopied] = useState(false)

  if (!campaign.landing_page_url) return null

  const params = campaignToUTMParams(campaign)
  const trackedLink = buildUTMLink(campaign.landing_page_url, params)

  async function copy() {
    await navigator.clipboard.writeText(trackedLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="rounded-[12px] border border-border bg-bg-secondary p-6 shadow-elevation-sm">
      <div className="flex items-center gap-2 mb-3">
        <Link2 className="h-4 w-4 text-text-tertiary" />
        <h2 className="text-[15px] font-semibold tracking-tight text-text-primary">Tracked Follow-up Link</h2>
      </div>
      <p className="text-[12.5px] text-text-secondary mb-4">
        Use this link in SMS or email follow-ups. Traffic attribution will be captured automatically.
      </p>

      <div className="flex items-start gap-2 rounded-md border border-border bg-bg-primary p-3">
        <p className="flex-1 text-[12.5px] font-mono text-text-primary break-all">{trackedLink}</p>
        <div className="flex shrink-0 items-center gap-1">
          <a
            href={trackedLink}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded p-1 text-text-tertiary hover:text-text-primary hover:bg-bg-secondary transition-colors"
            title="Open link"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <button
            type="button"
            onClick={copy}
            className="rounded p-1 text-text-tertiary hover:text-text-primary hover:bg-bg-secondary transition-colors"
            title="Copy link"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </div>
  )
}
