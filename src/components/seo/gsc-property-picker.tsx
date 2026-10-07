'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { listGscPropertiesForSite, setGscProperty, type GscPropertyOptions } from '@/app/(dashboard)/seo/website/actions'

/** Pick which Search Console property feeds this site (Domain or URL-prefix). */
export function GscPropertyPicker({ siteId, current }: { siteId: string; current: string | null }) {
  const router = useRouter()
  const [options, setOptions] = useState<GscPropertyOptions | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [value, setValue] = useState<string>(current ?? '')
  const [saving, startSave] = useTransition()

  useEffect(() => {
    let cancelled = false
    listGscPropertiesForSite(siteId).then((res) => {
      if (cancelled) return
      if (!res.ok) return setLoadError(res.error)
      setOptions(res.data)
      if (!current && res.data.suggested) setValue(res.data.suggested)
    })
    return () => {
      cancelled = true
    }
  }, [siteId, current])

  function save(next: string | null) {
    startSave(async () => {
      const res = await setGscProperty(siteId, next)
      if (!res.ok) return void toast.error(res.error)
      toast.success(next ? 'Property linked — importing data now' : 'Property unlinked')
      router.refresh()
    })
  }

  if (loadError) return <p className="text-sm text-danger">{loadError}</p>
  if (!options) {
    return (
      <p className="flex items-center gap-2 text-sm text-text-tertiary">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading your Search Console properties…
      </p>
    )
  }
  if (!options.properties.length) {
    return (
      <p className="text-sm text-text-secondary">
        The connected Google account has no verified Search Console properties. Add and verify the site in Search Console
        (a Domain property is best), or reconnect with an account that has access.
      </p>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger className="w-[320px]">
          <SelectValue placeholder="Choose a property" />
        </SelectTrigger>
        <SelectContent>
          {options.properties.map((p) => (
            <SelectItem key={p.siteUrl} value={p.siteUrl}>
              {p.siteUrl}
              {p.siteUrl === options.suggested ? ' (matches this site)' : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button size="sm" disabled={!value || value === current || saving} onClick={() => save(value)}>
        {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
        {current ? 'Change property' : 'Link property'}
      </Button>
      {current && (
        <Button size="sm" variant="ghost" disabled={saving} onClick={() => save(null)}>
          Unlink
        </Button>
      )}
    </div>
  )
}
