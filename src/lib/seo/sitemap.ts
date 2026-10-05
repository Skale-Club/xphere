// sitemap.xml parsing: a <urlset> yields page URLs, a <sitemapindex> yields
// child sitemaps for the caller to fetch. Anything else is "invalid".

import * as cheerio from 'cheerio'

export type ParsedSitemap =
  | { kind: 'urlset'; urls: string[] }
  | { kind: 'index'; sitemaps: string[] }
  | { kind: 'invalid' }

export function parseSitemap(xml: string): ParsedSitemap {
  if (!/<(urlset|sitemapindex)[\s>]/i.test(xml)) return { kind: 'invalid' }
  const $ = cheerio.load(xml, { xml: true })
  const locs = (selector: string) =>
    $(selector)
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((v: string) => /^https?:\/\//i.test(v))

  if ($('sitemapindex').length) return { kind: 'index', sitemaps: locs('sitemapindex > sitemap > loc') }
  if ($('urlset').length) return { kind: 'urlset', urls: locs('urlset > url > loc') }
  return { kind: 'invalid' }
}
