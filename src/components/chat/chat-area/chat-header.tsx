'use client'

/**
 * Redesigned chat header (v2.2 / SEED-011 + SEED-035 status selector).
 *
 * Slots:
 *   - 48px avatar with online/idle dot
 *   - Contact name + ChannelBadge + formatted phone/email + StatusPill row
 *   - Action cluster: status selector (5 values), labels, pause/resume bot,
 *     assign, pin, priority cycle, info-panel toggle, more
 *
 * Pin/priority/assign mutations are optimistic via parent callbacks; bot toggle
 * stays on its own path because it has loading state.
 */

import { useState } from 'react'
import {
  ArrowLeft,
  MoreHorizontal,
  Pause,
  Play,
  Trash2,
  Pin,
  Star,
  Flag,
  PanelRight,
  PanelRightClose,
  UserPlus,
  Phone,
  CheckCheck,
  ChevronDown,
  Filter as FilterIcon,
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
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
import { ConversationLabelPicker } from '@/components/chat/conversation-label-picker'
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

const STATUS_META: Record<
  ConversationStatus,
  { label: string; dot: string; text: string }
> = {
  open: { label: 'Open', dot: 'bg-blue-500', text: 'text-blue-500' },
  pending: { label: 'Pending', dot: 'bg-yellow-500', text: 'text-yellow-600' },
  waiting: { label: 'Waiting', dot: 'bg-purple-500', text: 'text-purple-500' },
  resolved: { label: 'Resolved', dot: 'bg-emerald-500', text: 'text-emerald-500' },
  closed: { label: 'Archived', dot: 'bg-slate-400', text: 'text-text-tertiary' },
}

const STATUS_ORDER: ConversationStatus[] = [
  'open',
  'pending',
  'waiting',
  'resolved',
  'closed',
]

interface ChatHeaderProps {
  conversation: ConversationSummary
  onBack: () => void
  /** SEED-035: now accepts 5 status values + optional wait_until. */
  onStatusChange: (status: ConversationStatus, waitUntil?: string | null) => void
  onDelete: () => void
  onBotStatusToggle: (id: string, currentStatus: string) => void
  isBotToggling: boolean
  onPinToggle: (id: string, pinned: boolean) => void
  onPriorityCycle: (id: string, next: ConversationPriority) => void
  onAssign: (id: string, userId: string | null) => void
  /** SEED-035: optimistic star toggle handler. */
  onStarToggle?: (id: string, starred: boolean) => void
  /** SEED-035: org-wide labels for the picker. */
  orgLabels?: Array<{ id: string; name: string; color: string }>
  /** SEED-035: called when labels on the conversation change (optimistic). */
  onLabelsChange?: (id: string, labels: ConversationLabel[]) => void
  members: OrgMember[]
  /** Right contact-info panel visible? */
  infoPanelOpen: boolean
  onToggleInfoPanel: () => void
  /** Phone for the "Call" quick-action — null hides the button. */
  callPhone?: string | null
  /** SEED-039: distinct channels that appear in the current thread. */
  threadChannels?: string[]
  /** SEED-039: currently selected channel filters (null/empty = show all). */
  channelFilter?: string[] | null
  /** SEED-039: toggle a channel into/out of the filter set. */
  onChannelFilterChange?: (next: string[] | null) => void
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
  onStarToggle,
  orgLabels,
  onLabelsChange,
  members,
  infoPanelOpen,
  onToggleInfoPanel,
  callPhone,
  threadChannels = [],
  channelFilter = null,
  onChannelFilterChange,
}: ChatHeaderProps) {
  const [showDelete, setShowDelete] = useState(false)
  const [waitingOpen, setWaitingOpen] = useState(false)
  const [waitUntilInput, setWaitUntilInput] = useState<string>('')
  const name = conversation.contactName || conversation.visitorName || conversation.visitorPhone || conversation.visitorEmail || 'Anonymous'
  const initial = name.replace(/[^a-zA-Z0-9]/g, '').charAt(0).toUpperCase() || '?'
  const channel = (CHANNEL_MAP[conversation.channel] ?? 'unknown') as Channel
  const isBotActive = conversation.botStatus === 'active'
  const status = (conversation.status as ConversationStatus) ?? 'open'
  const statusMeta = STATUS_META[status] ?? STATUS_META.open
  const priority = conversation.priority ?? 'normal'
  const starred = Boolean(conversation.starred)

  // Subtitle: phone OR email if available
  const subtitle =
    conversation.visitorPhone ??
    conversation.visitorEmail ??
    (conversation.channelAccountName ? `· ${conversation.channelAccountName}` : '')

  function handleSelectStatus(next: ConversationStatus) {
    if (next === 'waiting') {
      // Open mini-popover to capture wait_until before persisting.
      // Default to 24h from now in datetime-local format.
      const now = new Date(Date.now() + 24 * 60 * 60 * 1000)
      const iso = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
      setWaitUntilInput(iso)
      setWaitingOpen(true)
      return
    }
    onStatusChange(next, null)
  }

  function confirmWaiting() {
    if (!waitUntilInput) return
    // datetime-local is in local tz; convert to ISO with tz info
    const dt = new Date(waitUntilInput)
    if (Number.isNaN(dt.getTime())) return
    onStatusChange('waiting', dt.toISOString())
    setWaitingOpen(false)
  }

  return (
    // SEED-040: `pt-safe-3` extends padding under the iPhone notch / Dynamic
    // Island. On non-iOS the env(safe-area-inset-top) is 0 so it collapses to
    // the original py-3 spacing.
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border-subtle bg-bg-primary/95 px-4 pb-3 pt-safe-3 backdrop-blur">
      {/* Left cluster — back + avatar + identity */}
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
          {/* Status dot — uses the expanded status color */}
          <span
            className={cn(
              'absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-bg-primary',
              statusMeta.dot,
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

      {/* Right cluster — actions */}
      <div className="flex shrink-0 items-center gap-1">
        {/* SEED-035: status selector */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 px-2 text-[12px]"
              aria-label="Change status"
            >
              <span className={cn('h-2 w-2 rounded-full', statusMeta.dot)} />
              <span className={cn('font-medium', statusMeta.text)}>{statusMeta.label}</span>
              <ChevronDown className="h-3 w-3 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[180px]">
            <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-text-tertiary">
              Status
            </DropdownMenuLabel>
            {STATUS_ORDER.map((s) => {
              const meta = STATUS_META[s]
              return (
                <DropdownMenuItem
                  key={s}
                  onClick={() => handleSelectStatus(s)}
                  className={cn(status === s && 'text-accent')}
                >
                  <span className={cn('h-2 w-2 rounded-full mr-2', meta.dot)} />
                  {meta.label}
                  {status === s && <CheckCheck className="h-3.5 w-3.5 ml-auto" />}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* SEED-035: wait_until popover, opened lazily when "Waiting" is selected */}
        <Popover open={waitingOpen} onOpenChange={setWaitingOpen}>
          {/* Hidden trigger — anchored via the status selector visually; the
              popover only needs an anchor in DOM order for positioning. */}
          <PopoverTrigger asChild>
            <span className="sr-only" aria-hidden />
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[260px] p-3">
            <div className="space-y-2">
              <label className="block text-[11px] font-medium uppercase tracking-wide text-text-tertiary">
                Snooze until
              </label>
              <input
                type="datetime-local"
                value={waitUntilInput}
                onChange={(e) => setWaitUntilInput(e.target.value)}
                className="w-full rounded-[6px] border border-border-subtle bg-bg-primary px-2 py-1.5 text-[12px] text-text-primary"
              />
              <div className="flex justify-end gap-1.5 pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-[11.5px]"
                  onClick={() => setWaitingOpen(false)}
                >
                  Cancel
                </Button>
                <Button size="sm" className="h-7 px-2 text-[11.5px]" onClick={confirmWaiting}>
                  Snooze
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {/* SEED-035: labels picker */}
        {orgLabels && onLabelsChange && (
          <ConversationLabelPicker
            conversationId={conversation.id}
            allLabels={orgLabels}
            selectedLabels={conversation.labels ?? []}
            onChange={(next) => onLabelsChange(conversation.id, next)}
          />
        )}

        {/* SEED-039: channel filter — only shown when the thread spans more
            than one distinct channel. */}
        {threadChannels.length > 1 && onChannelFilterChange && (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  'h-8 w-8',
                  channelFilter && channelFilter.length > 0 && 'text-accent',
                )}
                aria-label="Filter messages by channel"
                title="Filter by channel"
              >
                <FilterIcon className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[200px] p-2">
              <div className="mb-1.5 px-1 text-[10px] font-medium uppercase tracking-wide text-text-tertiary">
                Show messages from
              </div>
              <button
                type="button"
                onClick={() => onChannelFilterChange(null)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-[6px] px-2 py-1 text-[12px] hover:bg-bg-tertiary',
                  (!channelFilter || channelFilter.length === 0) && 'text-accent',
                )}
              >
                <span className="h-2 w-2 rounded-full bg-text-tertiary" />
                All channels
                {(!channelFilter || channelFilter.length === 0) && (
                  <CheckCheck className="ml-auto h-3.5 w-3.5" />
                )}
              </button>
              <div className="my-1 h-px bg-border-subtle" />
              {threadChannels.map((ch) => {
                const selected = channelFilter?.includes(ch) ?? false
                const label =
                  ch === 'whatsapp' || ch === 'ghl_whatsapp'
                    ? 'WhatsApp'
                    : ch === 'sms' || ch === 'ghl_sms'
                      ? 'SMS'
                      : ch === 'instagram'
                        ? 'Instagram'
                        : ch === 'messenger'
                          ? 'Messenger'
                          : ch === 'telegram'
                            ? 'Telegram'
                            : ch === 'voice'
                              ? 'Voice'
                              : ch === 'widget' || ch === 'web'
                                ? 'Web'
                                : ch
                return (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => {
                      const current = channelFilter ?? []
                      const next = current.includes(ch)
                        ? current.filter((c) => c !== ch)
                        : [...current, ch]
                      onChannelFilterChange(next.length === 0 ? null : next)
                    }}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-[6px] px-2 py-1 text-[12px] hover:bg-bg-tertiary',
                      selected && 'text-accent',
                    )}
                  >
                    <span
                      className={cn(
                        'h-3.5 w-3.5 shrink-0 rounded border',
                        selected ? 'border-accent bg-accent' : 'border-border-subtle',
                      )}
                    >
                      {selected && <CheckCheck className="h-3 w-3 text-white" />}
                    </span>
                    {label}
                  </button>
                )
              })}
            </PopoverContent>
          </Popover>
        )}

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

          {/*
            SEED-040: Assign/Pin/Star/Priority are hidden on mobile to keep
            the header within a single phone-width row. They remain reachable
            via the ··· menu (TODO: surface them there explicitly in a future
            seed) and via the contact info panel.
          */}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="hidden md:inline-flex h-8 w-8">
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
                className={cn('hidden md:inline-flex h-8 w-8', conversation.pinned && 'text-accent')}
                onClick={() => onPinToggle(conversation.id, !conversation.pinned)}
                aria-label={conversation.pinned ? 'Unpin' : 'Pin'}
              >
                <Pin className="h-4 w-4" fill={conversation.pinned ? 'currentColor' : 'none'} />
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
                  className={cn('hidden md:inline-flex h-8 w-8', starred && 'text-amber-400')}
                  onClick={() => onStarToggle(conversation.id, !starred)}
                  aria-label={starred ? 'Unstar' : 'Star'}
                >
                  <Star className="h-4 w-4" fill={starred ? 'currentColor' : 'none'} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{starred ? 'Remove star' : 'Star'}</TooltipContent>
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  'hidden md:inline-flex h-8 w-8',
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
              {/*
                SEED-040: the info-panel toggle is visible on all viewports.
                On desktop it shows/hides the right column; on mobile the
                parent (chat-layout) interprets the same callback as a swap
                to the contact-info pane.
              */}
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

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {/*
              SEED-040: on mobile we hide pin/star/priority from the header
              row to fit the viewport, so we surface them here instead.
              Desktop already has icon buttons for these — duplicating in the
              menu is harmless and discoverable.
            */}
            <DropdownMenuItem
              className="md:hidden"
              onClick={() => onPinToggle(conversation.id, !conversation.pinned)}
            >
              <Pin className="h-3.5 w-3.5 mr-2" />
              {conversation.pinned ? 'Unpin' : 'Pin to top'}
            </DropdownMenuItem>
            {onStarToggle && (
              <DropdownMenuItem
                className="md:hidden"
                onClick={() => onStarToggle(conversation.id, !starred)}
              >
                <Star className="h-3.5 w-3.5 mr-2" />
                {starred ? 'Remove star' : 'Star'}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              className="md:hidden"
              onClick={() => onPriorityCycle(conversation.id, PRIORITY_CYCLE[priority])}
            >
              <Flag className="h-3.5 w-3.5 mr-2" />
              Priority: {priority === 'normal' ? 'Normal' : priority === 'high' ? 'High' : 'Urgent'}
            </DropdownMenuItem>
            <DropdownMenuSeparator className="md:hidden" />
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
