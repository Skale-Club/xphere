'use client'

import * as React from 'react'
import {
  ChevronLeft,
  Moon,
  UserPlus,
  User,
  Volume2,
  VolumeX,
  Mic,
  MicOff,
  Pause,
  Grid3x3,
  PhoneOff,
  CalendarDays,
  FileText,
  CheckSquare,
  CreditCard,
  Delete,
  ArrowUpRight,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { CallPhase } from '@/hooks/use-outbound-call-status'

const DTMF_KEYS: Array<{ digit: string; letters?: string }> = [
  { digit: '1' },
  { digit: '2', letters: 'ABC' },
  { digit: '3', letters: 'DEF' },
  { digit: '4', letters: 'GHI' },
  { digit: '5', letters: 'JKL' },
  { digit: '6', letters: 'MNO' },
  { digit: '7', letters: 'PQRS' },
  { digit: '8', letters: 'TUV' },
  { digit: '9', letters: 'WXYZ' },
  { digit: '*' },
  { digit: '0', letters: '+' },
  { digit: '#' },
]

function phaseLabel(phase: CallPhase): string {
  switch (phase) {
    case 'initiating':
      return 'Starting...'
    case 'ringing':
      return 'Ringing...'
    case 'connected':
      return 'Connected'
    case 'ended':
      return 'Ended'
    case 'busy':
      return 'Busy'
    case 'no-answer':
      return 'No answer'
    case 'failed':
      return 'Failed'
    case 'canceled':
      return 'Canceled'
  }
}

function formatElapsed(s: number): string {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}

interface ContactInitialsProps {
  name: string | null
  phone: string
}

function ContactAvatar({ name, phone }: ContactInitialsProps) {
  if (name) {
    const parts = name.trim().split(/\s+/)
    const initials = parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : parts[0].slice(0, 2).toUpperCase()
    return (
      <div className="flex h-24 w-24 items-center justify-center rounded-full bg-white/10 text-white text-3xl font-semibold">
        {initials}
      </div>
    )
  }
  return (
    <div className="flex h-24 w-24 items-center justify-center rounded-full bg-white/10">
      <User className="h-12 w-12 text-white/60" />
    </div>
  )
}

export interface MobileActiveCallScreenProps {
  /** Display name of the contact, or null if unknown. */
  contactName: string | null
  /** The phone number being called (formatted for display). */
  contactPhone: string
  /** contact.id, used for deep-link quick actions. Null if not found. */
  contactId: string | null
  /** Friendly name of the outbound number, e.g. "Skleanings Number". */
  fromLabel: string | null
  /** E.164 of the outbound number, e.g. "+1 508-500-6625". */
  fromPhone: string | null
  phase: CallPhase
  elapsed: number
  showTimer: boolean
  /** Whether the call is terminal (ended/busy/no-answer/failed/canceled). */
  isTerminal: boolean
  /** Whether this is a browser (WebRTC) call. Enables mute control. */
  browserActive: boolean
  muted: boolean
  speakerOn: boolean
  /** Whether the DTMF keypad overlay is visible. */
  keypadOpen: boolean
  onClose: () => void
  onMute: () => void
  onSpeaker: () => void
  onHangUp: () => void
  onDismiss: () => void
  onKeypadToggle: () => void
  onDtmfDigit: (digit: string) => void
  onKeypadBackspace: () => void
  dtmfInput: string
}

export function MobileActiveCallScreen({
  contactName,
  contactPhone,
  contactId,
  fromLabel,
  fromPhone,
  phase,
  elapsed,
  showTimer,
  isTerminal,
  browserActive,
  muted,
  speakerOn,
  keypadOpen,
  onClose,
  onMute,
  onSpeaker,
  onHangUp,
  onDismiss,
  onKeypadToggle,
  onDtmfDigit,
  onKeypadBackspace,
  dtmfInput,
}: MobileActiveCallScreenProps) {
  const router = useRouter()

  const quickActions = [
    {
      label: 'Calendar',
      icon: CalendarDays,
      onPress: () => router.push('/calendar'),
    },
    {
      label: 'Notes',
      icon: FileText,
      onPress: () => router.push(contactId ? `/contacts/${contactId}#notes` : '/contacts'),
    },
    {
      label: 'Tasks',
      icon: CheckSquare,
      onPress: () => router.push('/tasks'),
    },
    {
      label: 'Payments',
      icon: CreditCard,
      onPress: () => router.push('/payments'),
    },
    {
      label: 'Profile',
      icon: User,
      onPress: () => router.push(contactId ? `/contacts/${contactId}` : '/contacts'),
    },
  ] as const

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0e0e10] text-white">
      {/* Decorative wave background */}
      <div
        className="pointer-events-none absolute inset-0 opacity-20"
        style={{
          background:
            'radial-gradient(ellipse 120% 60% at 50% 0%, rgba(80,80,120,0.6) 0%, transparent 70%), radial-gradient(ellipse 80% 40% at 80% 100%, rgba(40,40,80,0.4) 0%, transparent 70%)',
        }}
      />

      {/* Top bar */}
      <div
        className="relative flex items-start justify-between px-5 pt-[env(safe-area-inset-top)] pb-2"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 16px)' }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-10 w-10 items-center justify-center rounded-full text-white/70 hover:text-white active:bg-white/10"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>

        <div className="flex items-start gap-5 pr-1 pt-1">
          <button
            type="button"
            aria-label="Do not disturb"
            className="flex flex-col items-center gap-1 text-white/60 active:text-white"
          >
            <Moon className="h-5 w-5" />
            <span className="text-[10px] font-medium tracking-wide">DND</span>
          </button>
          <button
            type="button"
            aria-label="Transfer call"
            className="flex flex-col items-center gap-1 text-white/60 active:text-white"
          >
            <UserPlus className="h-5 w-5" />
            <span className="text-[10px] font-medium tracking-wide">Transfer</span>
          </button>
        </div>
      </div>

      {/* Contact info */}
      <div className="relative flex flex-col items-center px-8 pt-6 text-center">
        <h1 className="text-[28px] font-semibold leading-tight text-white">
          {contactName ?? contactPhone}
        </h1>
        {contactName && (
          <p className="mt-1 text-[16px] font-normal text-white/60">{contactPhone}</p>
        )}
        <p className="mt-2 text-[15px] font-normal text-white/50">
          {isTerminal
            ? phaseLabel(phase)
            : phase === 'connected' && showTimer
              ? formatElapsed(elapsed)
              : phaseLabel(phase)}
        </p>
      </div>

      {/* Avatar */}
      <div className="relative flex flex-1 flex-col items-center justify-center gap-6">
        <ContactAvatar name={contactName} phone={contactPhone} />

        {/* Outbound call banner */}
        {(fromLabel || fromPhone) && (
          <div className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-2">
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500">
              <ArrowUpRight className="h-3 w-3 text-white" />
            </div>
            <div className="text-left">
              <p className="text-[11px] font-semibold text-white leading-none">Outbound Call</p>
              {(fromLabel || fromPhone) && (
                <p className="mt-0.5 text-[10px] text-white/60 leading-none">
                  {fromLabel}{fromLabel && fromPhone ? ' ' : ''}{fromPhone ? `(${fromPhone})` : ''}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Quick action shortcuts */}
      <div className="relative flex justify-around px-4 pb-5">
        {quickActions.map(({ label, icon: Icon, onPress }) => (
          <button
            key={label}
            type="button"
            onClick={onPress}
            className="flex flex-col items-center gap-2 active:opacity-70"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10">
              <Icon className="h-5 w-5 text-white" />
            </div>
            <span className="text-[10px] font-medium text-white/60 tracking-wide">{label}</span>
          </button>
        ))}
      </div>

      {/* Call controls */}
      <div
        className="relative flex justify-around px-4 pb-[env(safe-area-inset-bottom)]"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 24px)' }}
      >
        {/* Speaker */}
        <CallControl
          label="Speaker"
          active={speakerOn}
          onClick={onSpeaker}
          icon={speakerOn ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
        />

        {/* Mute */}
        <CallControl
          label="Mute"
          active={muted}
          activeColor="bg-white/20"
          onClick={browserActive ? onMute : undefined}
          disabled={!browserActive}
          icon={muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
        />

        {/* Hold is not implemented, always disabled. */}
        <CallControl
          label="Hold"
          disabled
          icon={<Pause className="h-5 w-5" />}
        />

        {/* Keypad */}
        <CallControl
          label="Keypad"
          active={keypadOpen}
          onClick={onKeypadToggle}
          icon={<Grid3x3 className="h-5 w-5" />}
        />

        {/* End Call */}
        {isTerminal ? (
          <CallControl
            label="Dismiss"
            onClick={onDismiss}
            icon={<PhoneOff className="h-5 w-5" />}
            endCall
          />
        ) : (
          <CallControl
            label="End Call"
            onClick={onHangUp}
            icon={<PhoneOff className="h-5 w-5" />}
            endCall
          />
        )}
      </div>

      {/* DTMF keypad overlay */}
      {keypadOpen && (
        <div className="absolute inset-0 z-10 flex flex-col bg-[#0e0e10]/95 backdrop-blur-sm pt-[env(safe-area-inset-top)]">
          <div
            className="flex items-center justify-between px-5 pb-2"
            style={{ paddingTop: 'max(env(safe-area-inset-top), 16px)' }}
          >
            <button
              type="button"
              onClick={onKeypadToggle}
              className="flex h-10 w-10 items-center justify-center rounded-full text-white/70 hover:text-white"
              aria-label="Close keypad"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            <span className="text-[13px] text-white/50">Keypad</span>
            <div className="w-10" />
          </div>

          {/* DTMF input display */}
          <div className="flex items-center justify-center gap-3 px-8 py-4">
            <span className="text-[28px] font-medium tracking-widest text-white min-h-[40px]">
              {dtmfInput || <span className="text-white/20">-</span>}
            </span>
            {dtmfInput && (
              <button
                type="button"
                onClick={onKeypadBackspace}
                className="text-white/50 hover:text-white"
                aria-label="Backspace"
              >
                <Delete className="h-5 w-5" />
              </button>
            )}
          </div>

          {/* 3x4 grid */}
          <div className="grid grid-cols-3 gap-3 mx-auto w-full max-w-[300px] px-6 flex-1 content-center">
            {DTMF_KEYS.map((k) => (
              <button
                key={k.digit}
                type="button"
                onClick={() => onDtmfDigit(k.digit)}
                className="flex aspect-square flex-col items-center justify-center gap-0.5 rounded-full bg-white/10 text-white transition-all active:scale-95 active:bg-white/20"
              >
                <span className="text-[27px] font-semibold leading-none">{k.digit}</span>
                {k.letters && (
                  <span className="text-[9.5px] font-medium uppercase tracking-[0.14em] text-white/40 leading-none">
                    {k.letters}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div
            className="pb-[env(safe-area-inset-bottom)]"
            style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 24px)' }}
          />
        </div>
      )}
    </div>
  )
}

interface CallControlProps {
  label: string
  icon: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  active?: boolean
  activeColor?: string
  endCall?: boolean
}

function CallControl({
  label,
  icon,
  onClick,
  disabled,
  active,
  activeColor,
  endCall,
}: CallControlProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex flex-col items-center gap-2 disabled:opacity-40',
        !disabled && 'active:opacity-70',
      )}
    >
      <div
        className={cn(
          'flex h-14 w-14 items-center justify-center rounded-full transition-colors',
          endCall
            ? 'bg-rose-500 text-white'
            : active
              ? (activeColor ?? 'bg-white text-[#0e0e10]')
              : 'bg-white/10 text-white',
        )}
      >
        {icon}
      </div>
      <span
        className={cn(
          'text-[10px] font-medium tracking-wide',
          endCall ? 'text-rose-400' : 'text-white/60',
        )}
      >
        {label}
      </span>
    </button>
  )
}
