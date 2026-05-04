export {}

interface ReviewsWidgetPayload {
  location: {
    name: string
    mapsUrl: string | null
    fetchedAt: string
    reviewCount: number
  }
  reviews: ReviewItem[]
}

interface ReviewItem {
  id: string
  authorName: string
  authorPhotoUrl: string | null
  authorUri: string | null
  rating: number
  reviewText: string | null
  originalText: string | null
  relativeTime: string | null
  publishedAt: string | null
  googleMapsUrl: string | null
}

type Layout = 'carousel' | 'grid' | 'list' | 'compact'
type Theme = 'light' | 'dark'

type WidgetOptions = {
  layout: Layout
  theme: Theme
  primaryColor: string
  starColor: string
  showPhoto: boolean
  showDate: boolean
  showGoogleButton: boolean
  borderRadius: number
  maxWidth: number
}

const WIDGET_CSS = `
:host {
  color-scheme: light;
}

*, *::before, *::after {
  box-sizing: border-box;
}

.orw-shell {
  --orw-bg: #fffdf7;
  --orw-card: #ffffff;
  --orw-text: #191919;
  --orw-muted: #6b665d;
  --orw-border: rgba(25, 25, 25, 0.12);
  --orw-shadow: 0 18px 50px rgba(25, 25, 25, 0.08);
  --orw-primary: #1f2937;
  --orw-star: #f59e0b;
  --orw-radius: 20px;
  width: 100%;
  max-width: var(--orw-max-width, 960px);
  margin: 0 auto;
  color: var(--orw-text);
  font-family: Georgia, 'Times New Roman', serif;
}

.orw-shell[data-theme="dark"] {
  --orw-bg: #171717;
  --orw-card: #222222;
  --orw-text: #f5f3ef;
  --orw-muted: #c9c2b8;
  --orw-border: rgba(245, 243, 239, 0.14);
  --orw-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
}

.orw-frame {
  border-radius: calc(var(--orw-radius) + 8px);
  background:
    radial-gradient(circle at top left, color-mix(in srgb, var(--orw-primary) 14%, transparent), transparent 34%),
    linear-gradient(180deg, color-mix(in srgb, var(--orw-primary) 6%, var(--orw-bg)), var(--orw-bg));
  border: 1px solid var(--orw-border);
  box-shadow: var(--orw-shadow);
  overflow: hidden;
}

.orw-header {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 16px;
  padding: 22px 22px 16px;
}

.orw-kicker {
  margin: 0 0 6px;
  font-size: 11px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--orw-muted);
  font-family: 'Trebuchet MS', Arial, sans-serif;
}

.orw-title {
  margin: 0;
  font-size: clamp(22px, 4vw, 32px);
  line-height: 1.1;
  color: var(--orw-primary);
}

.orw-subtitle {
  margin: 8px 0 0;
  font-size: 14px;
  line-height: 1.5;
  color: var(--orw-muted);
  font-family: 'Trebuchet MS', Arial, sans-serif;
}

.orw-controls {
  display: flex;
  gap: 10px;
}

.orw-nav {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: 999px;
  border: 1px solid var(--orw-border);
  background: var(--orw-card);
  color: var(--orw-primary);
  cursor: pointer;
}

.orw-nav[hidden] {
  display: none;
}

.orw-body {
  padding: 0 22px 22px;
}

.orw-list,
.orw-grid,
.orw-compact,
.orw-carousel-track {
  display: grid;
  gap: 16px;
}

.orw-list,
.orw-compact {
  grid-template-columns: 1fr;
}

.orw-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.orw-carousel-viewport {
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  scrollbar-width: none;
  padding-bottom: 4px;
}

.orw-carousel-viewport::-webkit-scrollbar {
  display: none;
}

.orw-carousel-track {
  grid-auto-flow: column;
  grid-auto-columns: minmax(280px, 72%);
}

.orw-card {
  min-width: 0;
  height: 100%;
  padding: 18px;
  border-radius: var(--orw-radius);
  border: 1px solid var(--orw-border);
  background: var(--orw-card);
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.08);
}

.orw-carousel .orw-card {
  scroll-snap-align: start;
}

.orw-compact .orw-card {
  padding: 16px;
}

.orw-stars {
  display: inline-flex;
  gap: 3px;
  margin-bottom: 12px;
  color: var(--orw-star);
}

.orw-star {
  width: 16px;
  height: 16px;
  fill: currentColor;
}

.orw-copy {
  margin: 0 0 14px;
  font-size: 15px;
  line-height: 1.65;
  color: var(--orw-text);
}

.orw-footer-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.orw-author {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.orw-photo,
.orw-photo-fallback {
  width: 42px;
  height: 42px;
  border-radius: 999px;
  flex-shrink: 0;
}

.orw-photo {
  object-fit: cover;
  border: 1px solid var(--orw-border);
}

.orw-photo-fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--orw-primary) 10%, var(--orw-card));
  color: var(--orw-primary);
  font-family: 'Trebuchet MS', Arial, sans-serif;
  font-size: 13px;
  font-weight: 700;
}

.orw-author-meta {
  min-width: 0;
}

.orw-author-name,
.orw-author-name-link {
  display: inline-block;
  max-width: 100%;
  color: var(--orw-text);
  font-size: 14px;
  font-weight: 700;
  text-decoration: none;
  font-family: 'Trebuchet MS', Arial, sans-serif;
}

.orw-author-name-link:hover {
  text-decoration: underline;
}

.orw-date {
  margin-top: 3px;
  font-size: 12px;
  color: var(--orw-muted);
  font-family: 'Trebuchet MS', Arial, sans-serif;
}

.orw-button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 999px;
  background: var(--orw-primary);
  color: #ffffff;
  text-decoration: none;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
  font-family: 'Trebuchet MS', Arial, sans-serif;
}

.orw-attribution {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 0 22px 20px;
  color: var(--orw-muted);
  font-size: 12px;
  font-family: 'Trebuchet MS', Arial, sans-serif;
}

.orw-powered {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.orw-powered img {
  height: 14px;
  width: auto;
}

.orw-place-link {
  color: var(--orw-primary);
  text-decoration: none;
  font-weight: 700;
}

.orw-place-link:hover {
  text-decoration: underline;
}

@media (max-width: 720px) {
  .orw-grid {
    grid-template-columns: 1fr;
  }

  .orw-header,
  .orw-attribution,
  .orw-footer-row {
    align-items: start;
  }

  .orw-carousel-track {
    grid-auto-columns: minmax(260px, 88%);
  }
}
`

