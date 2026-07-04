// Fixed platform conversion events (not admin-editable — see /admin/tracking).
// These track new Xphere org signups, not our tenants' end customers.
export type ConversionEvent = 'sign_up' | 'demo_start' | 'checkout_started' | 'purchase'

declare global {
  interface Window {
    dataLayer?: unknown[]
    fbq?: (...args: unknown[]) => void
  }
}

// Facebook Pixel standard event names where one exists; events with no
// standard match go through fbq('trackCustom', ...) instead.
const FB_STANDARD_EVENT: Partial<Record<ConversionEvent, string>> = {
  sign_up: 'CompleteRegistration',
  checkout_started: 'InitiateCheckout',
  purchase: 'Purchase',
}

/**
 * Pushes a conversion event to GTM's dataLayer and mirrors it to the Facebook
 * Pixel, if either is configured. Safe to call unconditionally from any client
 * component — no-ops during SSR and when no tracking script has loaded.
 */
export function trackEvent(name: ConversionEvent, params?: Record<string, unknown>) {
  if (typeof window === 'undefined') return

  try {
    window.dataLayer = window.dataLayer || []
    window.dataLayer.push({ event: name, ...params })
  } catch {}

  try {
    if (typeof window.fbq === 'function') {
      const standardName = FB_STANDARD_EVENT[name]
      if (standardName) {
        window.fbq('track', standardName, params)
      } else {
        window.fbq('trackCustom', name, params)
      }
    }
  } catch {}
}
