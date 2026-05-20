'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  ArrowDownRight,
  ArrowUpRight,
  Minus,
  MessageSquare,
  Phone,
  Trophy,
  Star,
  TrendingUp,
  Users,
  Inbox,
  Calendar,
  Activity,
  Bot,
  Plug2,
  type LucideIcon,
} from 'lucide-react'
import { Area, AreaChart, ResponsiveContainer } from 'recharts'

import { cn } from '@/lib/utils'
import { AnimatedNumber } from '@/components/design-system/animated-number'

export interface MetricCardProps {
  label: string
  value: string | number
  /** Optional small label after the value, e.g. "calls" or "/day" */
  unit?: string
  /** Disable the count-up animation when the value isn't a clean number. */
  animate?: boolean
  /** Trend % vs previous period. Positive = up, negative = down. */
  trend?: number | null
  /** Optional sparkline data points */
  data?: { value: number }[]
  /** Optional icon slug — looked up internally because lucide icons are functions and can't cross Server→Client boundary */
  icon?: MetricIconName
  /** Tone hint — affects sparkline color */
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'info'
  /** Make whole card clickable */
  href?: string
  /** Optional footer hint (e.g. "Daily cap: $25") */
  hint?: string
  className?: string
  /** Animation stagger index (0-based) */
  index?: number
}

// Icon registry — string slug → Lucide component. Kept inside the client
// component so server callers can pass a serializable string instead of a
// function (which would fail Server→Client serialization).
const ICON_MAP = {
  conversations: MessageSquare,
  phone: Phone,
  trophy: Trophy,
  star: Star,
  trending: TrendingUp,
  users: Users,
  inbox: Inbox,
  calendar: Calendar,
  activity: Activity,
  bot: Bot,
  plug: Plug2,
} satisfies Record<string, LucideIcon>

export type MetricIconName = keyof typeof ICON_MAP

const toneColors: Record<NonNullable<MetricCardProps['tone']>, string> = {
  default: 'var(--accent)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger:  'var(--danger)',
  info:    'var(--info)',
}

export function MetricCard({
  label,
  value,
  unit,
  animate = true,
  trend,
  data,
  icon,
  tone = 'default',
  href,
  hint,
  className,
  index = 0,
}: MetricCardProps) {
  // Detect a numeric value (or a formatted "$x.xx" / "1,234") so we can
  // animate the count-up. String values with non-numeric chars beyond
  // commas/dots/$ are rendered verbatim.
  const animatable = React.useMemo(() => {
    if (!animate) return null
    if (typeof value === 'number') return { prefix: '', n: value, suffix: '', decimals: 0 }
    const s = String(value).trim()
    const m = /^(\$?)([\d,]+(?:\.\d+)?)$/.exec(s)
    if (!m) return null
    const n = Number(m[2].replace(/,/g, ''))
    if (!Number.isFinite(n)) return null
    const decimals = m[2].includes('.') ? (m[2].split('.')[1]?.length ?? 0) : 0
    return { prefix: m[1] ?? '', n, suffix: '', decimals }
  }, [value, animate])
  const color = toneColors[tone]
  const gradientId = React.useId()

  const TrendIcon =
    trend === null || trend === undefined
      ? null
      : trend > 0
      ? ArrowUpRight
      : trend < 0
      ? ArrowDownRight
      : Minus

  const trendColor =
    trend === null || trend === undefined
      ? 'text-text-tertiary'
      : trend > 0
      ? 'text-success'
      : trend < 0
      ? 'text-danger'
      : 'text-text-tertiary'

  const body = (
    <div
      className={cn(
        'group relative flex flex-col gap-3 p-5',
        'rounded-[12px] border border-border bg-bg-secondary',
        'shadow-elevation-sm h-full',
        'transition-[transform,box-shadow,border-color] duration-200 ease-out',
        href && 'cursor-pointer hover:-translate-y-0.5 hover:shadow-elevation-md hover:border-border-strong',
        'animate-fade-in',
        className,
      )}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      {/* subtle accent glow on hover when interactive */}
      {href && (
        <div
          aria-hidden
          className="absolute inset-0 rounded-[12px] opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse 80% 60% at 50% 0%, var(--accent-muted), transparent 70%)',
          }}
        />
      )}

      <div className="relative flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-[12px] font-medium uppercase tracking-[0.06em] text-text-tertiary">
          {icon && (() => {
            const Icon = ICON_MAP[icon]
            return Icon ? <Icon className="h-3.5 w-3.5 shrink-0" /> : null
          })()}
          <span className="truncate">{label}</span>
        </div>
        {TrendIcon && (
          <div
            className={cn(
              'flex shrink-0 items-center gap-0.5 rounded-[5px] px-1.5 py-0.5 text-[11px] font-medium tabular',
              trendColor,
              trend !== null && trend !== undefined && trend > 0 && 'bg-[var(--success-muted)]',
              trend !== null && trend !== undefined && trend < 0 && 'bg-[var(--danger-muted)]',
            )}
          >
            <TrendIcon className="h-3 w-3" />
            <span>{trend === null || trend === undefined ? '—' : `${Math.abs(trend) > 999 ? '999+' : Math.abs(trend)}%`}</span>
          </div>
        )}
      </div>

      <div className="relative flex items-baseline gap-1.5">
        <div className="text-[28px] font-semibold leading-none tracking-tight tabular text-text-primary">
          {animatable ? (
            <AnimatedNumber
              value={animatable.n}
              prefix={animatable.prefix}
              decimals={animatable.decimals}
              duration={900}
            />
          ) : (
            value
          )}
        </div>
        {unit && <div className="text-[12.5px] text-text-tertiary">{unit}</div>}
      </div>

      {data && data.length > 0 && (
        <div className="relative h-10 -mx-1 min-w-0">
          <ResponsiveContainer width="100%" height={40} minWidth={0}>
            <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="value"
                stroke={color}
                strokeWidth={1.5}
                fill={`url(#${gradientId})`}
                isAnimationActive={false}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {hint && (
        <div className="relative text-[11.5px] text-text-tertiary">{hint}</div>
      )}
    </div>
  )

  if (href) {
    return (
      <Link href={href} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary rounded-[12px]">
        {body}
      </Link>
    )
  }
  return body
}
