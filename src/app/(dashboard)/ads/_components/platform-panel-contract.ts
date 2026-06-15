// src/app/(dashboard)/ads/_components/platform-panel-contract.ts
//
// Ads Platform Panel Contract — Project 3 (Ads Platform Unification), item S5.
//
// Single source of truth for what an ad-platform panel (Meta, Google, and any
// future TikTok / LinkedIn surface) shares. Codifies the unified foundation so
// date filters, saved-view persistence and presets are built once — in
// `AdsDateFilter` + `ads-date-filter.utils.ts` — and reused everywhere instead
// of drifting per platform.
//
// To add a new platform:
//   1. Add its key to `AD_PLATFORMS` below (the `AdsPlatform` union updates).
//   2. Render `<AdsDateFilter platform="<key>" … />` in its overview.
//   3. Saved views then persist automatically under `xphere:ads_view_<key>`.

import type { DateFilter } from './ads-date-filter.utils'

/** Canonical list of ad platforms on the unified panel. Order = display order. */
export const AD_PLATFORMS = ['meta', 'google'] as const

/** A platform key that has adopted the unified ads panel contract. */
export type AdsPlatform = (typeof AD_PLATFORMS)[number]

/** localStorage key under which a platform persists its saved date view. */
export const adsViewStorageKey = (platform: AdsPlatform) =>
  `xphere:ads_view_${platform}` as const

/**
 * Contract every ad-platform overview honours for date filtering.
 *
 * `AdsDateFilter` is the enforcement point: it accepts only an `AdsPlatform`
 * and owns the presets (`PRESET_LABELS` / `QUICK_PRESETS` / `MORE_PRESETS`) plus
 * the saved-view round-trip, so Meta and Google cannot drift apart on filtering.
 */
export interface AdsPlatformPanelProps {
  /** Which platform this panel renders. Drives the saved-view storage key. */
  platform: AdsPlatform
  /** Current date-filter selection, owned by the panel. */
  value: DateFilter
  /** Called when the user picks a preset / custom range / restores a view. */
  onChange: (filter: DateFilter) => void
}
