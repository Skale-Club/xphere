import { describe, expect, it } from 'vitest'
import { isSameSite, looksLikePage, normalizeUrl, parseSiteInput } from '@/lib/seo/url'
import { parseRobots } from '@/lib/seo/robots'
import { parseSitemap } from '@/lib/seo/sitemap'

describe('normalizeUrl', () => {
  it('drops fragments, default ports and tracking params, sorts the rest', () => {
    expect(normalizeUrl('HTTPS://Example.COM:443/a?utm_source=x&b=2&a=1&gclid=z#top')).toBe('https://example.com/a?a=1&b=2')
  })

  it('resolves relative links against the page', () => {
    expect(normalizeUrl('../c', 'https://example.com/a/b/')).toBe('https://example.com/a/c')
    expect(normalizeUrl('/x', 'https://example.com/a')).toBe('https://example.com/x')
  })

  it('keeps the trailing slash distinction', () => {
    expect(normalizeUrl('https://example.com/a/')).not.toBe(normalizeUrl('https://example.com/a'))
  })

  it('rejects non-http schemes and credentials', () => {
    expect(normalizeUrl('mailto:a@b.com')).toBeNull()
    expect(normalizeUrl('javascript:void(0)')).toBeNull()
    expect(normalizeUrl('https://user:pw@example.com/')).toBeNull()
  })
})

describe('site scoping', () => {
  it('treats www and apex as the same site, subdomains as different', () => {
    expect(isSameSite('https://www.example.com/a', 'example.com')).toBe(true)
    expect(isSameSite('https://example.com/a', 'www.example.com')).toBe(true)
    expect(isSameSite('https://blog.example.com/a', 'example.com')).toBe(false)
    expect(isSameSite('https://example.com.evil.io/a', 'example.com')).toBe(false)
  })

  it('skips links to files', () => {
    expect(looksLikePage('https://example.com/brochure.pdf')).toBe(false)
    expect(looksLikePage('https://example.com/img/logo.PNG')).toBe(false)
    expect(looksLikePage('https://example.com/services')).toBe(true)
    expect(looksLikePage('https://example.com/page.html')).toBe(true)
  })
})

describe('parseSiteInput', () => {
  it('accepts bare domains and full URLs, returning the origin', () => {
    expect(parseSiteInput('example.com')).toEqual({ rootUrl: 'https://example.com/', host: 'example.com' })
    expect(parseSiteInput(' http://WWW.Example.com/about?x=1 ')).toEqual({ rootUrl: 'http://www.example.com/', host: 'www.example.com' })
  })

  it('rejects IPs, single labels and junk', () => {
    expect(parseSiteInput('localhost')).toBeNull()
    expect(parseSiteInput('10.0.0.1')).toBeNull()
    expect(parseSiteInput('ftp://example.com')).toBeNull()
    expect(parseSiteInput('')).toBeNull()
  })
})

describe('parseRobots', () => {
  const robots = parseRobots(
    [
      'User-agent: *',
      'Disallow: /admin',
      'Allow: /admin/public',
      'Disallow: /*.pdf$',
      '',
      'User-agent: BadBot',
      'Disallow: /',
      '',
      'Sitemap: https://example.com/sitemap.xml',
      'Sitemap: /sitemap-2.xml',
    ].join('\n'),
    'https://example.com/robots.txt',
  )

  it('applies longest-match allow/disallow for our agent', () => {
    expect(robots.isAllowed('/')).toBe(true)
    expect(robots.isAllowed('/admin/users')).toBe(false)
    expect(robots.isAllowed('/admin/public/page')).toBe(true)
    expect(robots.isAllowed('/files/a.pdf')).toBe(false)
    expect(robots.isAllowed('/files/a.pdf?x=1')).toBe(true)
  })

  it('uses the specific group for a named agent', () => {
    expect(robots.isAllowed('/', 'BadBot/2.0')).toBe(false)
    expect(robots.blocksAll()).toBe(false)
  })

  it('collects absolute sitemap URLs', () => {
    expect(robots.sitemaps).toEqual(['https://example.com/sitemap.xml', 'https://example.com/sitemap-2.xml'])
  })

  it('detects a site-wide block, and an empty Disallow allows everything', () => {
    expect(parseRobots('User-agent: *\nDisallow: /').blocksAll()).toBe(true)
    expect(parseRobots('User-agent: *\nDisallow:').blocksAll()).toBe(false)
  })
})

describe('parseSitemap', () => {
  it('reads a urlset', () => {
    const xml = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url><loc> https://example.com/ </loc></url><url><loc>https://example.com/a</loc></url></urlset>`
    expect(parseSitemap(xml)).toEqual({ kind: 'urlset', urls: ['https://example.com/', 'https://example.com/a'] })
  })

  it('reads a sitemap index', () => {
    const xml = `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <sitemap><loc>https://example.com/s1.xml</loc></sitemap></sitemapindex>`
    expect(parseSitemap(xml)).toEqual({ kind: 'index', sitemaps: ['https://example.com/s1.xml'] })
  })

  it('flags HTML served at /sitemap.xml as invalid', () => {
    expect(parseSitemap('<html><body>Not found</body></html>')).toEqual({ kind: 'invalid' })
  })
})
