export type BookingLinkSource =
  | 'link'       // <a href>
  | 'iframe'     // <iframe src|data-src>
  | 'form'       // <form action>
  | 'script'     // <script src>
  | 'link_tag'   // <link href> (preconnect, prefetch, stylesheet...)
  | 'attribute'  // data-* / onclick / formaction carrying a URL
  | 'text'       // URL found anywhere in the raw HTML (inline scripts, JSON blobs, JSON-LD)
  | 'marker'     // platform widget marker with no URL of its own (Wix Bookings)
export type BookingMode = 'third_party' | 'on_site' | 'external_unknown' | 'none'

export interface BookingCandidate {
  url: string
  label?: string
  source: BookingLinkSource
  /** Pre-resolved provider, for markers that carry no provider domain. */
  provider?: string
}

export interface BookingLink {
  url: string
  label: string | null
  source: BookingLinkSource
  provider: string
  mode: Exclude<BookingMode, 'none'>
}

export interface BookingDiscovery {
  detected: boolean
  mode: BookingMode
  primaryProvider: string | null
  primaryUrl: string | null
  platforms: string[]
  links: BookingLink[]
  /** Internal booking page that was fetched (one hop) to look for a provider, if any. */
  followedUrl?: string | null
}

export interface ProviderDefinition {
  name: string
  domains: string[]
  /**
   * The domain also serves non-booking products (Square Online stores and
   * payment SDKs), so a link there only counts when it looks like a booking
   * link: booking wording in the label or a /book, /appointments... path.
   */
  needsBookingIntent?: boolean
}

/** Provider shown for booking pages hosted on the shop's own site (not a vendor). */
export const WEBSITE_BOOKING_PROVIDER = 'Website booking'
/** Provider for an off-site booking CTA whose destination is not a known vendor. */
export const UNKNOWN_BOOKING_PROVIDER = 'unknown'
export const WIX_BOOKINGS_PROVIDER = 'Wix Bookings'

/** THE booking provider list. Extend here only; discovery and HTML collection both read it. */
export const BOOKING_PROVIDERS: ProviderDefinition[] = [
  { domains: ['booksy.com', 'booksy.net'], name: 'Booksy' },
  { domains: ['thecut.co'], name: 'TheCut' },
  { domains: ['getsquire.com', 'squire.app'], name: 'Squire' },
  { domains: ['glossgenius.com'], name: 'GlossGenius' },
  { domains: ['vagaro.com'], name: 'Vagaro' },
  { domains: ['fresha.com'], name: 'Fresha' },
  { domains: ['styleseat.com'], name: 'StyleSeat' },
  { domains: ['schedulicity.com'], name: 'Schedulicity' },
  { domains: ['setmore.com'], name: 'Setmore' },
  { domains: ['acuityscheduling.com', 'as.me'], name: 'Acuity Scheduling' },
  { domains: ['squarespacescheduling.com'], name: 'Squarespace Scheduling' },
  { domains: ['mindbodyonline.com', 'mindbody.io'], name: 'Mindbody' },
  { domains: ['simplybook.me', 'simplybook.it'], name: 'SimplyBook.me' },
  { domains: ['appointy.com'], name: 'Appointy' },
  { domains: ['mytime.com'], name: 'MyTime' },
  { domains: ['phorest.com'], name: 'Phorest' },
  { domains: ['joinblvd.com', 'boulevard.io'], name: 'Boulevard' },
  { domains: ['meevo.com'], name: 'Meevo' },
  { domains: ['zenoti.com'], name: 'Zenoti' },
  { domains: ['salonized.com'], name: 'Salonized' },
  { domains: ['mangomint.com'], name: 'Mangomint' },
  { domains: ['gettimely.com'], name: 'Timely' },
  { domains: ['booker.com', 'mybooker.com'], name: 'Booker' },
  { domains: ['genbook.com'], name: 'Genbook' },
  { domains: ['square.site', 'squareup.com'], name: 'Square Appointments', needsBookingIntent: true },
  { domains: ['calendly.com'], name: 'Calendly' },
  { domains: ['cal.com'], name: 'Cal.com' },
  { domains: ['resy.com'], name: 'Resy' },
  { domains: ['opentable.com'], name: 'OpenTable' },
]

