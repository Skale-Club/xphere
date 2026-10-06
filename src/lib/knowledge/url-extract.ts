// Server-side text extraction for outside material (YouTube videos, articles)
// that an operator or the MCP caller wants to turn into Global Knowledge.
//
// No LLM here: this returns raw text. The caller (Claude via MCP, or an
// operator) structures it and then writes it through the Notion write path
// (`createGlobalKnowledgeNotionPage`).
//
// Safety: article URLs are user/AI supplied, so they go through the SEO
// crawler's SSRF-safe fetch (`fetchPage`): http/https only, every hop
// resolved and checked against private/loopback/link-local space, and a
// connect-time DNS guard against rebinding. YouTube requests only ever go to
// fixed youtube.com hosts (and caption URLs are re-checked to be youtube.com).
//
// YouTube transcripts are BEST-EFFORT. There is no official public captions
// API for arbitrary videos; we read the watch page's embedded player response
// and its caption track URLs. YouTube may serve a consent/bot-check page or an
// empty caption body to datacenter IPs (our servers), change the page format,
// or require a proof-of-origin token — any of which yields
// 'transcript_unavailable', and the operator should paste the transcript.

import { fetchPage } from '@/lib/seo/fetch-page'
import { isPrivateAddress } from '@/lib/flows/url-guard'
import { isIP } from 'node:net'

export type UrlExtractResult =
  | { ok: true; kind: 'youtube'; title: string; author: string | null; language: string | null; text: string; url: string }
  | { ok: true; kind: 'article'; title: string; text: string; url: string }
  | {
      ok: false
      error: 'invalid_url' | 'blocked_url' | 'fetch_failed' | 'transcript_unavailable' | 'empty_content'
      detail?: string
    }

export const MAX_EXTRACTED_TEXT_CHARS = 200_000
const ARTICLE_MAX_BYTES = 3 * 1024 * 1024
const FETCH_TIMEOUT_MS = 15_000
const YOUTUBE_MAX_BYTES = 5 * 1024 * 1024
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const TRANSCRIPT_HELP =
  'Open the video on YouTube, use "Show transcript", and paste the text instead.'

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/

/** Extract the 11-char video id from any common YouTube URL form, else null. */
export function parseYouTubeVideoId(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  const segments = url.pathname.split('/').filter(Boolean)

  let candidate: string | null = null
  if (host === 'youtu.be') {
    candidate = segments[0] ?? null
  } else if (
    host === 'youtube.com' ||
    host === 'm.youtube.com' ||
    host === 'music.youtube.com' ||
    host === 'youtube-nocookie.com'
  ) {
    if (segments[0] === 'watch') candidate = url.searchParams.get('v')
    else if (['shorts', 'embed', 'live', 'v'].includes(segments[0] ?? '')) candidate = segments[1] ?? null
  }
  return candidate && YOUTUBE_ID.test(candidate) ? candidate : null
}

/** True for hostnames we refuse before any network call (literal private IPs, localhost). */
function isObviouslyPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) return true
  return isIP(host) !== 0 && isPrivateAddress(host)
}

// ---------------------------------------------------------------------------
// HTML → text
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»',
  middot: '·', bull: '•', copy: '©', reg: '®', trade: '™', deg: '°', euro: '€', pound: '£',
  times: '×', divide: '÷', shy: '', zwj: '', zwnj: '',
  aacute: 'á', agrave: 'à', acirc: 'â', atilde: 'ã', auml: 'ä', ccedil: 'ç',
  eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë', iacute: 'í', igrave: 'ì', icirc: 'î', iuml: 'ï',
  ntilde: 'ñ', oacute: 'ó', ograve: 'ò', ocirc: 'ô', otilde: 'õ', ouml: 'ö',
  uacute: 'ú', ugrave: 'ù', ucirc: 'û', uuml: 'ü',
  Aacute: 'Á', Agrave: 'À', Acirc: 'Â', Atilde: 'Ã', Auml: 'Ä', Ccedil: 'Ç',
  Eacute: 'É', Egrave: 'È', Ecirc: 'Ê', Iacute: 'Í', Oacute: 'Ó', Ocirc: 'Ô', Otilde: 'Õ', Ouml: 'Ö',
  Uacute: 'Ú', Uuml: 'Ü', Ntilde: 'Ñ',
}

