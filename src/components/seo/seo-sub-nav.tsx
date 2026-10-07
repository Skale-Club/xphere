'use client'

// SEO sub-sidebar. One section per reachable area (Website, Local SEO,
// Reviews), each with its index page and its items: sites link to their audit,
// locations expand to their pages (Rankings, Trends, ...) like agents do in
// the Agents sub-sidebar. Sections the user can't reach are never passed in.

import * as React from 'react'
import Link from 'next/link'
import {
  ChevronRight,
  FileText,
  Globe,
  LayoutGrid,
  Link2,
  MapPin,
  Plus,
  Star,
  type LucideIcon,
} from 'lucide-react'

import { TreeNavChildLinks } from '@/components/layout/draggable-tree-nav'
import { useSubSidebar } from '@/components/layout/sub-sidebar'
import { AddLocationDialog } from '@/components/local-seo/add-location-dialog'
import { LOCATION_PAGES } from '@/components/local-seo/location-pages'
import { AddSiteDialog } from '@/components/seo/add-site-dialog'
import { scoreTone } from '@/components/seo/score-badge'
import { usePathname } from '@/lib/org/navigation'
import { cn } from '@/lib/utils'
import type { SeoSection } from '@/lib/seo/sections'

export type SeoNavSite = { id: string; name: string; score: number | null }
export type SeoNavLocation = { id: string; name: string; isActive: boolean; openAlerts: number }

type Props = {
  sections: SeoSection['key'][]
  sites: SeoNavSite[]
  locations: SeoNavLocation[]
  canManageSites: boolean
  canManageLocations: boolean
}

const TONE_DOT = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  muted: 'bg-text-tertiary/50',
} as const

function isActivePath(pathname: string, href: string, exact?: boolean) {
  return exact ? pathname === href : pathname === href || pathname.startsWith(href + '/')
}

const rowClass = (active: boolean) =>
  cn(
    'group relative flex min-w-0 items-center gap-2.5 rounded-[7px] px-2.5 py-1.5 text-[12.5px] transition-colors',
    active ? 'bg-accent/10 text-text-primary' : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary',
  )

function ActiveBar() {
  return <span className="absolute left-0 top-1/2 h-[60%] w-[2.5px] -translate-y-1/2 rounded-r-full bg-accent" />
}

function NavLink({ href, label, icon: Icon, exact, trailing }: { href: string; label: string; icon: LucideIcon; exact?: boolean; trailing?: React.ReactNode }) {
  const pathname = usePathname()
  const { onNavigate } = useSubSidebar()
  const active = isActivePath(pathname, href, exact)
  return (
    <Link href={href} onClick={onNavigate} className={rowClass(active)} aria-current={active ? 'page' : undefined}>
      {active && <ActiveBar />}
      <Icon className={cn('h-3.5 w-3.5 shrink-0', active ? 'text-accent' : 'text-text-tertiary')} />
      <span className="truncate font-medium">{label}</span>
      {trailing}
    </Link>
  )
}

function Section({ heading, action, children }: { heading: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex h-6 items-center justify-between pl-2 pr-1">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-text-tertiary">{heading}</span>
        {action}
      </div>
      <div className="flex flex-col gap-px">{children}</div>
    </div>
  )
}

/** "+" next to a section heading; used as a dialog trigger, so it forwards props. */
function HeadingAddButton({ label, ...props }: React.ComponentProps<'button'> & { label: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      {...props}
      className="flex h-5 w-5 items-center justify-center rounded-[5px] text-text-tertiary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
    >
      <Plus className="h-3.5 w-3.5" />
    </button>
  )
}

