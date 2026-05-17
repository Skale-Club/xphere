# Phase 24: Dashboard Config UI - Research

**Researched:** 2026-05-06
**Domain:** Next.js 15 App Router UI — integrations page pattern, copy-to-clipboard, server actions, ManyChat API
**Confidence:** HIGH

## Summary

Phase 24 builds the `/integrations/manychat` setup page so admins can self-serve the full ManyChat External Request configuration. The project already has strong precedents in the Meta integration page (`src/app/(dashboard)/integrations/meta/page.tsx` + `src/components/integrations/meta-settings.tsx`) and the copy-to-clipboard pattern from the reviews widget configurator. No new libraries are required.

The page has two rendering states: "not connected" (shows the API key form) and "connected" (shows the webhook URL, webhook secret, JSON payload template, and Test Connection button). The `getManychatChannel()` getter must be added to `actions.ts` in the manychat directory — it reads `webhook_secret` from `manychat_channels` for display in the connected state. The `testConnection` server action calls `GET https://api.manychat.com/fb/page/getFlows` with `Authorization: Bearer {decrypted_key}` and returns `{ success, error? }`.

The `/integrations` root page currently shows only Meta as a card plus the `IntegrationsTable` (which lists API-key-style integrations). ManyChat's dedicated setup page needs a card entry parallel to Meta added to the root page.

**Primary recommendation:** Model the page after `meta/page.tsx` (server component data fetch + client settings component). Use `navigator.clipboard.writeText` + `sonner` toast for all copy buttons — identical to the reviews widget configurator pattern already in the codebase.

## Project Constraints (from CLAUDE.md)

- Stack: Next.js 15 App Router, TypeScript 5 strict, Supabase, Tailwind 4, shadcn/ui
- Auth: always use `createClient` / `getUser` from `@/lib/supabase/server`, never `supabase.auth.getUser()` directly
- Forms: `react-hook-form` + `zod` + `zodResolver`
- Toasts: `sonner`
- API routes: inbound webhooks always return HTTP 200 (already handled in Phase 22)
- `src/lib/crypto.ts` format must not change
- Migrations: add new ones, never edit old
- After changes: `npm run build` must pass before finishing
- Server components by default; `'use client'` only when needed

## Standard Stack

### Core (no new dependencies required)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js 15 App Router | 15.x | Server components, server actions, routing | Project standard |
| TypeScript 5 strict | 5.x | Type safety | Project standard |
| shadcn/ui | current | Card, Button, Input, Badge, Textarea | Consistent with all existing pages |
| react-hook-form | current | Form state management | Project standard for all forms |
| zod | current | Schema validation | Project standard |
| sonner | current | Toast notifications | Project standard |
| lucide-react | current | Copy, Check, Loader2, Zap icons | Used everywhere in dashboard |

**Installation:** No new packages needed.

## Architecture Patterns

### Recommended File Structure

```
src/app/(dashboard)/integrations/
  page.tsx                          # MODIFY: add ManyChat card alongside Meta card
  manychat/
    actions.ts                      # MODIFY: add getManychatChannel(), testManychatConnection()
    rule-actions.ts                 # EXISTING — no changes needed
    page.tsx                        # CREATE: server component — fetches channel, renders settings
src/components/integrations/
  manychat-settings.tsx             # CREATE: 'use client' settings component
```

### Pattern 1: Server Component Page with Client Settings Component

Follows the identical pattern to `meta/page.tsx` → `meta-settings.tsx`.

The server component (`page.tsx`) uses `createClient` + `getUser`, queries `manychat_channels`, and passes the data as props to the client component. The client component holds all interactive state (copy feedback, test-connection pending, delete confirm).

```typescript
// src/app/(dashboard)/integrations/manychat/page.tsx
import { createClient, getUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getManychatChannel } from './actions'
import { ManychatSettings } from '@/components/integrations/manychat-settings'

export default async function ManychatPage() {
  const user = await getUser()
  if (!user) redirect('/login')

  const channel = await getManychatChannel()

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-lg font-semibold">ManyChat</h1>
        <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">
          Connect your ManyChat bot to receive subscriber events and route them to actions.
        </p>
      </div>
      <ManychatSettings channel={channel} />
    </div>
  )
}
```

