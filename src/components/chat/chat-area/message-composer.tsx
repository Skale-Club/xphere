'use client'

/**
 * Redesigned composer (v2.2 / SEED-011 + SEED-030 file upload).
 *
 * Features:
 *   - Auto-resizing textarea (rows grow up to maxRows)
 *   - Send-on-Enter / newline on Shift+Enter
 *   - Outbound channel hint
 *   - Disabled hint when bot is active (with quick "pause bot" affordance)
 *   - Optional typing broadcast via onTyping callback (debounced 500ms)
 *   - File attachment via Paperclip button (image/audio/video/PDF, max 5MB)
 *   - Preview of selected file before sending
 */

import { KeyboardEvent, useEffect, useRef, useState } from 'react'
import { Send, Paperclip, Smile, Mic, X, FileText } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface MediaItem {
  url: string
  mime_type: string
  filename?: string
  size?: number
}

interface SendMessageOpts {
  media?: MediaItem[]
}

interface MessageComposerProps {
  onSendMessage: (content: string, opts?: SendMessageOpts) => Promise<void>
  /** Optional — fired (debounced ~500ms) while the user is typing. */
  onTyping?: () => void
  /** Channel hint shown in the footer ("Sending via WhatsApp"). */
  channelLabel?: string | null
  /** When true the composer is disabled and shows a hint. */
  disabled?: boolean
  /** Optional hint banner (e.g. "Bot is active — pause bot to send manually"). */
  disabledHint?: string
  onResumeManual?: () => void
}

const MAX_ROWS = 8
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB

export function MessageComposer({
  onSendMessage,
  onTyping,
  channelLabel,
  disabled,
  disabledHint,
  onResumeManual,
}: MessageComposerProps) {
  const [value, setValue] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [pendingFileUrl, setPendingFileUrl] = useState<string | null>(null)
  const [pendingFileMime, setPendingFileMime] = useState<string>('')
  const [isUploading, setIsUploading] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const lastTypingRef = useRef(0)

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
    // Allow send if there's content OR a pending uploaded file
    if ((!content && !pendingFileUrl) || isSending || disabled) return
    setValue('')
    setIsSending(true)
    try {
      const opts: SendMessageOpts | undefined = pendingFileUrl
        ? {
            media: [
              {
                url: pendingFileUrl,
                mime_type: pendingFileMime,
                filename: pendingFile?.name,
                size: pendingFile?.size,
              },
            ],
          }
        : undefined
      await onSendMessage(content, opts)
      // Clear pending file after successful send
      clearPendingFile()
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

  function clearPendingFile() {
    setPendingFile(null)
    setPendingFileUrl(null)
    setPendingFileMime('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > MAX_FILE_SIZE) {
      alert('File too large. Maximum size is 5 MB.')
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    setPendingFile(file)
    setPendingFileMime(file.type || 'application/octet-stream')
    setIsUploading(true)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch('/api/chat/upload', {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Upload failed' }))
        alert(err.error ?? 'Upload failed')
        clearPendingFile()
        return
      }

      const data = await res.json() as { url: string }
      setPendingFileUrl(data.url)
    } catch {
      alert('Upload failed — please try again')
      clearPendingFile()
    } finally {
      setIsUploading(false)
    }
  }

  const isDisabled = isSending || disabled
  const canSend = (value.trim().length > 0 || !!pendingFileUrl) && !isDisabled && !isUploading
  const isImage = pendingFileMime.startsWith('image/')

  return (
    <div className="shrink-0 border-t border-border-subtle bg-bg-primary/95 px-4 py-3 backdrop-blur md:px-6">
      {disabled && disabledHint && (
        <div className="mb-2 flex items-center justify-between gap-3 rounded-[8px] border border-warning/30 bg-[var(--warning-muted)] px-3 py-2">
          <p className="text-[12px] text-warning">{disabledHint}</p>
          {onResumeManual && (
            <Button size="sm" variant="secondary" onClick={onResumeManual} className="h-7">
              Pause bot
            </Button>
          )}
        </div>
      )}

      {/* File preview */}
      {pendingFile && (
        <div className="mb-2 flex items-center gap-2 rounded-[8px] border border-border-subtle bg-bg-secondary px-3 py-2">
          {isImage && pendingFileUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={pendingFileUrl}
              alt={pendingFile.name}
              className="h-12 w-12 rounded-[4px] object-cover shrink-0"
            />
          ) : (
            <FileText className="h-8 w-8 shrink-0 text-text-tertiary" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-medium text-text-primary truncate">{pendingFile.name}</p>
            <p className="text-[11px] text-text-tertiary">
              {isUploading ? 'Uploading…' : `${(pendingFile.size / 1024).toFixed(0)} KB`}
            </p>
          </div>
          <button
            type="button"
            onClick={clearPendingFile}
            className="shrink-0 rounded-full p-1 hover:bg-bg-tertiary transition-colors"
            aria-label="Remove attachment"
          >
            <X className="h-3.5 w-3.5 text-text-tertiary" />
          </button>
        </div>
      )}

      <div
        className={cn(
          'relative flex items-end gap-2 rounded-[12px] border bg-bg-secondary px-3 py-2 transition-shadow',
          'focus-within:ring-[3px] focus-within:ring-accent/15 focus-within:border-accent/60',
          isDisabled ? 'border-border-subtle opacity-60' : 'border-border-subtle',
        )}
      >
        <TooltipProvider delayDuration={200}>
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,audio/*,video/*,application/pdf"
            className="hidden"
            onChange={handleFileSelected}
            disabled={isDisabled}
          />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-text-tertiary"
                disabled={isDisabled || isUploading}
                onClick={() => fileInputRef.current?.click()}
                type="button"
              >
                <Paperclip className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Attach file</TooltipContent>
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
          style={{ minHeight: '20px' }}
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

      <div className="mt-1.5 flex items-center justify-between px-1 text-[10.5px] text-text-tertiary">
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
