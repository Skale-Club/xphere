import { describe, expect, it } from 'vitest'
import { collectBookingCandidates } from '@/services/website-analyzer/booking-candidates'
import {
  BOOKING_PROVIDERS,
  discoverBooking,
  mergeHopBooking,
  pickInternalBookingHop,
} from '@/services/website-analyzer/booking-discovery'

const PAGE = 'https://shop.example'

async function detect(html: string, pageUrl = PAGE) {
  return discoverBooking(pageUrl, await collectBookingCandidates(html, pageUrl))
}

describe('booking detection on rendered HTML', () => {
  it('Squarespace page with a "Book Now" button to getsquire.com (N. Fadez case)', async () => {
    const result = await detect(`
      <header><nav><a href="/">Home</a><a href="/services">Services</a></nav></header>
      <div class="sqs-block-button-container">
        <a class="sqs-block-button-element" href="https://getsquire.com/booking/brands/n-fadez-barber-studio">Book Now</a>
      </div>
      <script src="https://static1.squarespace.com/static/vendor.js"></script>`)
    expect(result).toMatchObject({
      detected: true,
      mode: 'third_party',
      primaryProvider: 'Squire',
      primaryUrl: 'https://getsquire.com/booking/brands/n-fadez-barber-studio',
    })
  })

  it('Squire link is not lost behind many repeated internal "Book" links', async () => {
    const internal = Array.from({ length: 14 }, (_, i) => `<a href="/book?ref=${i}">Book</a>`).join('')
    const result = await detect(`${internal}<a href="https://getsquire.com/booking/x">Reserve a chair</a>`)
    expect(result).toMatchObject({ detected: true, mode: 'third_party', primaryProvider: 'Squire' })
  })

  it('Wix page with a Booksy iframe (Neighborhood Barbers case)', async () => {
    const result = await detect(`
      <div id="comp-1"><iframe title="Booking" data-src="https://booksy.com/widget/embed?business=1234"></iframe></div>
      <script src="https://static.parastorage.com/services/wix.js"></script>`)
    expect(result).toMatchObject({ detected: true, mode: 'third_party', primaryProvider: 'Booksy' })
  })

  it('Booksy script widget with no link or label', async () => {
    const result = await detect(`
      <div class="booksy-widget"></div>
      <script src="https://booksy.com/widget/code.js?id=99&country=us&lang=en"></script>`)
    expect(result).toMatchObject({ detected: true, mode: 'third_party', primaryProvider: 'Booksy' })
  })

  it('URL hidden in data-* and onclick attributes', async () => {
    const dataAttr = await detect(`<button data-href="https://book.thecut.co/barber">Make a reservation</button>`)
    expect(dataAttr).toMatchObject({ detected: true, primaryProvider: 'TheCut' })
    const onclick = await detect(`<button onclick="window.location='https://www.vagaro.com/neighborhood'">Go</button>`)
    expect(onclick).toMatchObject({ detected: true, primaryProvider: 'Vagaro' })
  })

  it('provider URL inside inline JSON with escaped slashes', async () => {
    const result = await detect(`<script>window.__STATE__={"cta":"https:\\/\\/getsquire.com\\/booking\\/brands\\/abc"}</script>`)
    expect(result).toMatchObject({ detected: true, primaryProvider: 'Squire', primaryUrl: 'https://getsquire.com/booking/brands/abc' })
  })

  it('generic off-site "Book now" CTA to an unknown domain is detected as unknown', async () => {
    const result = await detect(`<a href="https://bookings.mycustomsystem.io/shop/12">Book now</a>`)
    expect(result).toMatchObject({
      detected: true,
      mode: 'external_unknown',
      primaryProvider: 'unknown',
      primaryUrl: 'https://bookings.mycustomsystem.io/shop/12',
    })
  })

  it('off-site unknown URL in a data attribute counts only when its label asks to book', async () => {
    expect(await detect(`<div data-image="https://cdn.example.org/hero.jpg">Our story</div>`)).toMatchObject({ detected: false })
    expect(await detect(`<button data-url="https://cdn.example.org/go">Book online</button>`)).toMatchObject({
      detected: true,
      mode: 'external_unknown',
      primaryProvider: 'unknown',
    })
  })

  it('Wix Bookings widget marker is detected as on-site Wix Bookings', async () => {
    const result = await detect(`<div data-hook="bookings-widget-root" class="wix-bookings-widget"></div>`)
    expect(result).toMatchObject({ detected: true, mode: 'on_site', primaryProvider: 'Wix Bookings' })
  })

  it('Wix /book-online path on the same site is on-site booking', async () => {
    const result = await detect(`<a href="/book-online">Reserve</a><a href="/booking-calendar/haircut">Haircut</a>`)
    expect(result).toMatchObject({ detected: true, mode: 'on_site', primaryProvider: 'Website booking' })
  })

  it('page with only an internal /book link is on_site and is the single hop candidate', async () => {
    const result = await detect(`<nav><a href="/about">About</a><a href="/book">Book</a></nav>`)
    expect(result).toMatchObject({ detected: true, mode: 'on_site', primaryUrl: 'https://shop.example/book' })
    expect(pickInternalBookingHop(PAGE, result)).toBe('https://shop.example/book')
  })

  it('no hop when a provider or off-site CTA was already found', async () => {
    const result = await detect(`<a href="/book">Book</a><a href="https://getsquire.com/booking/x">Book now</a>`)
    expect(pickInternalBookingHop(PAGE, result)).toBeNull()
  })

  it('no hop when the only booking link is the page itself', async () => {
    const result = await detect(`<a href="/book">Book</a>`, 'https://shop.example/book/')
    expect(pickInternalBookingHop('https://shop.example/book/', result)).toBeNull()
  })

  it('merging the hop page promotes the provider found there', async () => {
    const first = await detect(`<a href="/book">Book</a>`)
    const hopUrl = 'https://shop.example/book'
    const hop = await detect(`<iframe src="https://getsquire.com/booking/embed/abc"></iframe>`, hopUrl)
    const merged = mergeHopBooking(first, hopUrl, hop)
    expect(merged).toMatchObject({
      detected: true,
      mode: 'third_party',
      primaryProvider: 'Squire',
      followedUrl: hopUrl,
    })
    expect(merged.platforms).toContain('Website booking')
  })

  it('merging an empty hop keeps the on-site result (never downgrades to none)', async () => {
    const first = await detect(`<a href="/book">Book</a>`)
    const hopUrl = 'https://shop.example/book'
    const hop = await detect(`<p>Call us to book</p>`, hopUrl)
    expect(mergeHopBooking(first, hopUrl, hop)).toMatchObject({ detected: true, mode: 'on_site', followedUrl: hopUrl })
  })

  it('genuinely no booking stays detected:false', async () => {
    const result = await detect(`
      <html><head>
        <link rel="stylesheet" href="/style.css">
        <link rel="canonical" href="https://shop.example/">
        <script src="https://www.googletagmanager.com/gtag/js?id=G-1"></script>
        <script src="https://js.squareup.com/v2/paymentform"></script>
      </head><body>
        <nav><a href="/">Home</a><a href="/about">About</a><a href="/gallery">Gallery</a><a href="/contact">Contact</a></nav>
        <a href="https://www.instagram.com/shop">Instagram</a>
        <a href="https://www.facebook.com/shop">Facebook</a>
        <a href="tel:+16175550100">Call us</a>
        <p>Walk-ins only. Open Tue-Sat.</p>
        <img data-src="https://cdn.example.org/chair.jpg">
      </body></html>`)
    expect(result).toMatchObject({ detected: false, mode: 'none', primaryProvider: null, primaryUrl: null, platforms: [], links: [] })
  })

  it('Square payment scripts alone do not count; Square book links do', async () => {
    expect(await detect(`<a href="https://squareup.com/gift/abc">Gift cards</a>`)).toMatchObject({ detected: false })
    expect(await detect(`<a href="https://squareup.com/appointments/book/abc/shop">Book</a>`)).toMatchObject({
      detected: true,
      primaryProvider: 'Square Appointments',
    })
    expect(await detect(`<a href="https://mybarber.square.site/appointments">Appointments</a>`)).toMatchObject({
      detected: true,
      primaryProvider: 'Square Appointments',
    })
  })
})

