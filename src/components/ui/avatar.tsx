"use client"

import * as React from "react"
import * as AvatarPrimitive from "@radix-ui/react-avatar"

import { cn } from "@/lib/utils"

const Avatar = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Root
    ref={ref}
    className={cn(
      "relative flex h-9 w-9 shrink-0 overflow-hidden rounded-full ring-1 ring-border-subtle",
      className
    )}
    {...props}
  />
))
Avatar.displayName = AvatarPrimitive.Root.displayName

const AvatarImage = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Image>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Image
    ref={ref}
    className={cn("aspect-square h-full w-full object-cover", className)}
    {...props}
  />
))
AvatarImage.displayName = AvatarPrimitive.Image.displayName

const AvatarFallback = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Fallback
    ref={ref}
    className={cn(
      "flex h-full w-full items-center justify-center rounded-full bg-bg-tertiary text-[11px] font-semibold text-text-secondary",
      className
    )}
    {...props}
  />
))
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName

interface AvatarStackProps extends React.HTMLAttributes<HTMLDivElement> {
  max?: number
  size?: number
}

const AvatarStack = React.forwardRef<HTMLDivElement, AvatarStackProps>(
  ({ children, max, className, ...props }, ref) => {
    const items = React.Children.toArray(children)
    const visible = typeof max === "number" ? items.slice(0, max) : items
    const overflow = typeof max === "number" ? items.length - max : 0

    return (
      <div
        ref={ref}
        className={cn("flex items-center -space-x-2", className)}
        {...props}
      >
        {visible.map((child, idx) => (
          <div key={idx} className="ring-2 ring-bg-secondary rounded-full">
            {child}
          </div>
        ))}
        {overflow > 0 && (
          <div className="ring-2 ring-bg-secondary rounded-full">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-bg-tertiary text-[11px] font-semibold text-text-secondary">
              +{overflow}
            </div>
          </div>
        )}
      </div>
    )
  }
)
AvatarStack.displayName = "AvatarStack"

export { Avatar, AvatarImage, AvatarFallback, AvatarStack }
