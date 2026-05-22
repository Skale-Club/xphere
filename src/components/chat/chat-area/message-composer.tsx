'use client'

/**
 * Redesigned composer (v2.2 / SEED-011).
 *
 * Features:
 *   - Auto-resizing textarea (rows grow up to maxRows)
 *   - Send-on-Enter / newline on Shift+Enter
 *   - Outbound channel hint
 *   - Disabled hint when bot is active (with quick "pause bot" affordance)
 *   - Optional typing broadcast via onTyping callback (debounced 500ms)
 */

import React, { KeyboardEvent, useEffect, useRef, useState } from 'react'
import { Send, Paperclip, Smile, Mic } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useVisualViewport } from '@/hooks/use-visual-viewport'
import { haptic } from '@/lib/haptics'

/** SEED-039: channel the message will be sent on. */
export type ComposerChannel = {
  channel: string
  label: string
}

interface MessageComposerProps {
  onSendMessage: (content: string) => Promise<void>
  /** Optional | fired (debounced ~500ms) while the user is typing. */
  onTyping?: () => void
  /** Channel hint shown in the footer ("Sending via WhatsApp"). */
  channelLabel?: string | null
  /** When true the composer is disabled and shows a hint. */
  disabled?: boolean
  /** Optional hint banner (e.g. "Bot is active | pause bot to send manually"). */
  disabledHint?: string
  onResumeManual?: () => void
  /** SEED-039: channels this contact can be reached on. */
  availableChannels?: ComposerChannel[]
  /** SEED-039: currently selected outbound channel. */
  activeChannel?: string
  /** SEED-039: callback when the operator switches channel. */
  onActiveChannelChange?: React.Dispatch<React.SetStateAction<string | null>>
}

const MAX_ROWS = 8

export function MessageComposer({
  onSendMessage,
  onTyping,
  channelLabel,
  disabled,
  disabledHint,
  onResumeManual,
  availableChannels: _availableChannels,
  activeChannel: _activeChannel,
  onActiveChannelChange: _onActiveChannelChange,
}: MessageComposerProps) {
  const [value, setValue] = useState('')
  const [isSending, setIsSending] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const lastTypingRef = useRef(0)
  // SEED-040: push the composer above the iOS soft keyboard when it opens.
  const keyboardOffset = useVisualViewport()

  // Auto-resize
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    const lineHeight = 20
    const maxHeight = lineHeight * MAX_ROWS + 18
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`
  }, [value])

  async function handleSend() {
    const content = value.trim()
    if (!content || isSending || disabled) return
    setValue('')
    setIsSending(true)
    // SEED-040: tiny haptic confirmation on send (no-op on desktop / iOS).
    haptic(10)
    try {
      await onSendMessage(content)
    } finally {
      setIsSending(false)
      ref.current?.focus()
    }
  }

  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  function handleChange(next: string) {
    setValue(next)
    if (!onTyping) return
    const now = Date.now()
    if (now - lastTypingRef.current > 500) {
      lastTypingRef.current = now
      onTyping()
    }
  }

  const isDisabled = isSending || disabled
  const canSend = value.trim().length > 0 && !isDisabled

  return (
    <div
      className="shrink-0 border-t border-border-subtle bg-bg-primary/95 px-4 py-4 pb-safe-4 backdrop-blur md:px-6"
      style={{
        transform: keyboardOffset > 0 ? `translateY(-${keyboardOffset}px)` : undefined,
        transition: 'transform 100ms',
      }}
    >
      {/* Bot warning moved to the right contact panel (subtle BotStatusBanner).
          The composer stays disabled with a "Sending disabled…" placeholder so
          the user still has a clear affordance here. */}

      <div
        className={cn(
          'relative flex items-end gap-2 rounded-[12px] border bg-bg-secondary px-3 py-2 transition-shadow',
          'focus-within:ring-[3px] focus-within:ring-accent/15 focus-within:border-accent/60',
          isDisabled ? 'border-border-subtle opacity-60' : 'border-border-subtle',
        )}
      >
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-text-tertiary" disabled>
                <Paperclip className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Attach (coming soon)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-text-tertiary" disabled>
                <Smile className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Emoji (coming soon)</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <textarea
          ref={ref}
          rows={1}
          placeholder={isDisabled ? 'Sending disabled…' : 'Type a message…'}
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKey}
          disabled={isDisabled}
          className={cn(
            'flex-1 resize-none bg-transparent text-[13.5px] leading-snug text-text-primary outline-none',
            'placeholder:text-text-tertiary',
            'py-1.5',
          )}
          style={{ minHeight: '20px', fontSize: '16px' }}  /* 16px prevents iOS auto-zoom on focus */
        />

        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-text-tertiary" disabled>
                <Mic className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Record (coming soon)</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <Button
          size="icon"
          onClick={handleSend}
          disabled={!canSend}
          className={cn(
            'h-8 w-8 shrink-0 rounded-[8px] transition-all',
            canSend
              ? 'bg-accent text-white shadow-sm hover:bg-accent-hover hover:scale-[1.03]'
              : 'bg-bg-tertiary text-text-tertiary',
          )}
          aria-label="Send"
        >
          <Send className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="mt-3 flex items-center justify-between px-1 text-[10.5px] text-text-tertiary">
        <span>
          <kbd className="rounded border border-border-subtle bg-bg-tertiary px-1 py-0.5 font-mono text-[9.5px]">
            Enter
          </kbd>{' '}
          to send ·{' '}
          <kbd className="rounded border border-border-subtle bg-bg-tertiary px-1 py-0.5 font-mono text-[9.5px]">
            Shift+Enter
          </kbd>{' '}
          for new line
        </span>
        {channelLabel && <span>Sending via {channelLabel}</span>}
      </div>
    </div>
  )
}
