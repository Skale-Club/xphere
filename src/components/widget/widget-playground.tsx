'use client'

import { useState, useCallback } from 'react'
import { RefreshCw, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface WidgetPlaygroundProps {
  widgetToken: string
}

export function WidgetPlayground({ widgetToken }: WidgetPlaygroundProps) {
  // Bump the key to force a full iframe reload (clears the widget session).
  const [key, setKey] = useState(0)
  const reset = useCallback(() => setKey((k) => k + 1), [])

  const src = `/api/widget-preview/${widgetToken}`

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[13.5px] font-semibold text-text-primary">Test your widget</p>
          <p className="text-[12px] text-text-tertiary mt-0.5">
            Click the bubble to open and test a real conversation.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={reset}
            className="gap-1.5"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Reset
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            asChild
            className="gap-1.5 text-text-tertiary"
          >
            <a href={src} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-[14px] border border-border-subtle bg-[#0f0f11]" style={{ height: 480 }}>
        <iframe
          key={key}
          src={src}
          title="Widget playground"
          className="h-full w-full border-0"
          sandbox="allow-scripts allow-same-origin allow-forms"
        />
      </div>
    </div>
  )
}
