// The SEO issue catalog: every code the audit can raise, with its severity,
// scope and the copy the UI shows. Codes are persisted in
// seo_audit_issues.code — never rename one; retire it and add a new code.

export type IssueSeverity = 'error' | 'warning' | 'notice'
/** `page` issues attach to one URL; `site` issues describe the whole site. */
export type IssueScope = 'page' | 'site'

export interface IssueDefinition {
  code: string
  severity: IssueSeverity
  scope: IssueScope
  title: string
  /** Why it matters, one sentence. */
  why: string
  /** What to do about it. */
  fix: string
}

const DEFINITIONS = [
  // ── Errors ────────────────────────────────────────────────────────────────
  { code: 'http_4xx', severity: 'error', scope: 'page', title: 'Page returns 4xx',
    why: 'Visitors and Google land on a dead page; links to it waste authority.',
    fix: 'Restore the page, 301-redirect it to the closest live page, or remove the links pointing to it.' },
  { code: 'http_5xx', severity: 'error', scope: 'page', title: 'Page returns 5xx',
    why: 'Server errors stop Google from crawling and can drop the page from the index.',
    fix: 'Check the server/application logs for this URL and fix the error.' },
  { code: 'fetch_failed', severity: 'error', scope: 'page', title: 'Page could not be fetched',
    why: 'The page timed out or the connection failed, so neither we nor Google can read it.',
    fix: 'Check that the page loads in under 15 seconds and the server accepts connections.' },
  { code: 'broken_internal_link', severity: 'error', scope: 'page', title: 'Links to a broken page',
    why: 'Broken internal links frustrate visitors and leak link equity.',
    fix: 'Update or remove the links listed in the details so they point to a live page.' },
  { code: 'title_missing', severity: 'error', scope: 'page', title: 'Title tag missing',
    why: 'The title is the headline Google shows in results; without it Google invents one.',
    fix: 'Add a unique, descriptive <title> of 30–60 characters.' },
  { code: 'noindex_in_sitemap', severity: 'error', scope: 'page', title: 'Noindex page in sitemap',
    why: 'The sitemap asks Google to index a page that tells Google not to index it.',
    fix: 'Remove the page from the sitemap, or drop the noindex if it should rank.' },
  { code: 'canonical_to_broken', severity: 'error', scope: 'page', title: 'Canonical points to a non-200 page',
    why: 'Google ignores canonicals to broken or redirecting URLs and may index the wrong version.',
    fix: 'Point the canonical at the live, final URL of the preferred page.' },
  { code: 'mixed_content', severity: 'error', scope: 'page', title: 'Mixed content (http resources on https)',
    why: 'Browsers block or warn about insecure resources, breaking the page and trust signals.',
    fix: 'Load the listed images, scripts and stylesheets over https.' },
  { code: 'robots_blocks_all', severity: 'error', scope: 'site', title: 'robots.txt blocks the whole site',
    why: 'Search engines are told not to crawl any page.',
    fix: 'Remove "Disallow: /" for User-agent: * unless the site must stay out of search.' },
  { code: 'crawl_blocked', severity: 'error', scope: 'site', title: 'Crawler blocked by the site',
    why: 'The site (often a firewall or bot protection) refused our crawler, so the audit could not run.',
    fix: 'Allow the user agent "XphereBot" in your firewall / Cloudflare bot settings, then re-run the audit.' },
  { code: 'no_https_redirect', severity: 'error', scope: 'site', title: 'http:// does not redirect to https://',
    why: 'Two copies of the site exist and the insecure one can be indexed.',
    fix: 'Add a site-wide 301 redirect from http:// to https://.' },

  // ── Warnings ──────────────────────────────────────────────────────────────
  { code: 'redirect_chain', severity: 'warning', scope: 'page', title: 'Redirect chain',
    why: 'Each extra hop slows the page and dilutes link equity.',
    fix: 'Redirect straight to the final URL in one hop.' },
  { code: 'redirect_temporary', severity: 'warning', scope: 'page', title: 'Temporary redirect (302/307)',
    why: 'Temporary redirects do not consolidate ranking signals on the target.',
    fix: 'Use a 301 (permanent) redirect if the move is permanent.' },
  { code: 'title_duplicate', severity: 'warning', scope: 'page', title: 'Duplicate title',
    why: 'Pages with the same title compete with each other and confuse Google.',
    fix: 'Give each page a unique title that describes its own content.' },
  { code: 'title_length', severity: 'warning', scope: 'page', title: 'Title too short or too long',
    why: 'Titles under 30 characters waste space; over 60 get cut off in results.',
    fix: 'Rewrite the title to 30–60 characters with the main keyword near the start.' },
  { code: 'meta_description_missing', severity: 'warning', scope: 'page', title: 'Meta description missing',
    why: 'Google writes its own snippet, which usually converts worse.',
    fix: 'Add a meta description of 70–160 characters that sells the click.' },
  { code: 'meta_description_duplicate', severity: 'warning', scope: 'page', title: 'Duplicate meta description',
    why: 'Identical snippets make results look interchangeable.',
    fix: 'Write a unique description for each page.' },
  { code: 'h1_missing', severity: 'warning', scope: 'page', title: 'H1 missing',
    why: 'The H1 tells visitors and Google what the page is about.',
    fix: 'Add one H1 that states the page topic.' },
  { code: 'canonical_missing', severity: 'warning', scope: 'page', title: 'Canonical tag missing',
    why: 'Without a canonical, URL variants (params, trailing slash) can be indexed as duplicates.',
    fix: 'Add <link rel="canonical"> pointing to the preferred URL (usually the page itself).' },
  { code: 'images_missing_alt', severity: 'warning', scope: 'page', title: 'Images without alt text',
    why: 'Alt text is how Google and screen readers understand images.',
    fix: 'Add descriptive alt text (use alt="" for purely decorative images).' },
  { code: 'thin_content', severity: 'warning', scope: 'page', title: 'Thin content (< 300 words)',
    why: 'Pages with little text rarely rank for anything competitive.',
    fix: 'Expand the page with useful content, or noindex it if it is a utility page.' },
  { code: 'duplicate_content', severity: 'warning', scope: 'page', title: 'Duplicate content',
    why: 'Pages with the same body text split ranking signals.',
    fix: 'Merge the pages, or set a canonical from the copies to the main version.' },
  { code: 'viewport_missing', severity: 'warning', scope: 'page', title: 'Viewport meta tag missing',
    why: 'Without it the page is not mobile-friendly, and Google indexes mobile-first.',
    fix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.' },
  { code: 'slow_ttfb', severity: 'warning', scope: 'page', title: 'Slow server response (TTFB > 800 ms)',
    why: 'A slow first byte delays everything else and hurts Core Web Vitals.',
    fix: 'Add caching/CDN, or speed up the server-side work for this page.' },
  { code: 'orphan_page', severity: 'warning', scope: 'page', title: 'Orphan page (in sitemap, no internal links)',
    why: 'Pages nobody links to get crawled rarely and rank poorly.',
    fix: 'Link to this page from relevant pages or the navigation.' },
  { code: 'sitemap_non_200', severity: 'warning', scope: 'page', title: 'Sitemap lists a non-200 URL',
    why: 'Sitemaps should only list live, final URLs; errors waste crawl budget.',
    fix: 'Remove broken and redirecting URLs from the sitemap.' },
  { code: 'sitemap_missing', severity: 'warning', scope: 'site', title: 'No sitemap found',
    why: 'A sitemap helps Google discover every page you want indexed.',
    fix: 'Publish /sitemap.xml and reference it in robots.txt.' },
  { code: 'sitemap_invalid', severity: 'warning', scope: 'site', title: 'Sitemap could not be parsed',
    why: 'Google cannot read an invalid sitemap.',
    fix: 'Make sure the sitemap is valid XML (<urlset> or <sitemapindex>).' },
  { code: 'www_inconsistent', severity: 'warning', scope: 'site', title: 'www and non-www both resolve',
    why: 'Two hosts serving the same site split signals between duplicates.',
    fix: 'Pick one host and 301-redirect the other to it.' },
  { code: 'cwv_poor', severity: 'warning', scope: 'site', title: 'Poor Core Web Vitals (mobile)',
    why: 'Slow loading or layout shifts hurt rankings and conversions.',
    fix: 'Open the PageSpeed details for the affected pages and fix the top opportunities.' },

  // ── Notices ───────────────────────────────────────────────────────────────
  { code: 'meta_description_length', severity: 'notice', scope: 'page', title: 'Meta description too short or too long',
    why: 'Descriptions outside 70–160 characters are padded or truncated by Google.',
    fix: 'Rewrite the description to 70–160 characters.' },
  { code: 'h1_multiple', severity: 'notice', scope: 'page', title: 'More than one H1',
    why: 'Several H1s blur what the page is primarily about.',
    fix: 'Keep one H1 and demote the others to H2.' },
  { code: 'canonical_elsewhere', severity: 'notice', scope: 'page', title: 'Canonical points to another URL',
    why: 'This page asks Google to index a different URL instead. Fine if intended.',
    fix: 'Confirm the canonical target is the version you want ranking.' },
  { code: 'title_cannibalization', severity: 'notice', scope: 'page', title: 'Near-duplicate titles',
    why: 'Titles that only differ by a suffix may target the same query.',
    fix: 'Differentiate the titles, or consolidate the pages if they cover the same topic.' },
  { code: 'lang_missing', severity: 'notice', scope: 'page', title: 'HTML lang attribute missing',
    why: 'The lang attribute tells search engines and screen readers the page language.',
    fix: 'Add lang (e.g. <html lang="en">).' },
  { code: 'social_tags_missing', severity: 'notice', scope: 'page', title: 'Open Graph / Twitter tags missing',
    why: 'Shared links show a poor preview without them.',
    fix: 'Add og:title, og:description, og:image and twitter:card.' },
  { code: 'structured_data_missing', severity: 'notice', scope: 'page', title: 'No structured data',
    why: 'Schema.org markup makes the page eligible for rich results.',
    fix: 'Add JSON-LD for the page type (Organization, LocalBusiness, Article, Product…).' },
  { code: 'links_to_redirect', severity: 'notice', scope: 'page', title: 'Links to a redirecting URL',
    why: 'Internal links through redirects add a hop on every click.',
    fix: 'Update the listed links to point at the final URL.' },
  { code: 'robots_missing', severity: 'notice', scope: 'site', title: 'No robots.txt',
    why: 'Not harmful, but robots.txt is where crawlers look for your sitemap.',
    fix: 'Publish /robots.txt with a Sitemap: line.' },
] as const satisfies readonly IssueDefinition[]

export type IssueCode = (typeof DEFINITIONS)[number]['code']

export const ISSUE_CATALOG: Record<IssueCode, IssueDefinition> = Object.fromEntries(
  DEFINITIONS.map((d) => [d.code, d]),
) as Record<IssueCode, IssueDefinition>

export function issueDefinition(code: string): IssueDefinition | null {
  return (ISSUE_CATALOG as Record<string, IssueDefinition>)[code] ?? null
}

export const SEVERITY_ORDER: Record<IssueSeverity, number> = { error: 0, warning: 1, notice: 2 }

/** One issue occurrence, before it is written to seo_audit_issues. */
export interface IssueFinding {
  code: IssueCode
  /** Page URL for page-scoped issues; null for site-scoped ones. */
  url: string | null
  details?: Record<string, unknown>
}
