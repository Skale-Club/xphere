'use client'

import { useState, useEffect, useCallback } from 'react'
import { MessageSquare } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ListSkeleton } from '@/components/skeletons/list-skeleton'
import { CommentCard } from './comment-card'
import type { CommentRow } from '@/app/api/chat/comments/[id]/route'

interface CommentThreadProps {
  platformPostId: string | null
}

export function CommentThread({ platformPostId }: CommentThreadProps) {
  const [comments, setComments] = useState<CommentRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (postId: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/chat/comments/${encodeURIComponent(postId)}`)
      if (!res.ok) throw new Error('Failed to load comments')
      const json = await res.json() as { comments: CommentRow[] }
      setComments(json.comments)
    } catch {
      setError('Could not load comments. Try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (platformPostId) {
      setComments([])
      void load(platformPostId)
    }
  }, [platformPostId, load])

  function handleHidden(id: string) {
    setComments((prev) => prev.filter((c) => c.id !== id))
  }

  if (!platformPostId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center px-8">
        <MessageSquare className="h-8 w-8 text-text-tertiary" />
        <p className="text-[13px] font-medium text-text-secondary">Select a post</p>
        <p className="text-[12px] text-text-tertiary">
          Choose a post on the left to see its comments.
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-border-subtle bg-bg-secondary/95 backdrop-blur px-4 pt-4 pb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-[15px] font-semibold tracking-tight text-text-primary">
            Comments
          </h2>
          {!loading && (
            <span className="text-[11px] tabular-nums text-text-tertiary">
              {comments.length} total
            </span>
          )}
        </div>
      </div>

      {/* Body */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-2">
          {loading ? (
            <div className="p-3">
              <ListSkeleton rows={6} />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center gap-2 p-8 text-center">
              <p className="text-[13px] text-text-secondary">{error}</p>
              <button
                type="button"
                onClick={() => platformPostId && void load(platformPostId)}
                className="text-[12px] font-medium text-accent hover:text-accent/80"
              >
                Retry
              </button>
            </div>
          ) : comments.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 p-8 text-center">
              <MessageSquare className="h-6 w-6 text-text-tertiary" />
              <p className="text-[13px] text-text-secondary">No comments on this post yet.</p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {comments.map((c) => (
                <CommentCard key={c.id} comment={c} onHidden={handleHidden} />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