const BOOKING_INTENT = /\b(book(?:ing)?|appointment|schedule|reserve|reservation|agendar|agendamento|marcar|marca[cç][aã]o|reservar|cita|reservar cita)\b/i
/** A path segment (or hyphenated part of one) naming booking: /book, /book-online, /online-booking, /booking-calendar, /appointments... */
const BOOKING_PATH = /(?:^|[/-])(?:book(?:ings?)?|appointments?|schedul(?:e|ing)|reserve|reservations?|agendar|agendamento|marcar)(?:[/?#-]|$)/i

/** Markers a Wix Bookings widget leaves in the rendered HTML even when the booking UI is on the shop's own domain. */
const WIX_BOOKINGS_MARKERS = /wix-bookings|wixbookings|bookings\.wixapps|com\.wixpress\.bookings|data-hook="[^"]*bookings?-|"bookingsApp"|wix-?bookings-?widget/i

function normalizedUrl(raw: string, baseUrl: string): URL | null {
  try {
    const parsed = new URL(raw, baseUrl)
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed : null
  } catch {
    return null
  }
}

function normalizedHost(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, '')
}

function providerFor(host: string, hasIntent: boolean): string | null {
  const match = BOOKING_PROVIDERS.find(({ domains }) =>
    domains.some((domain) => host === domain || host.endsWith(`.${domain}`)),
  )
  if (!match) return null
  if (match.needsBookingIntent && !hasIntent) return null
  return match.name
}

