/**
 * Bot defense core — framework-agnostic, dependency-free, Edge-safe.
 *
 * The same file is mirrored in every Skale Club project (xkedule, websites,
 * skaleclub, xphere, xtimator, stuscle). It holds the three pieces that must
 * behave identically everywhere; each project only adds a thin adapter for
 * its own framework (Express middleware, Next.js proxy/middleware, Medusa).
 *
 *  1. resolveClientIp — the real visitor IP, whether or not the host sits
 *     behind Cloudflare. A tenant's custom domain may point straight at our
 *     origin, so Cloudflare can never be assumed: CF-Connecting-IP is honoured
 *     ONLY when the peer that reached our own proxy is a Cloudflare address.
 *     Everything else comes from walking X-Forwarded-For right-to-left, because
 *     the left end is whatever the client chose to send.
 *  2. Trap paths + escalating ban — scanners probing /.env, /.git/, xmlrpc.php
 *     and friends get a 404 and a temporary ban (fail2ban-style: 1h → 24h → 7d
 *     for repeat offenders). Paths a human might type (/wp-admin) are "soft":
 *     they need several hits in a short window before a ban.
 *  3. Honeypot check for public forms — hidden field + minimum fill time. A
 *     tripped form is dropped silently by the caller; repeated trips from one
 *     IP count as soft strikes toward a ban.
 *
 * Safety rails: private/loopback addresses and Cloudflare edge addresses are
 * never banned (either would mean the IP resolution is wrong and we'd ban
 * everyone behind that hop), self-declared search crawlers are never banned
 * (they still get the 404), and BOT_DEFENSE_MODE=log|off turns enforcement
 * down without a code change.
 *
 * State is in-process memory, bounded. A deploy clears it, which is fine:
 * bans are short and scanners re-announce themselves within minutes.
 */

// ─── Configuration ──────────────────────────────────────────────────────────

export type BotDefenseMode = 'enforce' | 'log' | 'off'

function readEnv(name: string): string | undefined {
  try {
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    return env?.[name]
  } catch {
    return undefined
  }
}

export function botDefenseMode(): BotDefenseMode {
  const raw = (readEnv('BOT_DEFENSE_MODE') ?? '').trim().toLowerCase()
  if (raw === 'log' || raw === 'off') return raw
  return 'enforce'
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Ban length by offense number (1st, 2nd, 3rd+). fail2ban "recidive" style. */
export const BAN_LADDER_MS = [1 * HOUR, 24 * HOUR, 7 * DAY] as const
/** How long a past offense still counts toward the ladder. */
export const OFFENSE_MEMORY_MS = 30 * DAY
/** Soft strikes (soft trap paths, honeypot trips) needed within the window. */
export const SOFT_STRIKE_LIMIT = 5
export const SOFT_STRIKE_WINDOW_MS = 10 * MINUTE
/** Minimum time a human needs to fill a form. */
export const MIN_FORM_FILL_MS = 3000
/** Upper bound on tracked IPs, so a botnet cannot grow memory without limit. */
const MAX_TRACKED_IPS = 50_000

// ─── IP parsing ─────────────────────────────────────────────────────────────

type ParsedIp = { v: 4; parts: number[] } | { v: 6; parts: number[] }

function parseIpv4(s: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s)
  if (!m) return null
  const parts = m.slice(1).map(Number)
  return parts.every((n) => n >= 0 && n <= 255) ? parts : null
}