function LocationRow({ location }: { location: SeoNavLocation }) {
  const pathname = usePathname()
  const { onNavigate } = useSubSidebar()
  const base = `/seo/local/${location.id}`
  const inside = isActivePath(pathname, base)
  const [open, setOpen] = React.useState(inside)
  // Opening a location from elsewhere (cards, notifications) reveals its pages.
  React.useEffect(() => {
    if (inside) setOpen(true)
  }, [inside])

  return (
    <div>
      <div className={cn(rowClass(inside && !open), 'pr-1.5')}>
        {inside && !open && <ActiveBar />}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? `Collapse ${location.name}` : `Expand ${location.name}`}
          aria-expanded={open}
          className="-ml-1 flex h-4 w-4 shrink-0 items-center justify-center rounded text-text-tertiary hover:text-text-primary"
        >
          <ChevronRight className={cn('h-3 w-3 transition-transform', open && 'rotate-90')} />
        </button>
        <Link
          href={base}
          onClick={() => {
            setOpen(true)
            onNavigate?.()
          }}
          className={cn('min-w-0 flex-1 truncate font-medium', !location.isActive && 'text-text-tertiary')}
          title={location.name}
        >
          {location.name}
        </Link>
        {location.openAlerts > 0 && (
          <span
            className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-warning/15 px-1 text-[10px] font-semibold text-warning"
            title={`${location.openAlerts} open alert${location.openAlerts === 1 ? '' : 's'}`}
          >
            {location.openAlerts}
          </span>
        )}
      </div>
      {open && (
        <TreeNavChildLinks
          className="ml-[18px] mt-px"
          links={LOCATION_PAGES.map((p) => ({
            label: p.label,
            href: p.segment ? `${base}/${p.segment}` : base,
            icon: <p.icon className="h-3 w-3" />,
            exact: p.segment === '',
          }))}
        />
      )}
    </div>
  )
}

export function SeoSubNav({ sections, sites, locations, canManageSites, canManageLocations }: Props) {
  const has = (k: SeoSection['key']) => sections.includes(k)

  return (
    <nav className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 py-3" aria-label="SEO">
      {has('website') && (
        <Section
          heading="Website"
          action={canManageSites ? <AddSiteDialog trigger={<HeadingAddButton label="Add site" />} /> : undefined}
        >
          <NavLink href="/seo/website" label="All sites" icon={LayoutGrid} exact />
          {sites.map((s) => (
            <NavLink
              key={s.id}
              href={`/seo/website/${s.id}`}
              label={s.name}
              icon={Globe}
              trailing={
                <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[11px] tabular-nums text-text-tertiary">
                  <span className={cn('h-1.5 w-1.5 rounded-full', TONE_DOT[scoreTone(s.score)])} />
                  {s.score ?? '—'}
                </span>
              }
            />
          ))}
        </Section>
      )}

      {has('local') && (
        <Section
          heading="Local SEO"
          action={canManageLocations ? <AddLocationDialog trigger={<HeadingAddButton label="Add location" />} /> : undefined}
        >
          <NavLink href="/seo/local" label="All locations" icon={MapPin} exact />
          {locations.map((l) => (
            <LocationRow key={l.id} location={l} />
          ))}
          {has('reports') && <NavLink href="/seo/reports" label="Reports" icon={FileText} />}
        </Section>
      )}

      {has('reviews') && (
        <Section heading="Reviews">
          <NavLink href="/seo/reviews" label="Review widget" icon={Star} exact />
          <NavLink href="/seo/reviews/review-link" label="Review link" icon={Link2} />
        </Section>
      )}
    </nav>
  )
}

const RAIL_ITEMS: { key: SeoSection['key']; href: string; label: string; icon: LucideIcon }[] = [
  { key: 'website', href: '/seo/website', label: 'Website', icon: Globe },
  { key: 'local', href: '/seo/local', label: 'Local SEO', icon: MapPin },
  { key: 'reports', href: '/seo/reports', label: 'Reports', icon: FileText },
  { key: 'reviews', href: '/seo/reviews', label: 'Reviews', icon: Star },
]

/** Icon rail shown while the sub-sidebar is collapsed. */
export function SeoSubNavCollapsed({ sections }: { sections: SeoSection['key'][] }) {
  const pathname = usePathname()
  return (
    <div className="flex flex-col items-center gap-1.5">
      {RAIL_ITEMS.filter((i) => sections.includes(i.key)).map((item) => {
        const Icon = item.icon
        const active = isActivePath(pathname, item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            title={item.label}
            aria-label={item.label}
            className={cn(
              'flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors',
              active ? 'bg-accent/10 text-accent' : 'text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </Link>
        )
      })}
    </div>
  )
}
