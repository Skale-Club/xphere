/**
 * Derive a destination timezone from an E.164 phone number, so the dialer can
 * warn the caller about the local time at the other end *before* placing the
 * call ("it's 11:42 PM there").
 *
 * Accuracy is best-effort — a phone number only reveals the country, and for
 * multi-timezone countries the area code at best narrows it down. We special-
 * case the two that matter most for this product:
 *   - NANP (+1, US/Canada): area-code → zone, defaulting to Eastern.
 *   - Brazil (+55): DDD → zone, defaulting to Brasília time.
 * Every other country maps to a single representative zone (usually the
 * capital). Unknown numbers return `null` and the dialer shows nothing rather
 * than guess wrong.
 *
 * Pure functions, no React/server deps — safe to import anywhere. The country
 * lookup reuses the `react-international-phone` data we already ship.
 */

import {
  defaultCountries,
  guessCountryByPartialPhoneNumber,
} from 'react-international-phone'

/** Hours considered a bad time to cold-call (local time at destination). */
export const OFF_HOURS_START = 21 // 9 PM and later
export const OFF_HOURS_END = 8 // before 8 AM

export interface PhoneTimezone {
  /** IANA timezone, e.g. `America/Sao_Paulo`. */
  timeZone: string
  /** Friendly label for the zone, e.g. `Brasília`, `Eastern Time`, `London`. */
  label: string
  /** Lowercase ISO2 country code the number resolved to. */
  countryIso2: string
}