### Pattern 2: Two-State UI (Not Connected / Connected)

The client settings component renders two mutually exclusive states:

**Not connected state:**
- `react-hook-form` + `zod` form with `channelName` and `apiKey` fields
- Submit calls `createManychatChannel()` (existing server action from Phase 22)
- On success: `router.refresh()` (server component re-fetches, switches to connected state)

**Connected state:**
- Read-only display of `channel_name` and `key_hint`
- Copyable webhook URL field: `https://operator.skale.club/api/manychat/webhook`
- Copyable webhook secret field (value from `getManychatChannel()`)
- Copyable JSON payload template (pre-formatted code block)
- "Test Connection" button → calls `testManychatConnection()` server action
- "Disconnect" button → calls `deleteManychatChannel(channel.id)` (existing)

### Pattern 3: Copy-to-Clipboard

Established codebase pattern from `review-widget-configurator.tsx` and `widget-settings-form.tsx`:

```typescript
// 'use client' component
import { Copy } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

async function handleCopy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`${label} copied.`)
  } catch {
    toast.error(`Failed to copy ${label}.`)
  }
}

// Usage
<Button type="button" variant="outline" size="sm" onClick={() => handleCopy(webhookUrl, 'Webhook URL')}>
  <Copy className="mr-2 h-4 w-4" />
  Copy
</Button>
```

Optionally enhance with a transient "Copied!" check icon state (not yet in codebase — LOW priority for this phase). The basic pattern is sufficient.

### Pattern 4: Test Connection Server Action

Follows the existing `testConnection()` in `src/app/(dashboard)/integrations/actions.ts` — decrypt key, call external API with 5s timeout, return `{ success, error? }`.

```typescript
// In manychat/actions.ts
export async function testManychatConnection(): Promise<{ success: boolean; error?: string }> {
  const user = await getUser()
  if (!user) return { success: false, error: 'Not authenticated.' }

  const supabase = await createClient()

  // Fetch encrypted key — never returns raw key to caller
  const { data: channel } = await supabase
    .from('manychat_channels')
    .select('encrypted_api_key')
    .single()

  if (!channel) return { success: false, error: 'No ManyChat channel configured.' }

  let apiKey: string
  try {
    apiKey = await decrypt(channel.encrypted_api_key)
  } catch {
    return { success: false, error: 'Failed to decrypt credentials.' }
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 5000)

  try {
    const response = await fetch('https://api.manychat.com/fb/page/getFlows', {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    })
    if (response.ok) return { success: true }
    return { success: false, error: `ManyChat returned status ${response.status}` }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { success: false, error: 'Connection timed out after 5 seconds.' }
    }
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error.' }
  } finally {
    clearTimeout(timeoutId)
  }
}
```

### Pattern 5: getManychatChannel() Getter

New server action that returns the full channel row including `webhook_secret` for UI display. Returns `null` when no channel is configured for the org.

```typescript
export type ManychatChannelForDisplay = {
  id: string
  channelName: string
  keyHint: string
  webhookSecret: string   // shown in UI — NOT the API key
  isActive: boolean
  createdAt: string
}

export async function getManychatChannel(): Promise<ManychatChannelForDisplay | null> {
  const supabase = await createClient()

  const { data } = await supabase
    .from('manychat_channels')
    .select('id, channel_name, key_hint, webhook_secret, is_active, created_at')
    .maybeSingle()

  if (!data) return null

  return {
    id: data.id,
    channelName: data.channel_name,
    keyHint: data.key_hint ?? '••••••••',
    webhookSecret: data.webhook_secret,
    isActive: data.is_active,
    createdAt: data.created_at,
  }
}
```