describe('booking provider list', () => {
  const cases: Array<[string, string]> = [
    ['https://getsquire.com/booking/brands/x', 'Squire'],
    ['https://squire.app/shop/x', 'Squire'],
    ['https://booksy.com/en-us/1_shop', 'Booksy'],
    ['https://booksy.net/en-us/1_shop', 'Booksy'],
    ['https://www.vagaro.com/shop', 'Vagaro'],
    ['https://www.fresha.com/a/shop', 'Fresha'],
    ['https://shop.glossgenius.com/', 'GlossGenius'],
    ['https://www.styleseat.com/m/v/shop', 'StyleSeat'],
    ['https://www.schedulicity.com/scheduling/ABC', 'Schedulicity'],
    ['https://clients.mindbodyonline.com/classic/ws?studioid=1', 'Mindbody'],
    ['https://shop.as.me/', 'Acuity Scheduling'],
    ['https://app.acuityscheduling.com/schedule.php?owner=1', 'Acuity Scheduling'],
    ['https://app.squarespacescheduling.com/schedule.php?owner=1', 'Squarespace Scheduling'],
    ['https://calendly.com/shop/30min', 'Calendly'],
    ['https://www.setmore.com/bookingpage/abc', 'Setmore'],
    ['https://shop.simplybook.me/v2/', 'SimplyBook.me'],
    ['https://blvd.joinblvd.com/b/shop', 'Boulevard'],
    ['https://shop.zenoti.com/webstoreNew/services', 'Zenoti'],
    ['https://book.thecut.co/shop', 'TheCut'],
    ['https://www.booker.com/shop', 'Booker'],
    ['https://www.genbook.com/bookings/slot/reservations/1', 'Genbook'],
    ['https://book.gettimely.com/Booking/Location/1', 'Timely'],
    ['https://portal.phorest.com/book/x', 'Phorest'],
  ]

  it.each(cases)('detects %s as %s', async (url, provider) => {
    const result = await detect(`<a href="${url}">Appointments</a>`)
    expect(result).toMatchObject({ detected: true, mode: 'third_party', primaryProvider: provider })
  })

  it('lives in one exported constant with unique domains', () => {
    const domains = BOOKING_PROVIDERS.flatMap((provider) => provider.domains)
    expect(new Set(domains).size).toBe(domains.length)
  })
})