// ---------------------------------------------------------------------------
// Country → representative IANA timezone (capital / most populous region).
// Multi-zone countries are refined below for US/CA (NANP) and Brazil.
// ---------------------------------------------------------------------------
const COUNTRY_TZ: Record<string, string> = {
  af: 'Asia/Kabul', al: 'Europe/Tirane', dz: 'Africa/Algiers', ad: 'Europe/Andorra',
  ao: 'Africa/Luanda', ar: 'America/Argentina/Buenos_Aires', am: 'Asia/Yerevan',
  au: 'Australia/Sydney', at: 'Europe/Vienna', az: 'Asia/Baku', bh: 'Asia/Bahrain',
  bd: 'Asia/Dhaka', by: 'Europe/Minsk', be: 'Europe/Brussels', bo: 'America/La_Paz',
  ba: 'Europe/Sarajevo', br: 'America/Sao_Paulo', bg: 'Europe/Sofia', kh: 'Asia/Phnom_Penh',
  cm: 'Africa/Douala', ca: 'America/Toronto', cl: 'America/Santiago', cn: 'Asia/Shanghai',
  co: 'America/Bogota', cr: 'America/Costa_Rica', hr: 'Europe/Zagreb', cu: 'America/Havana',
  cy: 'Asia/Nicosia', cz: 'Europe/Prague', dk: 'Europe/Copenhagen', do: 'America/Santo_Domingo',
  ec: 'America/Guayaquil', eg: 'Africa/Cairo', sv: 'America/El_Salvador', ee: 'Europe/Tallinn',
  et: 'Africa/Addis_Ababa', fi: 'Europe/Helsinki', fr: 'Europe/Paris', ge: 'Asia/Tbilisi',
  de: 'Europe/Berlin', gh: 'Africa/Accra', gr: 'Europe/Athens', gt: 'America/Guatemala',
  hn: 'America/Tegucigalpa', hk: 'Asia/Hong_Kong', hu: 'Europe/Budapest', is: 'Atlantic/Reykjavik',
  in: 'Asia/Kolkata', id: 'Asia/Jakarta', ir: 'Asia/Tehran', iq: 'Asia/Baghdad',
  ie: 'Europe/Dublin', il: 'Asia/Jerusalem', it: 'Europe/Rome', jm: 'America/Jamaica',
  jp: 'Asia/Tokyo', jo: 'Asia/Amman', kz: 'Asia/Almaty', ke: 'Africa/Nairobi',
  kw: 'Asia/Kuwait', kg: 'Asia/Bishkek', la: 'Asia/Vientiane', lv: 'Europe/Riga',
  lb: 'Asia/Beirut', ly: 'Africa/Tripoli', lt: 'Europe/Vilnius', lu: 'Europe/Luxembourg',
  mo: 'Asia/Macau', mk: 'Europe/Skopje', mg: 'Indian/Antananarivo', my: 'Asia/Kuala_Lumpur',
  mv: 'Indian/Maldives', ml: 'Africa/Bamako', mt: 'Europe/Malta', mx: 'America/Mexico_City',
  md: 'Europe/Chisinau', mc: 'Europe/Monaco', mn: 'Asia/Ulaanbaatar', me: 'Europe/Podgorica',
  ma: 'Africa/Casablanca', mz: 'Africa/Maputo', mm: 'Asia/Yangon', na: 'Africa/Windhoek',
  np: 'Asia/Kathmandu', nl: 'Europe/Amsterdam', nz: 'Pacific/Auckland', ni: 'America/Managua',
  ng: 'Africa/Lagos', no: 'Europe/Oslo', om: 'Asia/Muscat', pk: 'Asia/Karachi',
  pa: 'America/Panama', pg: 'Pacific/Port_Moresby', py: 'America/Asuncion', pe: 'America/Lima',
  ph: 'Asia/Manila', pl: 'Europe/Warsaw', pt: 'Europe/Lisbon', qa: 'Asia/Qatar',
  ro: 'Europe/Bucharest', ru: 'Europe/Moscow', rw: 'Africa/Kigali', sa: 'Asia/Riyadh',
  sn: 'Africa/Dakar', rs: 'Europe/Belgrade', sg: 'Asia/Singapore', sk: 'Europe/Bratislava',
  si: 'Europe/Ljubljana', za: 'Africa/Johannesburg', kr: 'Asia/Seoul', es: 'Europe/Madrid',
  lk: 'Asia/Colombo', sd: 'Africa/Khartoum', se: 'Europe/Stockholm', ch: 'Europe/Zurich',
  sy: 'Asia/Damascus', tw: 'Asia/Taipei', tj: 'Asia/Dushanbe', tz: 'Africa/Dar_es_Salaam',
  th: 'Asia/Bangkok', tn: 'Africa/Tunis', tr: 'Europe/Istanbul', tm: 'Asia/Ashgabat',
  ug: 'Africa/Kampala', ua: 'Europe/Kyiv', ae: 'Asia/Dubai', gb: 'Europe/London',
  us: 'America/New_York', uy: 'America/Montevideo', uz: 'Asia/Tashkent', ve: 'America/Caracas',
  vn: 'Asia/Ho_Chi_Minh', ye: 'Asia/Aden', zm: 'Africa/Lusaka', zw: 'Africa/Harare',
}

