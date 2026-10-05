// Minimal robots.txt parser (RFC 9309): groups by user-agent, longest-match
// Allow/Disallow with `*` and `$` wildcards, plus Sitemap: lines.

export const CRAWLER_UA_TOKEN = 'XphereBot'

interface Rule {
  allow: boolean
  pattern: string
}

export interface Robots {
  /** Sitemap URLs declared in the file (absolute). */
  sitemaps: string[]
  /** True when `path` (pathname + search) may be fetched by `ua`. */
  isAllowed(path: string, ua?: string): boolean
  /** True when the group that applies to `ua` disallows the whole site. */
  blocksAll(ua?: string): boolean
}

export function parseRobots(text: string, baseUrl?: string): Robots {
  const groups: Array<{ agents: string[]; rules: Rule[] }> = []
  const sitemaps: string[] = []
  let current: { agents: string[]; rules: Rule[] } | null = null
  let lastWasAgent = false

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line) continue
    const idx = line.indexOf(':')
    if (idx < 0) continue
    const field = line.slice(0, idx).trim().toLowerCase()
    const value = line.slice(idx + 1).trim()

    if (field === 'sitemap') {
      try {
        sitemaps.push(new URL(value, baseUrl).toString())
      } catch {
        /* ignore malformed sitemap lines */
      }
      continue
    }
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] }
        groups.push(current)
      }
      current.agents.push(value.toLowerCase())
      lastWasAgent = true
      continue
    }
    if (field === 'allow' || field === 'disallow') {
      lastWasAgent = false
      if (!current) continue
      // An empty Disallow means "allow everything" — it adds no rule.
      if (!value) continue
      current.rules.push({ allow: field === 'allow', pattern: value })
      continue
    }
    lastWasAgent = false
  }

  function rulesFor(ua: string): Rule[] {
    const token = ua.toLowerCase()
    const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && token.includes(a)))
    if (specific.length) return specific.flatMap((g) => g.rules)
    return groups.filter((g) => g.agents.includes('*')).flatMap((g) => g.rules)
  }

  function isAllowed(path: string, ua = CRAWLER_UA_TOKEN): boolean {
    let best: Rule | null = null
    for (const rule of rulesFor(ua)) {
      if (!matches(rule.pattern, path)) continue
      if (
        !best ||
        rule.pattern.length > best.pattern.length ||
        (rule.pattern.length === best.pattern.length && rule.allow && !best.allow)
      ) {
        best = rule
      }
    }
    return best ? best.allow : true
  }

  return {
    sitemaps,
    isAllowed,
    blocksAll: (ua = CRAWLER_UA_TOKEN) => !isAllowed('/', ua) && !isAllowed('/index.html', ua),
  }
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$')
  const body = anchored ? pattern.slice(0, -1) : pattern
  const regex = body
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${regex}${anchored ? '$' : ''}`).test(path)
}