export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10)
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match
      try {
        return String.fromCodePoint(code)
      } catch {
        return match
      }
    }
    return NAMED_ENTITIES[entity] ?? NAMED_ENTITIES[entity.toLowerCase()] ?? match
  })
}

function metaContent(html: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)\\s*=\\s*["']${escaped}["'][^>]*content\\s*=\\s*["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content\\s*=\\s*["']([^"']*)["'][^>]*(?:property|name)\\s*=\\s*["']${escaped}["']`, 'i'),
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(html)
    if (match?.[1]?.trim()) return decodeHtmlEntities(match[1]).replace(/\s+/g, ' ').trim()
  }
  return null
}

/** Page title: og:title, then <title>. */
export function extractHtmlTitle(html: string): string | null {
  const og = metaContent(html, 'og:title')
  if (og) return og
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]
  const clean = title ? decodeHtmlEntities(title.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim() : ''
  return clean || null
}

const REMOVED_ELEMENTS = [
  'script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe', 'object',
  'nav', 'header', 'footer', 'aside', 'form', 'button', 'select', 'dialog', 'figure',
]

function stripElements(html: string, tags: string[]): string {
  let output = html
  for (const tag of tags) {
    // Repeat so (shallow) nesting of the same tag is also removed.
    const pattern = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi')
    let previous: string
    do {
      previous = output
      output = output.replace(pattern, ' ')
    } while (output !== previous)
    // Self-closing / unclosed leftovers.
    output = output.replace(new RegExp(`<${tag}\\b[^>]*\\/?>`, 'gi'), ' ')
  }
  return output
}

function innerOf(html: string, tag: string): string[] {
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, 'gi')
  return Array.from(html.matchAll(pattern), (match) => match[1])
}

/** Convert an HTML fragment to plain text with paragraph breaks preserved. */
export function htmlFragmentToText(fragment: string): string {
  let html = fragment.replace(/<!--[\s\S]*?-->/g, ' ')
  html = stripElements(html, REMOVED_ELEMENTS)
  html = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|section|article|main|h[1-6]|li|ul|ol|blockquote|pre|table|tr|dd|dt|header|figcaption)\s*>/gi, '\n\n')
    .replace(/<(p|div|section|h[1-6]|blockquote|pre|table|tr|ul|ol|hr)\b[^>]*>/gi, '\n\n')
    .replace(/<\/(td|th)\s*>/gi, ' \t ')
    .replace(/<[^>]+>/g, '')
  const text = decodeHtmlEntities(html)
    .replace(/ /g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v\r]+/g, ' ').trim())
    .join('\n')
    .replace(/\n(- )?\n+(?=- )/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text
}

/**
 * Main readable text of an HTML document: the longest <article>, else
 * <main>, else <body>; if the chosen region is suspiciously short, the whole
 * body is used instead. Capped at MAX_EXTRACTED_TEXT_CHARS.
 */
export function extractArticleText(html: string): { title: string | null; text: string } {
  const title = extractHtmlTitle(html)
  const withoutHead = html.replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/i, ' ')
  const body = innerOf(withoutHead, 'body')[0] ?? withoutHead

  const candidates = [
    ...innerOf(body, 'article'),
    ...innerOf(body, 'main'),
  ]
    .map(htmlFragmentToText)
    .sort((a, b) => b.length - a.length)
  let text = candidates[0] ?? ''
  if (text.length < 200) {
    const whole = htmlFragmentToText(body)
    if (whole.length > text.length) text = whole
  }
  if (text.length > MAX_EXTRACTED_TEXT_CHARS) text = text.slice(0, MAX_EXTRACTED_TEXT_CHARS).trimEnd()
  return { title, text }
}

// ---------------------------------------------------------------------------
// YouTube
// ---------------------------------------------------------------------------

/**
 * Extract a JSON object literal assigned to `marker` in a script (e.g.
 * `var ytInitialPlayerResponse = {...};`) with a string-aware brace matcher —
 * regexes break on braces inside strings.
 */
