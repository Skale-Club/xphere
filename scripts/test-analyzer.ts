// Manual test: npx tsx scripts/test-analyzer.ts <domain>
// Tests the Website Analyzer against a real domain.
//
// Calls analyzeWebsite() and calculateLeadScore() directly — no DB writes,
// no Supabase Storage uploads. Just prints the extracted data + score.
//
// Examples:
//   npx tsx scripts/test-analyzer.ts apple.com
//   npx tsx scripts/test-analyzer.ts https://www.tesla.com
//   npx tsx scripts/test-analyzer.ts local-plumber.com.br

import { analyzeWebsite, calculateLeadScore, normaliseUrl } from '../src/services/website-analyzer/extractor'

async function main() {
  const domain = process.argv[2]
  if (!domain) {
    console.error('Usage: npx tsx scripts/test-analyzer.ts <domain>')
    process.exit(1)
  }

  const url = normaliseUrl(domain)
  console.log(`\nAnalyzing: ${url}\n`)

  const startMs = Date.now()

  let extraction
  try {
    extraction = await analyzeWebsite(url)
  } catch (err) {
    console.error('Extraction failed:', err instanceof Error ? err.message : String(err))
    process.exit(1)
  }

  const elapsedMs = Date.now() - startMs

  const score = calculateLeadScore({
    siteReachable:      true,
    isMobileResponsive: extraction.isMobileResponsive,
    hasLogo:            extraction.logoUrl !== null,
    hasCTA:             extraction.hasClearlyCTA,
    hasContactInfo:     extraction.hasContactInfo,
    loadMs:             extraction.loadMs,
    hasCSSVars:         Object.keys(extraction.rawCssVars).length > 0,
    colorCount:         extraction.brandColors.length,
  })

  // Derive services + pain points (same logic as index.ts)
  const genericNavWords = new Set(['home', 'about', 'contact', 'blog', 'news', 'faq', 'login', 'sign in', 'register'])
  const services = [
    ...extraction.navItems.filter((t) => !genericNavWords.has(t.toLowerCase())),
    ...extraction.headings.slice(1, 6),
  ]
    .filter((t, i, arr) => arr.indexOf(t) === i)
    .slice(0, 10)

  const painPoints = extraction.heroText.slice(0, 5)

  console.log('='.repeat(60))
  console.log('RESULTS')
  console.log('='.repeat(60))
  console.log(`Resolved URL:      ${extraction.resolvedUrl}`)
  console.log(`Page title:        ${extraction.pageTitle}`)
  console.log(`Load time:         ${extraction.loadMs} ms`)
  console.log(`Total script time: ${elapsedMs} ms`)
  console.log('')
  console.log(`Lead score:        ${score} / 100`)
  console.log('')
  console.log('Site signals:')
  console.log(`  Mobile-responsive: ${extraction.isMobileResponsive}`)
  console.log(`  Has logo:          ${extraction.logoUrl !== null}`)
  console.log(`  Has CTA:           ${extraction.hasClearlyCTA}`)
  console.log(`  Has contact info:  ${extraction.hasContactInfo}`)
  console.log(`  CSS vars count:    ${Object.keys(extraction.rawCssVars).length}`)
  console.log('')
  console.log('Brand colors:')
  if (extraction.brandColors.length === 0) {
    console.log('  (none detected)')
  } else {
    for (const c of extraction.brandColors) {
      console.log(`  ${c.hex}  [${c.role}]`)
    }
  }
  console.log('')
  console.log(`Logo URL: ${extraction.logoUrl ?? '(not found)'}`)
  console.log('')
  console.log('Services (derived):')
  if (services.length === 0) {
    console.log('  (none)')
  } else {
    services.forEach((s, i) => console.log(`  ${i + 1}. ${s}`))
  }
  console.log('')
  console.log('Pain points / hero text:')
  if (painPoints.length === 0) {
    console.log('  (none)')
  } else {
    painPoints.forEach((p, i) => console.log(`  ${i + 1}. ${p}`))
  }
  console.log('')
  console.log('Headings (h1-h3):')
  extraction.headings.forEach((h, i) => console.log(`  ${i + 1}. ${h}`))
  console.log('')
  console.log('Nav items:')
  extraction.navItems.forEach((n, i) => console.log(`  ${i + 1}. ${n}`))
  console.log('')
  console.log('Screenshots (not uploaded):')
  console.log(`  Desktop buffer size: ${extraction.desktopScreenshot.length.toLocaleString()} bytes`)
  console.log(`  Mobile buffer size:  ${extraction.mobileScreenshot.length.toLocaleString()} bytes`)
  console.log('')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
