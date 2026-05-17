/**
 * Per-org branding helpers (SEED-010 R7).
 *
 * Pure utilities only — safe to import from both client and server
 * components. The async `getOrgBranding(...)` server fetcher lives in
 * `@/lib/branding.server`.
 */

import { APP_NAME } from '@/lib/config'

export const DEFAULT_ACCENT = '#6366F1'

export interface OrgBranding {
  /** Resolved brand name — falls back to APP_NAME. */
  appName: string
  /** Raw logo URL or null. */
  logoUrl: string | null
  /** Hex string (6 digits, # prefix). Always defined — defaults applied. */
  accent: string
  /** True if the org has overridden any default. */
  customized: boolean
}

export const DEFAULT_BRANDING: OrgBranding = {
  appName: APP_NAME,
  logoUrl: null,
  accent: DEFAULT_ACCENT,
  customized: false,
}

/**
 * Resolves a branding row (typically from Supabase) with defaults.
 * Pure function — safe everywhere.
 */
export function resolveOrgBranding(row: {
  logo_url?: string | null
  accent_color?: string | null
  brand_name?: string | null
} | null | undefined): OrgBranding {
  if (!row) return DEFAULT_BRANDING

  const accent = typeof row.accent_color === 'string' && /^#[0-9a-f]{6}$/i.test(row.accent_color)
    ? row.accent_color
    : DEFAULT_ACCENT
  const brand = typeof row.brand_name === 'string' && row.brand_name.trim() ? row.brand_name.trim() : APP_NAME
  const logo = typeof row.logo_url === 'string' && row.logo_url.trim() ? row.logo_url.trim() : null

  const customized = accent !== DEFAULT_ACCENT || brand !== APP_NAME || logo !== null
  return { appName: brand, logoUrl: logo, accent, customized }
}

/**
 * Derive a slightly darker hover variant from a hex color. Used to keep
 * the `--accent-hover` token in sync when an org overrides the accent.
 * Simple multiplicative darken — good enough for hover.
 */
export function deriveAccentHover(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const r = Math.max(0, Math.floor(((n >> 16) & 0xff) * 0.85))
  const g = Math.max(0, Math.floor(((n >> 8) & 0xff) * 0.85))
  const b = Math.max(0, Math.floor((n & 0xff) * 0.85))
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

/**
 * Convert a hex color to an rgba string with the given alpha. Used to
 * compute --accent-muted and --accent-glow tokens.
 */
export function hexToRgba(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return `rgba(99,102,241,${alpha})`
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 0xff
  const g = (n >> 8) & 0xff
  const b = n & 0xff
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