function parseIpv6(input: string): number[] | null {
  if (!/^[0-9a-fA-F:.]+$/.test(input) || !input.includes(':')) return null
  let s = input
  // Embedded IPv4 tail (e.g. ::ffff:1.2.3.4) → two hex groups.
  const lastColon = s.lastIndexOf(':')
  const tail = s.slice(lastColon + 1)
  if (tail.includes('.')) {
    const v4 = parseIpv4(tail)
    if (!v4) return null
    s = s.slice(0, lastColon + 1) + ((v4[0] << 8) | v4[1]).toString(16) + ':' + ((v4[2] << 8) | v4[3]).toString(16)
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const toGroups = (h: string) => (h === '' ? [] : h.split(':'))
  const head = toGroups(halves[0])
  const rest = halves.length === 2 ? toGroups(halves[1]) : []
  const parseGroup = (g: string) => (/^[0-9a-fA-F]{1,4}$/.test(g) ? parseInt(g, 16) : NaN)
  let groups: number[]
  if (halves.length === 2) {
    const fill = 8 - head.length - rest.length
    if (fill < 1) return null
    groups = [...head.map(parseGroup), ...new Array<number>(fill).fill(0), ...rest.map(parseGroup)]
  } else {
    if (head.length !== 8) return null
    groups = head.map(parseGroup)
  }
  if (groups.length !== 8 || groups.some((g) => Number.isNaN(g))) return null
  return groups
}

/** Strip brackets, ports and zone ids; unwrap IPv4-mapped IPv6. */
export function normalizeIp(raw: string | null | undefined): string | null {
  if (!raw) return null
  let s = raw.trim()
  if (!s) return null
  // [v6]:port or [v6]
  const bracket = /^\[([^\]]+)\](?::\d+)?$/.exec(s)
  if (bracket) s = bracket[1]
  // v4:port
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(s)) s = s.slice(0, s.lastIndexOf(':'))
  const zone = s.indexOf('%')
  if (zone !== -1) s = s.slice(0, zone)
  const v4 = parseIpv4(s)
  if (v4) return v4.join('.')
  const v6 = parseIpv6(s)
  if (!v6) return null
  // IPv4-mapped (::ffff:a.b.c.d) → plain IPv4
  if (v6.slice(0, 5).every((g) => g === 0) && v6[5] === 0xffff) {
    return [v6[6] >> 8, v6[6] & 255, v6[7] >> 8, v6[7] & 255].join('.')
  }
  // Keep the literal as written (lowercased) so it round-trips into logs and
  // Postgres inet columns unchanged; matching parses it separately anyway.
  return s.toLowerCase()
}

function parse(ip: string): ParsedIp | null {
  const v4 = parseIpv4(ip)
  if (v4) return { v: 4, parts: v4 }
  const v6 = parseIpv6(ip)
  return v6 ? { v: 6, parts: v6 } : null
}

type Cidr = { v: 4 | 6; parts: number[]; bits: number }

function parseCidr(cidr: string): Cidr {
  const [addr, bitsStr] = cidr.split('/')
  const p = parse(addr)
  if (!p) throw new Error(`bad CIDR ${cidr}`)
  return { v: p.v, parts: p.parts, bits: Number(bitsStr) }
}

function inCidr(ip: ParsedIp, c: Cidr): boolean {
  if (ip.v !== c.v) return false
  const width = ip.v === 4 ? 8 : 16
  let bits = c.bits
  for (let i = 0; i < ip.parts.length && bits > 0; i++) {
    const take = Math.min(width, bits)
    const mask = ((1 << take) - 1) << (width - take)
    if ((ip.parts[i] & mask) !== (c.parts[i] & mask)) return false
    bits -= take
  }
  return true
}

function matcher(list: string[]): (ip: string) => boolean {
  const cidrs = list.map(parseCidr)
  return (ip: string) => {
    const p = parse(ip)
    return !!p && cidrs.some((c) => inCidr(p, c))
  }
}

/**
 * Cloudflare edge ranges — https://www.cloudflare.com/ips/ (stable since
 * 2021). If Cloudflare ever publishes a new range, add it here and in every
 * mirrored copy; the symptom of a missing range is visitors being keyed by a
 * Cloudflare edge IP instead of their own.
 */
export const CLOUDFLARE_RANGES = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
  '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
  '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32',
  '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
]

/** Our own infrastructure hops: Docker networks, loopback, link-local, CGNAT. */
const INTERNAL_RANGES = [
  '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16',
  '172.16.0.0/12', '192.168.0.0/16',
  '::/128', '::1/128', 'fc00::/7', 'fe80::/10',
]

export const isCloudflareIp = matcher(CLOUDFLARE_RANGES)
export const isInternalIp = matcher(INTERNAL_RANGES)

// ─── Client IP resolution ───────────────────────────────────────────────────

