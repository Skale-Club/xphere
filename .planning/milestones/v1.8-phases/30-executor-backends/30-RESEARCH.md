# Phase 30: Executor Backends - Research

**Researched:** 2026-05-07
**Domain:** Twilio REST API · Fetch with AbortController · String template substitution
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SMS-01 | `send_sms` action type sends SMS using org's Twilio credentials (Account SID + Auth Token) from `integrations` table (provider: `twilio`) | Twilio Messages API confirmed: POST with Basic auth (btoa(SID:Token)) |
| SMS-02 | Executor reads `to` and `body` params from tool call; `from` is read from the Twilio integration's `config.from_number` field | integrations.config is Json JSONB — cast to `{ from_number: string }` after fetch |
| SMS-03 | On success, executor returns single-line string containing the Twilio message SID | Twilio response JSON contains `sid` field (format: SM + 32 hex chars) |
| SMS-04 | If no active Twilio integration exists for the org, executor throws a clear actionable error | Pattern: same as `resolveGoogleCredentials` — query integrations, throw on missing row |
| WEBHOOK-01 | `custom_webhook` action type makes HTTP request to configurable URL using tool_config's `config` JSONB | Native fetch; config JSONB contains `url`, `method`, `headers`, `body` |
| WEBHOOK-02 | `config` JSONB supports: `url` (required), `method` (GET/POST/PUT/PATCH, default POST), `headers` (key-value object), `body` (string template) | All fields resolved via cast of tool_config.config Json |
| WEBHOOK-03 | Param values from tool call are substituted into body template using `{{param_name}}` syntax | Simple `str.replace(/\{\{(\w+)\}\}/g, (_, k) => String(params[k] ?? ''))` — no library needed |
| WEBHOOK-04 | Executor returns single-line string with HTTP status code and truncated response body (max 200 chars) | `response.text()` then truncate to 200 chars, replace newlines, return single line |
| WEBHOOK-05 | Requests timeout after 10 seconds; timeout throws a clear error without crashing | AbortController + setTimeout (10_000ms) — same pattern as manychat/client.ts |
</phase_requirements>

---

## Summary

Phase 30 implements two executor modules that have been stubs throwing `Error('Unsupported action type: ...')` since the action engine was first built. Both are self-contained: no migrations are needed, the action_type enum already contains `send_sms` and `custom_webhook`, and all credential/config data is already stored in existing tables.

The **send_sms executor** calls the Twilio Messages REST API (`POST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages.json`) using HTTP Basic auth where the username is the Account SID and the password is the Auth Token. Both are stored encrypted as a JSON blob in `integrations.encrypted_api_key` for rows where `provider = 'twilio'`. The `from` phone number comes from `integrations.config.from_number`. The executor follows the exact same credential-resolution pattern established by `src/lib/google-contacts/credentials.ts` — query `integrations` by org + provider, decrypt, parse JSON.

The **custom_webhook executor** fires an arbitrary HTTP request whose URL, method, headers, and body template are all stored in `tool_configs.config` JSONB. Before firing, `{{param_name}}` placeholders in the body string are replaced with matching values from the tool call params. A 10-second AbortController timeout matches the pattern in `src/lib/manychat/client.ts`. The result is a single-line string with HTTP status + truncated response body.

Both executors must follow the single-line string contract (no `\n` characters) because the Vapi parser breaks on newlines. Both live in dedicated subdirectories under `src/lib/` following the project-established pattern (`src/lib/twilio/` and `src/lib/custom-webhook/`), and both are wired into `execute-action.ts` as new case arms replacing the current stubs.

