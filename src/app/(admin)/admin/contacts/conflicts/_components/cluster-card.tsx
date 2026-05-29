'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatPhoneDisplay } from '@/lib/phone-numbers/format'
import { formatEmailDisplay } from '@/lib/email-addresses/format'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { mergeContacts, markAsSeparate } from '../_actions/conflicts'
import type { ClusterRow } from '../page'

type ClusterContact = ClusterRow['contacts'][number]

function displayName(c: ClusterContact): string {
  return (
    c.name ||
    [c.first_name, c.last_name].filter(Boolean).join(' ') ||
    c.email ||
    c.phone ||
    c.id.slice(0, 8)
  )
}

export function ClusterCard({ cluster }: { cluster: ClusterRow }) {
  const [pending, startTransition] = useTransition()
  const [confirmMerge, setConfirmMerge] = useState<{
    survivor: ClusterContact
    others: ClusterContact[]
  } | null>(null)
  const [confirmSeparate, setConfirmSeparate] = useState(false)

  function onMergeClick(survivor: ClusterContact) {
    const others = cluster.contacts.filter((c) => c.id !== survivor.id)
    setConfirmMerge({ survivor, others })
  }

  function doMerge() {
    if (!confirmMerge) return
    const { survivor, others } = confirmMerge
    startTransition(async () => {
      try {
        for (const archived of others) {
          await mergeContacts(survivor.id, archived.id)
        }
        toast.success(
          `Merged ${others.length} contact${others.length === 1 ? '' : 's'} into ${displayName(survivor)}`,
        )
        setConfirmMerge(null)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Merge failed')
      }
    })
  }

  function doMarkSeparate() {
    startTransition(async () => {
      try {
        await markAsSeparate(cluster.org_id, cluster.contact_ids)
        toast.success('These contacts will not appear as duplicates in future audits.')
        setConfirmSeparate(false)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Mark-as-separate failed')
      }
    })
  }

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="outline">{cluster.match_type}</Badge>
          <span className="font-mono text-xs text-text-secondary">{cluster.normalized_value}</span>
          <Badge variant="secondary">{cluster.cluster_size} contacts</Badge>
        </div>
        <span className="text-xs text-text-tertiary">
          detected {new Date(cluster.detected_at).toLocaleString()}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {cluster.contacts.map((c) => (
          <div
            key={c.id}
            className="rounded-md border border-border-subtle bg-bg-secondary p-3 text-sm"
          >
            <div className="font-medium text-text-primary">{displayName(c)}</div>
            <dl className="mt-2 space-y-1 text-xs text-text-secondary">
              {c.phone && (
                <div>
                  <dt className="inline text-text-tertiary">phone </dt>
                  <dd className="inline">
                    {formatPhoneDisplay(c.phone)}
                    {c.phone_e164 && c.phone_e164 !== c.phone ? ` (${formatPhoneDisplay(c.phone_e164)})` : ''}
                  </dd>
                </div>
              )}
              {c.email && (
                <div>
                  <dt className="inline text-text-tertiary">email </dt>
                  <dd className="inline">
                    {formatEmailDisplay(c.email)}
                    {c.email_normalized && c.email_normalized !== c.email
                      ? ` (${c.email_normalized})`
                      : ''}
                  </dd>
                </div>
              )}
              {c.source && (
                <div>
                  <dt className="inline text-text-tertiary">source </dt>
                  <dd className="inline">{c.source}</dd>
                </div>
              )}
              <div>
                <dt className="inline text-text-tertiary">created </dt>
                <dd className="inline">{new Date(c.created_at).toLocaleDateString()}</dd>
              </div>
            </dl>
            <Button
              size="sm"
              variant="default"
              className="mt-3 w-full"
              disabled={pending}
              onClick={() => onMergeClick(c)}
            >
              Merge into this one
            </Button>
          </div>
        ))}
      </div>

      <div className="mt-4 flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => setConfirmSeparate(true)}
        >
          Mark as separate
        </Button>
      </div>

      {/* Merge confirmation */}
      <AlertDialog
        open={confirmMerge !== null}
        onOpenChange={(open) => !open && setConfirmMerge(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Merge contacts?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmMerge && (
                <>
                  You&apos;re about to merge {confirmMerge.others.length} contact
                  {confirmMerge.others.length === 1 ? '' : 's'} into{' '}
                  <strong>{displayName(confirmMerge.survivor)}</strong>. All conversations,
                  messages, calls, opportunities, tags, bookings and traffic events will be
                  reattributed to the survivor. This action is recorded in the audit log.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doMerge} disabled={pending}>
              {pending ? 'Merging…' : 'Confirm merge'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Mark-as-separate confirmation */}
      <AlertDialog open={confirmSeparate} onOpenChange={setConfirmSeparate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark as separate?</AlertDialogTitle>
            <AlertDialogDescription>
              These {cluster.contact_ids.length} contacts will not appear as duplicates in future
              audits. Undo via the <code>contact_merge_exclusions</code> table.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doMarkSeparate} disabled={pending}>
              {pending ? 'Marking…' : 'Confirm'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
