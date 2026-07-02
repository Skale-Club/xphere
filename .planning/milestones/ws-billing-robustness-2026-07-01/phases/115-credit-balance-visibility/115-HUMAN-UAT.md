---
status: partial
phase: 115-credit-balance-visibility
source: [115-VERIFICATION.md]
started: 2026-07-01T00:00:00.000Z
updated: 2026-07-01T00:00:00.000Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Desktop indicator render + popover click-through
expected: Sparkles icon indicator visible in the desktop TopBar between the theme toggle and org switcher for an org on a credit-bearing plan; clicking opens a popover showing "Copilot credits", rounded credit count, "{X} from your plan · {Y} purchased" breakdown, and a "Manage billing" link that navigates to /settings/billing and closes the popover
result: [pending]

### 2. Mobile Quick Actions 4th tile render + tap-through
expected: On mobile width, hamburger menu's Quick Actions grid shows a 4th "Credits" tile (wrapped to a new row, grid-cols-3 unchanged) that opens the same popover as the desktop indicator
result: [pending]

### 3. Live Realtime balance update without reload
expected: After a Copilot turn debits credits or a manual balance UPDATE in Supabase, the indicator's displayed number updates within a few seconds without the user reloading the page
result: [pending]

### 4. Low/zero visual state color transitions
expected: When balance drops below ~20% of allowance, icon/badge turn amber and popover shows "Running low on credits."; at zero balance, icon/badge turn destructive-red and popover shows "You're out of credits."
result: [pending]

### 5. CRB-03 indicator absence for non-credits orgs
expected: For an org with no credit-bearing plan and no existing balance row, the indicator is entirely absent from both desktop TopBar and mobile Quick Actions grid — no broken/zero pill shown
result: [pending]

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

## Gaps

- All 5 items above were approved during phase execution based on code review, passing `npm run build`, and passing unit tests — NOT a live clicked-through browser session. The connected Chrome browser extension had no network route to the local dev server (localhost:4267) during this session, likely because it runs on a different machine/network. The user explicitly chose to proceed on code/test evidence rather than debug cross-machine browser access. These 5 items remain open for a real click-through pass whenever convenient (e.g. before this ships broadly, or picked up via `/gsd:audit-uat`).