// ---------------------------------------------------------------------------
// NANP (+1) area code → zone. Eastern is the default, so only NON-Eastern
// area codes are listed here. US states that straddle a zone boundary are
// assigned by their dominant population centre.
// ---------------------------------------------------------------------------
const NANP_AREA_TZ: Record<string, string> = {}
function fillNanp(zone: string, codes: number[]) {
  for (const c of codes) NANP_AREA_TZ[String(c)] = zone
}
fillNanp('America/Chicago', [
  // US Central
  205, 251, 256, 334, 938, 479, 501, 870, 327, 217, 224, 309, 312, 331, 447, 464,
  618, 630, 708, 773, 779, 815, 847, 872, 319, 515, 563, 641, 712, 316, 620, 785,
  913, 225, 318, 337, 504, 985, 218, 320, 507, 612, 651, 763, 952, 228, 601, 662,
  769, 314, 417, 557, 573, 636, 660, 816, 975, 402, 531, 308, 701, 405, 539, 580,
  918, 605, 615, 629, 731, 901, 931, 210, 214, 254, 281, 325, 346, 361, 409, 430,
  432, 469, 512, 682, 713, 726, 737, 806, 817, 830, 832, 903, 936, 940, 945, 956,
  972, 979, 262, 414, 534, 608, 715, 920, 219, 270, 364,
  // Canada Central
  204, 431, 584, 306, 474, 639, 807,
])
fillNanp('America/Denver', [
  303, 719, 720, 970, 208, 986, 406, 505, 575, 385, 435, 801, 307, 915, // US Mountain
  368, 403, 587, 780, 825, 867, // Canada Mountain / territories
])
fillNanp('America/Phoenix', [480, 520, 602, 623, 928]) // Arizona — no DST
fillNanp('America/Los_Angeles', [
  // US Pacific
  209, 213, 279, 310, 323, 341, 350, 408, 415, 424, 442, 510, 530, 559, 562, 619,
  626, 628, 650, 657, 661, 669, 707, 714, 747, 760, 805, 818, 820, 831, 840, 858,
  909, 916, 925, 949, 951, 702, 725, 775, 458, 503, 541, 971, 206, 253, 360, 425,
  509, 564,
  // Canada Pacific
  236, 250, 257, 604, 672, 778,
])
fillNanp('America/Anchorage', [907])
fillNanp('Pacific/Honolulu', [808])
fillNanp('America/Halifax', [902, 782, 506])
fillNanp('America/St_Johns', [709])
fillNanp('America/Puerto_Rico', [787, 939, 340])
fillNanp('Pacific/Guam', [671])

// ---------------------------------------------------------------------------
// Brazil DDD → zone. Brasília time (America/Sao_Paulo) is the default; only the
// western/Amazonian DDDs that fall on UTC-4 or UTC-5 are listed.
// ---------------------------------------------------------------------------
const BR_DDD_TZ: Record<string, string> = {
  '68': 'America/Rio_Branco', // Acre (UTC-5)
  '69': 'America/Porto_Velho', // Rondônia (UTC-4)
  '92': 'America/Manaus', '97': 'America/Manaus', // Amazonas (UTC-4)
  '95': 'America/Boa_Vista', // Roraima (UTC-4)
  '65': 'America/Cuiaba', '66': 'America/Cuiaba', // Mato Grosso (UTC-4)
  '67': 'America/Campo_Grande', // Mato Grosso do Sul (UTC-4)
}

// Friendly labels for zones that span many cities, so we don't show a single
// (possibly wrong) city name for a whole-country region.
const ZONE_LABEL: Record<string, string> = {
  'America/New_York': 'Eastern Time',
  'America/Chicago': 'Central Time',
  'America/Denver': 'Mountain Time',
  'America/Phoenix': 'Arizona',
  'America/Los_Angeles': 'Pacific Time',
  'America/Anchorage': 'Alaska',
  'Pacific/Honolulu': 'Hawaii',
  'America/Halifax': 'Atlantic Time',
  'America/St_Johns': 'Newfoundland',
  'America/Puerto_Rico': 'Puerto Rico',
  'America/Sao_Paulo': 'Brasília',
  'America/Cuiaba': 'Cuiabá',
}

/** Last IANA segment as a human label: `America/Mexico_City` → `Mexico City`. */
function cityFromTimeZone(timeZone: string): string {
  const seg = timeZone.split('/').pop() ?? timeZone
  return seg.replace(/_/g, ' ')
}

function labelForZone(timeZone: string): string {
  return ZONE_LABEL[timeZone] ?? cityFromTimeZone(timeZone)
}

/**
 * Resolve the destination timezone for an E.164 number, or `null` when the
 * country can't be determined or isn't mapped.
 */
