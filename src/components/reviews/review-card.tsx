import { MessageSquareQuote } from 'lucide-react'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { StarRating } from './star-rating'

interface ReviewCardProps {
  review: {
    id: string
    reviewer_name: string | null
    reviewer_photo_url: string | null
    reviewer_profile_url: string | null
    rating: number
    text: string | null
    date_text: string | null
    is_local_guide: boolean
    local_guide_reviews_count: number | null
    helpful_count: number
    owner_response: string | null
    owner_response_date: string | null
    photos: { id: string; original_url: string; hetzner_url: string | null }[]
  }
}

function initials(name: string | null): string {
  if (!name) return '·'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

export function ReviewCard({ review }: ReviewCardProps) {
  return (
    <article className="group relative overflow-hidden rounded-2xl border bg-card p-5 shadow-sm transition-all hover:shadow-md">
      <div className="absolute -right-12 -top-12 h-24 w-24 rounded-full bg-gradient-to-br from-amber-200/40 to-amber-400/10 blur-2xl transition-opacity group-hover:opacity-100 opacity-50" />

      <header className="flex items-start gap-3">
        <Avatar className="h-11 w-11 ring-2 ring-amber-100 dark:ring-amber-900/40">
          <AvatarImage src={review.reviewer_photo_url ?? undefined} alt={review.reviewer_name ?? 'Reviewer'} />
          <AvatarFallback className="bg-gradient-to-br from-amber-200 to-amber-400 text-amber-900">
            {initials(review.reviewer_name)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold tracking-tight">
              {review.reviewer_profile_url ? (
                <a
                  href={review.reviewer_profile_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline"
                >
                  {review.reviewer_name ?? 'Anonymous'}
                </a>
              ) : (
                <>{review.reviewer_name ?? 'Anonymous'}</>
              )}
            </p>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <StarRating rating={review.rating} size="sm" />
            {review.date_text ? (
              <span className="text-[11px] text-muted-foreground">{review.date_text}</span>
            ) : null}
            {review.helpful_count > 0 ? (
              <span className="text-[11px] text-muted-foreground">· {review.helpful_count} helpful</span>
            ) : null}
          </div>
        </div>
      </header>

      {review.text ? (
        <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-foreground/90">{review.text}</p>
      ) : null}

      {review.photos.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {review.photos.map((p) => (
            <a
              key={p.id}
              href={p.hetzner_url ?? p.original_url}
              target="_blank"
              rel="noopener noreferrer"
              className="block overflow-hidden rounded-lg ring-1 ring-border transition-transform hover:scale-105"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.hetzner_url ?? p.original_url}
                alt="Review photo"
                className="h-20 w-20 object-cover"
                loading="lazy"
              />
            </a>
          ))}
        </div>
      ) : null}

      {review.owner_response ? (
        <div className="mt-4 rounded-xl border border-l-4 border-l-amber-400 bg-amber-50/50 px-4 py-3 dark:bg-amber-950/20">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-amber-700 dark:text-amber-300">
            <MessageSquareQuote className="h-3 w-3" />
            Owner response
            {review.owner_response_date ? (
              <span className="font-normal normal-case opacity-80">· {review.owner_response_date}</span>
            ) : null}
          </div>
          <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-foreground/85">
            {review.owner_response}
          </p>
        </div>
      ) : null}
    </article>
  )
}
