// Local SEO audit checks. Pure: every input is gathered elsewhere
// (src/lib/local-seo/audit.ts), so the verdicts are unit-testable and the
// same inputs always give the same score.
//
// Each check is Good / OK / Poor (or N/A when the data is not available,
// e.g. no Business Profile connection) with a weight. The score is the
// weighted share of points (Good 1, OK 0.5, Poor 0) over applicable checks.

export type Pillar = 'profile' | 'reviews' | 'website' | 'visibility' | 'competition'
export type Verdict = 'good' | 'ok' | 'poor' | 'na'

export type AuditCheck = {
  id: string
  pillar: Pillar
  label: string
  status: Verdict
  detail: string
  action: string | null
  weight: number
}

export const PILLAR_LABEL: Record<Pillar, string> = {
  profile: 'Business Profile',
  reviews: 'Reviews',
  website: 'Website & NAP',
  visibility: 'Map visibility',
  competition: 'Competition',
}

export type CompetitorSample = { title: string; rating: number | null; reviews: number | null; category: string | null }

export type WebsiteFacts = {
  url: string
  ok: boolean
  error?: string | null
  hasLocalBusinessSchema: boolean
  phoneFound: boolean
  addressFound: boolean
  nameFound: boolean
}

export type AuditInput = {
  now: Date
  businessName: string
  /** From the GBP snapshot when connected, else the location row. */
  profile: {
    connected: boolean
    primaryCategory: string | null
    additionalCategories: string[]
    description: string | null
    hoursSet: boolean | null
    websiteUri: string | null
    phone: string | null
  }
  reviews: {
    rating: number | null
    count: number | null
    last30Days: number | null
    replyRate90Days: number | null
    unrepliedNegative: number | null
  }
  postsLast7Days: number | null
  postsLast30Days: number | null
  /** Top competitors (not the business), from the latest scans. */
  competitors: CompetitorSample[]
  keywords: { keyword: string; solv: number | null; foundPct: number | null; scannedAt: string | null }[]
  website: WebsiteFacts | null
  /** Competitor names that look keyword-stuffed (see suspectedSpam). */
  spamSuspects: string[]
}

const median = (xs: number[]) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const r1 = (n: number) => Math.round(n * 10) / 10

function mostCommon(xs: string[]): string | null {
  const m = new Map<string, number>()
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1)
  let best: string | null = null
  let n = 0
  for (const [k, v] of m) if (v > n) [best, n] = [k, v]
  return best
}

/**
 * Names that read like keyword stuffing: the business name carries the
 * search term plus extra words ("Best Barber Shop Downtown - Bigode Cuts").
 */