export function extractAssignedJson(source: string, marker: string): unknown | null {
  let from = 0
  while (true) {
    const at = source.indexOf(marker, from)
    if (at === -1) return null
    from = at + marker.length
    const start = source.indexOf('{', from)
    if (start === -1) return null
    // Only accept `marker = {` / `marker":{` style assignments.
    const between = source.slice(from, start)
    if (!/^\s*["']?\s*[=:]\s*$/.test(between)) continue

    let depth = 0
    let inString: string | null = null
    for (let index = start; index < source.length; index++) {
      const char = source[index]
      if (inString) {
        if (char === '\\') index++
        else if (char === inString) inString = null
        continue
      }
      if (char === '"' || char === "'") inString = char
      else if (char === '{') depth++
      else if (char === '}') {
        depth--
        if (depth === 0) {
          try {
            return JSON.parse(source.slice(start, index + 1))
          } catch {
            break
          }
        }
      }
    }
  }
}

export type YouTubeCaptionTrack = {
  baseUrl: string
  languageCode: string
  kind?: string
  name?: string
}

function trackName(name: unknown): string | undefined {
  if (!name || typeof name !== 'object') return undefined
  const record = name as { simpleText?: string; runs?: Array<{ text?: string }> }
  return record.simpleText ?? record.runs?.map((run) => run.text ?? '').join('') ?? undefined
}

export type YouTubePlayerInfo = {
  title: string | null
  author: string | null
  playability: string | null
  playabilityReason: string | null
  tracks: YouTubeCaptionTrack[]
}

/** Pull title/author/caption tracks out of a watch page's HTML. */
export function parseYouTubeWatchPage(html: string): YouTubePlayerInfo | null {
  const player = extractAssignedJson(html, 'ytInitialPlayerResponse') as {
    videoDetails?: { title?: string; author?: string }
    playabilityStatus?: { status?: string; reason?: string }
    captions?: {
      playerCaptionsTracklistRenderer?: {
        captionTracks?: Array<{ baseUrl?: string; languageCode?: string; kind?: string; name?: unknown }>
      }
    }
  } | null
  if (!player || typeof player !== 'object') return null
  const rawTracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []
  return {
    title: player.videoDetails?.title?.trim() || extractHtmlTitle(html)?.replace(/\s*-\s*YouTube$/, '') || null,
    author: player.videoDetails?.author?.trim() || null,
    playability: player.playabilityStatus?.status ?? null,
    playabilityReason: player.playabilityStatus?.reason ?? null,
    tracks: rawTracks
      .filter((track) => typeof track.baseUrl === 'string' && typeof track.languageCode === 'string')
      .map((track) => ({
        baseUrl: track.baseUrl!,
        languageCode: track.languageCode!,
        kind: track.kind,
        name: trackName(track.name),
      })),
  }
}

/** Manual tracks before auto-generated (ASR); within each, pt → en → first. */
export function pickCaptionTrack(tracks: YouTubeCaptionTrack[]): YouTubeCaptionTrack | null {
  const manual = tracks.filter((track) => track.kind !== 'asr')
  const asr = tracks.filter((track) => track.kind === 'asr')
  for (const group of [manual, asr]) {
    if (group.length === 0) continue
    const lang = (prefix: string) =>
      group.find((track) => track.languageCode.toLowerCase().split(/[-_]/)[0] === prefix)
    return lang('pt') ?? lang('en') ?? group[0]
  }
  return null
}

type TimedSegment = { startMs: number; endMs: number; text: string }

/** Group timed caption segments into readable paragraphs. */
export function segmentsToParagraphs(segments: TimedSegment[]): string {
  const paragraphs: string[] = []
  let current = ''
  let lastEnd = 0
  for (const segment of segments) {
    const text = segment.text.replace(/\s+/g, ' ').trim()
    if (!text) continue
    const gap = segment.startMs - lastEnd
    const sentenceEnded = /[.!?…]["')\]]?$/.test(current)
    if (current && (gap > 2500 || (current.length > 600 && sentenceEnded) || current.length > 1500)) {
      paragraphs.push(current)
      current = ''
    }
    current = current ? `${current} ${text}` : text
    lastEnd = Math.max(lastEnd, segment.endMs)
  }
  if (current) paragraphs.push(current)
  return paragraphs.join('\n\n')
}

/** YouTube `fmt=json3` caption body → paragraphs. */
export function json3ToText(json: unknown): string {
  const events = (json as { events?: Array<{ tStartMs?: number; dDurationMs?: number; segs?: Array<{ utf8?: string }> }> })
    ?.events
  if (!Array.isArray(events)) return ''
  const segments: TimedSegment[] = []
  for (const event of events) {
    if (!Array.isArray(event.segs)) continue
    const text = event.segs.map((seg) => seg.utf8 ?? '').join('').replace(/\n/g, ' ')
    if (!text.trim()) continue
    const startMs = event.tStartMs ?? 0
    segments.push({ startMs, endMs: startMs + (event.dDurationMs ?? 0), text })
  }
  return segmentsToParagraphs(segments)
}

/** Legacy timedtext XML (`<text start="1.2" dur="3.4">…</text>`, or srv3 `<p t= d=>`) → paragraphs. */
export function timedTextXmlToText(xml: string): string {
  const segments: TimedSegment[] = []
  for (const match of xml.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/gi)) {
    const start = Number(/start="([\d.]+)"/.exec(match[1])?.[1] ?? '0')
    const dur = Number(/dur="([\d.]+)"/.exec(match[1])?.[1] ?? '0')
    segments.push({
      startMs: start * 1000,
      endMs: (start + dur) * 1000,
      // Captions are entity-encoded, sometimes twice (&amp;#39;).
      text: decodeHtmlEntities(decodeHtmlEntities(match[2].replace(/<[^>]+>/g, ''))),
    })
  }
  if (segments.length === 0) {
    for (const match of xml.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi)) {
      const start = Number(/\bt="(\d+)"/.exec(match[1])?.[1] ?? '0')
      const dur = Number(/\bd="(\d+)"/.exec(match[1])?.[1] ?? '0')
      segments.push({
        startMs: start,
        endMs: start + dur,
        text: decodeHtmlEntities(decodeHtmlEntities(match[2].replace(/<[^>]+>/g, ''))),
      })
    }
  }
  return segmentsToParagraphs(segments)
}

async function fetchYouTubeText(url: string): Promise<{ ok: true; text: string } | { ok: false; detail: string }> {
  try {
    const response = await fetch(url, {
      headers: {
        'user-agent': BROWSER_USER_AGENT,
        'accept-language': 'en-US,en;q=0.9,pt-BR;q=0.8',
        // Skip the EU consent interstitial (our servers are in the EU).
        cookie: 'CONSENT=YES+cb; SOCS=CAI',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: 'no-store',
    })
    if (!response.ok) return { ok: false, detail: `YouTube returned HTTP ${response.status}` }
    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > YOUTUBE_MAX_BYTES) {
      return { ok: false, detail: 'YouTube response too large' }
    }
    const text = await response.text()
    return { ok: true, text: text.length > YOUTUBE_MAX_BYTES ? text.slice(0, YOUTUBE_MAX_BYTES) : text }
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) }
  }
}

