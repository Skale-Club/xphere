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
import { Send, Paperclip, Smile, Mic, Square, X, FileText, AlertTriangle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ChannelBadge, type Channel } from '@/components/design-system/channel-badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useVisualViewport } from '@/hooks/use-visual-viewport'
import { haptic } from '@/lib/haptics'
import type { ConversationPriority } from '@/types/chat'

const EMOJI_GROUPS: Array<{ title: string; emojis: string[] }> = [
  { title: 'Smileys', emojis: ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔'] },
  { title: 'Gestures', emojis: ['👍','👎','👏','🙌','🤝','🙏','💪','✌️','🤞','🤟','🤘','👌','🤌','🤏','👈','👉','👆','👇','☝️','✋','🤚','🖐️','🖖','👋','🤙'] },
  { title: 'Hearts', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟'] },
  { title: 'Objects', emojis: ['🔥','⭐','✨','💡','🎉','🎊','🎁','📌','📎','📝','✅','❌','⚠️','⏰','🚀','💯','💸','💰','📈','📉','📊','🔔','🔕','💬','💭','🤖'] },
]

/** SEED-039: channel the message will be sent on. */
export type ComposerChannel = {
  channel: string
  label: string
  conversationId?: string
}

interface MessageComposerProps {
  onSendMessage: (
    content: string,
    opts?: {
      channel?: string
      conversationId?: string
      subject?: string
      media?: Array<{ url: string; mime_type: string; size?: number; filename?: string }>
    },
  ) => Promise<void>
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
  priority?: ConversationPriority
  onPriorityCycle?: () => void
  /**
   * WhatsApp Cloud template support. When `available` is true, the composer
   * shows a "Send template" button next to Send. When `outsideWindow` is
   * true, the 24h customer service window has expired and free-text
   * messages will be rejected by Meta — the composer renders a banner and
   * disables the regular Send button to steer the user to a template.
   */
  templateSupport?: {
    available: boolean
    outsideWindow: boolean
  }
  /** Opens the template selector modal. Required when templateSupport.available. */
  onSendTemplate?: () => void
}

const MAX_ROWS = 8
const CHANNEL_MAP: Record<string, Channel> = {
  whatsapp: 'whatsapp',
  ghl_whatsapp: 'whatsapp',
  instagram: 'instagram',
  messenger: 'messenger',
  sms: 'sms',
  ghl_sms: 'sms',
  voice: 'voice',
  email: 'email',
  widget: 'web',
  web: 'web',
  zernio_instagram: 'instagram',
  zernio_facebook: 'messenger',
  zernio_whatsapp: 'whatsapp',
  zernio_telegram: 'unknown',
  zernio_linkedin: 'unknown',
  zernio_tiktok: 'unknown',
  zernio_twitter: 'unknown',
  zernio_threads: 'unknown',
  zernio_youtube: 'unknown',
}

function badgeChannel(channel?: string | null): Channel {
  if (!channel) return 'unknown'
  return CHANNEL_MAP[channel] ?? 'unknown'
}

export function MessageComposer({
  onSendMessage,
  onTyping,
  channelLabel,
  disabled,
  disabledHint,
  onResumeManual,
  availableChannels = [],
  activeChannel,
  onActiveChannelChange,
  priority = 'normal',
  onPriorityCycle,
  templateSupport,
  onSendTemplate,
}: MessageComposerProps) {
  const [value, setValue] = useState('')
  const [subject, setSubject] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const isEmail = (activeChannel ?? '') === 'email'
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [attachments, setAttachments] = useState<File[]>([])
  const [recording, setRecording] = useState(false)
  const [recordSeconds, setRecordSeconds] = useState(0)
  const ref = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastTypingRef = useRef(0)
  // SEED-040: push the composer above the iOS soft keyboard when it opens.
  const keyboardOffset = useVisualViewport()

  function insertAtCursor(text: string) {
    const el = ref.current
    if (!el) {
      setValue((v) => v + text)
      return
    }
    const start = el.selectionStart ?? value.length
    const end = el.selectionEnd ?? value.length
    const next = value.slice(0, start) + text + value.slice(end)
    setValue(next)
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + text.length
      el.setSelectionRange(pos, pos)
    })
  }

  function handleEmojiPick(emoji: string) {
    insertAtCursor(emoji)
    setEmojiOpen(false)
  }

  function handleAttachClick() {
    fileInputRef.current?.click()
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return
    setAttachments((prev) => [...prev, ...files])
    toast.success(`${files.length} file${files.length > 1 ? 's' : ''} attached`)
    e.target.value = ''
  }

  function removeAttachment(idx: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== idx))
  }

  async function handleMicToggle() {
    if (recording) {
      mediaRecorderRef.current?.stop()
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error('Voice recording not supported in this browser')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      const chunks: Blob[] = []
      mr.ondataavailable = (ev) => chunks.push(ev.data)
      mr.onstop = () => {
        const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' })
        const file = new File([blob], `voice-${Date.now()}.webm`, { type: blob.type })
        setAttachments((prev) => [...prev, file])
        stream.getTracks().forEach((t) => t.stop())
        setRecording(false)
        if (recordTimerRef.current) clearInterval(recordTimerRef.current)
        setRecordSeconds(0)
        toast.success('Voice clip captured')
      }
      mr.start()
      mediaRecorderRef.current = mr
      setRecording(true)
      setRecordSeconds(0)
      recordTimerRef.current = setInterval(() => {
        setRecordSeconds((s) => s + 1)
      }, 1000)
    } catch {
      toast.error('Microphone access denied')
    }
  }

  function cancelRecording() {
    const mr = mediaRecorderRef.current
    if (!mr) return
    mr.ondataavailable = null
    mr.onstop = () => {
      mr.stream.getTracks().forEach((t) => t.stop())
    }
    mr.stop()
    setRecording(false)
    if (recordTimerRef.current) clearInterval(recordTimerRef.current)
    setRecordSeconds(0)
  }

  useEffect(() => {
    return () => {
      if (recordTimerRef.current) clearInterval(recordTimerRef.current)
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop()
      }
    }
  }, [])

  useEffect(() => {
    setSendError(null)
  }, [activeChannel])

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
    if ((!content && attachments.length === 0) || isSending || disabled) return
    const activeOption = availableChannels.find((ch) => ch.channel === activeChannel)
    const filesToSend = attachments
    setValue('')
    setSendError(null)
    setIsSending(true)
    // SEED-040: tiny haptic confirmation on send (no-op on desktop / iOS).
    haptic(10)
    try {
      // Upload any attachments first → public chat-media URLs to send as media.
      let media:
        | Array<{ url: string; mime_type: string; size?: number; filename?: string }>
        | undefined
      if (filesToSend.length > 0) {
        media = []
        for (const file of filesToSend) {
          const fd = new FormData()
          fd.append('file', file)
          const res = await fetch('/api/chat/upload', { method: 'POST', body: fd })
          if (!res.ok) {
            const msg = (await res.json().catch(() => null))?.error ?? 'Upload failed'
            throw new Error(msg)
          }
          const { url } = (await res.json()) as { url: string }
          media.push({
            url,
            mime_type: file.type || 'application/octet-stream',
            size: file.size,
            filename: file.name,
          })
        }
      }
      await onSendMessage(content, {
        channel: activeOption?.channel ?? activeChannel,
        conversationId: activeOption?.conversationId,
        subject: isEmail ? subject.trim() || undefined : undefined,
        media,
      })
      setAttachments([])
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Message was not sent.'
      setSendError(message)
      setValue(content)
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
    if (sendError) setSendError(null)
    if (!onTyping) return
    const now = Date.now()
    if (now - lastTypingRef.current > 500) {
      lastTypingRef.current = now
      onTyping()
    }
  }

  const outsideWindow = Boolean(templateSupport?.outsideWindow)
  const isDisabled = isSending || disabled
  // Outside the 24h customer service window, free-text via Cloud will fail
  // — only templates work. We block the regular Send button to steer the
  // operator to the template path instead of letting them get a Meta error.
  const canSend = (value.trim().length > 0 || attachments.length > 0) && !isDisabled && !outsideWindow
  const activeOption =
    availableChannels.find((ch) => ch.channel === activeChannel) ??
    availableChannels[0] ??
    null
  const showChannelSelect = availableChannels.length > 1
  const priorityLabel = priority === 'urgent' ? 'Urgent' : priority === 'high' ? 'High' : 'Normal'
  const priorityChipClass =
    priority === 'urgent'
      ? 'border-rose-500/40 bg-rose-500/15 text-rose-300'
      : priority === 'high'
      ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
      : 'border-border-subtle bg-bg-tertiary/60 text-text-secondary'
  const priorityDotClass =
    priority === 'urgent' ? 'bg-rose-500' : priority === 'high' ? 'bg-amber-500' : 'bg-text-tertiary'

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

      <div className="mb-4 flex items-center justify-between gap-3 px-1">
        <div className="flex min-w-0 items-center gap-2 select-none">
          <span className="text-[10px] font-medium uppercase tracking-wide text-text-tertiary">Channel</span>
          {showChannelSelect && activeOption ? (
            <Select value={activeOption.channel} onValueChange={(next) => onActiveChannelChange?.(next)}>
              {/* Trigger: icon-only badge (no colored bg) + plain label text so
                  the pill color doesn't bleed into the button background. */}
              <SelectTrigger className="h-7 w-auto min-w-0 gap-1.5 rounded-[7px] border-border-subtle bg-bg-secondary px-2 py-1 text-[11.5px] text-text-secondary ring-offset-0 focus-visible:ring-1 focus-visible:ring-accent/40 focus-visible:ring-offset-0">
                <span className="inline-flex items-center gap-1.5">
                  <ChannelBadge channel={badgeChannel(activeOption.channel)} size="sm" showLabel={false} className="bg-transparent" />
                  <span className="text-[11.5px] text-text-primary">{activeOption.label}</span>
                </span>
              </SelectTrigger>
              <SelectContent align="start" className="min-w-[150px]">
                {availableChannels.map((ch) => (
                  <SelectItem key={`${ch.channel}-${ch.conversationId ?? 'current'}`} value={ch.channel}>
                    <span className="inline-flex items-center gap-2">
                      <ChannelBadge channel={badgeChannel(ch.channel)} showLabel={false} size="sm" />
                      {ch.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : activeOption ? (
            <span className="inline-flex items-center gap-1.5">
              <ChannelBadge channel={badgeChannel(activeOption.channel)} size="sm" showLabel={false} className="bg-transparent" />
              <span className="text-[11.5px] text-text-secondary">{activeOption.label}</span>
            </span>
          ) : channelLabel ? (
            <span className="text-[11.5px] text-text-secondary">{channelLabel}</span>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2 select-none">
          <span className="text-[10px] font-medium uppercase tracking-wide text-text-tertiary">Status</span>
          {(() => {
            const chip = (
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-all',
                  priorityChipClass,
                )}
              >
                <span className={cn('h-1.5 w-1.5 rounded-full', priorityDotClass)} />
                {priorityLabel}
              </span>
            )
            return onPriorityCycle ? (
              <button
                type="button"
                onClick={onPriorityCycle}
                className="flex items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                {chip}
              </button>
            ) : (
              chip
            )
          })()}
        </div>
      </div>

      {outsideWindow && (
        <div className="mb-2 flex items-start gap-2 rounded-[8px] border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11.5px] text-amber-200">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span className="leading-relaxed">
            Outside the 24-hour customer service window — free text won&apos;t be delivered by
            Meta. Use a <strong>template</strong> to continue this conversation.
          </span>
        </div>
      )}

      {disabledHint && (
        <div className="mb-2 flex items-start justify-between gap-2 rounded-[8px] border border-warning/30 bg-[var(--warning-muted)] px-3 py-2 text-[11.5px] text-warning">
          <div className="flex min-w-0 items-start gap-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="leading-relaxed">{disabledHint}</span>
          </div>
          {onResumeManual && (
            <button
              type="button"
              onClick={onResumeManual}
              className="shrink-0 text-[11.5px] font-medium underline-offset-4 hover:underline"
            >
              Pause bot
            </button>
          )}
        </div>
      )}

      {sendError && (
        <div className="mb-2 flex items-start gap-2 rounded-[8px] border border-danger/30 bg-danger/10 px-3 py-2 text-[11.5px] text-danger">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="leading-relaxed">Message not sent: {sendError}</span>
        </div>
      )}

      {isEmail && (
        <div className="mb-2 flex items-center gap-2 rounded-[10px] border border-border-subtle bg-bg-secondary px-3 py-1.5">
          <span className="text-[10px] font-medium uppercase tracking-wide text-text-tertiary">
            Subject
          </span>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={isDisabled}
            placeholder="Email subject…"
            className="flex-1 bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-tertiary"
          />
        </div>
      )}

      <div
        className={cn(
          'relative flex items-stretch rounded-[12px] border bg-bg-secondary transition-shadow',
          'focus-within:ring-[3px] focus-within:ring-accent/15 focus-within:border-accent/60',
          isDisabled ? 'border-border-subtle opacity-60' : 'border-border-subtle',
        )}
      >
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileChange}
        />

        {/* Icon cluster — separated by delicate vertical lines */}
        <TooltipProvider delayDuration={200}>
          <div className="flex items-center divide-x divide-border-subtle/60 px-1 py-2">
            <div className="px-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-text-tertiary hover:text-text-primary"
                    onClick={handleAttachClick}
                    disabled={isDisabled}
                    aria-label="Attach files"
                  >
                    <Paperclip className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Attach files</TooltipContent>
              </Tooltip>
            </div>
            <div className="px-1">
              <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <PopoverTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className={cn(
                          'h-7 w-7 shrink-0 text-text-tertiary hover:text-text-primary',
                          emojiOpen && 'text-text-primary bg-bg-tertiary',
                        )}
                        disabled={isDisabled}
                        aria-label="Insert emoji"
                      >
                        <Smile className="h-3.5 w-3.5" />
                      </Button>
                    </PopoverTrigger>
                  </TooltipTrigger>
                  <TooltipContent>Emoji</TooltipContent>
                </Tooltip>
                <PopoverContent align="start" className="w-[300px] p-0">
                  <div className="max-h-[280px] overflow-y-auto p-2">
                    {EMOJI_GROUPS.map((group) => (
                      <div key={group.title} className="mb-2 last:mb-0">
                        <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
                          {group.title}
                        </div>
                        <div className="grid grid-cols-8 gap-0.5">
                          {group.emojis.map((emoji) => (
                            <button
                              key={emoji}
                              type="button"
                              onClick={() => handleEmojiPick(emoji)}
                              className="flex h-7 w-7 items-center justify-center rounded text-[18px] hover:bg-bg-tertiary"
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            <div className="px-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      'h-7 w-7 shrink-0 transition-colors',
                      recording
                        ? 'text-rose-400 bg-rose-500/10 hover:text-rose-300 hover:bg-rose-500/15'
                        : 'text-text-tertiary hover:text-text-primary',
                    )}
                    onClick={handleMicToggle}
                    disabled={isDisabled}
                    aria-label={recording ? 'Stop recording' : 'Record voice'}
                  >
                    {recording ? <Square className="h-3.5 w-3.5 fill-current" /> : <Mic className="h-3.5 w-3.5" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{recording ? 'Stop' : 'Record voice'}</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </TooltipProvider>

        {/* Vertical divider between icon cluster and textarea */}
        <div className="w-px self-stretch bg-border-subtle/60" aria-hidden />

        <div className="flex flex-1 items-end gap-2 px-3 py-2">
          {recording ? (
            <div className="flex flex-1 items-center gap-2 py-1">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-500 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500" />
              </span>
              <span className="text-[13px] font-medium text-text-primary tabular-nums">
                Recording {String(Math.floor(recordSeconds / 60)).padStart(2, '0')}:{String(recordSeconds % 60).padStart(2, '0')}
              </span>
              <button
                type="button"
                onClick={cancelRecording}
                className="ml-auto rounded-md px-2 py-1 text-[11px] text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary"
              >
                Cancel
              </button>
            </div>
          ) : (
            <textarea
              ref={ref}
              rows={1}
              placeholder={isDisabled ? 'Sending disabled…' : 'Type a message…'}
              value={value}
              onChange={(e) => handleChange(e.target.value)}
              onKeyDown={handleKey}
              disabled={isDisabled}
              className={cn(
                'flex-1 resize-none bg-transparent leading-snug text-text-primary outline-none',
                'placeholder:text-text-tertiary',
                'py-1 text-[16px] md:text-[13px]',  /* 16px on mobile prevents iOS auto-zoom; 13px on desktop fits more text */
              )}
              style={{ minHeight: '20px' }}
            />
          )}

          {templateSupport?.available && onSendTemplate && (
            <Button
              size="icon"
              variant="ghost"
              onClick={onSendTemplate}
              disabled={isDisabled}
              className={cn(
                'h-8 w-8 shrink-0 rounded-[8px] transition-colors',
                outsideWindow
                  ? 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30'
                  : 'text-text-tertiary hover:text-text-primary',
              )}
              aria-label="Send template"
              title="Send approved WhatsApp template"
            >
              <FileText className="h-3.5 w-3.5" />
            </Button>
          )}

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
            aria-label={isSending ? 'Sending…' : 'Send'}
          >
            {isSending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Send className="h-3.5 w-3.5" />
            }
          </Button>
        </div>
      </div>

      {/* Attachment chips */}
      {attachments.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5 px-1">
          {attachments.map((file, idx) => (
            <div
              key={`${file.name}-${idx}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle bg-bg-secondary px-2 py-1 text-[11px] text-text-secondary"
            >
              <Paperclip className="h-3 w-3 shrink-0" />
              <span className="max-w-[160px] truncate">{file.name}</span>
              <button
                type="button"
                onClick={() => removeAttachment(idx)}
                className="text-text-tertiary hover:text-text-primary"
                aria-label="Remove attachment"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

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
      </div>
    </div>
  )
}
