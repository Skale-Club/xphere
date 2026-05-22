'use client'

import * as React from 'react'
import { ThemeProvider as NextThemesProvider } from 'next-themes'

// next-themes 0.4.x injects a <script> tag for theme initialisation which
// React 19 intercepts and hoists to <head>, firing a "Encountered a script tag
// while rendering React component" console.error.  This is a known upstream
// issue (react 19 + next-themes).  Suppress only that specific warning at
// module load so it never appears.  The theme still initialises correctly
// because React 19 does execute the hoisted script.
if (typeof window !== 'undefined') {
  const _error = console.error.bind(console)
  console.error = (...args: Parameters<typeof console.error>) => {
    if (typeof args[0] === 'string' && args[0].includes('Encountered a script tag')) return
    _error(...args)
  }
}

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>
}
