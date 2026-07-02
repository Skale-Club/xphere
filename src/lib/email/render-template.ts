/**
 * Block-based email template renderer.
 *
 * Converts the block document JSON produced by the email template builder
 * into email-safe HTML (table-based layout, inline CSS).
 *
 * Document schema
 * ───────────────
 * {
 *   backgroundColor: string,
 *   contentWidth: number,           // px, default 600
 *   sections: Section[]
 * }
 *
 * Section:
 * {
 *   id: string,
 *   layout: 1 | 2 | 3,             // column count
 *   backgroundColor: string,
 *   padding: { top, right, bottom, left } (px),
 *   columns: Block[][]              // columns[colIndex][blockIndex]
 * }
 *
 * Block types (blockType):
 *   text   – { content: string (HTML), fontSize, color, align }
 *   image  – { src, alt, width, link }
 *   button – { label, href, backgroundColor, textColor, borderRadius }
 *   divider – { color, thickness }
 *   spacer  – { height }
 *   heading – { content, level: 1|2|3, color, align }
 */

export type BlockPadding = { top: number; right: number; bottom: number; left: number }

/** Stable, editor-only identity shared by every block. Lives in the document
 *  jsonb, backfilled on read by `normalizeDocument`, and NEVER emitted into the
 *  rendered HTML. */
export type BaseBlock = { id: string }

export type TextBlock = BaseBlock & {
  blockType: 'text'
  content: string
  fontSize?: number
  color?: string
  align?: 'left' | 'center' | 'right'
}

export type HeadingBlock = BaseBlock & {
  blockType: 'heading'
  content: string
  level?: 1 | 2 | 3
  color?: string
  align?: 'left' | 'center' | 'right'
}

export type ImageBlock = BaseBlock & {
  blockType: 'image'
  src: string
  alt?: string
  width?: number | string
  link?: string
}

export type ButtonBlock = BaseBlock & {
  blockType: 'button'
  label: string
  href: string
  backgroundColor?: string
  textColor?: string
  borderRadius?: number
}

export type DividerBlock = BaseBlock & {
  blockType: 'divider'
  color?: string
  thickness?: number
}

export type SpacerBlock = BaseBlock & {
  blockType: 'spacer'
  height?: number
}

export type HtmlBlock = BaseBlock & {
  blockType: 'html'
  content: string
}

export type EmailBlock =
  | TextBlock
  | HeadingBlock
  | ImageBlock
  | ButtonBlock
  | DividerBlock
  | SpacerBlock
  | HtmlBlock

/** Union-aware Omit. Plain `Omit<EmailBlock, 'id'>` collapses the discriminated
 *  union to its shared keys (only `blockType`); this distributes over each
 *  member so per-block properties survive — used for the id-free BLOCK_DEFAULTS. */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

export type EmailSection = {
  id: string
  layout: 1 | 2 | 3
  backgroundColor?: string
  padding?: Partial<BlockPadding>
  columnsGap?: number
  columns: EmailBlock[][]
}

export type EmailDocument = {
  backgroundColor?: string
  contentWidth?: number
  fontFamily?: string
  sections: EmailSection[]
}

// ─── Block identity ───────────────────────────────────────────────────────────

/** Stable, editor-only block id. Never rendered into HTML. Mirrors the
 *  section-id generator so blocks and sections share one convention. */
export function makeBlockId(): string {
  return Math.random().toString(36).slice(2, 10)
}

// ─── Render ──────────────────────────────────────────────────────────────────