export interface ClientIpInput {
  /** Raw X-Forwarded-For header (may be comma-joined or an array). */
  forwardedFor?: string | string[] | null
  /** Raw CF-Connecting-IP header. */
  cfConnectingIp?: string | string[] | null
  /** TCP peer address, when the framework exposes it (Express does). */
  remoteAddress?: string | null
}

function first(v: string | string[] | null | undefined): string | undefined {
  return Array.isArray(v) ? v.join(',') : v ?? undefined
}

/**
 * The visitor's IP, or null when it cannot be determined.
 *
 * Walks the hop chain from the right (closest to us). Internal hops are our
 * own proxies (Traefik, Caddy, Docker) and are skipped. The first public hop is
 * whoever connected to our edge proxy:
 *  - a Cloudflare edge → trust CF-Connecting-IP (Cloudflare overwrites it), or
 *    keep walking left, since Cloudflare appends the client to X-Forwarded-For;
 *  - anything else → that is the visitor. Entries further left were written by
 *    the client and are ignored, which is what makes spoofing useless.
 */
export function resolveClientIp(input: ClientIpInput): string | null {
  const chain: Array<string | null> = (first(input.forwardedFor) ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => normalizeIp(s))
  const remote = normalizeIp(input.remoteAddress ?? null)
  if (remote) chain.push(remote)

  let sawCloudflare = false
  let lastInternal: string | null = null
  for (let i = chain.length - 1; i >= 0; i--) {
    const hop = chain[i]
    // A malformed hop means everything further left is untrusted noise.
    if (!hop) return lastInternal
    if (isInternalIp(hop)) {
      lastInternal = lastInternal ?? hop
      continue
    }
    if (isCloudflareIp(hop)) {
      if (!sawCloudflare) {
        sawCloudflare = true
        const cf = normalizeIp(first(input.cfConnectingIp) ?? null)
        if (cf) return cf
      }
      continue
    }
    return hop
  }
  // Only internal hops (local dev, health checks from inside the network).
  return lastInternal
}

/** Convenience for Fetch-API style requests (Next.js route handlers, proxy). */
export function clientIpFromHeaders(headers: { get(name: string): string | null }, remoteAddress?: string | null): string | null {
  return resolveClientIp({
    forwardedFor: headers.get('x-forwarded-for'),
    cfConnectingIp: headers.get('cf-connecting-ip'),
    remoteAddress,
  })
}

// ─── Trap paths ─────────────────────────────────────────────────────────────

/**
 * HARD: no human and no legitimate crawler ever asks for these on a Node app.
 * One hit is a ban. Deliberately excludes /wp-content/ (sites migrated from
 * WordPress still have old image URLs indexed) and a blanket *.php (tenant
 * redirect tables can hold legacy .php URLs).
 */
const HARD_TRAP_PATTERNS: RegExp[] = [
  /(^|\/)\.env(\.[\w-]+)?$/i, // /.env, /.env.local, /api/.env
  /(^|\/)\.(git|svn|hg|aws|ssh|docker)(\/|$)/i,
  /(^|\/)\.(htpasswd|htaccess|DS_Store|npmrc|pypirc|bash_history)$/i,
  /(^|\/)(wp-config|configuration|config\.inc|settings\.inc|setup-config)\.php(\.\w+)?$/i,
  /(^|\/)xmlrpc\.php$/i,
  /(^|\/)(php-?my-?admin|pma|myadmin|adminer)(\/|\.php|$)/i,
  /(^|\/)vendor\/phpunit\//i,
  /(^|\/)cgi-bin\//i,
  /(^|\/)(boaform|HNAP1|GponForm)(\/|$)/i,
  /(^|\/)(shell|eval-stdin|phpinfo|info|test|c99|r57|alfa|wso)\.php$/i,
  /(^|\/)(server-status|server-info)$/i,
  /(^|\/)(actuator\/(env|heapdump|gateway)|_ignition\/execute-solution)/i,
  /(^|\/)(id_rsa|id_dsa|sftp-config\.json|docker-compose\.ya?ml|\.vscode\/sftp\.json)$/i,
  /\.(sql|bak|old|swp)$/i,
]

