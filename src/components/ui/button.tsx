import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // Base — applies to every variant
  [
    "relative inline-flex items-center justify-center gap-2 whitespace-nowrap",
    "rounded-[8px] text-sm font-medium",
    "transition-[background-color,box-shadow,transform,color,border-color] duration-150 ease-out",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
    "active:translate-y-px",
    "select-none",
  ].join(" "),
  {
    variants: {
      variant: {
        // Primary — indigo accent, glows on hover
        primary: [
          "bg-accent text-white shadow-elevation-sm",
          "hover:bg-accent-hover hover:shadow-glow",
        ].join(" "),

        // Secondary — subtle surface, the workhorse
        secondary: [
          "bg-bg-tertiary text-text-primary border border-border",
          "hover:bg-bg-elevated hover:border-border-strong",
        ].join(" "),

        // Ghost — minimal, no surface until hover
        ghost: [
          "text-text-secondary",
          "hover:bg-bg-tertiary hover:text-text-primary",
        ].join(" "),

        // Destructive — red, used for delete/danger actions
        destructive: [
          "bg-danger text-white shadow-elevation-sm",
          "hover:brightness-110",
        ].join(" "),

        // Outline — bordered, transparent surface
        outline: [
          "border border-border bg-transparent text-text-primary",
          "hover:bg-bg-tertiary hover:border-border-strong",
        ].join(" "),

        // Link — text-only with underline-on-hover
        link: [
          "text-accent underline-offset-4 hover:underline px-0 h-auto",
        ].join(" "),

        // Aliases for shadcn legacy callers (kept for back-compat)
        default: [
          "bg-accent text-white shadow-elevation-sm",
          "hover:bg-accent-hover hover:shadow-glow",
        ].join(" "),
      },
      size: {
        sm:      "h-8 px-3 text-[13px]",
        default: "h-9 px-4",
        md:      "h-9 px-4",
        lg:      "h-10 px-5 text-[14px]",
        icon:    "h-9 w-9",
        "icon-sm": "h-8 w-8 [&_svg]:size-[14px]",
        "icon-lg": "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "color">,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    const isDisabled = disabled || loading
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={isDisabled}
        {...props}
      >
        {loading ? (
          <>
            <Loader2 className="animate-spin" />
            <span className="opacity-80">{children}</span>
          </>
        ) : (
          children
        )}
      </Comp>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
