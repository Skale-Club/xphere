'use client'

import { useMemo, useState, useTransition } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { AlertCircle, Loader2, MapPin, Star, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { deleteLocation } from '@/app/(dashboard)/reviews/actions'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { Database } from '@/types/database'

import { SyncButton } from './sync-button'

type GoogleLocation = Database['public']['Tables']['google_locations']['Row'] & {
  google_reviews: Database['public']['Tables']['google_reviews']['Row'][]
}

interface LocationCardProps {
  location: GoogleLocation
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)

  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  }

  return name.slice(0, 2).toUpperCase() || 'G'
}

function DeleteButton({ locationId }: { locationId: string }) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteLocation(locationId)

      if (result.error) {
        toast.error('Failed to delete location. Try again.')
        return
      }

      setOpen(false)
      toast.success('Location deleted.')
    })
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
              aria-label="Delete location"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </AlertDialogTrigger>
        </TooltipTrigger>
        <TooltipContent>Delete location</TooltipContent>
      </Tooltip>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete location?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently remove the location and all its reviews. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault()
              handleDelete()
            }}
            disabled={isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Deleting...
              </>
            ) : (
              'Delete location'
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function LocationCard({ location }: LocationCardProps) {
  const reviews = useMemo(
    () => [...location.google_reviews].sort((a, b) => a.display_order - b.display_order),
    [location.google_reviews]
  )

  return (
    <div className="rounded-md border">
      <div className="flex items-start justify-between gap-4 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{location.name}</span>
            {location.client_name ? <Badge variant="secondary">{location.client_name}</Badge> : null}
          </div>
          {location.address ? (
            <p className="ml-6 mt-0.5 text-xs text-muted-foreground">{location.address}</p>
          ) : null}
          {location.category ? (
            <p className="ml-6 text-xs text-muted-foreground">{location.category}</p>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <SyncButton locationId={location.id} fetchedAt={location.fetched_at} />
          <DeleteButton locationId={location.id} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t px-4 py-2 text-xs text-muted-foreground">
        <span>
          {location.fetched_at
            ? `Last synced ${formatDistanceToNow(new Date(location.fetched_at))} ago`
            : 'Never synced'}
        </span>
        <span>
          {location.review_count > 0 ? `${location.review_count} review(s)` : 'No reviews - sync to fetch.'}
        </span>
        {location.last_fetch_error ? (
          <span className="flex items-center gap-1 rounded-md border border-destructive/20 bg-destructive/10 px-2 py-1 text-destructive">
            <AlertCircle className="h-3 w-3 shrink-0" />
            <span className="truncate">{location.last_fetch_error.slice(0, 60)}</span>
          </span>
        ) : null}
      </div>

      {reviews.length > 0 ? (
        <>
          <Separator />
          <div className="divide-y">
            {reviews.map((review) => (
              <div key={review.id} className="flex gap-3 px-4 py-3">
                <Avatar className="h-8 w-8 shrink-0">
                  <AvatarImage src={review.author_photo_url ?? undefined} alt={review.author_name} />
                  <AvatarFallback className="text-xs">{getInitials(review.author_name)}</AvatarFallback>
                </Avatar>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{review.author_name}</span>
                    <span className="flex items-center gap-0.5" aria-label={`${review.rating} out of 5 stars`}>
                      {Array.from({ length: 5 }).map((_, index) => (
                        <Star
                          key={index}
                          className={index < review.rating ? 'h-3 w-3 fill-current text-yellow-400' : 'h-3 w-3 text-muted-foreground/40'}
                        />
                      ))}
                    </span>
                  </div>

                  {review.relative_time ? (
                    <p className="text-xs text-muted-foreground">{review.relative_time}</p>
                  ) : null}

                  {review.review_text ? (
                    <p className="mt-1 line-clamp-3 text-sm">{review.review_text}</p>
                  ) : null}

                  {review.google_maps_url ? (
                    <a
                      href={review.google_maps_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-block text-xs text-primary underline"
                      aria-label={`View ${review.author_name}'s review on Google (opens in new tab)`}
                    >
                      View on Google
                    </a>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-1 border-t px-4 py-2 text-xs text-muted-foreground">
            <img src="/google-logo.svg" alt="Google" className="h-3 w-auto" />
            Powered by Google
          </div>
        </>
      ) : null}
    </div>
  )
}
