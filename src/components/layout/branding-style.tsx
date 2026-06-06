import { DEFAULT_ACCENT, deriveAccentHover, deriveAccentSoft, hexToRgba, type OrgBranding } from '@/lib/branding'

interface BrandingStyleProps {
  branding: OrgBranding
}

/**
 * Injects a tiny <style> tag that overrides the design-system accent
 * tokens when the active org has a custom accent_color. Rendered inside
 * the dashboard layout so changes apply instantly without reload.
 *
 * Falls back to a no-op when the org uses the default accent.
 */
export function BrandingStyle({ branding }: BrandingStyleProps) {
  if (branding.accent === DEFAULT_ACCENT) return null
  const accent = branding.accent
  const hover = deriveAccentHover(accent)
  const soft = deriveAccentSoft(accent)
  const muted = hexToRgba(accent, 0.08)
  const glow = hexToRgba(accent, 0.2)
  const ring = hexToRgba(accent, 0.35)

  const css = `:root, .dark {
  --accent: ${accent};
  --accent-hover: ${hover};
  --accent-soft: ${soft};
  --accent-muted: ${muted};
  --accent-glow: ${glow};
  --ring: ${accent};
  --shadow-glow: 0 0 24px ${glow}, 0 0 0 1px ${ring};
}`
  return <style id="org-branding" dangerouslySetInnerHTML={{ __html: css }} />
}
