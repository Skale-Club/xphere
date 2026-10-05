'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Loader2, MapPin, Plus, Search, Star } from 'lucide-react'
import { toast } from 'sonner'

import {
  createLocation,
  searchBusinessCandidates,
  type BusinessCandidate,
} from '@/app/(dashboard)/local-seo/actions'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export function AddLocationDialog({ triggerLabel = 'Add location' }: { triggerLabel?: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [near, setNear] = useState('')
  const [results, setResults] = useState<BusinessCandidate[] | null>(null)
  const [picked, setPicked] = useState<BusinessCandidate | null>(null)
  const [name, setName] = useState('')
  const [language, setLanguage] = useState('en')
  const [country, setCountry] = useState('us')
  const [keywords, setKeywords] = useState('')
  const [searching, startSearch] = useTransition()
  const [saving, startSave] = useTransition()

  function reset() {
    setQuery('')
    setNear('')
    setResults(null)
    setPicked(null)
    setName('')
    setKeywords('')
  }

  function search(e: React.FormEvent) {
    e.preventDefault()
    startSearch(async () => {
      const res = await searchBusinessCandidates({ query, near: near || undefined })
      if ('error' in res) {
        toast.error(res.error)
        return
      }
      setResults(res.results)
    })
  }

  function pick(c: BusinessCandidate) {
    setPicked(c)
    setName(c.title)
    if (c.category && !keywords) setKeywords(c.category.toLowerCase())
  }

  function save() {
    if (!picked) return
    startSave(async () => {
      const res = await createLocation({
        name: name.trim() || picked.title,
        placeId: picked.placeId,
        cid: picked.cid,
        businessName: picked.title,
        address: picked.address,
        lat: picked.lat,
        lng: picked.lng,
        category: picked.category,
        rating: picked.rating,
        reviews: picked.reviews,
        language,
        country,
        keywords: keywords.split(/[\n,]/).map((k) => k.trim()).filter(Boolean),
      })
      if ('error' in res) {
        toast.error(res.error)
        return
      }
      toast.success('Location added')
      setOpen(false)
      reset()
      router.push(`/local-seo/${res.id}`)
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (!v) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{picked ? 'Set up tracking' : 'Find the business'}</DialogTitle>
          <DialogDescription>
            {picked
              ? 'Name the location and list the searches customers use to find it.'
              : 'Search Google Maps by name. The Place ID and coordinates are filled in for you.'}
          </DialogDescription>
        </DialogHeader>

        {!picked ? (
          <div className="space-y-4">
            <form onSubmit={search} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <Input placeholder="Business name" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
              <Input placeholder="City (optional)" value={near} onChange={(e) => setNear(e.target.value)} />
              <Button type="submit" variant="secondary" disabled={searching || query.trim().length < 2}>
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Search
              </Button>
            </form>
            {results !== null && (
              <div className="max-h-80 space-y-1 overflow-y-auto">
                {results.length === 0 && (
                  <p className="py-6 text-center text-sm text-text-secondary">No businesses found. Try adding the city.</p>
                )}
                {results.map((r) => (
                  <button
                    key={r.placeId}
                    type="button"
                    onClick={() => pick(r)}
                    className="flex w-full items-start gap-3 rounded-lg border border-transparent px-3 py-2 text-left hover:border-border hover:bg-bg-tertiary"
                  >
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-text-tertiary" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-text-primary">{r.title}</div>
                      <div className="truncate text-xs text-text-secondary">
                        {[r.category, r.address].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    {r.rating !== null && (
                      <span className="flex shrink-0 items-center gap-1 text-xs text-text-secondary">
                        <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                        {r.rating}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-border-subtle bg-bg-secondary px-3 py-2">
              <div className="text-sm font-medium text-text-primary">{picked.title}</div>
              <div className="text-xs text-text-secondary">{picked.address}</div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ls-name">Location name</Label>
              <Input id="ls-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ls-lang">Search language</Label>
                <Input id="ls-lang" value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="en" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ls-country">Country code</Label>
                <Input id="ls-country" value={country} onChange={(e) => setCountry(e.target.value)} placeholder="us" maxLength={2} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ls-keywords">Keywords</Label>
              <Textarea
                id="ls-keywords"
                rows={4}
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                placeholder={'barber shop\nmens haircut\nbeard trim'}
              />
              <p className="text-xs text-text-tertiary">One per line. You can add more later.</p>
            </div>
          </div>
        )}

        {picked && (
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setPicked(null)} disabled={saving}>
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
            <Button onClick={save} loading={saving}>
              Add location
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
