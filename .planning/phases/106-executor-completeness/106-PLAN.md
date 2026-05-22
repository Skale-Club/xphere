# Phase 106: Executor Completeness - Plan

**Phase:** 106-executor-completeness
**Plan:** 01
**Requirements:** EXEC-01, EXEC-02, EXEC-03

## Tasks

### Task 1: Implement send_email executor

Create `src/lib/action-engine/executors/send-email.ts`:

```typescript
import { Resend } from 'resend'

export async function executeSendEmail(
  params: Record<string, unknown>,
): Promise<string> {
  const to = String(params.to ?? '')
  const subject = String(params.subject ?? '')
  const body = String(params.body ?? '')
  const fromName = params.from_name ? String(params.from_name) : undefined

  if (!to) throw new Error('send_email requires "to"')
  if (!subject) throw new Error('send_email requires "subject"')
  if (!body) throw new Error('send_email requires "body"')

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[send_email] RESEND_API_KEY not set; email not sent')
    return `Email not sent: RESEND_API_KEY not configured`
  }

  const resend = new Resend(apiKey)
  const from = fromName
    ? `${fromName} <${process.env.RESEND_FROM_EMAIL ?? 'notifications@xphere.app'}>`
    : process.env.RESEND_FROM ?? 'Xphere <notifications@xphere.app>'

  const { data, error } = await resend.emails.send({
    from,
    to,
    subject,
    html: body,
  })

  if (error) throw new Error(`send_email failed: ${error.message}`)
  return `Email sent. ID: ${data?.id ?? 'unknown'}`
}
```

### Task 2: Register send_email in execute-action.ts

Add to imports:
```typescript
import { executeSendEmail } from '@/lib/action-engine/executors/send-email'
```

Add to the switch statement (before default):
```typescript
case 'send_email':
  return executeSendEmail(params)
```

### Task 3: Add send_email to database.ts type union

Add `'send_email'` to the action_type union type in database.ts (lines 418, 432, 444, 4334).

### Task 4: Verify knowledge_base and custom_webhook parity

- Check that both already have cases in execute-action.ts ✓
- Verify knowledge_base is reachable from flow engine via executeAction() → confirmed in Phase 105
- Verify custom_webhook is reachable via executeAction() → confirmed in Phase 105
- Run `npm run build` to confirm no TS errors
- Run `npx vitest run` to confirm no regressions

### Verification
- `npm run build` exits 0
- `npx vitest run` shows no new failures
- `send_email` appears in action_type union
- `send_email` case exists in execute-action.ts switch
