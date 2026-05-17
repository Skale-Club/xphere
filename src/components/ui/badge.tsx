import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-[6px] border px-2 py-0.5 text-[11px] font-medium tracking-tight transition-colors",
  {
    variants: {
      variant: {
        // Neutral default
        default:
          "border-border bg-bg-tertiary text-text-secondary",
        // Primary — brand accent
        primary:
          "border-accent/30 bg-accent-muted text-accent",
        // Success — green
        success:
          "border-success/30 bg-[var(--success-muted)] text-success",
        // Warning — amber
        warning:
          "border-warning/30 bg-[var(--warning-muted)] text-warning",
        // Danger — red
        danger:
          "border-danger/30 bg-[var(--danger-muted)] text-danger",
        // Info — blue
        info:
          "border-info/30 bg-[var(--info-muted)] text-info",
        // Outline — bordered transparent
        outline:
          "border-border bg-transparent text-text-secondary",
        // Legacy shadcn names (kept for back-compat)
        secondary:
          "border-border bg-bg-tertiary text-text-secondary",
        destructive:
          "border-danger/30 bg-[var(--danger-muted)] text-danger",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
