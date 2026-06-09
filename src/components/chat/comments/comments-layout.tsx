'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { PostList } from './post-list'
import { CommentThread } from './comment-thread'

interface CommentsLayoutProps {
  orgId: string
  inboxTab: 'chat' | 'comments'
  onTabChange: (tab: 'chat' | 'comments') => void
  hasCommentsChannel: boolean
}

export function CommentsLayout({
  inboxTab,
  onTabChange,
  hasCommentsChannel,
}: CommentsLayoutProps) {
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null)

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden">
      {/* Left: Posts list */}
      <div className="h-full min-h-0 shrink-0 overflow-hidden border-r border-border-subtle" style={{ width: 320 }}>
        {/* Tab pills header */}
        {hasCommentsChannel && (
          <div className="border-b border-border-subtle bg-bg-secondary/95 backdrop-blur px-4 pt-4 pb-3">
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => onTabChange('chat')}
                className={cn(
                  'rounded-full px-3 py-0.5 text-[13px] font-semibold transition-colors',
                  inboxTab === 'chat'
                    ? 'bg-accent text-white'
                    : 'text-text-secondary hover:text-text-primary',
                )}
              >
                Chat
              </button>
              <button
                type="button"
                onClick={() => onTabChange('comments')}
                className={cn(
                  'rounded-full px-3 py-0.5 text-[13px] font-semibold transition-colors',
                  inboxTab === 'comments'
                    ? 'bg-accent text-white'
                    : 'text-text-secondary hover:text-text-primary',
                )}
              >
                Comments
              </button>
            </div>
          </div>
        )}
        {/* PostList fills remaining height */}
        <div className={hasCommentsChannel ? 'h-[calc(100%-52px)] min-h-0' : 'h-full min-h-0'}>
          <PostList selectedPostId={selectedPostId} onSelect={setSelectedPostId} />
        </div>
      </div>

      {/* Right: Comment thread */}
      <div className="h-full min-h-0 min-w-0 flex-1 overflow-hidden">
        <CommentThread platformPostId={selectedPostId} />
      </div>
    </div>
  )
}
