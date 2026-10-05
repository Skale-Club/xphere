// Pull the SEO-relevant facts out of one HTML document. Pure: HTML + URL in,
// plain object out, so every check can be tested against a fixture.

import { createHash } from 'node:crypto'
import * as cheerio from 'cheerio'
import { isSameSite, looksLikePage, normalizeUrl } from './url'

export interface ExtractedPage {
  title: string | null
  metaDescription: string | null
  h1Count: number
  h1: string | null
  canonical: string | null
  /** From <meta name="robots|googlebot"> and the X-Robots-Tag header. */
  noindex: boolean
  nofollow: boolean
  lang: string | null
  hasViewport: boolean
  hasOpenGraph: boolean
  hasTwitterCard: boolean
  hasStructuredData: boolean
  imagesTotal: number
  imagesMissingAlt: number
  /** http:// subresources on an https page. */
  mixedContent: string[]
  wordCount: number
  /** Hash of the normalised visible text, for duplicate-content detection. */
  contentHash: string | null
  /** Normalised same-site page links (deduplicated, nofollow links excluded). */
  internalLinks: string[]
  externalLinkCount: number
}

const MAX_INTERNAL_LINKS = 500
const MAX_MIXED_CONTENT = 20

export function extractPage(html: string, pageUrl: string, headers: Record<string, string> = {}): ExtractedPage {
  const $ = cheerio.load(html)
  const page = new URL(pageUrl)

  const text = (v: string | undefined) => {
    const t = (v ?? '').replace(/\s+/g, ' ').trim()
    return t || null
  }

  const title = text($('head > title').first().text() || $('title').first().text())
  const metaDescription = text($('meta[name="description" i]').first().attr('content'))

  const h1s = $('h1')
  const canonicalHref = $('link[rel~="canonical" i]').first().attr('href')
  const canonical = canonicalHref ? normalizeUrl(canonicalHref, page) : null

  const robotsDirectives = [
    ...$('meta[name="robots" i], meta[name="googlebot" i]')
      .map((_, el) => $(el).attr('content') ?? '')
      .get(),
    headers['x-robots-tag'] ?? '',
  ]
    .join(',')
    .toLowerCase()
  const noindex = /\b(noindex|none)\b/.test(robotsDirectives)
  const nofollow = /\b(nofollow|none)\b/.test(robotsDirectives)

  const images = $('img')
  let imagesMissingAlt = 0
  images.each((_, el) => {
    // alt="" is valid for decorative images; only a missing attribute is an issue.
    if ($(el).attr('alt') === undefined) imagesMissingAlt++
  })

  const mixedContent: string[] = []
  if (page.protocol === 'https:') {
    $('img[src], script[src], iframe[src], audio[src], video[src], source[src], link[rel~="stylesheet" i][href]').each(
      (_, el) => {
        const ref = $(el).attr('src') ?? $(el).attr('href') ?? ''
        if (/^http:\/\//i.test(ref.trim()) && mixedContent.length < MAX_MIXED_CONTENT) mixedContent.push(ref.trim())
      },
    )
  }

  const internal = new Set<string>()
  let externalLinkCount = 0
  const baseHref = $('base[href]').first().attr('href')
  const base = baseHref ? safeUrl(baseHref, page) ?? page : page
  $('a[href]').each((_, el) => {
    const href = ($(el).attr('href') ?? '').trim()
    if (!href || href.startsWith('#') || /^(mailto|tel|javascript|data|sms):/i.test(href)) return
    const normalized = normalizeUrl(href, base)
    if (!normalized) return
    if (!isSameSite(normalized, page.hostname)) {
      externalLinkCount++
      return
    }
    if (/\bnofollow\b/i.test($(el).attr('rel') ?? '')) return
    if (!looksLikePage(normalized) || internal.size >= MAX_INTERNAL_LINKS) return
    internal.add(normalized)
  })

  // Read before the strip below removes <script type="application/ld+json">.
  const hasStructuredData = $('script[type="application/ld+json" i]').length > 0 || $('[itemscope]').length > 0

  // Visible text: drop non-content elements before counting words.
  $('script, style, noscript, template, svg, iframe').remove()
  const bodyText = ($('body').text() || $.root().text()).replace(/\s+/g, ' ').trim()
  const words = bodyText ? bodyText.split(' ').filter((w) => /[\p{L}\p{N}]/u.test(w)) : []
  const contentHash =
    words.length >= 50 ? createHash('sha1').update(words.join(' ').toLowerCase()).digest('hex') : null

  return {
    title,
    metaDescription,
    h1Count: h1s.length,
    h1: text(h1s.first().text()),
    canonical,
    noindex,
    nofollow,
    lang: text($('html').attr('lang')),
    hasViewport: $('meta[name="viewport" i]').length > 0,
    hasOpenGraph: $('meta[property^="og:" i]').length > 0,
    hasTwitterCard: $('meta[name^="twitter:" i]').length > 0,
    hasStructuredData,
    imagesTotal: images.length,
    imagesMissingAlt,
    mixedContent,
    wordCount: words.length,
    contentHash,
    internalLinks: nofollow ? [] : [...internal],
    externalLinkCount,
  }
}

function safeUrl(raw: string, base: URL): URL | null {
  try {
    return new URL(raw, base)
  } catch {
    return null
  }
}