function sameSite(left: string, right: string): boolean {
  return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`)
}

/** Sources that only prove a provider by domain (they have no visible label to read intent from). */
const PROVIDER_ONLY_SOURCES: ReadonlySet<BookingLinkSource> = new Set<BookingLinkSource>(['script', 'link_tag', 'text'])

/** Detect a Wix Bookings widget from rendered HTML. Returns a marker candidate for `pageUrl`, or null. */
export function detectWixBookingsMarker(html: string, pageUrl: string): BookingCandidate | null {
  return WIX_BOOKINGS_MARKERS.test(html)
    ? { url: pageUrl, source: 'marker', provider: WIX_BOOKINGS_PROVIDER, label: 'Wix Bookings widget' }
    : null
}

function emptyDiscovery(): BookingDiscovery {
  return { detected: false, mode: 'none', primaryProvider: null, primaryUrl: null, platforms: [], links: [], followedUrl: null }
}

function rank(link: BookingLink): number {
  if (link.mode === 'third_party') return 0
  if (link.mode === 'on_site' && link.provider !== WEBSITE_BOOKING_PROVIDER) return 1 // known on-site platform (Wix Bookings)
  if (link.mode === 'external_unknown') return 2
  return 3
}

function rankedLinks(links: BookingLink[]): BookingLink[] {
  return links
    .map((link, index) => ({ link, index }))
    .sort((a, b) => rank(a.link) - rank(b.link) || a.index - b.index)
    .map(({ link }) => link)
}

function summarize(links: BookingLink[], followedUrl: string | null): BookingDiscovery {
  const primary = links[0] ?? null
  return {
    detected: links.length > 0,
    mode: primary?.mode ?? 'none',
    primaryProvider: primary?.provider ?? null,
    primaryUrl: primary?.url ?? null,
    platforms: [...new Set(links.map((link) => link.provider))],
    links,
    followedUrl,
  }
}

/**
 * Turn raw anchors/iframes/forms/scripts/attributes into factual, deduplicated booking evidence.
 *
 * Biased toward detecting: a false "has booking" costs little, while a false "no online
 * booking" tells a shop owner something untrue about their own site.
 */
export function discoverBooking(pageUrl: string, candidates: BookingCandidate[]): BookingDiscovery {
  const page = normalizedUrl(pageUrl, pageUrl)
  if (!page) return emptyDiscovery()
  const pageHost = normalizedHost(page)
  const seen = new Set<string>()
  const links: BookingLink[] = []

  for (const candidate of candidates) {
    const label = candidate.label?.replace(/\s+/g, ' ').trim() || null

    if (candidate.provider) {
      const key = `${candidate.provider}|${candidate.url}`
      if (seen.has(key)) continue
      seen.add(key)
      links.push({ url: candidate.url, label, source: candidate.source, provider: candidate.provider, mode: 'on_site' })
      continue
    }

    const parsed = normalizedUrl(candidate.url, pageUrl)
    if (!parsed) continue
    const url = parsed.href
    if (seen.has(url)) continue

    const host = normalizedHost(parsed)
    const pathIntent = BOOKING_PATH.test(`${parsed.pathname}${parsed.search}${parsed.hash}`)
    const labelIntent = BOOKING_INTENT.test(label ?? '')
    const hasIntent = labelIntent || pathIntent
    const knownProvider = providerFor(host, hasIntent)
    if (PROVIDER_ONLY_SOURCES.has(candidate.source) && !knownProvider) continue

    const isOwnSite = sameSite(pageHost, host)
    // data-* / onclick URLs are noisy (images, trackers): off-site unknowns need the label to ask for booking.
    const intentCounts = candidate.source === 'attribute' && !isOwnSite ? labelIntent : hasIntent
    if (!knownProvider && !intentCounts) continue

    const mode: BookingLink['mode'] = knownProvider
      ? 'third_party'
      : isOwnSite
        ? 'on_site'
        : 'external_unknown'
    links.push({
      url,
      label,
      source: candidate.source,
      provider: knownProvider ?? (isOwnSite ? WEBSITE_BOOKING_PROVIDER : UNKNOWN_BOOKING_PROVIDER),
      mode,
    })
    seen.add(url)
  }

  // Rank BEFORE capping: pages repeat "Book" links in header, mobile nav and footer, and a
  // cap applied in document order would drop a provider link that appears after them.
  return summarize(rankedLinks(links).slice(0, 10), null)
}

/**
 * The single internal booking page worth fetching, or null.
 * Only when nothing better than "a link to our own /book" was found: a known provider or an
 * off-site CTA already answers the question, so no second request is spent.
 */
export function pickInternalBookingHop(pageUrl: string, booking: BookingDiscovery): string | null {
  if (booking.mode !== 'on_site') return null
  const page = normalizedUrl(pageUrl, pageUrl)
  if (!page) return null
  const stripped = (u: URL) => `${u.origin}${u.pathname.replace(/\/$/, '')}${u.search}`
  const hop = booking.links.find((link) => {
    if (link.mode !== 'on_site' || link.provider !== WEBSITE_BOOKING_PROVIDER) return false
    const parsed = normalizedUrl(link.url, pageUrl)
    if (!parsed) return false
    if (/\.(?:pdf|jpe?g|png|gif|webp|zip|docx?)$/i.test(parsed.pathname)) return false
    return stripped(parsed) !== stripped(page)
  })
  return hop?.url ?? null
}

/**
 * Fold what the internal booking page revealed into the first-page result.
 * A vendor / off-site destination found there becomes the primary; otherwise the original
 * on_site result stands (the shop does point at a booking page, we just could not see more).
 */
export function mergeHopBooking(first: BookingDiscovery, hopUrl: string, hop: BookingDiscovery): BookingDiscovery {
  const better = hop.links.filter((link) => link.mode !== 'on_site' || link.provider !== WEBSITE_BOOKING_PROVIDER)
  if (better.length === 0) return { ...first, followedUrl: hopUrl }
  const merged = rankedLinks([...better, ...first.links])
    .filter((link, i, all) => all.findIndex((other) => other.url === link.url && other.provider === link.provider) === i)
    .slice(0, 10)
  return summarize(merged, hopUrl)
}
