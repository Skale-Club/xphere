'use client'

import { Component, type ReactNode } from 'react'

interface State {
  hasError: boolean
  error?: Error
}

interface Props {
  /**
   * Fallback element rendered when the wrapped subtree throws. A function
   * variant receives the captured error and may produce a richer fallback.
   */
  fallback: ReactNode | ((error: Error) => ReactNode)
  /**
   * Tag for log messages. Used to identify which widget failed in the
   * browser console (looks like `[dashboard:widget-name]`).
   */
  name?: string
  children: ReactNode
}

/**
 * Per-widget client-side error boundary.
 *
 * Used by the home dashboard so a single failing widget can't take down the
 * entire page (see incident 1621801304 | the previous dashboard had a single
 * segment-level boundary which caused render loops). Each widget on the
 * dashboard is wrapped:
 *
 *   <WidgetErrorBoundary name="conversations" fallback={<WidgetError />}>
 *     <Suspense fallback={<MetricSkeleton />}>
 *       <MetricOpenConversations />
 *     </Suspense>
 *   </WidgetErrorBoundary>
 *
 * The boundary catches synchronous render errors from its children. Async
 * errors thrown by Server Components arrive via the Suspense boundary's
 * thrown promise and surface here too once React unwraps them.
 */
export class WidgetErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    const tag = this.props.name ? `[dashboard:${this.props.name}]` : '[dashboard:widget]'
    // eslint-disable-next-line no-console
    console.error(tag, error, info?.componentStack ?? '')
  }

  render() {
    if (this.state.hasError) {
      const { fallback } = this.props
      if (typeof fallback === 'function') {
        return fallback(this.state.error ?? new Error('Unknown widget error'))
      }
      return fallback
    }
    return this.props.children
  }
}
