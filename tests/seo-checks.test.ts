import { describe, expect, it } from 'vitest'
import { extractPage } from '@/lib/seo/extract'
import { checkPage, type PageFetchFacts } from '@/lib/seo/checks/page'
import { checkCrossPage, titleStem, type CrawledPage } from '@/lib/seo/checks/cross-page'
import { checkSite, emptySiteChecks } from '@/lib/seo/checks/site'
import { ISSUE_CATALOG } from '@/lib/seo/checks/catalog'

const URL_ = 'https://example.com/services'
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ')

function html(head: string, body: string, lang = 'en') {
  return `<!doctype html><html lang="${lang}"><head>${head}</head><body>${body}</body></html>`
}

const GOOD_HEAD = `
  <title>Emergency Plumbing Services in Boston | Acme</title>
  <meta name="description" content="Licensed Boston plumbers available 24/7 for leaks, clogs and water heaters. Upfront pricing, same-day service.">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="canonical" href="https://example.com/services">
  <meta property="og:title" content="Plumbing">
  <script type="application/ld+json">{"@type":"Plumber"}</script>`

function facts(page: string, over: Partial<PageFetchFacts> = {}): PageFetchFacts {
  return {
    url: URL_,
    error: null,
    httpStatus: 200,
    redirectStatuses: [],
    ttfbMs: 120,
    isHtml: true,
    extracted: extractPage(page, URL_),
    ...over,
  }
}

const codes = (f: { code: string }[]) => f.map((x) => x.code).sort()

describe('extractPage', () => {
  it('extracts the on-page facts', () => {
    const x = extractPage(
      html(
        GOOD_HEAD,
        `<h1>Plumbing</h1><img src="a.png"><img src="b.png" alt=""><img src="http://cdn.x.com/c.png" alt="c">
         <a href="/about">About</a><a href="/about#team">Team</a><a href="https://other.com">x</a>
         <a href="/file.pdf">pdf</a><a href="/private" rel="nofollow">p</a><a href="mailto:a@b.c">m</a>
         <script>var hidden = "lots of words here"</script><p>${words(20)}</p>`,
      ),
      URL_,
    )
    expect(x.title).toBe('Emergency Plumbing Services in Boston | Acme')
    expect(x.h1Count).toBe(1)
    expect(x.canonical).toBe(URL_)
    expect(x.imagesTotal).toBe(3)
    expect(x.imagesMissingAlt).toBe(1)
    expect(x.mixedContent).toEqual(['http://cdn.x.com/c.png'])
    expect(x.internalLinks).toEqual(['https://example.com/about'])
    expect(x.externalLinkCount).toBe(1)
    expect(x.hasStructuredData).toBe(true)
    expect(x.wordCount).toBeLessThan(40)
  })

  it('reads noindex from meta and from the X-Robots-Tag header', () => {
    expect(extractPage(html('<meta name="robots" content="NOINDEX, follow">', ''), URL_).noindex).toBe(true)
    expect(extractPage(html('', ''), URL_, { 'x-robots-tag': 'noindex' }).noindex).toBe(true)
    expect(extractPage(html('', ''), URL_).noindex).toBe(false)
  })

  it('drops all links from a nofollow page', () => {
    const x = extractPage(html('<meta name="robots" content="nofollow">', '<a href="/a">a</a>'), URL_)
    expect(x.internalLinks).toEqual([])
  })
})