**Primary recommendation:** Implement `src/lib/twilio/send-sms.ts` and `src/lib/custom-webhook/fire-webhook.ts`, then replace the two stub case arms in `execute-action.ts`. Tests mirror the `tests/manychat/set-field.test.ts` pattern using `vi.stubGlobal('fetch', mockFetch)`.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Native `fetch` | Node.js 18+ built-in | HTTP to Twilio API and custom webhook URLs | Already used project-wide; no new dependency |
| `AbortController` | Node.js built-in | 10-second timeout for custom_webhook | Same pattern as `src/lib/manychat/client.ts` |
| `btoa` | Node.js built-in | Base64-encode `accountSid:authToken` for Basic auth header | Same as used in `src/lib/crypto.ts` helpers |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@/lib/crypto` (decrypt) | project-internal | Decrypt `integrations.encrypted_api_key` | Required for Twilio credential resolution |
| `URLSearchParams` | Node.js built-in | Build `application/x-www-form-urlencoded` body for Twilio API | Twilio's API is form-encoded, not JSON |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Raw `fetch` | `twilio` npm package | The SDK adds ~4MB and masks the credential format. Raw fetch with Basic auth is 10 lines and fully transparent. |
| `URLSearchParams` body | JSON body | Twilio Messages API requires `application/x-www-form-urlencoded` — JSON is not accepted. |
| Inline regex for `{{param}}` | `mustache` or `handlebars` npm package | The substitution is a single regex replace; a full template library is overkill and adds a dependency. |

**Installation:** No new npm packages required. All dependencies are built-in or project-internal.

---

## Architecture Patterns

### Recommended Project Structure

```
src/lib/twilio/
└── send-sms.ts          # resolveTwilioCredentials() + sendSms() executor

src/lib/custom-webhook/
└── fire-webhook.ts      # substituteParams() + fireWebhook() executor

tests/twilio/
└── send-sms.test.ts     # unit tests for SMS executor

tests/custom-webhook/
└── fire-webhook.test.ts # unit tests for webhook executor
```

The two new executor modules are imported into `execute-action.ts` exactly as the manychat and google-contacts executors are imported today.

### Pattern 1: Twilio Credential Resolution

**What:** Query `integrations` table for `provider = 'twilio'` and `is_active = true`, decrypt `encrypted_api_key`, parse JSON blob containing `account_sid` and `auth_token`.
**When to use:** At the top of `sendSms()`, same position as `resolveGoogleCredentials()` in google-contacts executors.

```typescript
// Source: modeled on src/lib/google-contacts/credentials.ts
export interface TwilioCredentials {
  accountSid: string
  authToken: string
  fromNumber: string
}

export async function resolveTwilioCredentials(ctx: ActionContext): Promise<TwilioCredentials> {
  const { data: row, error } = await ctx.supabase
    .from('integrations')
    .select('encrypted_api_key, config')
    .eq('organization_id', ctx.organizationId)
    .eq('provider', 'twilio')
    .eq('is_active', true)
    .single()

  if (error || !row) {
    throw new Error('Twilio not connected for this org. Add a Twilio integration in /integrations.')
  }

  const blob = JSON.parse(await decrypt(row.encrypted_api_key)) as {
    account_sid: string
    auth_token: string
  }

  const config = row.config as { from_number?: string } | null
  if (!config?.from_number) {
    throw new Error('Twilio integration is missing from_number in config. Update the integration.')
  }

  return {
    accountSid: blob.account_sid,
    authToken: blob.auth_token,
    fromNumber: config.from_number,
  }
}
```

**Confidence:** HIGH — mirrors exact pattern from credentials.ts, confirmed integrations table schema.

### Pattern 2: Twilio Messages API Call

**What:** POST to `https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages.json` with form-encoded body and Basic auth header.
**When to use:** After credential resolution in `sendSms()`.

```typescript
// Source: Twilio official docs — https://www.twilio.com/docs/messaging/api/message-resource
export async function sendSms(
  params: Record<string, unknown>,
  ctx: ActionContext
): Promise<string> {
  const creds = await resolveTwilioCredentials(ctx)

  const to = String(params.to ?? '')
  const body = String(params.body ?? params.message ?? '')
  if (!to) throw new Error('send_sms requires a "to" phone number parameter.')
  if (!body) throw new Error('send_sms requires a "body" message parameter.')

  const basicAuth = btoa(`${creds.accountSid}:${creds.authToken}`)
  const url = `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/Messages.json`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: creds.fromNumber, Body: body }).toString(),
    cache: 'no-store',
  })

  if (!res.ok) {
    const text = await res.text().catch(() => `status ${res.status}`)
    throw new Error(`Twilio error ${res.status}: ${text}`)
  }

  const data = (await res.json()) as { sid: string }
  // Single-line result — no newlines (Vapi parser breaks on \n)
  return `SMS sent. SID: ${data.sid}`
}
```

**Confidence:** HIGH — endpoint and auth confirmed from official Twilio docs.

### Pattern 3: Custom Webhook with Param Substitution and Timeout

**What:** Fire an HTTP request from `tool_configs.config` JSONB, substituting `{{param_name}}` placeholders, with a 10-second AbortController timeout.
**When to use:** The entire `fireWebhook()` executor.

```typescript
// Source: AbortController pattern from src/lib/manychat/client.ts
interface WebhookConfig {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH'
  headers?: Record<string, string>
  body?: string
}