/** SOFT: plausible typo/habit from a real person (e.g. an ex-WordPress owner). */
const SOFT_TRAP_PATTERNS: RegExp[] = [
  /(^|\/)wp-(admin|login\.php|includes)(\/|$)/i,
  /(^|\/)wordpress\/wp-/i,
  /(^|\/)administrator\/?$/i,
  /(^|\/)(admin|login|user|install|setup|upgrade)\.php$/i,
]

export type TrapKind = 'hard' | 'soft'

/** Classify a request path (no query string). null = not a trap. */
export function classifyTrapPath(pathname: string): TrapKind | null {
  let p = pathname
  try {
    p = decodeURIComponent(pathname)
  } catch {
    // malformed escapes — match on the raw path
  }
  if (HARD_TRAP_PATTERNS.some((re) => re.test(p))) return 'hard'
  if (SOFT_TRAP_PATTERNS.some((re) => re.test(p))) return 'soft'
  return null
}

// ─── Ban store ──────────────────────────────────────────────────────────────

interface IpRecord {
  bannedUntil: number
  offenses: number
  lastOffenseAt: number
  softStrikes: number[]
}

interface DefenseState {
  records: Map<string, IpRecord>
  stats: { banned: number; blocked: number; trapHits: number; honeypotTrips: number }
}

/**
 * Held on globalThis, not in module scope: frameworks such as Next.js bundle
 * the proxy/middleware and the route handlers separately, so each bundle gets
 * its own copy of this module. A process-wide key lets a honeypot trip in a
 * route handler count toward the ban the proxy enforces.
 */
const STATE_KEY = Symbol.for('skale.botDefense.state')

function state(): DefenseState {
  const g = globalThis as unknown as Record<symbol, DefenseState | undefined>
  let st = g[STATE_KEY]
  if (!st) {
    st = { records: new Map(), stats: { banned: 0, blocked: 0, trapHits: 0, honeypotTrips: 0 } }
    g[STATE_KEY] = st
  }
  return st
}

function allowlist(): Set<string> {
  const raw = readEnv('BOT_DEFENSE_ALLOWLIST') ?? ''
  return new Set(raw.split(',').map((s) => normalizeIp(s)).filter((s): s is string => !!s))
}

/** Known search/SEO crawlers. UA is spoofable; the worst a liar gets is the 404. */
const CRAWLER_UA = /(googlebot|google-inspectiontool|bingbot|duckduckbot|applebot|yandex(bot)?|baiduspider|slurp|ahrefsbot|semrushbot|facebookexternalhit|linkedinbot|twitterbot)/i

export function isBannable(ip: string | null | undefined, userAgent?: string | null): ip is string {
  if (!ip) return false
  if (isInternalIp(ip) || isCloudflareIp(ip)) return false
  if (userAgent && CRAWLER_UA.test(userAgent)) return false
  if (allowlist().has(ip)) return false
  return true
}

function getRecord(ip: string, now: number): IpRecord {
  const records = state().records
  let r = records.get(ip)
  if (!r) {
    if (records.size >= MAX_TRACKED_IPS) {
      // Evict the oldest-inserted entry (Map preserves insertion order).
      const oldest = records.keys().next().value
      if (oldest !== undefined) records.delete(oldest)
    }
    r = { bannedUntil: 0, offenses: 0, lastOffenseAt: 0, softStrikes: [] }
    records.set(ip, r)
  }
  if (r.offenses && now - r.lastOffenseAt > OFFENSE_MEMORY_MS) r.offenses = 0
  return r
}

function log(event: string, fields: Record<string, unknown>): void {
  try {
    console.warn(`[bot-defense] ${event} ${JSON.stringify(fields)}`)
  } catch {
    // logging must never break a request
  }
}

function ban(ip: string, reason: string, now: number): number {
  const r = getRecord(ip, now)
  const step = Math.min(r.offenses, BAN_LADDER_MS.length - 1)
  const duration = BAN_LADDER_MS[step]
  r.offenses += 1
  r.lastOffenseAt = now
  r.softStrikes = []
  const mode = botDefenseMode()
  if (mode === 'enforce') r.bannedUntil = now + duration
  state().stats.banned += 1
  log(mode === 'enforce' ? 'ban' : 'would-ban', { ip, reason, offense: r.offenses, minutes: Math.round(duration / MINUTE) })
  return duration
}

