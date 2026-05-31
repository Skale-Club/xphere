import type { ReactNode } from 'react'

interface Props {
  children: ReactNode
}

/**
 * Keep the wrapper stable without delaying route paints. Route-level exit
 * animations were visible in INP traces for sidebar navigation.
 */
export function PageTransition({ children }: Props) {
  return <div className="h-full">{children}</div>
}
