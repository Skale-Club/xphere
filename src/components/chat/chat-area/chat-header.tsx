'use client'

/**
 * Redesigned chat header (v2.2 / SEED-011).
 *
 * Slots:
 *   - 48px avatar with online/idle dot
 *   - Contact name + ChannelBadge + formatted phone/email + StatusPill row
 *   - Action cluster: pause/resume bot, assign, pin, priority cycle, info-panel toggle, more
 *
 * Pin/priority/assign mutations are optimistic via parent callbacks; bot toggle
 * stays on its own path because it has loading state.
 */

import React, { useState } from 'react'
import {
  ArrowLeft,
  Archive,
  ArchiveRestore,
  Menu,
  Trash2,
  Pin,
  Star,
  PanelRight,
  PanelRightClose,
  Phone,
  Eye,
  EyeOff,
  Pencil,
} from 'lucide-react'
import Link from 'next/link'

import { ConversationSummary, ConversationPriority, ConversationStatus, ConversationLabel } from '@/types/chat'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
import { cn } from '@/lib/utils'
import type { OrgMember } from '@/app/(dashboard)/chat/actions'
import { DndBadge } from '@/components/contacts/dnd-badge'
import { ContactDetailSheet } from '@/components/contacts/contact-detail-sheet'

interface ChatHeaderProps {
  conversation: ConversationSummary
  onBack: () => void
  /** SEED-035: accepts expanded status set + optional wait_until for snooze. */
  onStatusChange: (status: ConversationStatus, waitUntil?: string | null) => void
  onDelete: () => void
  onBotStatusToggle: (id: string, currentStatus: string) => void
  isBotToggling: boolean
  onPinToggle: (id: string, pinned: boolean) => void
  onPriorityCycle: (id: string, next: ConversationPriority) => void
  onAssign: (id: string, userId: string | null) => void
  /** SEED-035: star/unstar conversation. */
  onStarToggle?: (id: string, starred: boolean) => void
  /** SEED-035: org-wide labels for the label picker. */
  orgLabels?: Array<{ id: string; name: string; color: string }>
  /** SEED-035: mutate the labels assigned to this conversation. */
  onLabelsChange?: (id: string, labels: ConversationLabel[]) => void
  members: OrgMember[]
  /** Right contact-info panel visible? */
  infoPanelOpen: boolean
  onToggleInfoPanel: () => void
  /** Phone for the "Call" quick-action | null hides the button. */
  callPhone?: string | null
  /** SEED-039: distinct channels present in this thread. */
  threadChannels?: string[]
  /** SEED-039: active channel filter (null = all). */
  channelFilter?: string[] | null
  /** SEED-039: update the channel filter. */
  onChannelFilterChange?: React.Dispatch<React.SetStateAction<string[] | null>>
  /** Show/hide internal debug messages */
  showDebug?: boolean
  onToggleDebug?: () => void
  /** Phase 1085 DND: show DndBadge in header when contact has DND active. */
  dndEnabled?: boolean
  dndChannels?: string[]
}