export function suspectedSpam(titles: string[], keywords: string[]): string[] {
  const out = new Set<string>()
  for (const title of titles) {
    const t = title.toLowerCase()
    for (const k of keywords) {
      const kw = k.toLowerCase().trim()
      if (kw.length < 4 || !t.includes(kw)) continue
      const words = t.split(/\s+/).filter(Boolean).length
      if (words >= kw.split(/\s+/).length + 3 || /\b(best|near me|cheap|top|24\/7|#1)\b/.test(t)) out.add(title)
    }
  }
  return [...out]
}

export function computeAudit(input: AuditInput): { score: number; pillars: Record<Pillar, number | null>; checks: AuditCheck[] } {
  const checks: AuditCheck[] = []
  // Verdict objects are built inline below; their status literals widen to
  // string inside the conditional chains, so narrow them here.
  const add = (c: Omit<AuditCheck, 'status'> & { status: string }) => checks.push({ ...c, status: c.status as Verdict })
  const p = input.profile
  const gbp = p.connected

  // ── Profile ──────────────────────────────────────────────────────────────
  const compCategory = mostCommon(input.competitors.map((c) => c.category).filter((c): c is string => !!c))
  add({
    id: 'primary_category',
    pillar: 'profile',
    label: 'Primary category',
    weight: 3,
    ...(!p.primaryCategory
      ? { status: 'poor', detail: 'No primary category is known for this business.', action: 'Set the primary category in the Business Profile; it is the strongest relevance signal.' }
      : !compCategory
        ? { status: 'ok', detail: `Primary category: ${p.primaryCategory}. No competitor data to compare yet.`, action: null }
        : compCategory.toLowerCase() === p.primaryCategory.toLowerCase()
          ? { status: 'good', detail: `“${p.primaryCategory}” matches what the top competitors use.`, action: null }
          : {
              status: 'poor',
              detail: `Yours is “${p.primaryCategory}”; most top-ranking competitors use “${compCategory}”.`,
              action: `Consider “${compCategory}” as the primary category (and keep yours as a secondary one if it still fits).`,
            }),
  })
  add({
    id: 'secondary_categories',
    pillar: 'profile',
    label: 'Secondary categories',
    weight: 1,
    ...(!gbp
      ? { status: 'na', detail: 'Connect the Business Profile to check.', action: null }
      : p.additionalCategories.length
        ? { status: 'good', detail: `${p.additionalCategories.length} secondary: ${p.additionalCategories.join(', ')}.`, action: null }
        : { status: 'ok', detail: 'No secondary categories.', action: 'Add every secondary category that truly describes a service you offer.' }),
  })
  const descLen = p.description?.trim().length ?? 0
  add({
    id: 'description',
    pillar: 'profile',
    label: 'Business description',
    weight: 1,
    ...(!gbp
      ? { status: 'na', detail: 'Connect the Business Profile to check.', action: null }
      : descLen >= 250
        ? { status: 'good', detail: `${descLen} characters.`, action: null }
        : descLen > 0
          ? { status: 'ok', detail: `Only ${descLen} characters.`, action: 'Expand the description to 250–750 characters: services, area served, what makes you different.' }
          : { status: 'poor', detail: 'The description is empty.', action: 'Write a 250–750 character description in Profile.' }),
  })
  add({
    id: 'hours',
    pillar: 'profile',
    label: 'Opening hours',
    weight: 2,
    ...(p.hoursSet === null
      ? { status: 'na', detail: 'Connect the Business Profile to check.', action: null }
      : p.hoursSet
        ? { status: 'good', detail: 'Regular hours are set.', action: null }
        : { status: 'poor', detail: 'No regular hours. Google ranks “open now” searches by hours.', action: 'Add the regular opening hours in Profile.' }),
  })
  add({
    id: 'website_link',
    pillar: 'profile',
    label: 'Website link',
    weight: 1,
    ...(!p.websiteUri
      ? { status: 'poor', detail: 'The profile has no website.', action: 'Add the website link to the profile.' }
      : /[?&]utm_source=/i.test(p.websiteUri)
        ? { status: 'good', detail: 'Website link with UTM tracking.', action: null }
        : { status: 'ok', detail: 'Website link has no UTM tags, so profile visits mix with organic traffic in analytics.', action: 'Add ?utm_source=google&utm_medium=organic&utm_campaign=gbp to the profile website link.' }),
  })
  add({
    id: 'phone',
    pillar: 'profile',
    label: 'Phone number',
    weight: 1,
    ...(p.phone ? { status: 'good', detail: p.phone, action: null } : { status: 'poor', detail: 'No phone number on the profile.', action: 'Add a local phone number to the profile.' }),
  })
  add({
    id: 'posts',
    pillar: 'profile',
    label: 'Recent posts',
    weight: 1,
    ...(!gbp || input.postsLast30Days === null
      ? { status: 'na', detail: 'Connect the Business Profile to check.', action: null }
      : (input.postsLast7Days ?? 0) > 0
        ? { status: 'good', detail: `${input.postsLast7Days} post(s) in the last 7 days.`, action: null }
        : input.postsLast30Days > 0
          ? { status: 'ok', detail: `${input.postsLast30Days} post(s) in 30 days, none this week.`, action: 'Post at least once a week (schedule a recurring post in Posts).' }
          : { status: 'poor', detail: 'No posts in 30 days.', action: 'Publish a post now and schedule a weekly recurring one.' }),
  })

  // ── Reviews ──────────────────────────────────────────────────────────────
  const compRatings = input.competitors.map((c) => c.rating).filter((n): n is number => n !== null)
  const compCounts = input.competitors.map((c) => c.reviews).filter((n): n is number => n !== null)
  const compAvgRating = avg(compRatings)
  const compMedianCount = median(compCounts)
  const rv = input.reviews
  add({
    id: 'rating',
    pillar: 'reviews',
    label: 'Average rating vs competitors',
    weight: 2,
    ...(rv.rating === null
      ? { status: 'na', detail: 'No rating known yet.', action: null }
      : compAvgRating === null
        ? { status: rv.rating >= 4.5 ? 'good' : rv.rating >= 4 ? 'ok' : 'poor', detail: `${rv.rating}★. No competitor data yet.`, action: rv.rating < 4.5 ? 'Ask happy customers for reviews and answer every negative one.' : null }
        : rv.rating >= compAvgRating
          ? { status: 'good', detail: `${rv.rating}★ vs ${r1(compAvgRating)}★ for top competitors.`, action: null }
          : rv.rating >= compAvgRating - 0.2
            ? { status: 'ok', detail: `${rv.rating}★, slightly under the ${r1(compAvgRating)}★ competitor average.`, action: 'Ask recent happy customers for reviews to lift the average.' }
            : { status: 'poor', detail: `${rv.rating}★ vs ${r1(compAvgRating)}★ for top competitors.`, action: 'Find the recurring complaint in 1–3★ reviews, fix it, and run a review request campaign.' }),
  })
  add({
    id: 'review_count',
    pillar: 'reviews',
    label: 'Number of reviews vs competitors',
    weight: 2,
    ...(rv.count === null
      ? { status: 'na', detail: 'No review count known yet.', action: null }
      : compMedianCount === null
        ? { status: 'ok', detail: `${rv.count} reviews. No competitor data yet.`, action: null }
        : rv.count >= compMedianCount
          ? { status: 'good', detail: `${rv.count} reviews vs a competitor median of ${Math.round(compMedianCount)}.`, action: null }
          : rv.count >= compMedianCount / 2
            ? { status: 'ok', detail: `${rv.count} reviews vs a competitor median of ${Math.round(compMedianCount)}.`, action: 'Send a review request after every visit (workflow + SMS/email).' }
            : { status: 'poor', detail: `${rv.count} reviews vs a competitor median of ${Math.round(compMedianCount)}.`, action: 'Start a steady review request routine; volume and recency both count.' }),
  })
  add({
    id: 'review_velocity',
    pillar: 'reviews',
    label: 'New reviews in the last 30 days',
    weight: 1,
    ...(rv.last30Days === null
      ? { status: 'na', detail: 'Review dates are not available.', action: null }
      : rv.last30Days >= 4
        ? { status: 'good', detail: `${rv.last30Days} new reviews.`, action: null }
        : rv.last30Days > 0
          ? { status: 'ok', detail: `${rv.last30Days} new review(s).`, action: 'Aim for at least one new review a week.' }
          : { status: 'poor', detail: 'No new reviews this month.', action: 'Ask for reviews; a quiet profile loses ground to active ones.' }),
  })
  add({
    id: 'reply_rate',
    pillar: 'reviews',
    label: 'Reply rate (90 days)',
    weight: 1,
    ...(rv.replyRate90Days === null
      ? { status: 'na', detail: gbp ? 'No reviews in the last 90 days.' : 'Connect the Business Profile to check.', action: null }
      : rv.replyRate90Days >= 80
        ? { status: 'good', detail: `${Math.round(rv.replyRate90Days)}% answered.`, action: null }
        : rv.replyRate90Days >= 50
          ? { status: 'ok', detail: `${Math.round(rv.replyRate90Days)}% answered.`, action: 'Reply to every review; turn on AI drafts in Reviews.' }
          : { status: 'poor', detail: `${Math.round(rv.replyRate90Days)}% answered.`, action: 'Reply to the backlog in Reviews (AI drafts help) and keep up weekly.' }),
  })
  add({
    id: 'negative_unreplied',
    pillar: 'reviews',
    label: 'Unanswered negative reviews',
    weight: 2,
    ...(rv.unrepliedNegative === null
      ? { status: 'na', detail: 'Connect the Business Profile to check.', action: null }
      : rv.unrepliedNegative === 0
        ? { status: 'good', detail: 'Every 1–3★ review has a reply.', action: null }
        : { status: 'poor', detail: `${rv.unrepliedNegative} negative review(s) without a reply.`, action: 'Answer the 1–3★ reviews first: calm, specific, move the conversation offline.' }),
  })

  // ── Website & NAP ────────────────────────────────────────────────────────
  const w = input.website
  if (!w) {
    add({ id: 'website_reachable', pillar: 'website', label: 'Website reachable', weight: 1, status: 'na', detail: 'No website to check.', action: null })
  } else {
    add({
      id: 'website_reachable',
      pillar: 'website',
      label: 'Website reachable',
      weight: 1,
      ...(w.ok ? { status: 'good', detail: w.url, action: null } : { status: 'poor', detail: `${w.url} could not be loaded: ${w.error ?? 'error'}.`, action: 'Fix the website (or the link on the profile).' }),
    })
    if (w.ok) {
      add({
        id: 'schema',
        pillar: 'website',
        label: 'LocalBusiness structured data',
        weight: 1,
        ...(w.hasLocalBusinessSchema
          ? { status: 'good', detail: 'The page declares LocalBusiness schema.', action: null }
          : { status: 'ok', detail: 'No LocalBusiness JSON-LD on the page.', action: 'Add LocalBusiness schema with name, address, phone, hours and geo to the home page.' }),
      })
      add({
        id: 'nap_phone',
        pillar: 'website',
        label: 'Phone on the website matches',
        weight: 2,
        ...(!p.phone
          ? { status: 'na', detail: 'No profile phone to compare.', action: null }
          : w.phoneFound
            ? { status: 'good', detail: 'The profile phone appears on the website.', action: null }
            : { status: 'poor', detail: 'The profile phone was not found on the website.', action: 'Show the same phone number as the profile on the website (header or footer).' }),
      })
      add({
        id: 'nap_address',
        pillar: 'website',
        label: 'Address on the website matches',
        weight: 1,
        ...(w.addressFound
          ? { status: 'good', detail: 'The street address appears on the website.', action: null }
          : { status: 'ok', detail: 'The profile address was not found on the website.', action: 'Show the full address (same format as the profile) on the website.' }),
      })
      add({
        id: 'nap_name',
        pillar: 'website',
        label: 'Business name on the website',
        weight: 1,
        ...(w.nameFound
          ? { status: 'good', detail: 'The business name appears on the website.', action: null }
          : { status: 'ok', detail: 'The exact business name was not found on the website.', action: 'Use the same business name on the website as on the profile.' }),
      })
    }
  }

  // ── Visibility ───────────────────────────────────────────────────────────
  const scanned = input.keywords.filter((k) => k.solv !== null)
  const avgSolv = avg(scanned.map((k) => k.solv as number))
  add({
    id: 'solv',
    pillar: 'visibility',
    label: 'Share of local voice',
    weight: 3,
    ...(avgSolv === null
      ? { status: 'poor', detail: 'No scans yet.', action: 'Run a geogrid scan for every keyword (Rankings → Scan now).' }
      : avgSolv >= 50
        ? { status: 'good', detail: `${r1(avgSolv)}% of grid points in the top 3 across ${scanned.length} keyword(s).`, action: null }
        : avgSolv >= 20
          ? { status: 'ok', detail: `${r1(avgSolv)}% of grid points in the top 3.`, action: 'Work on the weakest keywords: category, reviews mentioning the service, a page for it on the website.' }
          : { status: 'poor', detail: `Only ${r1(avgSolv)}% of grid points in the top 3.`, action: 'Fix the Poor profile and review items above first; they move map rankings most.' }),
  })
  const invisible = scanned.filter((k) => (k.foundPct ?? 0) < 20).map((k) => k.keyword)
  add({
    id: 'invisible_keywords',
    pillar: 'visibility',
    label: 'Keywords where the business is missing',
    weight: 2,
    ...(scanned.length === 0
      ? { status: 'na', detail: 'No scans yet.', action: null }
      : invisible.length === 0
        ? { status: 'good', detail: 'The business shows up for every tracked keyword.', action: null }
        : {
            status: 'poor',
            detail: `Barely visible (under 20% of points) for: ${invisible.join(', ')}.`,
            action: 'Check the business really offers these services; add them as services/secondary categories and mention them on the website.',
          }),
  })
  const newest = input.keywords
    .map((k) => (k.scannedAt ? new Date(k.scannedAt).getTime() : 0))
    .reduce((a, b) => Math.max(a, b), 0)
  const ageDays = newest ? (input.now.getTime() - newest) / 86_400_000 : null
  add({
    id: 'scan_freshness',
    pillar: 'visibility',
    label: 'Ranking data is recent',
    weight: 1,
    ...(ageDays === null
      ? { status: 'poor', detail: 'Never scanned.', action: 'Schedule weekly scans in Settings.' }
      : ageDays <= 14
        ? { status: 'good', detail: `Last scan ${Math.round(ageDays)} day(s) ago.`, action: null }
        : ageDays <= 45
          ? { status: 'ok', detail: `Last scan ${Math.round(ageDays)} days ago.`, action: 'Schedule weekly or biweekly scans in Settings.' }
          : { status: 'poor', detail: `Last scan ${Math.round(ageDays)} days ago.`, action: 'Schedule weekly scans in Settings.' }),
  })

  // ── Competition ──────────────────────────────────────────────────────────
  add({
    id: 'spam',
    pillar: 'competition',
    label: 'Keyword-stuffed competitor names',
    weight: 1,
    ...(input.competitors.length === 0
      ? { status: 'na', detail: 'No competitor data yet.', action: null }
      : input.spamSuspects.length === 0
        ? { status: 'good', detail: 'No suspicious competitor names in the top results.', action: null }
        : {
            status: 'ok',
            detail: `Possibly keyword-stuffed: ${input.spamSuspects.slice(0, 5).join('; ')}.`,
            action: 'Check these listings on Google Maps and use “Suggest an edit” for names that are not the real business name.',
          }),
  })

  // ── Score ────────────────────────────────────────────────────────────────
  const value = (v: Verdict) => (v === 'good' ? 1 : v === 'ok' ? 0.5 : 0)
  const scoreOf = (cs: AuditCheck[]) => {
    const applicable = cs.filter((c) => c.status !== 'na')
    const total = applicable.reduce((a, c) => a + c.weight, 0)
    return total ? Math.round((applicable.reduce((a, c) => a + c.weight * value(c.status), 0) / total) * 100) : null
  }
  const pillars = Object.fromEntries(
    (Object.keys(PILLAR_LABEL) as Pillar[]).map((pl) => [pl, scoreOf(checks.filter((c) => c.pillar === pl))]),
  ) as Record<Pillar, number | null>
  return { score: scoreOf(checks) ?? 0, pillars, checks }
}

// ── Website facts extraction (pure, from HTML) ─────────────────────────────

const LOCAL_BUSINESS_TYPES = /"@type"\s*:\s*(\[[^\]]*)?"(LocalBusiness|[A-Za-z]*(Store|Shop|Restaurant|Salon|Clinic|Dentist|Physician|Plumber|Electrician|Attorney|LegalService|AutoRepair|HomeAndConstructionBusiness|HealthAndBeautyBusiness|FoodEstablishment|ProfessionalService|BarberShop|BeautySalon|HairSalon|DaySpa|Hotel|LodgingBusiness|RealEstateAgent|Locksmith|RoofingContractor|HVACBusiness|MedicalBusiness|SportsActivityLocation|EntertainmentBusiness|FinancialService|AutomotiveBusiness|ChildCare|DryCleaningOrLaundry|EmploymentAgency|GovernmentOffice|InternetCafe|Library|RadioStation|RecyclingCenter|SelfStorage|ShoppingCenter|TelevisionStation|TouristInformationCenter|TravelAgency))"/

export function digitsOnly(s: string): string {
  return s.replace(/\D/g, '')
}

export function extractWebsiteFacts(
  html: string,
  target: { name: string; phone: string | null; address: string | null },
): Omit<WebsiteFacts, 'url' | 'ok' | 'error'> {
  const lower = html.toLowerCase()
  const hasLocalBusinessSchema = /application\/ld\+json/i.test(html) && LOCAL_BUSINESS_TYPES.test(html)

  // Phone: compare the last 8 digits, which survives country codes,
  // separators and tel: links in any format.
  let phoneFound = false
  if (target.phone) {
    const want = digitsOnly(target.phone).slice(-8)
    if (want.length >= 7) phoneFound = digitsOnly(html).includes(want)
  }

  // Address: the street number and the postal code (when present) both appear.
  let addressFound = false
  if (target.address) {
    const number = target.address.match(/\b\d{1,6}\b/)?.[0]
    const postal = target.address.match(/\b\d{5}(?:-\d{3,4})?\b/)?.[0]
    const street = target.address.split(',')[0]?.replace(/\d+/g, '').trim().toLowerCase()
    addressFound =
      (!!number && lower.includes(number) && (!!street ? lower.includes(street.slice(0, 12)) : true)) &&
      (!postal || digitsOnly(html).includes(digitsOnly(postal)))
  }

  const name = target.name.toLowerCase().trim()
  const nameFound = name.length > 2 && lower.includes(name)
  return { hasLocalBusinessSchema, phoneFound, addressFound, nameFound }
}
