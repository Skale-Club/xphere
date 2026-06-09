'use client'

import { useState } from 'react'
import { formatDistanceToNowStrict } from 'date-fns'
import { MessageSquare, Mail, EyeOff } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import type { CommentRow } from '@/app/api/chat/comments/[id]/route'

interface CommentCardProps {
  comment: CommentRow
  onHidden?: (id: string) => void
}

function formatRelative(dateStr: string | null): string {
  if (!dateStr) return ''
  try {
    return formatDistanceToNowStrict(new Date(dateStr), { addSuffix: true })
      .replace(' seconds', 's').replace(' second', 's')
      .replace(' minutes', 'min').replace(' minute', 'min')
      .replace(' hours', 'h').replace(' hour', 'h')
      .replace(' days', 'd').replace(' day', 'd')
      .replace(' months', 'mo').replace(' month', 'mo')
  } catch {
    return ''
  }
}

function initialOf(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '').charAt(0).toUpperCase() || '?'
}

export function CommentCard({ comment, onHidden }: CommentCardProps) {
  const [showReply, setShowReply] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)
  const [hiding, setHiding] = useState(false)

  const name = comment.visitorName || 'Anonymous'
  const initial = initialOf(name)

  async function handleReply() {
    if (!replyText.trim()) return
    setSending(true)
    try {
      const res = await fetch(`/api/chat/conversations/${comment.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: replyText.trim(), role: 'assistant' }),
      })
      if (!res.ok) throw new Error('Failed to send reply')
      setReplyText('')
      setShowReply(false)
      toast.success('Reply sent')
    } catch {
      toast.error('Could not send reply. Try again.')
    } finally {
      setSending(false)
    }
  }

  async function handleHide() {
    setHiding(true)
    try {
      const res = await fetch(`/api/chat/comments/${comment.id}/hide`, { method: 'POST' })
      if (!res.ok) throw new Error('Failed to hide')
      onHidden?.(comment.id)
      toast.success('Comment hidden')
    } catch {
      toast.error('Could not hide comment. Try again.')
    } finally {
      setHiding(false)
    }
  }

  return (
    <div className="group px-4 py-3 hover:bg-bg-tertiary/50 rounded-[8px] transition-colors">
      <div className="flex items-start gap-3">
        <Avatar className="h-8 w-8 shrink-0">
          <AvatarFallback className="text-[12px] font-semibold bg-accent/15 text-accent">
            {initial}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[13px] font-semibold text-text-primary truncate">{name}</span>
            <span className="text-[11px] text-text-tertiary shrink-0">
              {formatRelative(comment.lastMessageAt)}
            </span>
          </div>
          <p className="text-[13px] text-text-secondary leading-relaxed break-words">
            {comment.lastMessage || '—'}
          </p>

          {/* Actions — visible on hover */}
          <div className="mt-2 flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={() => setShowReply((v) => !v)}
              className="flex items-center gap-1 text-[12px] text-text-tertiary hover:text-accent transition-colors"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Reply
            </button>
            {comment.contactId && (
              <a
                href={`/chat?contact=${comment.contactId}`}
                className="flex items-center gap-1 text-[12px] text-text-tertiary hover:text-accent transition-colors"
              >
                <Mail className="h-3.5 w-3.5" />
                DM
              </a>
            )}
            <button
              type="button"
              onClick={handleHide}
              disabled={hiding}
              className="flex items-center gap-1 text-[12px] text-text-tertiary hover:text-text-primary transition-colors disabled:opacity-40"
            >
              <EyeOff className="h-3.5 w-3.5" />
              Hide
            </button>
          </div>

          {/* Inline reply composer */}
          {showReply && (
            <div className="mt-3 flex items-end gap-2">
              <textarea
                autoFocus
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void handleReply()
                }}
                placeholder="Write a reply…"
                rows={2}
                className={cn(
                  'flex-1 resize-none rounded-[8px] border border-border-subtle bg-bg-primary px-3 py-2',
                  'text-[13px] text-text-primary placeholder:text-text-tertiary',
                  'focus:outline-none focus:border-accent focus:ring-[3px] focus:ring-accent/15',
                )}
              />
              <button
                type="button"
                onClick={() => void handleReply()}
                disabled={sending || !replyText.trim()}
                className={cn(
                  'shrink-0 rounded-[8px] bg-accent px-3 py-2 text-[12px] font-medium text-white',
                  'hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors',
                )}
              >
                {sending ? '…' : 'Send'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
