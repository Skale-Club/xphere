/**
 * Xphere Reviews Widget — embeddable IIFE bundle.
 *
 * Usage (recommended — iframe):
 *   <iframe src="https://xphere.app/widget/reviews/{token}?layout=grid&min_rating=4"
 *           width="100%" height="640" frameborder="0"></iframe>
 *
 * Or directly inline via the script bundle:
 *   <div id="operator-reviews"
 *        data-token="..."
 *        data-layout="grid"
 *        data-theme="light"
 *        data-min-rating="4"
 *        data-limit="12"></div>
 *   <script src="https://xphere.app/reviews-widget.js" defer></script>
 *
 * Reads its config from either:
 *   1. The query string when running inside an iframe (?token=...&layout=...)
 *   2. The closest [data-token] element on the host page
 */

export {}

interface ApiPayload {
  business: {
    name: string | null
    address: string | null
    averageRating: number | null
    totalReviewsCount: number | null
    lastScrapedAt: string | null
  }
  distribution: { rating: number; count: number }[]
  reviews: ReviewItem[]
  total: number
}

interface ReviewItem {
  id: string
  reviewerName: string | null
  reviewerPhotoUrl: string | null
  reviewerProfileUrl: string | null
  rating: number
  text: string | null
  dateText: string | null
  dateIso: string | null
  isLocalGuide: boolean
  helpfulCount: number
  ownerResponse: string | null
  ownerResponseDate: string | null
  photos: { url: string; width: number | null; height: number | null }[]
}

type Layout = 'grid' | 'list' | 'carousel'
type Theme = 'light' | 'dark'
type Sort = 'recent' | 'rating_high' | 'helpful'

interface WidgetConfig {
  token: string
  layout: Layout
  theme: Theme
  minRating: number
  sort: Sort
  limit: number
  apiBase: string
  showHero: boolean
}

const DEFAULTS: Omit<WidgetConfig, 'token'> = {
  layout: 'grid',
  theme: 'light',
  minRating: 1,
  sort: 'recent',
  limit: 12,
  apiBase: '',
  showHero: true,
}

