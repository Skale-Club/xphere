'use client'

import { memo, useState } from 'react'
import { Handle, Position } from '@xyflow/react'
import { AlertCircle, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

export type NodeVisualState = 'default' | 'incomplete' | 'error' | 'disabled'

interface BaseNodeProps {
  /** Lucide-style icon. Used as a fallback when `logo` is missing or fails to load. */
  icon: React.ReactNode
  /** Optional path to a brand SVG (e.g. `/logos/twilio.svg`). Renders inside
   *  the coloured tile when present; falls back to `icon` on load error so
   *  workflows keep rendering even when a brand asset is missing. */
  logo?: string
  title: string
  subtitle?: string
  /** Hex string used as the tile background and handle colour. */
  color: string
  selected?: boolean
  hasInput?: boolean
  hasOutput?: boolean
  hasBranchOutputs?: boolean
  /** Visual state — drives the outer border / opacity. Default is unchanged. */
  state?: NodeVisualState
}

// SEED-043 Phase 1 | inline border style per state. Kept off the Tailwind layer
// because these colours never appear elsewhere on the canvas and we'd rather
// not pull them into the design tokens yet.
const STATE_BORDER_STYLE: Record<
  NodeVisualState,
  React.CSSProperties | undefined
> = {
  default: undefined,
  incomplete: { borderColor: '#f59e0b', borderStyle: 'dashed', borderWidth: 1 },
  error: { borderColor: '#ef4444', borderStyle: 'solid', borderWidth: 1 },
  disabled: undefined,
}

function StateBadge({ state }: { state: NodeVisualState }) {
  if (state === 'incomplete') {
    return (
      <span
        className="absolute -top-1 -right-1 rounded-full bg-card p-[1px] text-amber-500 shadow-sm"
        title="Configuration incomplete"
      >
        <AlertCircle className="h-3 w-3" />
      </span>
    )
  }
  if (state === 'error') {
    return (
      <span
        className="absolute -top-1 -right-1 rounded-full bg-card p-[1px] text-rose-500 shadow-sm"
        title="Last run failed"
      >
        <XCircle className="h-3 w-3" />
      </span>
    )
  }
  return null
}

/** Icon-tile renderer that prefers the brand `logo` and falls back to the
 *  lucide `icon` when the SVG path 404s or isn't provided. The fallback is
 *  important: brand SVGs may not be on disk yet (registry seeds them
 *  optimistically) and we never want a missing asset to break the canvas. */
function NodeIconTile({
  icon,
  logo,
  color,
}: {
  icon: React.ReactNode
  logo?: string
  color: string
}) {
  const [logoFailed, setLogoFailed] = useState(false)
  const showLogo = !!logo && !logoFailed

  return (
    <div
      className="h-7 w-7 rounded flex items-center justify-center shrink-0 text-white overflow-hidden"
      style={{ backgroundColor: color }}
    >
      {showLogo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logo}
          alt=""
          width={18}
          height={18}
          className="object-contain"
          onError={() => setLogoFailed(true)}
        />
      ) : (
        icon
      )}
    </div>
  )
}

function BaseNodeImpl({
  icon,
  logo,
  title,
  subtitle,
  color,
  selected,
  hasInput = true,
  hasOutput = true,
  hasBranchOutputs = false,
  state = 'default',
}: BaseNodeProps) {
  const isDisabled = state === 'disabled'
  const inlineBorder = STATE_BORDER_STYLE[state]
  // When `selected` is true the primary ring takes over visually; we still
  // want incomplete/error feedback though, hence the state badge stays.

  return (
    <div className={cn(isDisabled && 'opacity-60')}>
      <div
        className={cn(
          'rounded-lg border bg-card shadow-sm min-w-[200px] transition-all',
          selected ? 'border-primary ring-2 ring-primary/30' : 'border-border',
        )}
        style={!selected && inlineBorder ? inlineBorder : undefined}
      >
        <div className="flex items-center gap-2 px-3 py-2">
          <div className="relative">
            <NodeIconTile icon={icon} logo={logo} color={color} />
            <StateBadge state={state} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium truncate">{title}</p>
            {subtitle && (
              <p className="text-[10px] text-muted-foreground truncate">{subtitle}</p>
            )}
          </div>
        </div>

        {hasInput && (
          <Handle
            type="target"
            position={Position.Top}
            style={{ background: color, width: 8, height: 8 }}
          />
        )}

        {hasBranchOutputs ? (
          <>
            <Handle
              id="true"
              type="source"
              position={Position.Bottom}
              style={{ background: '#10b981', width: 8, height: 8, left: '30%' }}
            />
            <Handle
              id="false"
              type="source"
              position={Position.Bottom}
              style={{ background: '#ef4444', width: 8, height: 8, left: '70%' }}
            />
            <div className="flex justify-between px-3 pb-1.5 gap-2">
              <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-[4px] bg-emerald-500/15 text-emerald-400">
                TRUE
              </span>
              <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-[4px] bg-rose-500/15 text-rose-400">
                FALSE
              </span>
            </div>
          </>
        ) : hasOutput ? (
          <Handle
            type="source"
            position={Position.Bottom}
            style={{ background: color, width: 8, height: 8 }}
          />
        ) : null}
      </div>
    </div>
  )
}

export const BaseNode = memo(BaseNodeImpl)
