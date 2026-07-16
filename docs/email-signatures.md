# Email Signatures

A per-org library of named HTML email signatures (e.g. *Sales*, *Support*),
built in **Settings → Signatures**. Signatures are usable in two ways:

- **Internally** — appended to outbound agent email replies from the inbox.
- **Externally** — copied/pasted into Gmail or Outlook signature settings.

## Data model

Table `email_signatures` (migration `1248`), org-scoped by RLS
(`get_current_org_id()`):

| column | notes |
| --- | --- |
| `document` (jsonb) | block tree — the same `EmailDocument` shape as `email_templates` |
| `html_snapshot` | compiled inline-CSS **fragment** (no `<html>`/`<head>`/`<style>`) |
| `plain_text_snapshot` | extracted text part |
| `is_default` | at most one per org (partial unique index); auto-appended to replies |

The stored HTML is a **fragment**, produced by `renderSignatureFragment()` in
`src/lib/email/render-template.ts` — chrome-free and all-inline so it survives
paste-into-compose sanitization (Gmail strips `<style>`/classes) and appends
cleanly onto an email body. The per-button Outlook MSO/VML fallback is retained.

## Editing

- **HTML editor** (`/settings/signatures/[id]`) — write/paste raw HTML with a
  sandboxed live preview, plus **Copy for Gmail/Outlook** (rich `text/html`
  clipboard), **Copy HTML**, and **Download .html**.
- **Visual builder** (`/settings/signatures/[id]/build`) — drag-and-drop blocks,
  reusing `EmailTemplateEditor` in `variant="section"`.

Both surfaces share the same `document` + `html_snapshot`. Saving runs the
canonical pipeline: `normalizeDocument → validateEmailDocument →
sanitizeEmailDocument → renderSignatureFragment → persist`. Sanitize is never
skipped — signatures are user HTML that lands in external clients.

## Internal use (agent replies)

When an agent replies by **email** in the inbox composer, a signature selector
(org default preselected, or *None*) controls what gets appended. On send:

1. The composer passes `signature_id` to `POST /api/chat/conversations/[id]/messages`.
2. The route forwards it to `dispatchOutboundMessage({ signatureId })`.
3. In the email branch, `dispatch-outbound` fetches the signature's
   `html_snapshot`, resolves merge tags (`buildSignatureVars` → `appendSignature`),
   and appends it to the body before `sendTenantEmail`.

Helpers live in `src/lib/email/signature.ts`. The append is best-effort — any
lookup miss leaves the body untouched, and unresolved `{{ tokens }}` collapse to
`''` (never leak). Automation callers (workflow/action-engine executors) never
pass `signatureId`, so automated sends are unaffected.

## External use (Gmail / Outlook)

- **Gmail:** Settings → See all settings → General → Signature → paste.
- **Outlook:** Settings → Mail → Compose and reply → Email signature.

## Not covered

- Calendar booking emails (`src/lib/calendar/emails.ts`) build their own HTML
  and do not pick up signatures.
- Platform/system mail (`sendPlatformEmail`) uses the platform identity and is
  intentionally excluded.
