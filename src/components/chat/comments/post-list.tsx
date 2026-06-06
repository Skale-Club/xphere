'use client'

import { useState, useEffect } from 'react'
import { formatDistanceToNowStrict } from 'date-fns'
import { MessageSquare } from 'lucide-react'
import { ChannelBadge, type Channel } from '@/components/design-system/channel-badge'
import { ListSkeleton } from '@/components/skeletons/list-skeleton'
import { cn } from '@/lib/utils'
import type { PostSummary } from '@/app/api/chat/comments/route'

interface PostListProps {
  selectedPostId: string | null
  onSelect: (platformPostId: string) => void
}

function platformToChannel(platform: string): Channel {
  if (platform === 'facebook') return 'messenger'
  return 'instagram'
}

function formatRelative(dateStr: string | null): string {
  if (!dateStr) return ''
  try {
    return formatDistanceToNowStrict(new Date(dateStr), { addSuffix: true })
      .replace(' seconds', 's').replace(' second', 's')
      .replace(' minutes', 'min').replace(' minute', 'min')
      .replace(' hours', 'h').replace(' hour', 'h')
      .replace(' days', 'd').replace(' day', 'd')
  } catch {
    return ''
  }
}

export function PostList({ selectedPostId, onSelect }: PostListProps) {
  const [posts, setPosts] = useState<PostSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/chat/comments')
        if (!res.ok) throw new Error('Failed to load posts')
        const json = await res.json() as { posts: PostSummary[] }
        setPosts(json.posts)
      } catch {
        setError('Could not load posts.')
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [])

  return (
    <div className="flex h-full min-h-0 flex-col border-r border-border-subtle bg-bg-secondary/40">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-border-subtle bg-bg-secondary/95 backdrop-blur px-4 pt-4 pb-3">
        <h2 className="text-[15px] font-semibold tracking-tight text-text-primary">Posts</h2>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4">
            <ListSkeleton rows={5} />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-2 p-8 text-center">
            <p className="text-[12px] text-text-secondary">{error}</p>
          </div>
        ) : posts.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 p-8 text-center">
            <MessageSquare className="h-7 w-7 text-text-tertiary" />
            <p className="text-[13px] font-medium text-text-secondary">No comments yet</p>
            <p className="text-[12px] text-text-tertiary">
              Comments on your Instagram and Facebook posts will appear here.
            </p>
          </div>
        ) : (
          <div className="p-2 space-y-0.5">
            {posts.map((post) => (
              <button
                key={post.platformPostId}
                type="button"
                onClick={() => onSelect(post.platformPostId)}
                className={cn(
                  'w-full text-left rounded-[8px] px-3 py-3 transition-colors',
                  selectedPostId === post.platformPostId
                    ? 'bg-accent/10 border border-accent/20'
                    : 'hover:bg-bg-tertiary/60 border border-transparent',
                )}
              >
                <div className="flex items-start gap-2 min-w-0">
                  <div className="shrink-0 mt-0.5">
                    <ChannelBadge
                      channel={platformToChannel(post.platform)}
                      showLabel={false}
                      size="sm"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] text-text-secondary line-clamp-2 leading-relaxed">
                      {post.lastCommentText || post.platformPostId}
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-[11px] tabular-nums text-text-tertiary">
                        {post.commentCount} {post.commentCount === 1 ? 'comment' : 'comments'}
                      </span>
                      {post.lastCommentAt && (
                        <>
                          <span className="text-[10px] text-text-tertiary">·</span>
                          <span className="text-[11px] text-text-tertiary">
                            {formatRelative(post.lastCommentAt)}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
