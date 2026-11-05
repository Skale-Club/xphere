import { cn } from '@/lib/utils'

/**
 * Hairline accent along the top edge of the sign-in box, with a faint glow
 * behind it. Same treatment as Xpot's GradientTopLine, in Xphere's indigo to
 * violet instead of Xpot's blue to teal.
 *
 * The parent must be positioned and clip its overflow (DialogContent does
 * both), otherwise the blurred glow bleeds past the rounded corners.
 */
export function GradientTopLine({ className }: { className?: string }) {
  return (
    <>
      <div
        aria-hidden="true"
        data-ui="gradient-top-line"
        className={cn(
          'pointer-events-none absolute inset-x-8 top-0 z-20 h-px bg-[linear-gradient(90deg,transparent,#4F39F6_38%,#A78BFA_68%,transparent)]',
          className,
        )}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-0 h-24 w-48 -translate-x-1/2 rounded-full bg-[#4F39F6]/15 blur-3xl"
      />
    </>
  )
}