function substituteParams(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    String(params[key] ?? '')
  )
}

export async function fireWebhook(
  params: Record<string, unknown>,
  config: unknown,
  ctx: ActionContext
): Promise<string> {
  const cfg = config as WebhookConfig | null
  if (!cfg?.url) throw new Error('custom_webhook config is missing required "url" field.')

  const method = cfg.method ?? 'POST'
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(cfg.headers ?? {}) }
  const rawBody = cfg.body ? substituteParams(cfg.body, params) : undefined

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 10_000)

  let res: Response
  try {
    res = await fetch(cfg.url, {
      method,
      headers,
      body: rawBody,
      signal: controller.signal,
      cache: 'no-store',
    })
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`custom_webhook timed out after 10 seconds (url: ${cfg.url})`)
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }

  const responseText = await res.text().catch(() => '')
  // Truncate to 200 chars and strip newlines — single-line contract for Vapi
  const truncated = responseText.replace(/[\r\n]/g, ' ').slice(0, 200)
  return `Webhook ${res.status}: ${truncated}`
}
```

**Confidence:** HIGH — AbortController timeout pattern confirmed from manychat/client.ts, Fetch API docs.

### Pattern 4: Wiring into execute-action.ts

**What:** Replace the two stub case arms with real executor calls that require `ctx`.

```typescript
// Replace lines 72-75 in execute-action.ts:
case 'send_sms': {
  if (!ctx?.organizationId || !ctx?.supabase) {
    throw new Error('send_sms requires ctx.organizationId and ctx.supabase')
  }
  return sendSms(params, ctx)
}
case 'custom_webhook': {
  if (!ctx?.organizationId || !ctx?.supabase) {
    throw new Error('custom_webhook requires ctx.organizationId and ctx.supabase')
  }
  // tool_configs.config is passed through ctx — need to plumb it from the call site
  // OR: fetch the tool_config's config from the DB using ctx (see decision below)
  return fireWebhook(params, toolConfig.config, ctx)
}
```

**CRITICAL DECISION — config plumbing for custom_webhook:**
`fireWebhook()` needs `tool_configs.config` JSONB. Currently `executeAction()` signature is:
```typescript
executeAction(actionType, params, credentials, ctx?)
```
The `tool_configs.config` is not passed. Two options:
1. **Extend `ActionContext`** to include `toolConfig?: { config: Json }` — the Vapi tools route already has the full tool_config row before calling executeAction, so this is a one-line addition to the context object passed in.
2. **Query the DB inside the executor** — re-fetches what was already fetched. Wasteful.

**Recommended:** Option 1. Extend `ActionContext` with `toolConfig?: { config: unknown }`. The Vapi tools route passes `toolConfig.config` into ctx. All existing executor case arms ignore the new field — zero regression risk.

### Anti-Patterns to Avoid

- **Importing the `twilio` npm SDK:** Adds ~4MB dependency for functionality achievable in 10 lines of fetch. Avoid.
- **Returning multi-line strings:** Any `\n` in the return string breaks the Vapi parser. Always `.replace(/[\r\n]/g, ' ')` on external data before returning.
- **Swallowing timeout errors silently:** The action engine already catches thrown errors and falls back to `fallback_message` — let timeout throw so action_logs captures it as an error.
- **Using `JSON.stringify(body)` for Twilio:** Twilio Messages API requires `application/x-www-form-urlencoded`, not JSON. Using JSON body returns a 400 error.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Template substitution | Custom parser with recursion, loops | Single regex: `/\{\{(\w+)\}\}/g` | The `{{param_name}}` syntax is flat key replacement — no nesting, no conditionals |
| HTTP timeout | Manual race with `Promise.race()` | `AbortController` + `setTimeout` | Established pattern already in the codebase (manychat/client.ts) — abort is cleaner and cancels the underlying request |
| Twilio auth | Custom HMAC or token exchange | `btoa(accountSid + ':' + authToken)` → `Basic` header | Twilio uses standard HTTP Basic auth — no SDK or token exchange needed |

**Key insight:** Both executors are thin wrappers over `fetch`. The complexity is in error handling and the single-line return contract, not in the HTTP calls themselves.

---

## Common Pitfalls

### Pitfall 1: Twilio Body Must Be Form-Encoded

**What goes wrong:** Sending `JSON.stringify({ To, From, Body })` with `Content-Type: application/json` returns Twilio error 400 "Resource not found" or a malformed request error.
**Why it happens:** The Twilio Messages API only accepts `application/x-www-form-urlencoded` — it predates the industry's shift to JSON APIs.
**How to avoid:** Use `new URLSearchParams({ To: ..., From: ..., Body: ... }).toString()` as the body string, with `Content-Type: application/x-www-form-urlencoded` header.
**Warning signs:** Twilio responds with status 400 and an error about "Unable to create record."

### Pitfall 2: Twilio Account SID Goes in the URL AND the Basic Auth Username

**What goes wrong:** Using only the Auth Token in Basic auth, or omitting the Account SID from the URL path.
**Why it happens:** Twilio's auth model uses the Account SID in two places: the URL path (`/Accounts/{AccountSid}/Messages.json`) AND as the Basic auth username.
**How to avoid:** `btoa(`${accountSid}:${authToken}`)` for the Authorization header; `accountSid` also interpolated in the URL.
**Warning signs:** Twilio returns 401 Unauthorized.

### Pitfall 3: Multi-Line Strings Breaking Vapi

**What goes wrong:** Returning a result string with `\n` characters causes the Vapi tool result parser to truncate or malform the response.
**Why it happens:** Vapi expects a single-line string from each tool call result.
**How to avoid:** Always call `.replace(/[\r\n]/g, ' ')` on any external API response body before including it in the return string. The `create-contact.ts` executor comment calls this out explicitly.
**Warning signs:** Vapi call logs show truncated tool results or JSON parse errors in the conversation.

### Pitfall 4: AbortError vs Generic Network Error

**What goes wrong:** The `AbortController` abort throws `DOMException: AbortError`, but code catches a generic `Error` and re-throws a wrong message.
**Why it happens:** Checking `err instanceof DOMException` is unreliable across environments.
**How to avoid:** Check `(err as Error).name === 'AbortError'` — this is the reliable cross-environment check. The manychat client.ts does not check the error type but the custom_webhook executor should give a clear timeout message.
**Warning signs:** Timeout produces an unhelpful "fetch failed" error in action_logs instead of a clear timeout message.

### Pitfall 5: Missing `from_number` in Twilio Integration Config

**What goes wrong:** The integrations row has `encrypted_api_key` with the SID/Token but `config` is `{}` (no `from_number`).
**Why it happens:** The integration form (Phase 31) hasn't been built yet. During development, integrations are created with empty config.
**How to avoid:** `resolveTwilioCredentials` must explicitly check `config.from_number` and throw a clear error. Do not let it fail later with "undefined is not a string."
**Warning signs:** TypeScript would pass but runtime throws a confusing fetch error.

### Pitfall 6: Passing `toolConfig.config` to `executeAction`

**What goes wrong:** `fireWebhook()` needs the `tool_configs.config` JSONB, but the current `executeAction()` signature does not include it — the executor would have no way to know the URL/method/headers/body.
**Why it happens:** The dispatcher was designed before `custom_webhook` was real. Credentials come from `integrations` (already plumbed via `credentials` param), but per-tool config comes from `tool_configs`.
**How to avoid:** Extend `ActionContext` to include `toolConfig?: { config: unknown }`. The Vapi tools route already has the full tool_config row and can pass `ctx.toolConfig = { config: toolConfig.config }`. Add the field as optional so all existing case arms are unaffected.
**Warning signs:** TypeScript compile error in `fireWebhook` when trying to access `config` that isn't in scope.

---

## Code Examples

Verified patterns from official sources and project codebase:

### Twilio Messages API — Full Fetch

```typescript
// Source: https://www.twilio.com/docs/messaging/api/message-resource (verified 2026-05-07)
const basicAuth = btoa(`${accountSid}:${authToken}`)
const res = await fetch(
  `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
  {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: fromNumber, Body: messageBody }).toString(),
    cache: 'no-store',
  }
)
const data = await res.json() as { sid: string }
// data.sid === "SMxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

### AbortController Timeout — Exact Pattern from Codebase

```typescript
// Source: src/lib/manychat/client.ts (same pattern, extended to 10s)
const controller = new AbortController()
const timeoutId = setTimeout(() => controller.abort(), 10_000)
try {
  const res = await fetch(url, { ..., signal: controller.signal })
  // process res
} catch (err) {
  if ((err as Error).name === 'AbortError') {
    throw new Error(`custom_webhook timed out after 10 seconds (url: ${url})`)
  }
  throw err
} finally {
  clearTimeout(timeoutId)
}
```

### Param Substitution — Regex Pattern

```typescript
// No external library needed
function substituteParams(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    String(params[key] ?? '')
  )
}
// substituteParams('Hello {{name}}, your number is {{phone}}', { name: 'Jane', phone: '555-1234' })
// => 'Hello Jane, your number is 555-1234'
// Unknown keys become empty string: substituteParams('{{x}}', {}) => ''
```

### Test Pattern — vi.stubGlobal('fetch', mockFetch)

```typescript
// Source: tests/manychat/set-field.test.ts (established test pattern)
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

