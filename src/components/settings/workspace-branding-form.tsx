'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, Loader2, Upload } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { APP_NAME } from '@/lib/config'
import { DEFAULT_ACCENT, deriveAccentHover, hexToRgba } from '@/lib/branding'
import { updateWorkspaceBranding } from '@/app/(dashboard)/settings/workspace/actions'

interface OrgBrandingShape {
  id: string
  name: string
  logo_url: string | null
  accent_color: string | null
  brand_name: string | null
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
  const [logoUrl, setLogoUrl] = React.useState(org.logo_url ?? '')
  const [accent, setAccent] = React.useState(org.accent_color ?? DEFAULT_ACCENT)
  const [accentInput, setAccentInput] = React.useState(org.accent_color ?? DEFAULT_ACCENT)
  const [brandName, setBrandName] = React.useState(org.brand_name ?? '')
  const [saving, setSaving] = React.useState(false)
  const [savedAt, setSavedAt] = React.useState<number | null>(null)
  const [, force] = React.useReducer((x: number) => x + 1, 0)

  // Re-render every 10s for "saved Xs ago" timer.
  React.useEffect(() => {
    if (!savedAt) return
    const id = window.setInterval(force, 10_000)
    return () => window.clearInterval(id)
  }, [savedAt])

  // Dirty detection.
  const dirty =
    (logoUrl || '') !== (org.logo_url ?? '') ||
    accent !== (org.accent_color ?? DEFAULT_ACCENT) ||
    (brandName || '') !== (org.brand_name ?? '')

  async function handleSave(e?: React.FormEvent) {
    e?.preventDefault()
    if (!HEX_RE.test(accentInput)) {
      toast.error('Accent color must be a 6-digit hex like #6366F1')
      return
    }
    setSaving(true)
    const result = await updateWorkspaceBranding({
      logo_url: logoUrl.trim() || null,
      accent_color: accentInput,
      brand_name: brandName.trim() || null,
    })
    setSaving(false)
    if (!result.ok) {
      toast.error(result.error ?? 'Failed to save')
      return
    }
    setAccent(accentInput)
    setSavedAt(Date.now())
    toast.success('Branding saved', {
      description: 'Your workspace looks fresh.',
    })
    // Refresh server components so the sidebar/branding apply instantly.
    router.refresh()
  }

  const savedLabel = savedAt ? `Saved ${formatAgo(Date.now() - savedAt)}` : null

  // Live preview values.
  const previewAccent = HEX_RE.test(accentInput) ? accentInput : DEFAULT_ACCENT
  const previewHover = deriveAccentHover(previewAccent)
  const previewMuted = hexToRgba(previewAccent, 0.12)
  const previewBrand = brandName.trim() || APP_NAME

  return (
    <form onSubmit={handleSave} className="space-y-4">
      {/* Logo */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle>Logo</CardTitle>
            <CardDescription>
              Square image, ideally 256×256 PNG or SVG. Paste a URL — uploads coming soon.
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

      {/* Brand name */}
      <Card>
        <CardHeader>
          <CardTitle>Brand name</CardTitle>
          <CardDescription>Optional white-label override. Replaces &quot;{APP_NAME}&quot; in the sidebar.</CardDescription>
        </CardHeader>
        <CardContent>
          <Input
            value={brandName}
            onChange={(e) => setBrandName(e.target.value)}
            placeholder={APP_NAME}
            maxLength={64}
            className="max-w-md"
          />
        </CardContent>
      </Card>

      {/* Live preview */}
      <Card>
        <CardHeader>
          <CardTitle>Live preview</CardTitle>
          <CardDescription>How your dashboard chrome will look with these changes.</CardDescription>
        </CardHeader>
        <CardContent>
          <div
            className="rounded-[12px] border border-border bg-bg-primary p-4"
            style={{
              ['--preview-accent' as string]: previewAccent,
              ['--preview-accent-hover' as string]: previewHover,
              ['--preview-accent-muted' as string]: previewMuted,
            }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoUrl} alt="" className="h-6 w-6 rounded-[7px] object-cover ring-1 ring-border-subtle" />
                ) : (
                  <div
                    className="h-6 w-6 rounded-[7px] flex items-center justify-center"
                    style={{ background: `linear-gradient(135deg, ${previewAccent}, ${previewHover})` }}
                  >
                    <span className="text-[11px] font-bold text-white tracking-tighter">
                      {previewBrand.charAt(0).toUpperCase()}
                    </span>
                  </div>
                )}
                <span className="text-[13.5px] font-semibold text-text-primary">{previewBrand}</span>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className="text-[12px] font-medium px-2 py-1 rounded-[6px]"
                  style={{ background: previewMuted, color: previewAccent }}
                >
                  Active
                </span>
                <button
                  type="button"
                  className="text-[12px] font-medium px-3 py-1.5 rounded-[8px] text-white"
                  style={{ backgroundColor: previewAccent }}
                  onMouseDown={(e) => (e.currentTarget.style.backgroundColor = previewHover)}
                  onMouseUp={(e) => (e.currentTarget.style.backgroundColor = previewAccent)}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = previewAccent)}
                >
                  Primary CTA
                </button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-3">
        {savedLabel && (
          <span className="text-[12px] text-text-tertiary">
            <Check className="inline h-3 w-3 text-success mr-1" /> {savedLabel}
          </span>
        )}
        <Button type="submit" disabled={!dirty || saving}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Save changes
        </Button>
      </div>
    </form>
  )
}
