import type { LucideIcon } from 'lucide-react'
import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Composite icon: a primary lucide icon with a small "+" badge in the
 * bottom-right corner. Used by the email-templates collapsed rail's "New
 * template" / "New section" buttons so they read as distinct create actions
 * (Mail+ / Layers+) instead of two identical bare `Plus` icons — see
 * `settings/email-templates/layout.tsx` collapsedActions and Phase 7 of
 * the email-builder-hardening plan.
 */
export function IconWithPlusBadge({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return (
    <span className={cn('relative inline-flex h-3.5 w-3.5 items-center justify-center', className)}>
      {/* Inline `style` sizing (not a `size-*`/`h-*`/`w-*` class) is
          load-bearing here: the shadcn Button this renders inside sets
          `[&_svg]:size-4` on itself, which compiles to a `.btn svg { … }`
          descendant-selector rule — higher CSS specificity than a plain
          utility class on the icon, so it would force BOTH nested icons to
          the same 16px size and erase the badge. Inline styles beat any
          non-`!important` class rule regardless of specificity. */}
      <Icon style={{ width: 14, height: 14 }} />
      <span className="absolute -bottom-1 -right-1 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-primary ring-1 ring-card">
        <Plus style={{ width: 6, height: 6 }} className="text-primary-foreground" strokeWidth={3} />
      </span>
    </span>
  )
}