export function renderTemplate(document: EmailDocument | Record<string, unknown>): {
  html: string
  plainText: string
} {
  const doc = document as EmailDocument
  const bgColor = doc.backgroundColor ?? '#f0f0f0'
  const width = doc.contentWidth ?? 600
  const fontFamily = doc.fontFamily ?? 'Arial, sans-serif'
  const sections = doc.sections ?? []

  const sectionHtml = sections.map((s) => renderSection(s, fontFamily)).join('\n')
  const plainText = extractPlainText(sections)

  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="x-apple-disable-message-reformatting" />
  <style type="text/css">
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
    body { margin: 0 !important; padding: 0 !important; background-color: ${bgColor}; width: 100% !important; }
    a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; }
    @media only screen and (max-width: 620px) {
      .email-container { width: 100% !important; max-width: 100% !important; }
      .col-block { display: block !important; width: 100% !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:${bgColor};">
  <table border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%" style="background-color:${bgColor};">
    <tr>
      <td align="center" valign="top" style="padding:32px 16px;">
        <table class="email-container" border="0" cellpadding="0" cellspacing="0" role="presentation" width="${width}" style="background-color:#ffffff;max-width:${width}px;width:100%;">
          <tr>
            <td>
${sectionHtml}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

  return { html, plainText }
}

// ─── Section renderer ─────────────────────────────────────────────────────────

function renderSection(section: EmailSection, fontFamily: string): string {
  const bg = section.backgroundColor ?? '#ffffff'
  const pad = {
    top: section.padding?.top ?? 16,
    right: section.padding?.right ?? 24,
    bottom: section.padding?.bottom ?? 16,
    left: section.padding?.left ?? 24,
  }

  const cols = section.columns ?? [[]]
  const layout = section.layout ?? 1
  const gap = section.columnsGap ?? 0
  const halfGap = gap > 0 ? gap / 2 : 0
  const colWidth = Math.floor(100 / layout)

  const colsHtml = cols
    .slice(0, layout)
    .map((blocks, idx) => {
      const blocksHtml = blocks.map((b) => renderBlock(b, fontFamily)).join('\n')
      if (layout === 1) {
        return `<td class="col-block" valign="top" style="padding:${pad.top}px ${pad.right}px ${pad.bottom}px ${pad.left}px;background-color:${bg};">\n${blocksHtml}\n</td>`
      }
      const leftPad = idx === 0 ? pad.left : pad.left + halfGap
      const rightPad = idx === layout - 1 ? pad.right : pad.right + halfGap
      return `<td class="col-block" valign="top" width="${colWidth}%" style="width:${colWidth}%;padding:${pad.top}px ${rightPad}px ${pad.bottom}px ${leftPad}px;background-color:${bg};">\n${blocksHtml}\n</td>`
    })
    .join('\n')

  return `<table border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%" style="background-color:${bg};">
  <tr>
${colsHtml}
  </tr>
</table>`
}

// ─── Block renderers ──────────────────────────────────────────────────────────

function renderBlock(block: EmailBlock, fontFamily: string): string {
  switch (block.blockType) {
    case 'text':
      return renderTextBlock(block, fontFamily)
    case 'heading':
      return renderHeadingBlock(block, fontFamily)
    case 'image':
      return renderImageBlock(block)
    case 'button':
      return renderButtonBlock(block, fontFamily)
    case 'divider':
      return renderDividerBlock(block)
    case 'spacer':
      return renderSpacerBlock(block)
    case 'html':
      return renderHtmlBlock(block)
    default:
      return ''
  }
}

function renderTextBlock(block: TextBlock, fontFamily: string): string {
  const fontSize = block.fontSize ?? 15
  const color = block.color ?? '#333333'
  const align = block.align ?? 'left'
  return `<div style="font-family:${fontFamily};font-size:${fontSize}px;line-height:1.6;color:${color};text-align:${align};margin-bottom:12px;">${block.content}</div>`
}

function renderHeadingBlock(block: HeadingBlock, fontFamily: string): string {
  const level = block.level ?? 2
  const sizes: Record<number, number> = { 1: 32, 2: 24, 3: 20 }
  const fontSize = sizes[level] ?? 24
  const color = block.color ?? '#111111'
  const align = block.align ?? 'left'
  return `<h${level} style="font-family:${fontFamily};font-size:${fontSize}px;font-weight:700;line-height:1.3;color:${color};text-align:${align};margin:0 0 12px 0;">${block.content}</h${level}>`
}

function renderImageBlock(block: ImageBlock): string {
  const width = block.width ?? '100%'
  const widthAttr = typeof width === 'number' ? `${width}px` : width
  const img = `<img src="${escAttr(block.src)}" alt="${escAttr(block.alt ?? '')}" width="${widthAttr}" style="max-width:100%;height:auto;display:block;margin:0 auto 12px;" />`
  if (block.link) {
    return `<a href="${escAttr(block.link)}" target="_blank" rel="noopener" style="display:block;">${img}</a>`
  }
  return img
}

function renderButtonBlock(block: ButtonBlock, fontFamily: string): string {
  const bg = block.backgroundColor ?? '#000000'
  const fg = block.textColor ?? '#ffffff'
  const radius = block.borderRadius ?? 4
  return `<table border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 0 16px;">
  <tr>
    <td align="center" style="border-radius:${radius}px;background-color:${bg};">
      <a href="${escAttr(block.href)}" target="_blank" rel="noopener" style="display:inline-block;font-family:${fontFamily};font-size:15px;font-weight:600;color:${fg};text-decoration:none;padding:12px 24px;border-radius:${radius}px;background-color:${bg};">${escHtml(block.label)}</a>
    </td>
  </tr>
</table>`
}

function renderDividerBlock(block: DividerBlock): string {
  const color = block.color ?? '#e5e5e5'
  const thickness = block.thickness ?? 1
  return `<hr style="border:0;border-top:${thickness}px solid ${color};margin:16px 0;" />`
}

function renderSpacerBlock(block: SpacerBlock): string {
  const height = block.height ?? 24
  return `<div style="height:${height}px;line-height:${height}px;">&nbsp;</div>`
}

function renderHtmlBlock(block: HtmlBlock): string {
  return block.content ?? ''
}

// ─── Plain text extraction ────────────────────────────────────────────────────

function extractPlainText(sections: EmailSection[]): string {
  const parts: string[] = []
  for (const section of sections) {
    for (const col of section.columns ?? []) {
      for (const block of col) {
        switch (block.blockType) {
          case 'text':
          case 'heading':
            parts.push(stripHtml(block.content))
            break
          case 'button':
            parts.push(`${block.label} (${block.href})`)
            break
          default:
            break
        }
      }
    }
  }
  return parts.filter(Boolean).join('\n\n')
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escAttr(str: string): string {
  return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// ─── Empty document template ──────────────────────────────────────────────────

export function emptyDocument(): EmailDocument {
  return {
    backgroundColor: '#f0f0f0',
    contentWidth: 600,
    fontFamily: 'Arial, sans-serif',
    sections: [],
  }
}

// ─── Upgrade-on-read normalization ────────────────────────────────────────────

/**
 * Upgrade-on-read: validate the stored document shape and backfill missing
 * block/section ids. Legacy templates (saved before Phase 118) have blocks with
 * no `id`; this mints stable ids in memory so the editor can key/select by id.
 * The backfilled ids persist on the next save — no DB migration required.
 * ids are editor-only metadata and are never emitted by renderTemplate.
 */
export function normalizeDocument(raw: unknown): EmailDocument {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return emptyDocument()
  }
  const doc = raw as Partial<EmailDocument>
  if (!Array.isArray(doc.sections)) {
    return emptyDocument()
  }
  return {
    ...doc,
    sections: doc.sections.map((section) => ({
      ...section,
      id: section.id || makeBlockId(),
      columns: (section.columns ?? []).map((col) =>
        (col ?? []).map((block) => ({
          ...block,
          id: block.id || makeBlockId(),
        })),
      ),
    })) as EmailSection[],
  }
}

export const BLOCK_DEFAULTS: Record<string, DistributiveOmit<EmailBlock, 'id'>> = {
  text: {
    blockType: 'text',
    content: 'Edit this text block.',
    fontSize: 15,
    color: '#333333',
    align: 'left',
  },
  heading: {
    blockType: 'heading',
    content: 'Heading Text',
    level: 2,
    color: '#111111',
    align: 'left',
  },
  image: {
    blockType: 'image',
    src: 'https://placehold.co/600x200',
    alt: 'Image',
  },
  button: {
    blockType: 'button',
    label: 'Click Here',
    href: 'https://',
    backgroundColor: '#000000',
    textColor: '#ffffff',
    borderRadius: 4,
  },
  divider: {
    blockType: 'divider',
    color: '#e5e5e5',
    thickness: 1,
  },
  spacer: {
    blockType: 'spacer',
    height: 24,
  },
  html: {
    blockType: 'html',
    content: '<p>Custom HTML here…</p>',
  },
}
