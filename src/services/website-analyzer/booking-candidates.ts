// Collects booking evidence from a rendered page's HTML. Pure (HTML in, candidates out) so it
// can be unit-tested on fixtures; the Playwright extractor only supplies `page.content()`.
//
// cheerio is loaded dynamically, like in extractor.ts, so importing this module never fails
// in a standalone build that lacks it.
import {
  BOOKING_PROVIDERS,
  detectWixBookingsMarker,
  type BookingCandidate,
  type BookingLinkSource,
} from './booking-discovery'

const MAX_CANDIDATES = 1000
const MAX_TEXT_MATCHES = 30
const LABEL_MAX = 160

const providerDomains = BOOKING_PROVIDERS.flatMap(({ domains }) => domains)
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Any http(s) / protocol-relative URL whose host is (a subdomain of) a known provider. */
const PROVIDER_URL_PATTERN = new RegExp(
  `(?:https?:)?//(?:[a-z0-9-]+\\.)*(?:${providerDomains.map(escapeRegExp).join('|')})(?::\\d+)?(?:[/?#][^\\s"'<>\\\\)]*)?`,
  'gi',
)
const ANY_URL_PATTERN = /(?:https?:)?\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?(?:[/?#][^\s"'<>\\)]*)?/gi

/** JSON blobs and inline scripts escape slashes; undo that so URLs match. */
function unescapeJsonUrls(text: string): string {
  return text.replace(/\\u002[fF]/g, '/').replace(/\\\//g, '/').replace(/&amp;/g, '&')
}

function withScheme(url: string): string {
  return url.startsWith('//') ? `https:${url}` : url
}

function cleanLabel(raw: string | undefined | null): string | undefined {
  const label = raw?.replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX)
  return label || undefined
}

/**
 * Collect every place a booking destination can hide:
 * `a[href]`, `iframe[src|data-src]`, `script[src]`, `link[href]`, `form[action]`,
 * `data-*` / `onclick` / `formaction` attributes holding URLs, any provider URL inside inline
 * scripts or JSON blobs, and the Wix Bookings widget marker.
 */
export async function collectBookingCandidates(html: string, pageUrl: string): Promise<BookingCandidate[]> {
  const cheerio = await import('cheerio')
  const $ = cheerio.load(html)
  const candidates: BookingCandidate[] = []
  const add = (url: string | undefined, label: string | undefined, source: BookingLinkSource) => {
    const value = url?.trim()
    if (!value || /^(?:#|javascript:|mailto:|tel:|sms:|data:)/i.test(value)) return
    if (candidates.length < MAX_CANDIDATES) candidates.push({ url: withScheme(value), label, source })
  }

  // Elements that carry visible text we can read booking intent from. Collected first so a
  // labelled "Book Now" is not shadowed by an unlabelled duplicate of the same URL.
  $('a[href], area[href]').each((_, el) => {
    const node = $(el)
    add(node.attr('href'), cleanLabel(node.text()) ?? cleanLabel(node.attr('aria-label')) ?? cleanLabel(node.attr('title')), 'link')
  })
  $('iframe').each((_, el) => {
    const node = $(el)
    const label = cleanLabel(node.attr('title'))
    add(node.attr('src'), label, 'iframe')
    add(node.attr('data-src'), label, 'iframe')
  })
  $('form[action]').each((_, el) => {
    const node = $(el)
    add(node.attr('action'), cleanLabel(node.attr('aria-label')), 'form')
  })
  $('script[src]').each((_, el) => add($(el).attr('src'), undefined, 'script'))
  $('link[href]').each((_, el) => add($(el).attr('href'), undefined, 'link_tag'))

  // data-* / onclick / formaction: buttons that navigate with JS (Squarespace, Wix and Elementor buttons).
  $('*').each((_, el) => {
    const attribs = (el as unknown as { attribs?: Record<string, string> }).attribs
    if (!attribs) return
    const urls: string[] = []
    for (const [name, value] of Object.entries(attribs)) {
      if (!value || !(name.startsWith('data-') || name === 'onclick' || name === 'formaction')) continue
      urls.push(...(unescapeJsonUrls(value).match(ANY_URL_PATTERN) ?? []))
    }
    if (urls.length === 0) return
    const label = cleanLabel($(el).text()) ?? cleanLabel(attribs['aria-label'])
    for (const url of urls) add(url, label, 'attribute')
  })

  // Anything else: provider URLs in inline scripts, JSON state, JSON-LD (ReserveAction), comments.
  const raw = unescapeJsonUrls(html)
  let textMatches = 0
  for (const match of raw.match(PROVIDER_URL_PATTERN) ?? []) {
    if (textMatches++ >= MAX_TEXT_MATCHES) break
    add(match.replace(/[.,;]+$/, ''), undefined, 'text')
  }

  const wix = detectWixBookingsMarker(html, pageUrl)
  if (wix) candidates.push(wix)
  return candidates
}
