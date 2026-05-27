/**
 * Generates src/app/favicon.ico from public/xphere-icon.svg.
 * Runs as part of the build pipeline (see "prebuild" in package.json).
 * Sizes: 16, 32, 48 px — embedded as PNGs inside the ICO container.
 */

import sharp from 'sharp'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const ROOT = process.cwd()
const SVG_PATH = join(ROOT, 'public', 'xphere-icon.svg')
const ICO_PATH = join(ROOT, 'src', 'app', 'favicon.ico')
const SIZES = [16, 32, 48]

async function buildIco(pngs: Buffer[], sizes: number[]): Promise<Buffer> {
  const count = pngs.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(count, 4)

  const dirs: Buffer[] = []
  let offset = 6 + count * 16

  for (let i = 0; i < count; i++) {
    const dir = Buffer.alloc(16)
    const s = sizes[i]
    dir.writeUInt8(s >= 256 ? 0 : s, 0) // width  (0 = 256)
    dir.writeUInt8(s >= 256 ? 0 : s, 1) // height (0 = 256)
    dir.writeUInt8(0, 2)                 // colorCount (0 = truecolor PNG)
    dir.writeUInt8(0, 3)                 // reserved
    dir.writeUInt16LE(1, 4)              // planes
    dir.writeUInt16LE(32, 6)             // bitCount
    dir.writeUInt32LE(pngs[i].length, 8)
    dir.writeUInt32LE(offset, 12)
    offset += pngs[i].length
    dirs.push(dir)
  }

  return Buffer.concat([header, ...dirs, ...pngs])
}

async function main() {
  const svg = readFileSync(SVG_PATH)

  const pngs = await Promise.all(
    SIZES.map(size =>
      sharp(svg, { density: 300 })
        .resize(size, size)
        .png({ compressionLevel: 9 })
        .toBuffer(),
    ),
  )

  const ico = await buildIco(pngs, SIZES)
  writeFileSync(ICO_PATH, ico)
  console.log(`favicon.ico regenerated (${SIZES.join(', ')}px) → src/app/favicon.ico`)
}

main().catch(err => { console.error(err); process.exit(1) })
