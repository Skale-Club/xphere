import { type NextRequest, NextResponse } from 'next/server'
import { unstable_noStore } from 'next/cache'
import sharp from 'sharp'
import { getFaviconUrl } from '@/lib/seo'

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 }
// Matches --bg-primary in dark mode (globals.css) — keeps iOS home screen icons
// (which can't render transparency and fall back to white) consistent with the admin panel.
const DARK_BG = { r: 0x0a, g: 0x0a, b: 0x0b, alpha: 1 }

/**
 * Static "orb" brand mark — concentric circles matching XphereOrb at rest.
 * Circular with transparent corners (no square plate). Used as the icon
 * whenever the org has no custom favicon configured.
 */
function orbSvg(size: number): Buffer {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512" fill="none">
  <circle cx="256" cy="256" r="256" fill="#4F39F6"/>
  <circle cx="256" cy="256" r="204.8" fill="#665AF4"/>
  <circle cx="256" cy="256" r="153.6" fill="#7074F9"/>
  <circle cx="256" cy="256" r="99.84" fill="#848BF9"/>
</svg>`
  return Buffer.from(svg)
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ size: string }> }
) {
  unstable_noStore()

  const { size: sizeParam } = await params
  const size = Math.min(Math.max(parseInt(sizeParam, 10) || 192, 16), 1024)
  // Maskable icons keep the mark inside the safe zone so OS masking never clips it.
  const maskable = request.nextUrl.searchParams.has('maskable')
  const inner = maskable ? Math.round(size * 0.8) : size
  // iOS renders transparent home screen icon corners as white — opt into an
  // opaque plate (e.g. for apple-touch-icon) to match the admin panel instead.
  const plate = request.nextUrl.searchParams.has('bg') ? DARK_BG : TRANSPARENT

  try {
    const faviconUrl = await getFaviconUrl()
    let inputBuffer: Buffer

    if (faviconUrl) {
      const res = await fetch(faviconUrl, { next: { revalidate: 3600 } })
      if (!res.ok) throw new Error('fetch failed')
      inputBuffer = Buffer.from(await res.arrayBuffer())
    } else {
      inputBuffer = orbSvg(inner)
    }

    // Render the mark, then center it on the plate — transparent by default so
    // it stays circular with no background, or opaque when the caller needs one.
    const mark = await sharp(inputBuffer)
      .resize(inner, inner, { fit: 'contain', background: TRANSPARENT })
      .png()
      .toBuffer()

    const png = await sharp({
      create: { width: size, height: size, channels: 4, background: plate },
    })
      .composite([{ input: mark, gravity: 'center' }])
      .png()
      .toBuffer()

    return new NextResponse(new Uint8Array(png), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=3600',
      },
    })
  } catch {
    const fallback = await sharp(orbSvg(size)).resize(size, size).png().toBuffer()
    return new NextResponse(new Uint8Array(fallback), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=3600',
      },
    })
  }
}
