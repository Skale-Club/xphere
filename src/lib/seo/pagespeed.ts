// Core Web Vitals via the PageSpeed Insights API (mobile strategy).
//
// GOOGLE_PSI_API_KEY is optional: PSI works without a key but shares a tiny
// anonymous quota, so production should set one (25k requests/day free).
// A PSI run takes 10–40s, which is why the audit calls it once, in parallel,
// at finalisation — never per crawled page.

import type { CoreWebVitals } from './checks/site'

const ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed'

interface PsiResponse {
  loadingExperience?: {
    overall_category?: string
    metrics?: Record<string, { percentile?: number; category?: string }>
  }
  lighthouseResult?: {
    categories?: { performance?: { score?: number | null } }
    audits?: Record<string, { numericValue?: number }>
  }
  error?: { message?: string }
}

export async function runPageSpeed(url: string, timeoutMs: number): Promise<CoreWebVitals> {
  const params = new URLSearchParams({ url, strategy: 'mobile', category: 'performance' })
  const key = process.env.GOOGLE_PSI_API_KEY
  if (key) params.set('key', key)

  try {
    const res = await fetch(`${ENDPOINT}?${params}`, { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' })
    const json = (await res.json().catch(() => ({}))) as PsiResponse
    if (!res.ok) return emptyVitals(url, json.error?.message ?? `PSI HTTP ${res.status}`)
    return parsePageSpeed(url, json)
  } catch (err) {
    const name = (err as Error)?.name
    return emptyVitals(url, name === 'TimeoutError' || name === 'AbortError' ? 'PSI timed out' : String(err))
  }
}

export function parsePageSpeed(url: string, json: PsiResponse): CoreWebVitals {
  const field = json.loadingExperience?.metrics ?? {}
  const audits = json.lighthouseResult?.audits ?? {}
  const perf = json.lighthouseResult?.categories?.performance?.score
  const num = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

  return {
    url,
    performance: typeof perf === 'number' ? Math.round(perf * 100) : null,
    // Prefer real-user (CrUX) data; fall back to the lab run.
    lcpMs: num(field.LARGEST_CONTENTFUL_PAINT_MS?.percentile) ?? roundOrNull(num(audits['largest-contentful-paint']?.numericValue)),
    cls:
      field.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile !== undefined
        ? field.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100
        : num(audits['cumulative-layout-shift']?.numericValue),
    inpMs: num(field.INTERACTION_TO_NEXT_PAINT?.percentile),
    fieldCategory: json.loadingExperience?.overall_category ?? null,
  }
}

function roundOrNull(v: number | null) {
  return v === null ? null : Math.round(v)
}

function emptyVitals(url: string, error: string): CoreWebVitals {
  return { url, performance: null, lcpMs: null, cls: null, inpMs: null, fieldCategory: null, error }
}