const STAR_ICON = '<svg class="orw-star" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 17.3 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"></path></svg>'

const script = document.currentScript as HTMLScriptElement | null
const token = script?.dataset.token?.trim() ?? ''

if (script && token && script.dataset.reviewsWidgetLoaded !== 'true') {
  script.dataset.reviewsWidgetLoaded = 'true'
  void initWidget(script, token)
}

async function initWidget(scriptEl: HTMLScriptElement, reviewToken: string): Promise<void> {
  const host = document.createElement('div')
  host.className = 'operator-reviews-widget-host'
  scriptEl.insertAdjacentElement('afterend', host)

  try {
    const shadowRoot = host.attachShadow({ mode: 'open' })
    const options = readOptions(scriptEl)
    const apiOrigin = new URL(scriptEl.src, window.location.href).origin
    const payload = await fetchPayload(apiOrigin, reviewToken)

    if (!payload || payload.reviews.length === 0) {
      cleanup(host)
      return
    }

    renderWidget(shadowRoot, apiOrigin, payload, options)
  } catch {
    cleanup(host)
  }
}

function readOptions(scriptEl: HTMLScriptElement): WidgetOptions {
  return {
    layout: parseLayout(scriptEl.dataset.layout),
    theme: scriptEl.dataset.theme === 'dark' ? 'dark' : 'light',
    primaryColor: parseColor(scriptEl.dataset.primaryColor, '#1f2937'),
    starColor: parseColor(scriptEl.dataset.starColor, '#f59e0b'),
    showPhoto: parseBoolean(scriptEl.dataset.showPhoto, true),
    showDate: parseBoolean(scriptEl.dataset.showDate, true),
    showGoogleButton: parseBoolean(scriptEl.dataset.showGoogleButton, true),
    borderRadius: parseNumber(scriptEl.dataset.borderRadius, 20, 8, 40),
    maxWidth: parseNumber(scriptEl.dataset.maxWidth, 960, 280, 1440),
  }
}