export function ChatHeader({
  conversation,
  onBack,
  onStatusChange,
  onDelete,
  onBotStatusToggle: _onBotStatusToggle,
  isBotToggling: _isBotToggling,
  onPinToggle,
  onPriorityCycle: _onPriorityCycle,
  onAssign: _onAssign,
  onStarToggle,
  orgLabels: _orgLabels,
  onLabelsChange: _onLabelsChange,
  members: _members,
  infoPanelOpen,
  onToggleInfoPanel,
  callPhone,
  threadChannels: _threadChannels,
  channelFilter: _channelFilter,
  onChannelFilterChange: _onChannelFilterChange,
  showDebug = false,
  onToggleDebug,
  dndEnabled = false,
  dndChannels = [],
}: ChatHeaderProps) {
  const [showDelete, setShowDelete] = useState(false)
  // When set, opens the contact editor popup for this contact (edit mode).
  const [editContactId, setEditContactId] = useState<string | null>(null)
  const name = conversation.contactName || conversation.visitorName || conversation.visitorPhone || conversation.visitorEmail || 'Anonymous'
  const initial = name.replace(/[^a-zA-Z0-9]/g, '').charAt(0).toUpperCase() || '?'
  const isOpen = conversation.status === 'open'
  const isStarred = Boolean(conversation.starred)

  // Subtitle: phone OR email if available, with the receiving phone number
  // appended when an inbound number is linked (phone-numbers Phase 4).
  const baseSubtitle =
    conversation.visitorPhone ??
    conversation.visitorEmail ??
    (conversation.channelAccountName ? `· ${conversation.channelAccountName}` : '')
  const subtitle = conversation.phoneNumberLabel
    ? baseSubtitle
      ? `${baseSubtitle} · via ${conversation.phoneNumberLabel}`
      : `via ${conversation.phoneNumberLabel}`
    : baseSubtitle

  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border-subtle bg-bg-primary/95 px-4 py-3 pt-safe-3 backdrop-blur">
      {/* Left cluster | back + avatar + identity */}
      <div className="flex min-w-0 items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden h-8 w-8 shrink-0"
          onClick={onBack}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="relative shrink-0">
          <Avatar className="h-10 w-10">
            {conversation.contactAvatarUrl ? (
              <AvatarImage src={conversation.contactAvatarUrl} alt="" />
            ) : null}
            <AvatarFallback className="bg-accent-muted text-accent text-[13px] font-semibold">
              {initial}
            </AvatarFallback>
          </Avatar>
          {/* Status dot | defaults to success when conversation is open + bot active */}
          <span
            className={cn(
              'absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-bg-primary',
              isOpen ? 'bg-success' : 'bg-text-tertiary',
            )}
            aria-hidden
          />
        </div>
        <div className="flex min-w-0 flex-col">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[14px] font-semibold tracking-tight text-text-primary">
              {name}
            </span>
            <DndBadge dndEnabled={dndEnabled} dndChannels={dndChannels} />
            {/* Mobile-only quick edit: desktop edits the contact inline in the
                right info panel, but on mobile that panel is hard to reach, so
                surface an explicit edit affordance next to the name. */}
            {conversation.contactId && (
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden h-6 w-6 shrink-0 text-text-tertiary"
                onClick={() => setEditContactId(conversation.contactId ?? null)}
                aria-label="Edit contact"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          {subtitle && (
            <span className="truncate text-[11.5px] text-text-tertiary">
              {subtitle}
            </span>
          )}
        </div>
      </div>

      {/* Right cluster | panel toggle + secondary actions */}
      <div className="flex shrink-0 items-center gap-1">
        <TooltipProvider delayDuration={200}>
          {/* Desktop-only quick actions: Pin + Star */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="hidden md:inline-flex h-8 w-8"
                onClick={() => onPinToggle(conversation.id, !conversation.pinned)}
                aria-label={conversation.pinned ? 'Unpin' : 'Pin to top'}
              >
                <Pin
                  className={cn('h-4 w-4', conversation.pinned && 'text-accent')}
                  fill={conversation.pinned ? 'currentColor' : 'none'}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{conversation.pinned ? 'Unpin' : 'Pin to top'}</TooltipContent>
          </Tooltip>
          {onStarToggle && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="hidden md:inline-flex h-8 w-8"
                  onClick={() => onStarToggle(conversation.id, !isStarred)}
                  aria-label={isStarred ? 'Unstar' : 'Star'}
                >
                  <Star
                    className={cn('h-4 w-4', isStarred && 'text-amber-400')}
                    fill={isStarred ? 'currentColor' : 'none'}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{isStarred ? 'Unstar' : 'Star'}</TooltipContent>
            </Tooltip>
          )}

          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label="More"
                  >
                    <Menu className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>More</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="text-xs text-text-tertiary">More</DropdownMenuLabel>
              {callPhone && (
                <DropdownMenuItem asChild>
                  <Link href={`/voice?to=${encodeURIComponent(callPhone)}`}>
                    <Phone className="h-4 w-4" />
                    Call this contact
                  </Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                className="md:hidden"
                onClick={() => onPinToggle(conversation.id, !conversation.pinned)}
              >
                <Pin
                  className={cn('h-4 w-4', conversation.pinned && 'text-accent')}
                  fill={conversation.pinned ? 'currentColor' : 'none'}
                />
                {conversation.pinned ? 'Unpin' : 'Pin to top'}
              </DropdownMenuItem>
              {onStarToggle && (
                <DropdownMenuItem
                  className="md:hidden"
                  onClick={() => onStarToggle(conversation.id, !isStarred)}
                >
                  <Star
                    className={cn('h-4 w-4', isStarred && 'text-amber-400')}
                    fill={isStarred ? 'currentColor' : 'none'}
                  />
                  {isStarred ? 'Unstar' : 'Star'}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator className="md:hidden" />
              <DropdownMenuItem onClick={() => onStatusChange(isOpen ? 'closed' : 'open')}>
                {isOpen ? <Archive className="h-4 w-4" /> : <ArchiveRestore className="h-4 w-4" />}
                {isOpen ? 'Archive' : 'Reopen'}
              </DropdownMenuItem>
              {onToggleDebug && (
                <DropdownMenuItem onClick={onToggleDebug}>
                  {showDebug ? <Eye className="h-4 w-4 text-accent" /> : <EyeOff className="h-4 w-4" />}
                  {showDebug ? 'Hide internal messages' : 'Show internal messages'}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-rose-400 focus:bg-rose-500/10 focus:text-rose-300"
                onClick={() => setShowDelete(true)}
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={onToggleInfoPanel}
                aria-label={infoPanelOpen ? 'Hide contact info' : 'Show contact info'}
              >
                {infoPanelOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRight className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{infoPanelOpen ? 'Hide contact info' : 'Show contact info'}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <ContactDetailSheet
        contactId={editContactId}
        initialEditing
        onOpenChange={(open) => {
          if (!open) setEditContactId(null)
        }}
      />

      <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the conversation with <strong>{name}</strong> and all its
              messages. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-danger text-white hover:bg-danger/90"
              onClick={() => {
                setShowDelete(false)
                onDelete()
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