const CSS = `
:root, .orw-root {
  color-scheme: light dark;
}
.orw-root {
  --orw-bg: #fafaf7;
  --orw-card: #ffffff;
  --orw-text: #18181b;
  --orw-muted: #6b7280;
  --orw-border: rgba(24, 24, 27, 0.10);
  --orw-shadow: 0 10px 30px rgba(24, 24, 27, 0.06);
  --orw-accent: #f59e0b;
  --orw-accent-soft: #fef3c7;
  --orw-radius: 18px;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  color: var(--orw-text);
}
.orw-root[data-theme="dark"] {
  --orw-bg: #0a0a0a;
  --orw-card: #161616;
  --orw-text: #f5f5f4;
  --orw-muted: #a1a1aa;
  --orw-border: rgba(245, 245, 244, 0.10);
  --orw-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
  --orw-accent-soft: rgba(245, 158, 11, 0.18);
}
.orw-root *, .orw-root *::before, .orw-root *::after { box-sizing: border-box; }

.orw-hero {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 24px;
  padding: 24px;
  border-radius: var(--orw-radius);
  background: linear-gradient(135deg, var(--orw-accent-soft), var(--orw-bg) 80%);
  border: 1px solid var(--orw-border);
  margin-bottom: 20px;
}
.orw-hero-rating { display: flex; align-items: baseline; gap: 12px; }
.orw-hero-rating-num {
  font-size: 56px; font-weight: 700; line-height: 1; letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}
.orw-hero-meta { font-size: 13px; color: var(--orw-muted); }
.orw-hero-name { font-size: 18px; font-weight: 600; margin: 0 0 4px; }
.orw-hero-text { flex: 1; min-width: 220px; }

.orw-dist { display: flex; flex-direction: column; gap: 6px; min-width: 240px; flex: 1; }
.orw-dist-row { display: flex; align-items: center; gap: 10px; font-size: 12px; }
.orw-dist-label { width: 32px; color: var(--orw-muted); display: inline-flex; align-items: center; gap: 2px; }
.orw-dist-bar { flex: 1; height: 8px; background: var(--orw-border); border-radius: 999px; overflow: hidden; }
.orw-dist-fill { height: 100%; background: linear-gradient(90deg, #fbbf24, #f59e0b); border-radius: 999px; transition: width 600ms ease; }
.orw-dist-count { width: 40px; text-align: right; color: var(--orw-muted); font-variant-numeric: tabular-nums; }

.orw-grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
.orw-list { display: flex; flex-direction: column; gap: 14px; }
.orw-carousel-viewport { overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: thin; padding-bottom: 8px; }
.orw-carousel-track { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(280px, 76%); gap: 16px; }
.orw-carousel-track .orw-card { scroll-snap-align: start; }

.orw-card {
  background: var(--orw-card);
  border: 1px solid var(--orw-border);
  border-radius: var(--orw-radius);
  padding: 18px;
  box-shadow: var(--orw-shadow);
  display: flex; flex-direction: column; gap: 10px;
  transition: transform 200ms ease, box-shadow 200ms ease;
}
.orw-card:hover { transform: translateY(-2px); box-shadow: 0 16px 40px rgba(24,24,27,0.10); }

.orw-card-head { display: flex; align-items: center; gap: 10px; }
.orw-avatar {
  width: 40px; height: 40px; border-radius: 999px; overflow: hidden;
  background: var(--orw-accent-soft); color: var(--orw-accent);
  display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 14px;
}
.orw-avatar img { width: 100%; height: 100%; object-fit: cover; }
.orw-name { font-weight: 600; font-size: 14px; line-height: 1.2; }
.orw-name a { color: inherit; text-decoration: none; }
.orw-name a:hover { text-decoration: underline; }
.orw-localguide {
  display: inline-block; padding: 1px 6px; margin-left: 6px; font-size: 10px;
  border-radius: 999px; background: var(--orw-accent-soft); color: var(--orw-accent);
  vertical-align: middle;
}
.orw-meta-row { display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--orw-muted); margin-top: 2px; }

.orw-stars { display: inline-flex; gap: 2px; }
.orw-star { width: 14px; height: 14px; flex: none; }
.orw-star-empty { fill: rgba(245, 158, 11, 0.20); }
.orw-star-full  { fill: #f59e0b; }

.orw-text {
  font-size: 14px; line-height: 1.55; margin: 0; color: var(--orw-text);
  white-space: pre-line;
}
.orw-text.orw-collapsed {
  display: -webkit-box; -webkit-line-clamp: 6; -webkit-box-orient: vertical; overflow: hidden;
}
.orw-more {
  align-self: flex-start; background: none; border: 0; padding: 0; cursor: pointer;
  color: var(--orw-accent); font-size: 12px; font-weight: 600;
}

.orw-photos { display: flex; flex-wrap: wrap; gap: 6px; }
.orw-photo {
  width: 72px; height: 72px; border-radius: 10px; overflow: hidden; cursor: zoom-in;
  border: 1px solid var(--orw-border); background: var(--orw-border);
}
.orw-photo img { width: 100%; height: 100%; object-fit: cover; transition: transform 250ms ease; }
.orw-photo:hover img { transform: scale(1.08); }

.orw-owner {
  margin-top: 4px;
  border-left: 3px solid var(--orw-accent);
  background: var(--orw-accent-soft);
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 13px;
}
.orw-owner-label {
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--orw-accent); font-weight: 700;
}
.orw-owner-text { margin: 4px 0 0; line-height: 1.5; }

.orw-empty {
  padding: 40px 20px; text-align: center; color: var(--orw-muted); font-size: 14px;
  border: 1px dashed var(--orw-border); border-radius: var(--orw-radius);
}

.orw-lightbox {
  position: fixed; inset: 0; z-index: 99999; background: rgba(0,0,0,0.85);
  display: flex; align-items: center; justify-content: center; padding: 32px;
  opacity: 0; pointer-events: none; transition: opacity 200ms ease;
}
.orw-lightbox.open { opacity: 1; pointer-events: auto; }
.orw-lightbox img { max-width: 100%; max-height: 100%; border-radius: 12px; box-shadow: 0 30px 80px rgba(0,0,0,0.4); }
.orw-lightbox-close {
  position: absolute; top: 18px; right: 18px; background: white; color: black;
  border: 0; border-radius: 999px; width: 36px; height: 36px; font-size: 20px; cursor: pointer;
}

@media (max-width: 540px) {
  .orw-hero-rating-num { font-size: 44px; }
  .orw-grid { grid-template-columns: 1fr; }
}
`

const STAR_PATH =
  'M12 2.5l2.95 6.0 6.62.96-4.79 4.66 1.13 6.59L12 17.77 6.09 20.71 7.22 14.12 2.43 9.46 9.05 8.5z'

function svgStar(filled: boolean): string {
  const cls = filled ? 'orw-star orw-star-full' : 'orw-star orw-star-empty'
  return `<svg class="${cls}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="${STAR_PATH}"/></svg>`
}