function isYouTubeHost(url: URL): boolean {
  const host = url.hostname.toLowerCase()
  return url.protocol === 'https:' && (host === 'youtube.com' || host.endsWith('.youtube.com'))
}

async function extractYouTube(videoId: string, originalUrl: string): Promise<UrlExtractResult> {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}&hl=en`
  const page = await fetchYouTubeText(watchUrl)
  if (!page.ok) return { ok: false, error: 'fetch_failed', detail: page.detail }

  const info = parseYouTubeWatchPage(page.text)
  if (!info) {
    return {
      ok: false,
      error: 'transcript_unavailable',
      detail: `Could not read the YouTube player data (likely a consent or bot-check page). ${TRANSCRIPT_HELP}`,
    }
  }
  if (info.playability && info.playability !== 'OK' && info.tracks.length === 0) {
    return {
      ok: false,
      error: 'transcript_unavailable',
      detail: `YouTube refused the video (${info.playability}${info.playabilityReason ? `: ${info.playabilityReason}` : ''}). ${TRANSCRIPT_HELP}`,
    }
  }

  const track = pickCaptionTrack(info.tracks)
  if (!track) {
    return { ok: false, error: 'transcript_unavailable', detail: `This video has no caption tracks. ${TRANSCRIPT_HELP}` }
  }

  let captionUrl: URL
  try {
    captionUrl = new URL(track.baseUrl, 'https://www.youtube.com')
  } catch {
    return { ok: false, error: 'transcript_unavailable', detail: `Invalid caption URL. ${TRANSCRIPT_HELP}` }
  }
  if (!isYouTubeHost(captionUrl)) {
    return { ok: false, error: 'transcript_unavailable', detail: `Unexpected caption host. ${TRANSCRIPT_HELP}` }
  }

  let text = ''
  const json3Url = new URL(captionUrl)
  json3Url.searchParams.set('fmt', 'json3')
  const json3 = await fetchYouTubeText(json3Url.toString())
  if (json3.ok && json3.text.trim()) {
    try {
      text = json3ToText(JSON.parse(json3.text))
    } catch {
      text = ''
    }
  }
  if (!text) {
    // Some tracks only answer in the default XML format.
    const xmlUrl = new URL(captionUrl)
    xmlUrl.searchParams.delete('fmt')
    const xml = await fetchYouTubeText(xmlUrl.toString())
    if (xml.ok) text = timedTextXmlToText(xml.text)
  }
  if (!text.trim()) {
    return {
      ok: false,
      error: 'transcript_unavailable',
      detail: `YouTube returned an empty transcript (it often blocks server requests). ${TRANSCRIPT_HELP}`,
    }
  }

  return {
    ok: true,
    kind: 'youtube',
    title: info.title ?? `YouTube video ${videoId}`,
    author: info.author,
    language: track.languageCode,
    text: text.length > MAX_EXTRACTED_TEXT_CHARS ? text.slice(0, MAX_EXTRACTED_TEXT_CHARS).trimEnd() : text,
    url: originalUrl,
  }
}

// ---------------------------------------------------------------------------
// Articles
// ---------------------------------------------------------------------------

async function extractArticle(url: URL): Promise<UrlExtractResult> {
  const result = await fetchPage(url.toString(), { timeoutMs: FETCH_TIMEOUT_MS, maxBytes: ARTICLE_MAX_BYTES })
  if (!result.ok) {
    return result.blocked
      ? { ok: false, error: 'blocked_url', detail: result.error }
      : { ok: false, error: 'fetch_failed', detail: result.error }
  }
  if (result.status < 200 || result.status >= 300) {
    return { ok: false, error: 'fetch_failed', detail: `HTTP ${result.status}` }
  }
  if (result.body === null) {
    return {
      ok: false,
      error: 'empty_content',
      detail: `Unsupported content type ${result.contentType || '(none)'}; only HTML and plain-text pages can be extracted.`,
    }
  }

  let title: string | null
  let text: string
  if (result.contentType === 'text/plain') {
    title = null
    text = result.body.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_EXTRACTED_TEXT_CHARS)
  } else {
    const article = extractArticleText(result.body)
    title = article.title
    text = article.text
  }
  if (!text.trim()) {
    return {
      ok: false,
      error: 'empty_content',
      detail: 'No readable text found (the page may render its content with JavaScript).',
    }
  }
  return {
    ok: true,
    kind: 'article',
    title: title ?? new URL(result.finalUrl).hostname,
    text,
    url: result.finalUrl,
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function extractUrlContent(url: string): Promise<
  | { ok: true; kind: 'youtube'; title: string; author: string | null; language: string | null; text: string; url: string }
  | { ok: true; kind: 'article'; title: string; text: string; url: string }
  | { ok: false; error: 'invalid_url' | 'blocked_url' | 'fetch_failed' | 'transcript_unavailable' | 'empty_content'; detail?: string }
> {
  let parsed: URL
  try {
    parsed = new URL((url ?? '').trim())
  } catch {
    return { ok: false, error: 'invalid_url', detail: 'Not a valid URL.' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'invalid_url', detail: 'Only http and https URLs are supported.' }
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: 'invalid_url', detail: 'URLs with credentials are not supported.' }
  }
  if (isObviouslyPrivateHost(parsed.hostname)) {
    return { ok: false, error: 'blocked_url', detail: `${parsed.hostname} is not a public host.` }
  }

  const videoId = parseYouTubeVideoId(parsed.toString())
  if (videoId) return extractYouTube(videoId, parsed.toString())
  return extractArticle(parsed)
}