/** Milliseconds left on a ban, or 0. Cheap; call on every request. */
export function banRemainingMs(ip: string | null | undefined, now = Date.now()): number {
  if (!ip || botDefenseMode() !== 'enforce') return 0
  const r = state().records.get(ip)
  if (!r || r.bannedUntil <= now) return 0
  state().stats.blocked += 1
  return r.bannedUntil - now
}

/** Record a soft strike; bans once SOFT_STRIKE_LIMIT land inside the window. */
export function recordSoftStrike(ip: string | null | undefined, reason: string, userAgent?: string | null, now = Date.now()): void {
  if (botDefenseMode() === 'off' || !isBannable(ip, userAgent)) return
  const r = getRecord(ip, now)
  r.softStrikes = r.softStrikes.filter((t) => now - t < SOFT_STRIKE_WINDOW_MS)
  r.softStrikes.push(now)
  if (r.softStrikes.length >= SOFT_STRIKE_LIMIT) ban(ip, `soft:${reason}`, now)
}

export interface TrapResult {
  /** The request hit a trap; answer 404 and stop. */
  trapped: boolean
  kind: TrapKind | null
}

/** Check a path; on a trap, record the offense. Always 404 a trapped path. */
export function checkTrap(pathname: string, ip: string | null | undefined, userAgent?: string | null, now = Date.now()): TrapResult {
  if (botDefenseMode() === 'off') return { trapped: false, kind: null }
  const kind = classifyTrapPath(pathname)
  if (!kind) return { trapped: false, kind: null }
  state().stats.trapHits += 1
  if (isBannable(ip, userAgent)) {
    if (kind === 'hard') ban(ip, `trap:${pathname.slice(0, 120)}`, now)
    else recordSoftStrike(ip, `trap:${pathname.slice(0, 120)}`, userAgent, now)
  }
  return { trapped: true, kind }
}

// ─── Honeypot ───────────────────────────────────────────────────────────────

export interface HoneypotOptions {
  /** Where the submission came from, for the log line. */
  source: string
  /** Hidden fields that must stay empty. */
  fields?: string[]
  /** Field carrying client-measured fill time in ms. Missing value = skip. */
  elapsedField?: string
  /** Set false for forms that can legitimately be submitted instantly. */
  checkElapsed?: boolean
  ip?: string | null
  userAgent?: string | null
}

/**
 * True when a public-form submission is a bot: a hidden field was filled or
 * the form was submitted faster than a human can type. The caller must answer
 * with a normal-looking success and do nothing else — no write, no
 * notification — so the bot learns nothing. Also counts a soft strike.
 */
export function isBotSubmission(body: unknown, opts: HoneypotOptions): boolean {
  const b = (body ?? {}) as Record<string, unknown>
  const fields = opts.fields ?? ['hp_extra']
  const honeypotFilled = fields.some((f) => {
    const v = b[f]
    return v !== undefined && v !== null && String(v).trim() !== ''
  })
  const elapsed = b[opts.elapsedField ?? 'elapsedMs']
  const tooFast =
    (opts.checkElapsed ?? true) &&
    typeof elapsed === 'number' &&
    Number.isFinite(elapsed) &&
    elapsed >= 0 &&
    elapsed < MIN_FORM_FILL_MS
  if (!honeypotFilled && !tooFast) return false
  state().stats.honeypotTrips += 1
  log('form-dropped', { source: opts.source, reason: honeypotFilled ? 'honeypot' : 'too-fast', ip: opts.ip ?? null })
  recordSoftStrike(opts.ip, `form:${opts.source}`, opts.userAgent)
  return true
}

// ─── Introspection (tests / health) ─────────────────────────────────────────

export function botDefenseStats() {
  const st = state()
  return { ...st.stats, tracked: st.records.size, mode: botDefenseMode() }
}

/** Test helper — clears all state. */
export function __resetBotDefense(): void {
  const st = state()
  st.records.clear()
  st.stats = { banned: 0, blocked: 0, trapHits: 0, honeypotTrips: 0 }
}