function stars(rating: number): string {
  const out: string[] = []
  for (let i = 1; i <= 5; i++) out.push(svgStar(rating >= i))
  return `<span class="orw-stars" role="img" aria-label="${rating} of 5 stars">${out.join('')}</span>`
}

function initials(name: string | null): string {
  if (!name) return '·'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function getConfig(): WidgetConfig | null {
  // 1) iframe / standalone page: read from query string
  const sp = new URLSearchParams(window.location.search)
  if (sp.has('token')) {
    return {
      token: sp.get('token')!,
      layout: (sp.get('layout') as Layout) || DEFAULTS.layout,
      theme: (sp.get('theme') as Theme) || DEFAULTS.theme,
      minRating: Number.parseInt(sp.get('min_rating') ?? '1', 10) || DEFAULTS.minRating,
      sort: (sp.get('sort') as Sort) || DEFAULTS.sort,
      limit: Number.parseInt(sp.get('limit') ?? '12', 10) || DEFAULTS.limit,
      apiBase: sp.get('api') ?? window.location.origin,
      showHero: sp.get('hero') !== '0',
    }
  }

  // 2) inline script bundle: find first [data-token] element
  const host = document.querySelector<HTMLElement>('[data-operator-reviews][data-token], #operator-reviews[data-token]')
  if (!host) return null
  return {
    token: host.dataset.token!,
    layout: ((host.dataset.layout as Layout) || DEFAULTS.layout) as Layout,
    theme: ((host.dataset.theme as Theme) || DEFAULTS.theme) as Theme,
    minRating: Number.parseInt(host.dataset.minRating ?? '1', 10) || DEFAULTS.minRating,
    sort: ((host.dataset.sort as Sort) || DEFAULTS.sort) as Sort,
    limit: Number.parseInt(host.dataset.limit ?? '12', 10) || DEFAULTS.limit,
    apiBase: host.dataset.api ?? new URL((document.currentScript as HTMLScriptElement | null)?.src ?? window.location.href).origin,
    showHero: host.dataset.hero !== '0',
  }
}

function renderHero(p: ApiPayload): string {
  const avg = p.business.averageRating ?? 0
  const total = p.business.totalReviewsCount ?? p.distribution.reduce((s, d) => s + d.count, 0)
  const max = Math.max(...p.distribution.map((d) => d.count), 1)
  return `
    <section class="orw-hero">
      <div class="orw-hero-text">
        ${p.business.name ? `<h2 class="orw-hero-name">${escapeHtml(p.business.name)}</h2>` : ''}
        <div class="orw-hero-rating">
          <span class="orw-hero-rating-num">${avg.toFixed(1)}</span>
          <div>
            ${stars(avg)}
            <div class="orw-hero-meta">${total} reviews</div>
          </div>
        </div>
      </div>
      <div class="orw-dist" aria-label="Rating distribution">
        ${p.distribution.map((d) => `
          <div class="orw-dist-row">
            <span class="orw-dist-label">${d.rating}${svgStar(true)}</span>
            <span class="orw-dist-bar"><span class="orw-dist-fill" style="width:${Math.round((d.count / max) * 100)}%"></span></span>
            <span class="orw-dist-count">${d.count}</span>
          </div>
        `).join('')}
      </div>
    </section>
  `
}

function renderReview(r: ReviewItem): string {
  const photos = r.photos.length > 0 ? `
    <div class="orw-photos">
      ${r.photos.map((p) => `
        <button type="button" class="orw-photo" data-orw-photo="${escapeHtml(p.url)}">
          <img src="${escapeHtml(p.url)}" alt="Review photo" loading="lazy" referrerpolicy="no-referrer">
        </button>
      `).join('')}
    </div>
  ` : ''

  const owner = r.ownerResponse ? `
    <div class="orw-owner">
      <div class="orw-owner-label">Owner response${r.ownerResponseDate ? ` · ${escapeHtml(r.ownerResponseDate)}` : ''}</div>
      <p class="orw-owner-text">${escapeHtml(r.ownerResponse)}</p>
    </div>
  ` : ''

  const avatar = r.reviewerPhotoUrl
    ? `<img src="${escapeHtml(r.reviewerPhotoUrl)}" alt="${escapeHtml(r.reviewerName ?? 'Reviewer')}" referrerpolicy="no-referrer">`
    : escapeHtml(initials(r.reviewerName))

  const name = r.reviewerProfileUrl
    ? `<a href="${escapeHtml(r.reviewerProfileUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.reviewerName ?? 'Anonymous')}</a>`
    : escapeHtml(r.reviewerName ?? 'Anonymous')

  const text = r.text ? `
    <p class="orw-text orw-collapsed" data-orw-collapsible>${escapeHtml(r.text)}</p>
    <button type="button" class="orw-more" data-orw-more hidden>Read more</button>
  ` : ''

  return `
    <article class="orw-card">
      <header class="orw-card-head">
        <span class="orw-avatar">${avatar}</span>
        <div>
          <div class="orw-name">${name}${r.isLocalGuide ? '<span class="orw-localguide">Local Guide</span>' : ''}</div>
          <div class="orw-meta-row">
            ${stars(r.rating)}
            ${r.dateText ? `<span>${escapeHtml(r.dateText)}</span>` : ''}
            ${r.helpfulCount > 0 ? `<span>· ${r.helpfulCount} helpful</span>` : ''}
          </div>
        </div>
      </header>
      ${text}
      ${photos}
      ${owner}
    </article>
  `
}

function renderShell(config: WidgetConfig, payload: ApiPayload): string {
  const cards = payload.reviews.map(renderReview).join('')
  const heroHtml = config.showHero ? renderHero(payload) : ''
  const empty = payload.reviews.length === 0
    ? `<div class="orw-empty">No reviews yet.</div>`
    : ''

  if (empty) return `<div class="orw-root" data-theme="${config.theme}">${heroHtml}${empty}</div>`

  if (config.layout === 'list') {
    return `<div class="orw-root" data-theme="${config.theme}">${heroHtml}<div class="orw-list">${cards}</div></div>`
  }
  if (config.layout === 'carousel') {
    return `<div class="orw-root" data-theme="${config.theme}">${heroHtml}<div class="orw-carousel-viewport"><div class="orw-carousel-track">${cards}</div></div></div>`
  }
  return `<div class="orw-root" data-theme="${config.theme}">${heroHtml}<div class="orw-grid">${cards}</div></div>`
}

function wireInteractions(root: HTMLElement): void {
  // Expand long reviews
  root.querySelectorAll<HTMLElement>('[data-orw-collapsible]').forEach((el) => {
    requestAnimationFrame(() => {
      if (el.scrollHeight > el.clientHeight + 4) {
        const btn = el.nextElementSibling as HTMLButtonElement | null
        if (btn?.hasAttribute('data-orw-more')) btn.hidden = false
      }
    })
  })
  root.querySelectorAll<HTMLButtonElement>('[data-orw-more]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const prev = btn.previousElementSibling as HTMLElement | null
      if (!prev) return
      prev.classList.remove('orw-collapsed')
      btn.remove()
    })
  })

  // Lightbox
  const lb = document.createElement('div')
  lb.className = 'orw-lightbox'
  lb.innerHTML = `<button type="button" class="orw-lightbox-close" aria-label="Close">×</button><img alt="">`
  document.body.appendChild(lb)
  const lbImg = lb.querySelector('img') as HTMLImageElement
  const close = () => lb.classList.remove('open')
  lb.querySelector('.orw-lightbox-close')!.addEventListener('click', close)
  lb.addEventListener('click', (e) => { if (e.target === lb) close() })
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close() })
  root.querySelectorAll<HTMLButtonElement>('[data-orw-photo]').forEach((btn) => {
    btn.addEventListener('click', () => {
      lbImg.src = btn.dataset.orwPhoto!
      lb.classList.add('open')
    })
  })
}

