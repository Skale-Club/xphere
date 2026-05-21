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
  MoreHorizontal,
  Pause,
  Play,
  Trash2,
  Pin,
  Flag,
  PanelRight,
  PanelRightClose,
  UserPlus,
  Phone,
  CheckCheck,
} from 'lucide-react'
import Link from 'next/link'

import { ConversationSummary, ConversationPriority, ConversationStatus, ConversationLabel } from '@/types/chat'
import { ChannelBadge, type Channel } from '@/components/design-system/channel-badge'
import { StatusPill } from '@/components/design-system/status-pill'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
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

const CHANNEL_MAP: Record<string, Channel> = {
  whatsapp: 'whatsapp',
  instagram: 'instagram',
  messenger: 'messenger',
  sms: 'sms',
  voice: 'voice',
  widget: 'web',
  web: 'web',
}

const PRIORITY_CYCLE: Record<ConversationPriority, ConversationPriority> = {
  normal: 'high',
  high: 'urgent',
  urgent: 'normal',
}

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
}

export function ChatHeader({
  conversation,
  onBack,
  onStatusChange,
  onDelete,
  onBotStatusToggle,
  isBotToggling,
  onPinToggle,
  onPriorityCycle,
  onAssign,
  onStarToggle: _onStarToggle,
  orgLabels: _orgLabels,
  onLabelsChange: _onLabelsChange,
  members,
  infoPanelOpen,
  onToggleInfoPanel,
  callPhone,
  threadChannels: _threadChannels,
  channelFilter: _channelFilter,
  onChannelFilterChange: _onChannelFilterChange,
}: ChatHeaderProps) {
  const [showDelete, setShowDelete] = useState(false)
  const [waitingOpen, setWaitingOpen] = useState(false)
  const [waitUntilInput, setWaitUntilInput] = useState<string>('')
  const name = conversation.contactName || conversation.visitorName || conversation.visitorPhone || conversation.visitorEmail || 'Anonymous'
  const initial = name.replace(/[^a-zA-Z0-9]/g, '').charAt(0).toUpperCase() || '?'
  const channel = (CHANNEL_MAP[conversation.channel] ?? 'unknown') as Channel
  const isBotActive = conversation.botStatus === 'active'
  const isOpen = conversation.status === 'open'
  const priority = conversation.priority ?? 'normal'

  // Subtitle: phone OR email if available
  const subtitle =
    conversation.visitorPhone ??
    conversation.visitorEmail ??
    (conversation.channelAccountName ? `· ${conversation.channelAccountName}` : '')

  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border-subtle bg-bg-primary/95 px-4 py-3 pt-safe backdrop-blur">
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
          <div className="flex items-center gap-2">
            <span className="truncate text-[14px] font-semibold tracking-tight text-text-primary">
              {name}
            </span>
            {channel !== 'unknown' && <ChannelBadge channel={channel} size="sm" />}
            {priority !== 'normal' && (
              <StatusPill tone={priority === 'urgent' ? 'danger' : 'warning'} className="!py-0 !text-[10px]">
                {priority === 'urgent' ? 'Urgent' : 'High'}
              </StatusPill>
            )}
          </div>
          {subtitle && (
            <span className="truncate text-[11.5px] text-text-tertiary">
              {subtitle}
            </span>
          )}
        </div>
      </div>

      {/* Right cluster | actions */}
      <div className="flex shrink-0 items-center gap-1">
        <TooltipProvider delayDuration={200}>
          {callPhone && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  asChild
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                >
                  <Link href={`/voice?to=${encodeURIComponent(callPhone)}`}>
                    <Phone className="h-4 w-4" />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Call this contact</TooltipContent>
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                disabled={isBotToggling}
                onClick={() => onBotStatusToggle(conversation.id, conversation.botStatus)}
                aria-label={isBotActive ? 'Pause bot' : 'Resume bot'}
              >
                {isBotActive ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{isBotActive ? 'Pause bot' : 'Resume bot'}</TooltipContent>
          </Tooltip>

          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <UserPlus className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Assign</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="min-w-[200px]">
              <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-text-tertiary">
                Assign conversation
              </DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() => onAssign(conversation.id, null)}
                className={cn(!conversation.assignedUserId && 'text-accent')}
              >
                {!conversation.assignedUserId && <CheckCheck className="h-3.5 w-3.5 mr-2" />}
                <span className={cn(!conversation.assignedUserId ? '' : 'ml-[18px]')}>
                  Unassigned
                </span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {members.length === 0 ? (
                <DropdownMenuItem disabled>No org members</DropdownMenuItem>
              ) : (
                members.map((m) => (
                  <DropdownMenuItem
                    key={m.userId}
                    onClick={() => onAssign(conversation.id, m.userId)}
                    className={cn(conversation.assignedUserId === m.userId && 'text-accent')}
                  >
                    {conversation.assignedUserId === m.userId && (
                      <CheckCheck className="h-3.5 w-3.5 mr-2" />
                    )}
                    <span className={cn(conversation.assignedUserId === m.userId ? '' : 'ml-[18px]')}>
                      {m.displayName ?? m.email}
                    </span>
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-8 w-8', conversation.pinned && 'text-accent')}
                onClick={() => onPinToggle(conversation.id, !conversation.pinned)}
                aria-label={conversation.pinned ? 'Unpin' : 'Pin'}
              >
                <Pin className="h-4 w-4" fill={conversation.pinned ? 'currentColor' : 'none'} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{conversation.pinned ? 'Unpin' : 'Pin to top'}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  'h-8 w-8',
                  priority === 'urgent' && 'text-danger',
                  priority === 'high' && 'text-warning',
                )}
                onClick={() => onPriorityCycle(conversation.id, PRIORITY_CYCLE[priority])}
                aria-label="Cycle priority"
              >
                <Flag className="h-4 w-4" fill={priority !== 'normal' ? 'currentColor' : 'none'} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Priority: {priority === 'normal' ? 'Normal' : priority === 'high' ? 'High' : 'Urgent'}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 hidden md:inline-flex"
                onClick={onToggleInfoPanel}
                aria-label={infoPanelOpen ? 'Hide contact info' : 'Show contact info'}
              >
                {infoPanelOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRight className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{infoPanelOpen ? 'Hide contact info' : 'Show contact info'}</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onStatusChange(isOpen ? 'closed' : 'open')}>
              {isOpen ? (
                <>
                  <Archive className="h-3.5 w-3.5 mr-2" />
                  Archive
                </>
              ) : (
                <>
                  <ArchiveRestore className="h-3.5 w-3.5 mr-2" />
                  Reopen
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => setShowDelete(true)}
              className="text-rose-500 focus:text-rose-500"
            >
              <Trash2 className="h-3.5 w-3.5 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

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
