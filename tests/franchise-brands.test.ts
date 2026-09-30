// tests/franchise-brands.test.ts
//
// Item 3(b), 2026-09-30: unit coverage for matchesFranchiseBrand
// (src/lib/prospects/franchise-brands.ts) — the single, commented module
// prospects_import_to_xmail consults to retain national barbershop/salon
// franchise locations instead of importing them as independent businesses.

import { describe, expect, it } from 'vitest'
import { FRANCHISE_BRANDS, matchesFranchiseBrand } from '@/lib/prospects/franchise-brands'

describe('matchesFranchiseBrand', () => {
  it('matches by the corporate support email domain (measured: contact.us@sportclips.com on a scraped location)', () => {
    expect(matchesFranchiseBrand('Sport Clips Haircuts of Anytown', 'contact.us@sportclips.com', null)).toBe('Sport Clips')
  })

  it('matches by business name even without a recognized domain', () => {
    expect(matchesFranchiseBrand('Great Clips - Downtown', 'greatclips.downtown@gmail.com', null)).toBe('Great Clips')
  })

  it('matches by website domain when the name is generic', () => {
    expect(matchesFranchiseBrand('Downtown Hair Salon', null, 'https://www.supercuts.com/locations/123')).toBe('Supercuts')
  })

  it('is punctuation-insensitive for apostrophes and pipes (Floyd\'s 99, 18|8)', () => {
    expect(matchesFranchiseBrand("Floyd's 99 Barbershop", null, null)).toBe("Floyd's 99 Barbershop")
    expect(matchesFranchiseBrand('18|8 Fine Men\'s Salons - Midtown', null, null)).toBe("18|8 Fine Men's Salons")
  })

  it('returns null for an independent barbershop with no franchise signal', () => {
    expect(matchesFranchiseBrand('Roslindale Barbershop', 'roslindalebarbershop@live.com', null)).toBeNull()
  })

  it('covers every brand named in the task: a realistic location name matches its own brand', () => {
    // Regis's tokens require "salon"/"hairstylist" alongside the brand word
    // (a bare "Regis" is too generic to flag on its own) — a location name
    // exercises this the same way every other brand's bare name does.
    const sampleNameByBrand: Record<string, string> = { Regis: 'Regis Salon - Westfield Mall' }
    for (const brand of FRANCHISE_BRANDS) {
      const sampleName = sampleNameByBrand[brand.name] ?? brand.name
      expect(matchesFranchiseBrand(sampleName, null, null)).toBe(brand.name)
    }
  })

  it('required roster is present (Sport Clips, Great Clips, Supercuts, Fantastic Sam\'s, Cost Cutters, Floyd\'s 99, Hair Cuttery, Roosters, V\'s Barbershop, 18|8, The Lodge, Regis)', () => {
    const names = FRANCHISE_BRANDS.map((b) => b.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'Sport Clips',
        'Great Clips',
        'Supercuts',
        "Fantastic Sam's",
        'Cost Cutters',
        "Floyd's 99 Barbershop",
        'Hair Cuttery',
        "Roosters Men's Grooming Center",
        "V's Barbershop",
        "18|8 Fine Men's Salons",
        'The Lodge (Hair)',
        'Regis',
      ]),
    )
    expect(names).toHaveLength(12)
  })
})
