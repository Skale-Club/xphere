// Page-level checks: everything that can be decided from one fetched URL.
// Runs right after the fetch, so issues appear while the crawl is still going.

import type { ExtractedPage } from '../extract'
import type { IssueFinding } from './catalog'

export const TITLE_MIN = 30
export const TITLE_MAX = 60
export const DESCRIPTION_MIN = 70
export const DESCRIPTION_MAX = 160
export const THIN_CONTENT_WORDS = 300
export const SLOW_TTFB_MS = 800

export interface PageFetchFacts {
  url: string
  /** Fetch failed outright (timeout, connection refused, blocked). */
  error: string | null
  /** Status of the final response, or of the first hop when redirected. */
  httpStatus: number | null
  /** Each 3xx hop status, in order. */
  redirectStatuses: number[]
  ttfbMs: number | null
  isHtml: boolean
  extracted: ExtractedPage | null
}

export function checkPage(page: PageFetchFacts): IssueFinding[] {
  const out: IssueFinding[] = []
  const add = (code: IssueFinding['code'], details?: Record<string, unknown>) =>
    out.push({ code, url: page.url, ...(details ? { details } : {}) })

  if (page.error) {
    add('fetch_failed', { error: page.error })
    return out
  }

  if (page.redirectStatuses.length) {
    if (page.redirectStatuses.length > 1) add('redirect_chain', { hops: page.redirectStatuses.length })
    if (page.redirectStatuses.some((s) => s === 302 || s === 303 || s === 307)) {
      add('redirect_temporary', { statuses: page.redirectStatuses })
    }
    // The redirect target is crawled as its own row; nothing else to check here.
    return out
  }

  const status = page.httpStatus ?? 0
  if (status >= 500) add('http_5xx', { status })
  else if (status >= 400) add('http_4xx', { status })
  if (status !== 200 || !page.isHtml || !page.extracted) return out

  const x = page.extracted
  if (page.ttfbMs !== null && page.ttfbMs > SLOW_TTFB_MS) add('slow_ttfb', { ttfb_ms: page.ttfbMs })
  if (x.mixedContent.length) add('mixed_content', { resources: x.mixedContent })
  if (!x.hasViewport) add('viewport_missing')
  if (!x.lang) add('lang_missing')

  if (!x.title) add('title_missing')
  else if (x.title.length < TITLE_MIN || x.title.length > TITLE_MAX) {
    add('title_length', { length: x.title.length, title: x.title })
  }

  // Content-quality checks only matter for pages meant to rank.
  if (x.noindex) return out

  if (!x.metaDescription) add('meta_description_missing')
  else if (x.metaDescription.length < DESCRIPTION_MIN || x.metaDescription.length > DESCRIPTION_MAX) {
    add('meta_description_length', { length: x.metaDescription.length })
  }

  if (x.h1Count === 0) add('h1_missing')
  else if (x.h1Count > 1) add('h1_multiple', { count: x.h1Count })

  if (!x.canonical) add('canonical_missing')
  else if (x.canonical !== page.url) add('canonical_elsewhere', { canonical: x.canonical })

  if (x.imagesMissingAlt > 0) add('images_missing_alt', { count: x.imagesMissingAlt, total: x.imagesTotal })
  if (x.wordCount < THIN_CONTENT_WORDS) add('thin_content', { words: x.wordCount })
  if (!x.hasOpenGraph && !x.hasTwitterCard) add('social_tags_missing')
  if (!x.hasStructuredData) add('structured_data_missing')

  return out
}
