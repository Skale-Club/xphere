// URL extraction helpers for Global Knowledge (pure parsing, no network).
import { describe, expect, it } from 'vitest'
import {
  decodeHtmlEntities,
  extractArticleText,
  extractAssignedJson,
  extractHtmlTitle,
  extractUrlContent,
  htmlFragmentToText,
  json3ToText,
  parseYouTubeVideoId,
  parseYouTubeWatchPage,
  pickCaptionTrack,
  timedTextXmlToText,
} from '@/lib/knowledge/url-extract'

describe('parseYouTubeVideoId', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?si=abc', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/live/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
  ])('parses %s', (url, id) => {
    expect(parseYouTubeVideoId(url)).toBe(id)
  })

  it.each([
    'https://www.youtube.com/channel/UC123',
    'https://www.youtube.com/watch?v=short',
    'https://example.com/watch?v=dQw4w9WgXcQ',
    'https://notyoutube.com/watch?v=dQw4w9WgXcQ',
    'ftp://youtu.be/dQw4w9WgXcQ',
    'not a url',
  ])('rejects %s', (url) => {
    expect(parseYouTubeVideoId(url)).toBeNull()
  })
})

describe('decodeHtmlEntities', () => {
  it('decodes named, decimal and hex entities', () => {
    expect(decodeHtmlEntities('a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39; &#x2014; caf&eacute; &nbsp;x'))
      .toBe('a & b <c> "d" \'e\' — café  x')
  })

  it('leaves unknown entities alone', () => {
    expect(decodeHtmlEntities('&unknownthing; &#xZZ;')).toBe('&unknownthing; &#xZZ;')
  })
})

describe('HTML extraction', () => {
  const html = `<!doctype html>
<html><head>
  <title>Fallback title | Blog</title>
  <meta content="The real &amp; best title" property="og:title">
  <style>.x{color:red}</style>
</head>
<body>
  <header><nav><a href="/">Home</a> <a href="/blog">Blog</a></nav></header>
  <aside>Subscribe to our newsletter!</aside>
  <main>
    <article>
      <h1>How to scale Meta Ads</h1>
      <p>Start with a <strong>broad</strong> audience.<br>Then iterate.</p>
      <script>window.tracking = "{not text}"</script>
      <ul><li>Test hooks</li><li>Test offers</li></ul>
      <p>Budget &mdash; increase 20%   per   day.</p>
      <form><input value="email"><button>Join</button></form>
    </article>
  </main>
  <footer>© 2026 Example</footer>
</body></html>`

  it('prefers og:title and falls back to <title>', () => {
    expect(extractHtmlTitle(html)).toBe('The real & best title')
    expect(extractHtmlTitle('<html><head><title> Only  title </title></head></html>')).toBe('Only title')
    expect(extractHtmlTitle('<p>none</p>')).toBeNull()
  })

  it('keeps the article body and drops chrome, scripts and forms', () => {
    const { title, text } = extractArticleText(html)
    expect(title).toBe('The real & best title')
    expect(text).toContain('How to scale Meta Ads')
    expect(text).toContain('Start with a broad audience.\nThen iterate.')
    expect(text).toContain('- Test hooks\n- Test offers')
    expect(text).toContain('Budget — increase 20% per day.')
    expect(text).not.toContain('Home')
    expect(text).not.toContain('newsletter')
    expect(text).not.toContain('tracking')
    expect(text).not.toContain('Join')
    expect(text).not.toContain('2026 Example')
    expect(text).not.toMatch(/\n{3,}/)
  })

  it('falls back to the body when there is no article/main', () => {
    const body = `<html><body><div><p>${'Long paragraph text. '.repeat(20)}</p><p>Second.</p></div></body></html>`
    const { text } = extractArticleText(body)
    expect(text).toContain('Long paragraph text.')
    expect(text).toContain('Second.')
    expect(text.split('\n\n').length).toBe(2)
  })

  it('caps the extracted text', () => {
    const huge = `<article><p>${'word '.repeat(60_000)}</p></article>`
    expect(extractArticleText(huge).text.length).toBeLessThanOrEqual(200_000)
  })

  it('converts fragments with paragraph breaks', () => {
    expect(htmlFragmentToText('<p>One</p><p>Two</p><!-- c --><div>Three</div>')).toBe('One\n\nTwo\n\nThree')
  })
})