function parseLayout(value: string | undefined): Layout {
  if (value === 'carousel' || value === 'grid' || value === 'compact' || value === 'list') {
    return value
  }

  return 'list'
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

function parseColor(value: string | undefined, fallback: string): string {
  return /^#[0-9A-Fa-f]{6}$/.test(value ?? '') ? (value as string) : fallback
}

function parseNumber(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

async function fetchPayload(origin: string, reviewToken: string): Promise<ReviewsWidgetPayload | null> {
  const response = await fetch(`${origin}/api/reviews/${reviewToken}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })

  if (!response.ok) {
    return null
  }

  const payload = (await response.json()) as ReviewsWidgetPayload

  if (!payload?.location?.name || !Array.isArray(payload.reviews) || payload.reviews.length === 0) {
    return null
  }

  return payload
}

function renderWidget(
  shadowRoot: ShadowRoot,
  origin: string,
  payload: ReviewsWidgetPayload,
  options: WidgetOptions
): void {
  const style = document.createElement('style')
  style.textContent = WIDGET_CSS
  shadowRoot.appendChild(style)

  const shell = document.createElement('section')
  shell.className = 'orw-shell'
  shell.dataset.theme = options.theme
  shell.style.setProperty('--orw-primary', options.primaryColor)
  shell.style.setProperty('--orw-star', options.starColor)
  shell.style.setProperty('--orw-radius', `${options.borderRadius}px`)
  shell.style.setProperty('--orw-max-width', `${options.maxWidth}px`)

  const frame = document.createElement('div')
  frame.className = 'orw-frame'
  shell.appendChild(frame)

  const header = document.createElement('div')
  header.className = 'orw-header'
  header.innerHTML = `
    <div>
      <p class="orw-kicker">Google reviews</p>
      <h2 class="orw-title">What customers say about ${escapeHtml(payload.location.name)}</h2>
      <p class="orw-subtitle">Up to ${payload.location.reviewCount} recent reviews from Google, rendered without touching your host site's styles.</p>
    </div>
  `

  const controls = document.createElement('div')
  controls.className = 'orw-controls'
  const prevButton = createNavButton('Previous reviews', '&#8592;')
  const nextButton = createNavButton('Next reviews', '&#8594;')
  prevButton.hidden = options.layout !== 'carousel'
  nextButton.hidden = options.layout !== 'carousel'
  controls.append(prevButton, nextButton)
  header.appendChild(controls)
  frame.appendChild(header)

  const body = document.createElement('div')
  body.className = 'orw-body'
  frame.appendChild(body)

  if (options.layout === 'carousel') {
    const viewport = document.createElement('div')
    viewport.className = 'orw-carousel-viewport orw-carousel'
    const track = document.createElement('div')
    track.className = 'orw-carousel-track'

    payload.reviews.forEach((review) => {
      track.appendChild(createReviewCard(review, options))
    })

    viewport.appendChild(track)
    body.appendChild(viewport)

    prevButton.addEventListener('click', () => {
      viewport.scrollBy({ left: -viewport.clientWidth * 0.85, behavior: 'smooth' })
    })

    nextButton.addEventListener('click', () => {
      viewport.scrollBy({ left: viewport.clientWidth * 0.85, behavior: 'smooth' })
    })
  } else {
    const container = document.createElement('div')
    container.className = options.layout === 'grid' ? 'orw-grid' : options.layout === 'compact' ? 'orw-compact' : 'orw-list'

    payload.reviews.forEach((review) => {
      container.appendChild(createReviewCard(review, options))
    })

    body.appendChild(container)
  }

  const attribution = document.createElement('div')
  attribution.className = 'orw-attribution'
  attribution.innerHTML = `
    <span class="orw-powered">
      <img src="${origin}/google-logo.svg" alt="Google" />
      <span>Powered by Google</span>
    </span>
  `

  if (payload.location.mapsUrl) {
    const placeLink = document.createElement('a')
    placeLink.className = 'orw-place-link'
    placeLink.href = payload.location.mapsUrl
    placeLink.target = '_blank'
    placeLink.rel = 'noopener noreferrer'
    placeLink.textContent = `View ${payload.location.name} on Google`
    attribution.appendChild(placeLink)
  }

  shell.appendChild(attribution)
  shadowRoot.appendChild(shell)
}

function createNavButton(label: string, icon: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'orw-nav'
  button.setAttribute('aria-label', label)
  button.innerHTML = icon
  return button
}

function createReviewCard(review: ReviewItem, options: WidgetOptions): HTMLElement {
  const card = document.createElement('article')
  card.className = 'orw-card'

  const stars = document.createElement('div')
  stars.className = 'orw-stars'
  stars.setAttribute('aria-label', `${review.rating} out of 5 stars`)
  stars.innerHTML = Array.from({ length: 5 }, (_, index) => index < review.rating ? STAR_ICON : STAR_ICON).join('')
  card.appendChild(stars)

  const quote = document.createElement('p')
  quote.className = 'orw-copy'
  quote.textContent = review.reviewText || review.originalText || 'Recommended by a Google reviewer.'
  card.appendChild(quote)

  const footer = document.createElement('div')
  footer.className = 'orw-footer-row'
  footer.appendChild(createAuthorBlock(review, options))

  if (options.showGoogleButton && review.googleMapsUrl) {
    const button = document.createElement('a')
    button.className = 'orw-button'
    button.href = review.googleMapsUrl
    button.target = '_blank'
    button.rel = 'noopener noreferrer'
    button.textContent = 'Read on Google'
    footer.appendChild(button)
  }

  card.appendChild(footer)
  return card
}

function createAuthorBlock(review: ReviewItem, options: WidgetOptions): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.className = 'orw-author'

  if (options.showPhoto) {
    if (review.authorPhotoUrl) {
      const image = document.createElement('img')
      image.className = 'orw-photo'
      image.src = review.authorPhotoUrl
      image.alt = review.authorName
      wrapper.appendChild(image)
    } else {
      const fallback = document.createElement('span')
      fallback.className = 'orw-photo-fallback'
      fallback.textContent = getInitials(review.authorName)
      wrapper.appendChild(fallback)
    }
  }

  const meta = document.createElement('div')
  meta.className = 'orw-author-meta'
  if (review.authorUri) {
    const link = document.createElement('a')
    link.className = 'orw-author-name-link'
    link.href = review.authorUri
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    link.textContent = review.authorName
    meta.appendChild(link)
  } else {
    const name = document.createElement('span')
    name.className = 'orw-author-name'
    name.textContent = review.authorName
    meta.appendChild(name)
  }

  if (options.showDate && review.relativeTime) {
    const date = document.createElement('div')
    date.className = 'orw-date'
    date.textContent = review.relativeTime
    meta.appendChild(date)
  }

  wrapper.appendChild(meta)
  return wrapper
}

function getInitials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  }

  return value.trim().slice(0, 2).toUpperCase() || 'GR'
}

function cleanup(host: HTMLElement): void {
  host.remove()
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