export function phoneToTimezone(e164: string | null | undefined): PhoneTimezone | null {
  if (!e164) return null
  const trimmed = e164.trim()
  if (!trimmed.startsWith('+')) return null

  let guess
  try {
    guess = guessCountryByPartialPhoneNumber({
      phone: trimmed,
      countries: defaultCountries,
      currentCountryIso2: undefined,
    })
  } catch {
    return null
  }

  const country = guess?.country
  if (!country) return null

  const iso2 = country.iso2
  const digits = trimmed.replace(/\D/g, '')
  const dialCode = country.dialCode
  const national = digits.startsWith(dialCode) ? digits.slice(dialCode.length) : digits

  let timeZone: string | undefined

  if (dialCode === '1') {
    // NANP: first 3 national digits are the area code; default Eastern.
    const area = national.slice(0, 3)
    timeZone = NANP_AREA_TZ[area] ?? 'America/New_York'
  } else if (dialCode === '55') {
    // Brazil: first 2 national digits are the DDD; default Brasília time.
    const ddd = national.slice(0, 2)
    timeZone = BR_DDD_TZ[ddd] ?? 'America/Sao_Paulo'
  } else {
    timeZone = COUNTRY_TZ[iso2]
  }

  if (!timeZone) return null

  return { timeZone, label: labelForZone(timeZone), countryIso2: iso2 }
}

// ---------------------------------------------------------------------------
// Local-time computation (used by the dialer notice). Kept here so the data
// and the math live together; the React glue lives in the component.
// ---------------------------------------------------------------------------

/** Current UTC offset (in minutes) for an IANA zone, DST-aware. */
export function tzOffsetMinutes(timeZone: string, at: Date): number {
  try {
    const local = new Date(at.toLocaleString('en-US', { timeZone }))
    const utc = new Date(at.toLocaleString('en-US', { timeZone: 'UTC' }))
    return Math.round((local.getTime() - utc.getTime()) / 60000)
  } catch {
    return 0
  }
}

export interface DestinationTime extends PhoneTimezone {
  /** Formatted wall-clock time at the destination, e.g. `11:42 PM`. */
  localTime: string
  /** 24h hour (0–23) at the destination — drives the off-hours check. */
  hour: number
  /** True when it's a poor time to call there (early morning / late night). */
  isOffHours: boolean
  /** Destination offset minus the viewer's offset, in minutes (signed). */
  diffMinutes: number
  /** Human "2h ahead" / "30m behind" / "same time" relative to the viewer. */
  diffLabel: string
}

/**
 * Compute the destination's current local time and how it relates to the
 * viewer's own timezone. Returns `null` when the number can't be resolved.
 */
export function describeDestinationTime(
  e164: string | null | undefined,
  now: Date,
  viewerTimeZone: string,
): DestinationTime | null {
  const tz = phoneToTimezone(e164)
  if (!tz) return null

  const localTime = new Intl.DateTimeFormat('en-US', {
    timeZone: tz.timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(now)

  const hourStr = new Intl.DateTimeFormat('en-US', {
    timeZone: tz.timeZone,
    hour: '2-digit',
    hour12: false,
  }).format(now)
  // hourStr can be "24" at midnight in some engines → normalise to 0.
  const hour = Number(hourStr) % 24

  const isOffHours = hour >= OFF_HOURS_START || hour < OFF_HOURS_END

  const diffMinutes =
    tzOffsetMinutes(tz.timeZone, now) - tzOffsetMinutes(viewerTimeZone, now)

  return { ...tz, localTime, hour, isOffHours, diffMinutes, diffLabel: formatDiff(diffMinutes) }
}

function formatDiff(diffMinutes: number): string {
  if (diffMinutes === 0) return 'same time as you'
  const ahead = diffMinutes > 0
  const abs = Math.abs(diffMinutes)
  const h = Math.floor(abs / 60)
  const m = abs % 60
  const parts: string[] = []
  if (h) parts.push(`${h}h`)
  if (m) parts.push(`${m}m`)
  return `${parts.join(' ')} ${ahead ? 'ahead' : 'behind'}`
}