describe('checkPage', () => {
  it('raises nothing on a well-formed page', () => {
    const page = html(GOOD_HEAD, `<h1>Plumbing</h1><p>${words(400)}</p>`)
    expect(checkPage(facts(page))).toEqual([])
  })

  it('flags missing on-page elements', () => {
    const page = `<html><head></head><body><h1>a</h1><h1>b</h1><img src="x.png"><p>${words(50)}</p></body></html>`
    expect(codes(checkPage(facts(page)))).toEqual(
      [
        'canonical_missing',
        'h1_multiple',
        'images_missing_alt',
        'lang_missing',
        'meta_description_missing',
        'social_tags_missing',
        'structured_data_missing',
        'thin_content',
        'title_missing',
        'viewport_missing',
      ].sort(),
    )
  })

  it('flags out-of-range title and description lengths', () => {
    const page = html(
      GOOD_HEAD.replace(/<title>.*<\/title>/, '<title>Home</title>').replace(/content="Licensed[^"]*"/, 'content="Short"'),
      `<h1>x</h1><p>${words(400)}</p>`,
    )
    expect(codes(checkPage(facts(page)))).toEqual(['meta_description_length', 'title_length'])
  })

  it('skips content-quality checks on noindex pages', () => {
    const page = html('<title>Thank you for contacting our team today</title><meta name="robots" content="noindex"><meta name="viewport" content="x">', '<p>Thanks</p>')
    expect(codes(checkPage(facts(page)))).toEqual([])
  })

  it('reports HTTP errors, failures, chains and temporary redirects', () => {
    expect(codes(checkPage(facts('', { httpStatus: 404, extracted: null })))).toEqual(['http_4xx'])
    expect(codes(checkPage(facts('', { httpStatus: 503, extracted: null })))).toEqual(['http_5xx'])
    expect(codes(checkPage(facts('', { error: 'Timed out', httpStatus: null, extracted: null })))).toEqual(['fetch_failed'])
    expect(codes(checkPage(facts('', { httpStatus: 301, redirectStatuses: [301, 302], extracted: null })))).toEqual([
      'redirect_chain',
      'redirect_temporary',
    ])
    expect(checkPage(facts('', { httpStatus: 301, redirectStatuses: [301], extracted: null }))).toEqual([])
  })

  it('flags slow TTFB and canonical pointing elsewhere', () => {
    const page = html(GOOD_HEAD.replace('href="https://example.com/services"', 'href="/services/"'), `<h1>x</h1><p>${words(400)}</p>`)
    expect(codes(checkPage(facts(page, { ttfbMs: 1500 })))).toEqual(['canonical_elsewhere', 'slow_ttfb'])
  })
})

function page(url: string, over: Partial<CrawledPage> = {}): CrawledPage {
  return {
    url,
    httpStatus: 200,
    redirectTo: null,
    isHtml: true,
    title: `Title of ${url}`,
    metaDescription: `Description of ${url}`,
    contentHash: `hash-${url}`,
    canonical: url,
    indexable: true,
    inSitemap: false,
    links: [],
    ...over,
  }
}

