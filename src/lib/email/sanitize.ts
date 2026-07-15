/**
 * Server-side HTML sanitization for the email template builder.
 *
 * The builder persists user-authored HTML fragments (`text`/`heading` block
 * `content`, the raw `html` block `content`) plus a handful of URL-bearing
 * fields (button `href`, image `src`/`link`, section `backgroundImage`).
 * None of it is trustworthy — any org member with editor access can type
 * `<script>` or `javascript:` into a field, and it's stored verbatim in the
 * `document` jsonb, re-rendered into the canvas (`dangerouslySetInnerHTML`)
 * and into the outbound email HTML (`renderTemplate`). This module is the
 * single choke point that strips dangerous markup before either happens.
 *
 * Uses `sanitize-html` (Node-only, no DOM required) so it is safe to call
 * from server actions and route handlers. See `canvas.tsx` for the
 * client-side DOMPurify pass — that is defense in depth for documents saved
 * before this module existed, not a substitute for sanitizing on write.
 */

import sanitizeHtmlLib from 'sanitize-html'
import type { EmailBlock, EmailDocument, EmailSection } from './render-template'

// ─── Shared primitives ──────────────────────────────────────────────────────

const ALLOWED_URL_SCHEMES = ['http', 'https', 'mailto', 'tel']

const INLINE_TAGS = ['a', 'strong', 'b', 'em', 'i', 'u', 's', 'br', 'span']

// ─── sanitizeInlineHtml — text/heading block content ───────────────────────
//
// Small, editor-authored rich text. Only structural formatting tags survive;
// style is limited to a handful of safe, purely visual properties.

const INLINE_STYLE_RULES: sanitizeHtmlLib.IOptions['allowedStyles'] = {
  '*': {
    color: [
      /^#[0-9a-fA-F]{3,8}$/,
      /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*[\d.]+\s*)?\)$/,
    ],
    'font-weight': [/^(normal|bold|bolder|lighter|[1-9]00)$/],
    'font-style': [/^(normal|italic|oblique)$/],
    'text-decoration': [
      /^(none|underline|line-through|overline)(\s(none|underline|line-through|overline))*$/,
    ],
  },
}

export function sanitizeInlineHtml(html: string | undefined | null): string {
  if (!html) return ''
  return sanitizeHtmlLib(html, {
    allowedTags: INLINE_TAGS,
    allowedAttributes: {
      a: ['href', 'target', 'rel', 'style'],
      span: ['style'],
    },
    allowedStyles: INLINE_STYLE_RULES,
    allowedSchemes: ALLOWED_URL_SCHEMES,
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    // script/style content is dropped entirely (not left behind as text);
    // iframe/object/embed/noscript are included here too so any injected
    // markup and its inner text both disappear rather than degrading to a
    // harmless-looking text node.
    nonTextTags: ['script', 'style', 'textarea', 'option', 'iframe', 'object', 'embed', 'noscript'],
  })
}

// ─── sanitizeBlockHtml — the raw 'html' escape-hatch block ─────────────────
//
// Broader allowlist for hand-authored email markup (tables, images, headings)
// but still no active content: no script/iframe/object/embed/form/link/meta/
// style tags, no event-handler attributes (nothing starting with "on" is ever
// in the allowlist below, so sanitize-html strips it unconditionally).

const BLOCK_TAGS = [
  'p', 'div', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'img',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'hr',
  ...INLINE_TAGS,
]

const BLOCK_STYLE_PROPS = [
  'color', 'background-color', 'background', 'font-family', 'font-size', 'font-weight',
  'font-style', 'text-decoration', 'text-align', 'vertical-align', 'line-height',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
  'border-radius', 'border-color', 'border-width', 'border-style', 'border-collapse',
  'width', 'max-width', 'min-width', 'height', 'max-height', 'display', 'box-sizing',
]