describe('YouTube parsing', () => {
  const player = {
    videoDetails: { title: 'Meta Ads em 2026', author: 'Canal X' },
    playabilityStatus: { status: 'OK' },
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [
          { baseUrl: 'https://www.youtube.com/api/timedtext?v=1&lang=pt&kind=asr', languageCode: 'pt', kind: 'asr', name: { simpleText: 'Portuguese (auto)' } },
          { baseUrl: 'https://www.youtube.com/api/timedtext?v=1&lang=en', languageCode: 'en', name: { runs: [{ text: 'English' }] } },
          { baseUrl: 'https://www.youtube.com/api/timedtext?v=1&lang=es', languageCode: 'es' },
        ],
      },
    },
  }
  const watchHtml = `<html><script>var foo = {"a":"}"};</script>
<script nonce="x">var ytInitialPlayerResponse = ${JSON.stringify(player)};var meta = {};</script></html>`

  it('extracts the assigned JSON with braces inside strings', () => {
    expect(extractAssignedJson('x = 1; var foo = {"a":"}{","b":{"c":"\\"}"}};', 'foo'))
      .toEqual({ a: '}{', b: { c: '"}' } })
    expect(extractAssignedJson('nothing here', 'foo')).toBeNull()
  })

  it('skips non-assignment mentions of the marker', () => {
    const source = 'if (window["ytInitialPlayerResponse"]) {}; var ytInitialPlayerResponse = {"ok":true};'
    expect(extractAssignedJson(source, 'ytInitialPlayerResponse')).toEqual({ ok: true })
  })

  it('reads title, author and tracks from the watch page', () => {
    const info = parseYouTubeWatchPage(watchHtml)
    expect(info).toMatchObject({ title: 'Meta Ads em 2026', author: 'Canal X', playability: 'OK' })
    expect(info?.tracks.map((track) => track.languageCode)).toEqual(['pt', 'en', 'es'])
    expect(info?.tracks[1].name).toBe('English')
    expect(parseYouTubeWatchPage('<html>consent page</html>')).toBeNull()
  })

  it('prefers manual tracks, then pt, then en, then the first', () => {
    const info = parseYouTubeWatchPage(watchHtml)!
    expect(pickCaptionTrack(info.tracks)?.languageCode).toBe('en')
    expect(pickCaptionTrack([
      { baseUrl: 'a', languageCode: 'en' },
      { baseUrl: 'b', languageCode: 'pt-BR' },
    ])?.languageCode).toBe('pt-BR')
    expect(pickCaptionTrack([
      { baseUrl: 'a', languageCode: 'de', kind: 'asr' },
      { baseUrl: 'b', languageCode: 'en', kind: 'asr' },
    ])?.languageCode).toBe('en')
    expect(pickCaptionTrack([{ baseUrl: 'a', languageCode: 'fr' }])?.languageCode).toBe('fr')
    expect(pickCaptionTrack([])).toBeNull()
  })

  it('joins json3 events into paragraphs, splitting on long pauses', () => {
    const json3 = {
      events: [
        { tStartMs: 0, dDurationMs: 1000 },
        { tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: 'Hello' }, { utf8: ' everyone' }] },
        { tStartMs: 2000, dDurationMs: 1500, segs: [{ utf8: '\n' }] },
        { tStartMs: 2100, dDurationMs: 1500, segs: [{ utf8: 'welcome\nback.' }] },
        { tStartMs: 9000, dDurationMs: 1000, segs: [{ utf8: 'New topic.' }] },
      ],
    }
    expect(json3ToText(json3)).toBe('Hello everyone welcome back.\n\nNew topic.')
    expect(json3ToText({})).toBe('')
    expect(json3ToText(null)).toBe('')
  })

  it('parses legacy timedtext XML with double-encoded entities', () => {
    const xml = '<?xml version="1.0"?><transcript><text start="0" dur="1.5">It&amp;#39;s here</text>'
      + '<text start="1.5" dur="1">and now</text><text start="10" dur="1">later</text></transcript>'
    expect(timedTextXmlToText(xml)).toBe("It's here and now\n\nlater")
  })

  it('parses srv3 <p t= d=> XML', () => {
    const xml = '<timedtext><body><p t="0" d="1000">one</p><p t="1000" d="1000">two</p></body></timedtext>'
    expect(timedTextXmlToText(xml)).toBe('one two')
  })
})

describe('extractUrlContent input guards (no network)', () => {
  it('rejects invalid URLs and schemes', async () => {
    expect(await extractUrlContent('nope')).toMatchObject({ ok: false, error: 'invalid_url' })
    expect(await extractUrlContent('ftp://example.com/file')).toMatchObject({ ok: false, error: 'invalid_url' })
    expect(await extractUrlContent('file:///etc/passwd')).toMatchObject({ ok: false, error: 'invalid_url' })
    expect(await extractUrlContent('https://user:pw@example.com')).toMatchObject({ ok: false, error: 'invalid_url' })
  })

  it.each([
    'http://localhost:3000/admin',
    'http://127.0.0.1/',
    'http://169.254.169.254/latest/meta-data',
    'http://10.0.0.5/',
    'http://192.168.1.1/',
    'http://[::1]/',
    'http://metadata.google.internal/',
  ])('blocks private host %s', async (url) => {
    expect(await extractUrlContent(url)).toMatchObject({ ok: false, error: 'blocked_url' })
  })
})