async function main() {
  const config = getConfig()
  if (!config) {
    console.warn('[operator-reviews] no config found — provide ?token= query param or a [data-token] element.')
    return
  }

  // Inject CSS once
  if (!document.getElementById('orw-style')) {
    const style = document.createElement('style')
    style.id = 'orw-style'
    style.textContent = CSS
    document.head.appendChild(style)
  }

  const params = new URLSearchParams({
    min_rating: String(config.minRating),
    sort: config.sort,
    limit: String(config.limit),
  })
  const url = `${config.apiBase}/api/reviews/${encodeURIComponent(config.token)}?${params.toString()}`

  let payload: ApiPayload
  try {
    const res = await fetch(url, { method: 'GET', credentials: 'omit' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    payload = (await res.json()) as ApiPayload
  } catch (err) {
    console.error('[operator-reviews] failed to load reviews', err)
    return
  }

  const html = renderShell(config, payload)

  // Mount: iframe/standalone uses document.body; embed uses [data-token] host
  const sp = new URLSearchParams(window.location.search)
  const host = sp.has('token')
    ? document.body
    : document.querySelector<HTMLElement>('[data-operator-reviews][data-token], #operator-reviews[data-token]')!

  host.innerHTML = html
  wireInteractions(host)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main)
} else {
  void main()
}
