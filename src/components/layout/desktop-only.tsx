import { Laptop } from 'lucide-react'

/**
 * Renders `children` only on viewports ≥ lg (1024px). Below that, shows a
 * friendly message asking the user to switch to a desktop browser. Used to
 * gate complex editors (workflow canvas, tool config forms) that don't
 * function well on small touch screens.
 *
 * Implemented with CSS visibility classes so it works in Server Components
 * without hydration drift.
 */
export function DesktopOnly({
  children,
  message = 'This editor is not available on mobile.',
}: {
  children: React.ReactNode
  message?: string
}) {
  return (
    <>
      <div className="hidden lg:block">{children}</div>
      <div className="lg:hidden flex flex-col items-center justify-center text-center px-6 py-16 gap-4">
        <div className="h-14 w-14 rounded-2xl bg-accent-muted flex items-center justify-center">
          <Laptop className="h-7 w-7 text-accent" />
        </div>
        <div className="max-w-sm">
          <h2 className="text-lg font-semibold text-text-primary">Desktop only</h2>
          <p className="mt-1.5 text-sm text-text-secondary leading-relaxed">{message}</p>
          <p className="mt-3 text-xs text-text-tertiary">
            Open Xphere on a tablet or laptop to continue editing.
          </p>
        </div>
      </div>
    </>
  )
}