describe('checkCrossPage', () => {
  const HOME = 'https://example.com/'

  it('finds broken links and links through redirects on the source page', () => {
    const pages = [
      page(HOME, { links: ['https://example.com/gone', 'https://example.com/old', 'https://example.com/ok'] }),
      page('https://example.com/gone', { httpStatus: 404 }),
      page('https://example.com/old', { httpStatus: 301, redirectTo: 'https://example.com/ok' }),
      page('https://example.com/ok'),
    ]
    const { findings, inlinks } = checkCrossPage(pages, HOME)
    expect(findings.filter((f) => f.url === HOME).map((f) => f.code).sort()).toEqual(['broken_internal_link', 'links_to_redirect'])
    expect(inlinks.get('https://example.com/ok')).toBe(1)
    expect(inlinks.get(HOME)).toBe(0)
  })

  it('groups duplicate titles, descriptions and content among indexable pages only', () => {
    const pages = [
      page('https://example.com/a', { title: 'Same', metaDescription: 'D', contentHash: 'h' }),
      page('https://example.com/b', { title: 'same', metaDescription: 'd', contentHash: 'h' }),
      page('https://example.com/c', { title: 'Same', metaDescription: 'D', contentHash: 'h', indexable: false }),
      page('https://example.com/d', { title: 'Same', canonical: 'https://example.com/a' }),
    ]
    const { findings } = checkCrossPage(pages, HOME)
    const byCode = (c: string) => findings.filter((f) => f.code === c).map((f) => f.url).sort()
    expect(byCode('title_duplicate')).toEqual(['https://example.com/a', 'https://example.com/b'])
    expect(byCode('meta_description_duplicate')).toEqual(['https://example.com/a', 'https://example.com/b'])
    expect(byCode('duplicate_content')).toEqual(['https://example.com/a', 'https://example.com/b'])
  })

  it('flags near-duplicate titles that only differ by brand suffix', () => {
    expect(titleStem('Emergency Plumbing Boston | Acme')).toBe(titleStem('Emergency Plumbing Boston – Acme Co'))
    const { findings } = checkCrossPage(
      [
        page('https://example.com/a', { title: 'Emergency Plumbing Boston | Acme' }),
        page('https://example.com/b', { title: 'Emergency Plumbing Boston - Acme Co' }),
      ],
      HOME,
    )
    expect(findings.map((f) => f.code)).toEqual(['title_cannibalization', 'title_cannibalization'])
  })

  it('checks sitemap membership: non-200, noindex and orphans', () => {
    const pages = [
      page(HOME, { inSitemap: true, links: ['https://example.com/linked'] }),
      page('https://example.com/linked', { inSitemap: true }),
      page('https://example.com/orphan', { inSitemap: true }),
      page('https://example.com/hidden', { inSitemap: true, indexable: false }),
      page('https://example.com/moved', { inSitemap: true, httpStatus: 301, redirectTo: HOME }),
    ]
    const { findings } = checkCrossPage(pages, HOME)
    expect(findings.map((f) => `${f.code} ${f.url}`).sort()).toEqual(
      [
        'noindex_in_sitemap https://example.com/hidden',
        'orphan_page https://example.com/hidden',
        'orphan_page https://example.com/orphan',
        'sitemap_non_200 https://example.com/moved',
      ].sort(),
    )
  })

  it('flags canonicals that point at a broken or redirecting page', () => {
    const pages = [
      page('https://example.com/a', { canonical: 'https://example.com/b' }),
      page('https://example.com/b', { httpStatus: 404 }),
    ]
    expect(checkCrossPage(pages, HOME).findings.map((f) => f.code)).toContain('canonical_to_broken')
  })
})

describe('checkSite', () => {
  const ROOT = 'https://example.com/'

  it('reports robots, sitemap, https and host problems', () => {
    const site = {
      ...emptySiteChecks(),
      robots: { status: 200, blocksAll: true, sitemaps: [] },
      sitemap: { found: false, valid: false, urls: 0, sources: [] },
      httpProbe: { finalUrl: 'http://example.com/', status: 200 },
      twinProbe: { url: 'https://www.example.com/', finalUrl: 'https://www.example.com/', status: 200 },
    }
    expect(codes(checkSite(site, ROOT))).toEqual(['no_https_redirect', 'robots_blocks_all', 'sitemap_missing', 'www_inconsistent'])
  })

  it('is quiet on a healthy site', () => {
    const site = {
      ...emptySiteChecks(),
      robots: { status: 200, blocksAll: false, sitemaps: ['https://example.com/sitemap.xml'] },
      sitemap: { found: true, valid: true, urls: 10, sources: ['https://example.com/sitemap.xml'] },
      httpProbe: { finalUrl: 'https://example.com/', status: 200 },
      twinProbe: { url: 'https://www.example.com/', finalUrl: 'https://example.com/', status: 200 },
      cwv: [{ url: ROOT, performance: 92, lcpMs: 1800, cls: 0.02, inpMs: 120, fieldCategory: 'FAST' }],
    }
    expect(checkSite(site, ROOT)).toEqual([])
  })

  it('flags poor Core Web Vitals and a blocked crawl', () => {
    const site = {
      ...emptySiteChecks(),
      crawlBlocked: { status: 403, reason: 'cloudflare challenge' },
      cwv: [{ url: ROOT, performance: 31, lcpMs: 6200, cls: 0.1, inpMs: null, fieldCategory: null }],
    }
    expect(codes(checkSite(site, ROOT))).toEqual(['crawl_blocked', 'cwv_poor'])
  })
})

describe('catalog', () => {
  it('has copy for every code', () => {
    for (const def of Object.values(ISSUE_CATALOG)) {
      expect(def.title.length).toBeGreaterThan(3)
      expect(def.fix.length).toBeGreaterThan(10)
    }
  })
})
