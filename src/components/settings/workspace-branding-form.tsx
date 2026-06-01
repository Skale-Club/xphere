'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, Loader2, Upload } from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { DEFAULT_ACCENT } from '@/lib/branding'
import { useWorkspaceSaveSection } from '@/components/settings/workspace-save-bar'
import { updateWorkspaceBranding, updateDailyCostCap } from '@/app/(dashboard)/settings/workspace/actions'

interface OrgBrandingShape {
  id: string
  name: string
  logo_url: string | null
  accent_color: string | null
  brand_name: string | null
  daily_cost_cap_usd: number | null
}

interface Props {
  org: OrgBrandingShape
}

const PRESET_COLORS: string[] = [
  '#6366F1', // indigo (default)
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#EF4444', // red
  '#F59E0B', // amber
  '#22C55E', // green
  '#14B8A6', // teal
  '#3B82F6', // blue
  '#0EA5E9', // sky
  '#71717A', // zinc
]

const HEX_RE = /^#[0-9a-fA-F]{6}$/

function formatAgo(ms: number): string {
  if (ms < 5_000) return 'just now'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return `${h}h ago`
}

export function WorkspaceBrandingForm({ org }: Props) {
  const router = useRouter()
  // Baseline = last-saved values; dirty is computed against it so the page
  // save bar disappears right after a successful save.
  const [baseline, setBaseline] = React.useState({
    logo: org.logo_url ?? '',
    accent: org.accent_color ?? DEFAULT_ACCENT,
    cap: org.daily_cost_cap_usd != null ? String(org.daily_cost_cap_usd) : '',
  })
  const [logoUrl, setLogoUrl] = React.useState(baseline.logo)
  const [accentInput, setAccentInput] = React.useState(baseline.accent)
  const [capInput, setCapInput] = React.useState(baseline.cap)
  const [saving, setSaving] = React.useState(false)
  const [savedAt, setSavedAt] = React.useState<number | null>(null)
  const [, force] = React.useReducer((x: number) => x + 1, 0)

  // Re-render every 10s for "saved Xs ago" timer.
  React.useEffect(() => {
    if (!savedAt) return
    const id = window.setInterval(force, 10_000)
    return () => window.clearInterval(id)
  }, [savedAt])

  // Dirty detection across all three controls on this card group.
  const dirty =
    logoUrl !== baseline.logo ||
    accentInput !== baseline.accent ||
    capInput.trim() !== baseline.cap

  async function handleSave(): Promise<boolean> {
    const brandingDirty =
      logoUrl !== baseline.logo || accentInput !== baseline.accent
    const capDirty = capInput.trim() !== baseline.cap

    if (brandingDirty && !HEX_RE.test(accentInput)) {
      toast.error('Accent color must be a 6-digit hex like #6366F1')
      return false
    }

    setSaving(true)
    try {
      if (brandingDirty) {
        const result = await updateWorkspaceBranding({
          logo_url: logoUrl.trim() || null,
          accent_color: accentInput,
        })
        if (!result.ok) {
          toast.error(result.error ?? 'Failed to save')
          return false
        }
      }
      if (capDirty) {
        const val = capInput.trim() === '' ? null : parseFloat(capInput)
        const result = await updateDailyCostCap({ daily_cost_cap_usd: val })
        if (!result.ok) {
          toast.error(result.error ?? 'Failed to save cost cap')
          return false
        }
      }
    } finally {
      setSaving(false)
    }

    setBaseline({ logo: logoUrl, accent: accentInput, cap: capInput.trim() })
    setSavedAt(Date.now())
    toast.success('Workspace settings saved', {
      description: 'Your workspace looks fresh.',
    })
    // Refresh server components so the sidebar/branding apply instantly.
    router.refresh()
    return true
  }

  function handleReset() {
    setLogoUrl(baseline.logo)
    setAccentInput(baseline.accent)
    setCapInput(baseline.cap)
  }

  useWorkspaceSaveSection({
    id: 'workspace-branding',
    dirty,
    save: handleSave,
    reset: handleReset,
  })

  const savedLabel = savedAt ? `Saved ${formatAgo(Date.now() - savedAt)}` : null

  return (
    <div className="space-y-4">
      {/* Logo */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle>Logo</CardTitle>
            <CardDescription>
              Square image, ideally 256×256 PNG or SVG. Paste a URL | uploads coming soon.
            </CardDescription>
          </div>
          {saving && savedLabel === null ? (
            <span className="flex items-center gap-1 text-[11px] text-text-tertiary">
              <Loader2 className="h-3 w-3 animate-spin" /> Saving…
            </span>
          ) : savedLabel ? (
            <span className="flex items-center gap-1 text-[11px] text-text-tertiary">
              <Check className="h-3 w-3 text-success" /> {savedLabel}
            </span>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-[10px] border border-border bg-bg-tertiary overflow-hidden">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="Logo preview" className="h-full w-full object-cover" />
              ) : (
                <Upload className="h-5 w-5 text-text-tertiary" />
              )}
            </div>
            <div className="flex-1">
              <Label htmlFor="logo_url" className="text-[12px] text-text-secondary">Logo URL</Label>
              <Input
                id="logo_url"
                type="url"
                placeholder="https://…/logo.png"
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Accent color */}
      <Card>
        <CardHeader>
          <CardTitle>Accent color</CardTitle>
          <CardDescription>Used for buttons, active states, and highlights across the dashboard.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setAccentInput(c)}
                aria-label={`Pick color ${c}`}
                className={cn(
                  'relative h-8 w-8 rounded-full ring-1 ring-border transition-all duration-150 hover:scale-110',
                  accentInput.toLowerCase() === c.toLowerCase() && 'ring-2 ring-offset-2 ring-offset-bg-secondary',
                )}
                style={{ backgroundColor: c, boxShadow: accentInput.toLowerCase() === c.toLowerCase() ? `0 0 0 2px ${c}` : undefined }}
              >
                {accentInput.toLowerCase() === c.toLowerCase() && (
                  <Check className="absolute inset-0 m-auto h-4 w-4 text-white drop-shadow" />
                )}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 max-w-xs">
            <div
              className="h-9 w-9 shrink-0 rounded-[8px] border border-border"
              style={{ backgroundColor: HEX_RE.test(accentInput) ? accentInput : '#ffffff' }}
            />
            <Input
              value={accentInput}
              onChange={(e) => setAccentInput(e.target.value)}
              placeholder="#6366F1"
              className="font-mono"
              maxLength={7}
            />
          </div>
        </CardContent>
      </Card>

      {/* Daily AI cost cap */}
      <Card>
        <CardHeader>
          <CardTitle>Daily AI cost cap</CardTitle>
          <CardDescription>
            Maximum USD your agents can spend per day. Requests are blocked once the limit is reached. Leave blank to use the platform default.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 max-w-xs">
            <span className="text-text-tertiary text-sm">$</span>
            <Input
              type="number"
              min={0}
              max={10000}
              step={1}
              value={capInput}
              onChange={(e) => setCapInput(e.target.value)}
              placeholder="Platform default"
              className="max-w-[160px]"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