// Broad allowlist of properties, but reject values that could smuggle script
// execution through CSS (legacy IE `expression()`, `url(javascript:...)`,
// stray `data:`/`vbscript:` payloads). Not a strict per-property validator —
// email clients already ignore anything they don't understand.
const SAFE_CSS_VALUE = /^(?!.*expression\s*\()(?!.*javascript:)(?!.*vbscript:)(?!.*data:)[\s\S]*$/i

const BLOCK_STYLE_RULES: sanitizeHtmlLib.IOptions['allowedStyles'] = {
  '*': Object.fromEntries(BLOCK_STYLE_PROPS.map((prop) => [prop, [SAFE_CSS_VALUE]])),
}

export function sanitizeBlockHtml(html: string | undefined | null): string {
  if (!html) return ''
  return sanitizeHtmlLib(html, {
    allowedTags: BLOCK_TAGS,
    allowedAttributes: {
      '*': ['style', 'align', 'valign', 'class'],
      a: ['href', 'target', 'rel'],
      img: ['src', 'alt', 'width', 'height'],
      table: ['border', 'cellpadding', 'cellspacing', 'role', 'width'],
      td: ['width', 'colspan', 'rowspan'],
      th: ['width', 'colspan', 'rowspan'],
    },
    allowedStyles: BLOCK_STYLE_RULES,
    allowedSchemes: ALLOWED_URL_SCHEMES,
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    nonTextTags: ['script', 'style', 'textarea', 'option', 'iframe', 'object', 'embed', 'form', 'noscript'],
  })
}

// ─── sanitizeUrl — button.href, image.src/link, section.backgroundImage ────
//
// Allows http:/https:/mailto:/tel: and merge-tag values (e.g. a href built
// from "{{contact.id}}" — these have no parseable scheme so they're
// relative-shaped and pass through unchanged). Replaces javascript:/data:/
// vbscript: — and, defensively, any other unrecognized scheme — with an
// empty string. Bare relative URLs ("#", "/foo") pass through: they carry no
// scheme and can't execute script.

const MERGE_TAG_RE = /\{\{[^{}]+\}\}/
const DANGEROUS_SCHEME_RE = /^(javascript|data|vbscript)\s*:/i
const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*)\s*:/

function detectScheme(value: string): string | null {
  const match = SCHEME_RE.exec(value)
  return match ? match[1].toLowerCase() : null
}

export function sanitizeUrl(value: string | undefined | null): string {
  if (value == null) return ''
  const trimmed = String(value).trim()
  if (!trimmed) return trimmed

  if (MERGE_TAG_RE.test(trimmed)) return trimmed

  // Strip embedded whitespace (space/tab/newline/etc, including obscure
  // unicode spaces matched by \s) that can be used to obfuscate a dangerous
  // scheme — e.g. "java\tscript:" — before testing. Also test the raw value
  // in case stripping changes something incidentally.
  const collapsed = trimmed.replace(/\s+/g, '')
  if (DANGEROUS_SCHEME_RE.test(collapsed) || DANGEROUS_SCHEME_RE.test(trimmed)) return ''

  const scheme = detectScheme(collapsed) ?? detectScheme(trimmed)
  if (!scheme) return trimmed // relative URL — no scheme, nothing to execute
  if (ALLOWED_URL_SCHEMES.includes(scheme)) return trimmed
  return '' // unknown scheme (ftp:, file:, blob:, ...) — default-deny
}

// ─── sanitizeEmailDocument — full-document walk ────────────────────────────

function sanitizeBlock(block: EmailBlock): EmailBlock {
  switch (block.blockType) {
    case 'text':
      return { ...block, content: sanitizeInlineHtml(block.content) }
    case 'heading':
      return { ...block, content: sanitizeInlineHtml(block.content) }
    case 'html':
      return { ...block, content: sanitizeBlockHtml(block.content) }
    case 'button':
      return { ...block, href: sanitizeUrl(block.href) }
    case 'image':
      return {
        ...block,
        src: sanitizeUrl(block.src),
        ...(block.link !== undefined ? { link: sanitizeUrl(block.link) } : {}),
      }
    default:
      return block
  }
}

/** Sanitizes a flat block array — used for section-template documents, which
 *  are stored as `{ blocks: EmailBlock[] }` rather than a full section tree. */
export function sanitizeBlocks(blocks: EmailBlock[] | undefined | null): EmailBlock[] {
  return (blocks ?? []).map(sanitizeBlock)
}

function sanitizeSection(section: EmailSection): EmailSection {
  return {
    ...section,
    ...(section.backgroundImage !== undefined
      ? { backgroundImage: sanitizeUrl(section.backgroundImage) }
      : {}),
    columns: (section.columns ?? []).map((col) => sanitizeBlocks(col)),
  }
}

/** Walks sections -> columns -> blocks, applying the appropriate sanitizer
 *  per block type and validating every URL-bearing field. Returns a new
 *  document — the input is never mutated. Call this AFTER
 *  `validateEmailDocument` and BEFORE `renderTemplate` / persisting. */
export function sanitizeEmailDocument(doc: EmailDocument): EmailDocument {
  return {
    ...doc,
    sections: (doc.sections ?? []).map(sanitizeSection),
  }
}