it('POSTs to Twilio Messages API with Basic auth', async () => {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ sid: 'SM123abc' }),
  })
  // ... test body
  expect(result).not.toContain('\n')  // single-line contract
})
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Twilio Node.js SDK (`require('twilio')`) | Raw `fetch` with Basic auth | Node.js 18+ native fetch | No dependency needed; same auth model |
| `Promise.race()` for timeout | `AbortController.abort()` | ES2021+ / Node 15+ | Abort actually cancels the underlying TCP connection |

**Deprecated/outdated:**
- `xmlhttprequest` / `node-fetch` packages: Node.js 18+ ships native `fetch` — this project already uses it everywhere.
- Twilio `Messages.create()` SDK method: Not used in this project; raw fetch keeps the bundle lean.

---

## Open Questions

1. **Twilio credential JSON blob structure — exact field names**
   - What we know: The integration form (`integration-form.tsx`) treats the Twilio `apiKey` as a single string. The REQUIREMENTS.md says the blob contains "Account SID + Auth Token." There is no existing Twilio executor to reverse-engineer.
   - What's unclear: Are the keys stored as `account_sid` + `auth_token` in the JSON blob, or as `accountSid` + `authToken`, or as a combined `"SID:Token"` string?
   - Recommendation: The current `createIntegration` server action stores whatever string is passed as `apiKey` — it encrypts it directly. For Twilio, the admin enters a single value. The integration form needs a special Twilio case (Phase 31) or the blob convention needs to be established now. **Best approach for Phase 30:** Define the convention as `{ account_sid, auth_token }` JSON blob (snake_case, consistent with the google_contacts blob that also uses snake_case). Document in a comment in `send-sms.ts`. The Phase 31 form will store in this format.

