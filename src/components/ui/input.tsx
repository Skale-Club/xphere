import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // Surface + shape
          "flex h-9 w-full rounded-[8px] border border-border bg-bg-secondary px-3 py-2",
          // Typography
          "text-sm text-text-primary placeholder:text-text-tertiary",
          // File input styling
          "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-text-primary",
          // Focus | accent ring
          "transition-[border-color,box-shadow] duration-150 ease-out",
          "focus-visible:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30",
          // Disabled
          "disabled:cursor-not-allowed disabled:opacity-50",
          // Responsive
          "md:text-[13.5px]",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
