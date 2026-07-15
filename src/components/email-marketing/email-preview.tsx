'use client'

// @deprecated Legacy /email-marketing system, retired in favor of the
// block-based builder at /settings/email-templates. Kept for existing
// data only — do not build new features against this. See
// .planning/workstreams/email-builder-hardening/PLAN.md Phase 5.

import { useState } from 'react'
import { Monitor, Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface EmailPreviewProps {
  html: string
  subjectLine?: string
  previewText?: string
}

export function EmailPreview({ html, subjectLine, previewText }: EmailPreviewProps) {
  const [view, setView] = useState<'desktop' | 'mobile'>('desktop')

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/30 shrink-0">
        <div className="text-xs text-muted-foreground space-y-0.5">
          {subjectLine && (
            <p>
              <span className="font-medium text-foreground">Assunto:</span>{' '}
              {subjectLine}
            </p>
          )}
          {previewText && (
            <p>
              <span className="font-medium">Preview:</span>{' '}
              <span className="text-muted-foreground">{previewText}</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant={view === 'desktop' ? 'secondary' : 'ghost'}
            className="h-7 w-7"
            onClick={() => setView('desktop')}
            title="Desktop"
          >
            <Monitor className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant={view === 'mobile' ? 'secondary' : 'ghost'}
            className="h-7 w-7"
            onClick={() => setView('mobile')}
            title="Mobile"
          >
            <Smartphone className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Frame */}
      <div className="flex-1 overflow-auto bg-zinc-100 flex items-start justify-center py-6 px-4">
        <div
          className={cn(
            'bg-white shadow-lg transition-all duration-300',
            view === 'desktop' ? 'w-full max-w-[680px]' : 'w-[375px]',
          )}
          style={{ borderRadius: 4 }}
        >
          <iframe
            srcDoc={html}
            title="Email preview"
            className="w-full border-0"
            style={{ height: '800px', minHeight: '600px' }}
            sandbox="allow-same-origin"
          />
        </div>
      </div>
    </div>
  )
}