2. **`toolConfig.config` plumbing for `custom_webhook`**
   - What we know: `executeAction()` currently only receives `params, credentials, ctx`. The `tool_configs.config` JSONB (which has `url`, `method`, etc.) is available at the call site in `/api/vapi/tools/route.ts` but is not passed through.
   - What's unclear: Whether extending `ActionContext` or adding a 5th parameter to `executeAction()` is cleaner.
   - Recommendation: Extend `ActionContext` with `toolConfig?: { config: unknown }`. The call site already builds `ctx` before calling `executeAction`, so passing `toolConfig.config` there is a single line. A 5th parameter would affect the function signature and all test mocks.

---

## Environment Availability

Step 2.6: SKIPPED — Phase 30 is pure code changes. No new CLI tools, databases, or external services beyond Twilio (which is reached at runtime, not build time). The Twilio integration credentials are stored in the database and resolved at runtime.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (vitest.config.ts) |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run tests/twilio/ tests/custom-webhook/` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SMS-01 | sendSms calls Twilio Messages API with Basic auth | unit | `npx vitest run tests/twilio/send-sms.test.ts` | Wave 0 |
| SMS-02 | from_number read from integrations.config; to + body from params | unit | `npx vitest run tests/twilio/send-sms.test.ts` | Wave 0 |
| SMS-03 | Returns single-line string containing SID (no newlines) | unit | `npx vitest run tests/twilio/send-sms.test.ts` | Wave 0 |
| SMS-04 | No active Twilio integration throws clear error | unit | `npx vitest run tests/twilio/send-sms.test.ts` | Wave 0 |
| WEBHOOK-01 | fireWebhook makes HTTP request to config.url | unit | `npx vitest run tests/custom-webhook/fire-webhook.test.ts` | Wave 0 |
| WEBHOOK-02 | All config fields (url, method, headers, body) respected | unit | `npx vitest run tests/custom-webhook/fire-webhook.test.ts` | Wave 0 |
| WEBHOOK-03 | {{param_name}} placeholders substituted from params | unit | `npx vitest run tests/custom-webhook/fire-webhook.test.ts` | Wave 0 |
| WEBHOOK-04 | Returns single-line string: "Webhook {status}: {truncated body}" | unit | `npx vitest run tests/custom-webhook/fire-webhook.test.ts` | Wave 0 |
| WEBHOOK-05 | AbortController timeout after 10s throws clear error | unit | `npx vitest run tests/custom-webhook/fire-webhook.test.ts` | Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run tests/twilio/ tests/custom-webhook/`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green + `npm run build` passes before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/twilio/send-sms.test.ts` — covers SMS-01, SMS-02, SMS-03, SMS-04
- [ ] `tests/custom-webhook/fire-webhook.test.ts` — covers WEBHOOK-01 through WEBHOOK-05
- [ ] `src/lib/twilio/send-sms.ts` — executor module (new file, does not exist)
- [ ] `src/lib/custom-webhook/fire-webhook.ts` — executor module (new file, does not exist)

---

## Project Constraints (from CLAUDE.md)

| Directive | Impact on This Phase |
|-----------|---------------------|
| `npm run build` required after changes | Must verify no TypeScript errors when extending `ActionContext` and adding new imports |
| Strict TypeScript | `toolConfig.config` is typed as `Json` in database.ts — must cast safely to `WebhookConfig` |
| Single-line executor results (no `\n`) | All return strings must `.replace(/[\r\n]/g, ' ')` on external response data |
| Auth gating in layouts/pages/actions — not middleware | Not applicable (executor is a server-side library, not a route) |
| Node.js runtime for webhook receivers | `execute-action.ts` runs server-side in Node.js — `AbortController`, `btoa`, native `fetch` all available |
| Sensitive paths: `src/lib/crypto.ts` — do not change the encryption format | Only call `decrypt()` — do not modify crypto.ts |
| Never edit old migrations | No migrations needed for this phase |
| Inbound webhooks always return HTTP 200 | Not applicable (executors are called from within the webhook handler, not as webhook endpoints) |

---

## Sources

### Primary (HIGH confidence)
- Twilio official docs — https://www.twilio.com/docs/messaging/api/message-resource — POST endpoint, Basic auth, form-encoded body, `sid` response field (verified 2026-05-07)
- `src/lib/google-contacts/credentials.ts` — credential resolution pattern to replicate for Twilio
- `src/lib/manychat/client.ts` — AbortController + setTimeout timeout pattern
- `src/lib/google-contacts/create-contact.ts` — single-line return string pattern, error handling shape
- `src/lib/action-engine/execute-action.ts` — exact stub locations and ActionContext shape
- `src/types/database.ts` — integrations table schema (encrypted_api_key, config Json, provider), tool_configs.config Json type

### Secondary (MEDIUM confidence)
- WebSearch + Twilio docs: `btoa(accountSid + ':' + authToken)` as Basic auth encoding — consistent across Twilio SDK source and docs

### Tertiary (LOW confidence)
- Credential JSON blob field names (`account_sid`, `auth_token`): Convention proposed based on pattern in google_contacts blob — not confirmed by any existing Twilio executor code because none exists yet. Planner should establish this as the canonical format in Wave 0.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — native fetch, AbortController, btoa are all Node.js built-ins already used in the project
- Architecture: HIGH — direct replication of established google-contacts and manychat executor patterns
- Twilio API endpoint/auth: HIGH — verified from official Twilio docs
- Credential blob field names: LOW — convention proposed; no existing Twilio executor to validate against
- Pitfalls: HIGH — form-encoded body, single-line contract, AbortError detection are all verified code-level facts

**Research date:** 2026-05-07
**Valid until:** 2026-08-07 (Twilio REST API is stable; AbortController API is stable)