**Security note:** `webhook_secret` is the inbound verification token — safe to display in the dashboard (admin must copy it to ManyChat). `encrypted_api_key` is NEVER returned. RLS scopes this to the active org automatically via the authenticated client.

### Pattern 6: Root /integrations Page Update

Add a ManyChat card parallel to the existing Meta card:

```typescript
// In src/app/(dashboard)/integrations/page.tsx — add after Meta card
<Card>
  <CardHeader>
    <div className="flex items-center gap-2">
      <MessageCircleMore className="h-4 w-4 text-muted-foreground" />
      <CardTitle className="text-base">ManyChat</CardTitle>
    </div>
    <CardDescription>
      Connect a ManyChat bot to receive subscriber events and route them to actions.
    </CardDescription>
  </CardHeader>
  <CardContent>
    <Link href="/integrations/manychat" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
      Open ManyChat settings
    </Link>
  </CardContent>
</Card>
```

ManyChat should NOT appear in `ALL_PROVIDERS` in `IntegrationsTable` — it has a dedicated settings page like Meta, not a sheet-based API key form.

### Anti-Patterns to Avoid

- **Returning `encrypted_api_key` from any server action** — getter returns `webhook_secret` (safe) + `key_hint` (safe), never the encrypted key bytes.
- **Calling `supabase.auth.getUser()` directly** — always use `getUser()` from `@/lib/supabase/server`.
- **Manually filtering by `org_id`** — RLS via authenticated client scopes automatically. `.maybeSingle()` on `manychat_channels` is safe because of the `UNIQUE(org_id)` constraint.
- **Adding ManyChat to `IntegrationsTable`'s `ALL_PROVIDERS`** — ManyChat uses a dedicated page, not the generic sheet pattern.
- **Fetching `webhook_secret` in a useEffect or client fetch** — must come from the server component data fetch to avoid client-side leakage.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Copy to clipboard | Custom hook or direct DOM | `navigator.clipboard.writeText` + sonner toast | Pattern already exists twice in codebase |
| Form validation | Manual state checks | `react-hook-form` + `zod` | Project standard, consistent with all forms |
| Toast notifications | Custom banner state | `sonner` | Project standard |
| API key masking | Custom masking function | `maskApiKey` from `@/lib/crypto` | Already encrypts and masks consistently |
| Encryption | Custom crypto | `encrypt`/`decrypt` from `@/lib/crypto` | AES-256-GCM, must not duplicate |

## ManyChat API — getFlows Endpoint

**Endpoint:** `GET https://api.manychat.com/fb/page/getFlows`

**Auth:** `Authorization: Bearer {api_key}` (static token from ManyChat Settings → API)

**Response (MEDIUM confidence — from PLANNING.md + Swagger reference, not directly observed):**
```json
{
  "status": "success",
  "data": [
    { "id": "content20000001", "name": "Flow name" }
  ]
}
```

**For CHANNEL-04 (Test Connection):** A 200 `ok` response from this endpoint confirms the key is valid. The flows list itself is not needed for Phase 24 — Phase 26 will use the array for the flow selector dropdown.

**Rate limits:** Not publicly documented. LOW confidence. Assume standard REST limits; the test connection is one call per user action, not a polling loop — no risk in Phase 24.

**Pagination:** Not confirmed. The PLANNING.md notes this as an open question. For Phase 24 (test connection only), the response status is what matters, not the payload. Phase 26 (flow selector) will need to investigate pagination.

