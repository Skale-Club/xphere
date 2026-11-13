// tests/websites-site-info.test.ts
// The text an agent reads when it asks a Skale Club Websites tenant what the business does.
// It must be explicit about what the site does NOT say, so the model never reads silence as
// permission to invent a service, an area or opening hours.

import { describe, it, expect } from 'vitest'
import { formatSiteInfo } from '@/lib/websites/site-info'

describe('formatSiteInfo', () => {
  it('lists contact details, hours, services and areas', () => {
    const text = formatSiteInfo({
      site: { url: 'https://poolsorlando.com' },
      business: {
        name: 'Pools Orlando',
        business_type: 'Pool builder',
        phone: '+1 407 555 0100',
        address: 'Orlando, FL',
        hours: {
          monday: { isOpen: true, start: '08:00', end: '18:00' },
          sunday: { isOpen: false, start: '09:00', end: '14:00' },
        },
      },
      services: [
        { slug: 'pool-construction', title: 'Pool Construction', summary: 'Custom pools' },
        { slug: 'custom-spas', title: 'Custom Spas' },
      ],
      areas: [
        { slug: 'winter-park', name: 'Winter Park', state: 'FL' },
        { slug: 'lake-nona', name: 'Lake Nona' },
      ],
    })
    expect(text).toContain('Business: Pools Orlando')
    expect(text).toContain('Phone: +1 407 555 0100')
    expect(text).toContain('Website: https://poolsorlando.com')
    expect(text).toContain('Monday: 08:00–18:00')
    expect(text).toContain('Sunday: closed')
    expect(text).toContain('- Pool Construction: Custom pools')
    expect(text).toContain('- Custom Spas')
    expect(text).toContain('Service areas: Winter Park, FL; Lake Nona')
  })

  it('says so, instead of staying silent, when no service or area is published', () => {
    const text = formatSiteInfo({ business: { name: 'Pools Orlando' }, services: [], areas: [] })
    expect(text).toContain('none published on the site yet — do not invent services')
    expect(text).toContain('none published — say you will check')
  })

  it('tolerates a snapshot with missing blocks', () => {
    expect(() => formatSiteInfo({})).not.toThrow()
    expect(formatSiteInfo({})).toContain('Services offered')
  })
})
