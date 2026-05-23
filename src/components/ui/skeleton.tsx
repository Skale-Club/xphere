import { cn } from "@/lib/utils"

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  rounded?: "none" | "sm" | "md" | "lg" | "xl" | "full"
}

const radiusMap = {
  none: "rounded-none",
  sm: "rounded-[var(--radius-xs)]",
  md: "rounded-[var(--radius-sm)]",
  lg: "rounded-[var(--radius)]",
  xl: "rounded-[var(--radius-lg)]",
  full: "rounded-full",
}

function Skeleton({ className, rounded = "md", ...props }: SkeletonProps) {
  return (
    <div
      className={cn("shimmer", radiusMap[rounded], className)}
      {...props}
    />
  )
}

export { Skeleton, radiusMap }