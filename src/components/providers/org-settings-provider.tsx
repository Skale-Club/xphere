'use client'

/**
 * Makes the org's timezone + currency available to client components so their
 * date/money formatting matches what server components render (the org is the
 * source of truth, not the viewer's browser zone). Mounted once in the
 * dashboard layout with values resolved server-side via getOrgSettings.
 *
 * Usage:
 *   const { timezone, currency } = useOrgSettings()
 *   formatDateTime(iso, timezone)   // from @/lib/datetime
 *   formatCurrency(value, currency) // from @/lib/pipeline/format
 */

import * as React from 'react'

export interface OrgSettingsClient {
  timezone: string
  currency: string
}

const DEFAULT: OrgSettingsClient = { timezone: 'UTC', currency: 'USD' }

const OrgSettingsContext = React.createContext<OrgSettingsClient>(DEFAULT)

export function OrgSettingsProvider({
  value,
  children,
}: {
  value: OrgSettingsClient
  children: React.ReactNode
}) {
  return <OrgSettingsContext.Provider value={value}>{children}</OrgSettingsContext.Provider>
}

export function useOrgSettings(): OrgSettingsClient {
  return React.useContext(OrgSettingsContext)
}