**Token format:** Static API key (no expiry, no OAuth). Generated in ManyChat under Settings → API. Format observed in community: appears to be a long alphanumeric string. No documented prefix to validate against (unlike Anthropic's `sk-ant-` prefix) — key validity must be tested via the API call.

**Confidence:** MEDIUM — endpoint URL confirmed from PLANNING.md and Swagger reference. Response structure is inferred from the PHP library docs and community references, not live observation.

## JSON Payload Template

From `projects/manychat-integration/PLANNING.md` (canonical source):

```json
{
  "subscriber_id": "{{user.id}}",
  "first_name": "{{user.first_name}}",
  "last_name": "{{user.last_name}}",
  "email": "{{user.email}}",
  "phone": "{{user.phone}}",
  "tags": "{{user.tags}}",
  "event_type": "flow_completed",
  "flow_id": "{{flow_id}}"
}
```

This template uses ManyChat's interpolation syntax for the External Request body config. Admin copies this JSON verbatim into the External Request body configuration panel in ManyChat. The `event_type` field is a literal string (admin customizes per flow); all `{{...}}` fields are ManyChat-supplied variables.

Display in UI: `<Textarea readOnly>` with monospace font, pre-formatted JSON, Copy button. Use `JSON.stringify(template, null, 2)` to ensure consistent formatting.

## UI States

### Not Connected State
```
Card:
  Title: "Connect ManyChat"
  Description: "Enter your ManyChat API key to start receiving subscriber events."
  Form:
    - Channel name input (label: "Bot name", placeholder: "Main Bot")
    - API key input (type="password", label: "ManyChat API key")
    - Submit button: "Connect"
    - Error message if createManychatChannel() returns error
```

### Connected State
```
Card:
  Header: channel.channelName + Active badge
  Sections:
  1. Webhook URL
     - Read-only input or code block: https://operator.skale.club/api/manychat/webhook
     - "Copy URL" button
  2. Webhook Secret
     - Read-only input: channel.webhookSecret (full value)
     - "Copy Secret" button
     - Helper text: "Add as X-Operator-Secret header in ManyChat External Request"
  3. Payload Template
     - Label: "Copy this JSON into your External Request body config"
     - Read-only Textarea (monospace): formatted JSON template
     - "Copy JSON" button
  4. Test Connection
     - Button: "Test Connection"
     - Shows spinner while pending
     - On success: green toast "Connection successful — ManyChat API key is valid."
     - On failure: red toast with error message
  5. Danger zone (or bottom of card)
     - "Disconnect" button (destructive)
     - Calls deleteManychatChannel(channel.id), then router.refresh()
```

## Common Pitfalls

### Pitfall 1: Page Fetches webhook_secret at Wrong Layer
**What goes wrong:** `webhook_secret` fetched client-side via a fetch to an API route, exposing it over the wire unnecessarily.
**Why it happens:** Treating the page like a client-side app.
**How to avoid:** Fetch in the server component via `getManychatChannel()` and pass as a prop. It renders server-side and is included in the initial HTML — acceptable for an admin-only dashboard.

### Pitfall 2: Adding ManyChat to IntegrationsTable ALL_PROVIDERS
**What goes wrong:** ManyChat appears as a row in the generic sheet-based integrations table AND has its own page, causing duplicate connection surfaces.
**Why it happens:** Copying the pattern from other providers without checking the Meta precedent.
**How to avoid:** Follow the Meta pattern — add a card on the `/integrations` root page with a link, skip `ALL_PROVIDERS`.

### Pitfall 3: testManychatConnection Throws Instead of Returning Error
**What goes wrong:** Unhandled errors surface to the client as unformatted error pages.
**Why it happens:** Forgetting the established pattern of `return { success: false, error: ... }` for all failure paths.
**How to avoid:** Every catch block returns `{ success: false, error: string }` — same as the existing `testConnection()` pattern in `integrations/actions.ts`.

### Pitfall 4: org_id filter missing on getManychatChannel
**What goes wrong:** If RLS is not active (e.g., service role client accidentally used), the query could return another org's channel.
**Why it happens:** Using service role client instead of authenticated user client.
**How to avoid:** Use `createClient()` (authenticated, RLS active) never `createServiceRoleClient()` in server actions. The `UNIQUE(org_id)` + RLS means `.maybeSingle()` is safe without an explicit org filter.

### Pitfall 5: Build Fails Due to Untyped manychat_channels columns
**What goes wrong:** `src/types/database.ts` may not include `webhook_secret` in the generated type if the column was added in a migration that hasn't been pushed.
**Why it happens:** Migrations 018-020 and ManyChat migrations are pending push (see STATE.md Pending Todos).
**How to avoid:** After implementing, run `npm run build`. If TypeScript errors arise from missing DB types, update `src/types/database.ts` manually to include the ManyChat tables and columns. The CLAUDE.md requires `npm run build` to pass before finishing.

## Code Examples

### Form Schema (Not Connected State)
```typescript
// Source: project convention — all forms in codebase use this pattern
import { z } from 'zod'

const manychatChannelSchema = z.object({
  channelName: z.string().min(1, 'Bot name is required'),
  apiKey: z.string().min(1, 'API key is required'),
})

type ManychatChannelFormValues = z.infer<typeof manychatChannelSchema>
```

### Copy Button Implementation
```typescript
// Source: src/components/reviews/review-widget-configurator.tsx (established pattern)
async function handleCopy(text: string, successMsg: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(successMsg)
  } catch {
    toast.error('Failed to copy. Please copy manually.')
  }
}
```

### Test Connection Handler (Client Side)
```typescript
// 'use client' component pattern
const [isTesting, setIsTesting] = useState(false)

async function handleTestConnection() {
  setIsTesting(true)
  try {
    const result = await testManychatConnection()
    if (result.success) {
      toast.success('Connection successful — ManyChat API key is valid.')
    } else {
      toast.error(result.error ?? 'Connection test failed.')
    }
  } catch {
    toast.error('Connection test failed. Try again.')
  } finally {
    setIsTesting(false)
  }
}
```

## Environment Availability

Step 2.6: SKIPPED — Phase 24 is a pure UI/server-action phase with no external tools or services beyond existing project stack. ManyChat API is called at runtime from the server action; no CLI tools or local services required.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run tests/manychat/` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| ID | Behavior | Test Type | Automated Command | File Exists? |
|----|----------|-----------|-------------------|-------------|
| CHANNEL-02 | `getManychatChannel()` returns `webhook_secret` (not null) for connected org | unit | `npx vitest run tests/manychat/channel-actions.test.ts` | Partial — file exists, new tests needed |
| CHANNEL-02 | `getManychatChannel()` returns null when no channel configured | unit | `npx vitest run tests/manychat/channel-actions.test.ts` | Partial |
| CHANNEL-03 | JSON payload template constant matches canonical template from PLANNING.md | unit | `npx vitest run tests/manychat/channel-actions.test.ts` | No — Wave 0 gap |
| CHANNEL-04 | `testManychatConnection()` calls `GET /fb/page/getFlows` with Bearer token | unit | `npx vitest run tests/manychat/channel-actions.test.ts` | No — Wave 0 gap |
| CHANNEL-04 | `testManychatConnection()` returns `{ success: true }` on 200 response | unit | `npx vitest run tests/manychat/channel-actions.test.ts` | No — Wave 0 gap |
| CHANNEL-04 | `testManychatConnection()` returns `{ success: false, error }` on non-200 | unit | `npx vitest run tests/manychat/channel-actions.test.ts` | No — Wave 0 gap |
| CHANNEL-04 | `testManychatConnection()` returns timeout error after 5s abort | unit | `npx vitest run tests/manychat/channel-actions.test.ts` | No — Wave 0 gap |

Note: CHANNEL-02 (webhook URL display) and CHANNEL-03 (payload template display) are UI behaviors verified visually. The unit tests verify the server action contracts. UI state switching (connected/not connected) is manual verification.

### Sampling Rate
- **Per task commit:** `npx vitest run tests/manychat/channel-actions.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green + `npm run build` pass before verification

### Wave 0 Gaps
- [ ] `tests/manychat/channel-actions.test.ts` — add tests for `getManychatChannel()` and `testManychatConnection()` (file exists, new `describe` blocks needed)

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Page-level API key forms in sheet modal | Dedicated route with server component + client settings | Meta set this precedent; ManyChat follows same pattern |
| Generic `navigator.clipboard` with no feedback | `navigator.clipboard.writeText` + sonner toast | Already established in codebase |

## Open Questions

1. **TypeScript types for manychat_channels**
   - What we know: Migrations 018-020 and v1.6 ManyChat migrations are pending push (`STATE.md`)
   - What's unclear: Whether `src/types/database.ts` already has `manychat_channels` typed (Phase 22 may have added manual types)
   - Recommendation: Read `src/types/database.ts` at plan time; if missing, Wave 0 must include a manual type addition task

2. **getFlows pagination**
   - What we know: PLANNING.md flagged this as an open question; the endpoint exists and works
   - What's unclear: Whether the response is paginated; whether a large flow count could cause issues
   - Recommendation: For Phase 24 (test connection only), the HTTP status code is what matters — no pagination concern. Phase 26 (flow selector) will need to investigate.

3. **`webhook_secret` column nullability**
   - What we know: `createManychatChannel` generates `webhook_secret = crypto.randomUUID()` and inserts it
   - What's unclear: Whether the DB column is NOT NULL or nullable
   - Recommendation: Treat as non-null in TypeScript (generated at creation time) but add null-coalescing fallback in the getter for safety

## Plan Count Recommendation

**2 plans, 3 waves each:**

**Plan 24-01: Server Actions + Tests**
- Wave 0: Add `getManychatChannel()` and `testManychatConnection()` tests to `tests/manychat/channel-actions.test.ts` (RED)
- Wave 1: Implement `getManychatChannel()` and `testManychatConnection()` in `src/app/(dashboard)/integrations/manychat/actions.ts` (GREEN)
- Wave 2: `npm run build` + `npx vitest run tests/manychat/channel-actions.test.ts` pass

**Plan 24-02: UI Page + Root Integration**
- Wave 0: Scaffold `src/app/(dashboard)/integrations/manychat/page.tsx` shell + `src/components/integrations/manychat-settings.tsx` shell (compile-ready skeletons)
- Wave 1: Implement not-connected form state + connected display state with all copy buttons + test connection button
- Wave 2: Update `/integrations/page.tsx` to add ManyChat card, `npm run build` pass

## Sources

### Primary (HIGH confidence)
- `src/app/(dashboard)/integrations/meta/page.tsx` — server component page pattern
- `src/components/integrations/meta-settings.tsx` — two-state client settings component pattern
- `src/components/reviews/review-widget-configurator.tsx` — copy-to-clipboard pattern
- `src/app/(dashboard)/integrations/actions.ts` — `testConnection()` pattern for external API calls
- `src/app/(dashboard)/integrations/manychat/actions.ts` — existing Phase 22 server actions
- `projects/manychat-integration/PLANNING.md` — canonical payload template, endpoint list, security decisions
- `.planning/STATE.md` — v1.6 decisions, pending migrations note

### Secondary (MEDIUM confidence)
- ManyChat Swagger `https://api.manychat.com/swagger` — getFlows endpoint exists at `GET /fb/page/getFlows`
- ManyChat help docs (via WebSearch) — Bearer token auth format confirmed
- `https://manychat.github.io/manychat-api-php/` — getFlows return structure inferred

### Tertiary (LOW confidence)
- getFlows response schema (field names `id`, `name`) — inferred from PHP library docs, not directly verified against live API

## Metadata

**Confidence breakdown:**
- Server action patterns: HIGH — reading live codebase
- UI component structure: HIGH — following established Meta precedent exactly
- Copy-to-clipboard: HIGH — pattern exists verbatim in two codebase files
- ManyChat getFlows endpoint URL: MEDIUM — confirmed in PLANNING.md + Swagger reference
- getFlows response schema: LOW — inferred, not live-tested
- Test connection timeout pattern: HIGH — copied from existing `testConnection()` implementation

**Research date:** 2026-05-06
**Valid until:** 2026-06-06 (stable stack, 30-day window)
