# Automated Testing

Xphere has one routine command for a broad regression check:

```bash
npm run test:battery
```

Use it after non-trivial behavior changes and whenever an operator asks for a
"test battery." It runs an explicit, deterministic selection covering the
Action Engine, Vapi webhook contract, tenant and delegation boundaries,
workflow execution, authentication, credential encryption, the public contact
API, and representative business rules. It also validates every workflow YAML.

The explicit membership lives in `scripts/test-battery.ts`. Add a regression
test to the appropriate group when it protects a critical platform contract.
The manifest has its own integrity test, so deleting or renaming a declared
test cannot silently reduce the battery.

## Commands

| Command | Purpose | External requirements |
|---|---|---|
| `npm run test:battery` | Routine deterministic critical regression battery | Installed dependencies |
| `npm run test:battery:list` | Show every group and member without running tests | None |
| `npm run test:battery:full` | Run every automatic Vitest file plus workflow validation | Some historical suites may require configured database services |
| `npm run test:battery:release` | Routine battery, workflow validation, and the production build | Build-time environment and enough memory for Next.js |
| `npm test` | Raw automatic Vitest suite; excludes manual and E2E probes | Depends on the selected tests |
| `npm run test:manual` | Explicit provider/database probes under `tests/manual` | Test-specific credentials; may perform external writes |
| `npm run test:e2e` | Browser smoke checks against an explicitly selected running app | `E2E_BASE_URL`, a running app, and Playwright Chromium |

## Choosing the right level

- During implementation, run the test file closest to the changed code.
- Before handing off a non-trivial change, run `npm run test:battery`.
- Before a release, run `npm run test:battery:release`.
- Use `npm run test:battery:full` for repository-wide audits. A failure is a
  real result to investigate, not a reason to remove the test from the suite.
- Use E2E only for browser-visible critical journeys. Keep business rules in
  faster unit or integration tests that construct the required state directly.

## Browser tests

Browser tests never choose production implicitly. Start the application in a
separate terminal, install Chromium once if needed, and pass the target URL:

```powershell
npx playwright install chromium
npm run dev
$env:E2E_BASE_URL="http://127.0.0.1:4267"
npm run test:e2e
```

The first E2E suite checks the health endpoint and renders the public entry
page while capturing uncaught browser errors. Add focused journeys under
`tests/e2e/`; they remain excluded from ordinary Vitest runs.

The composer layout regression renders the real component with production
Tailwind CSS in Chromium, without a server, authentication, or provider calls:

```bash
npx vitest run --config vitest.e2e.config.ts tests/e2e/message-composer-layout.test.ts
```

It checks panels from 280 to 900 pixels in mobile and desktop viewports,
including long channel names, email, and template/fallback send buttons.
Channel/status controls must stay separate, the textarea must remain usable,
and every visible button must stay within the panel. Chromium must be installed.

The header has a separate regression for avatar/name visibility and non-overlapping
toolbar actions (including Pin) in panels from 240 to 900 pixels:

```bash
npx vitest run --config vitest.e2e.config.ts tests/e2e/chat-header-layout.test.ts
```

The login regression mounts the interactive dialog with production CSS and an
offline identity provider. It models keyboard resize/pan through VisualViewport
events while keeping the layout viewport unchanged, including both login steps,
verification errors, landscape, light/dark themes, and the window-resize fallback:

```bash
npx vitest run --config vitest.e2e.config.ts tests/e2e/login-dialog-layout.test.ts
```

The field and submit button must remain visible together, the logo must stay
centered, and the dark panel must fit horizontally without overflow. These are
browser simulations; native keyboard behavior still benefits from a device check.

Audio message layout tests render the full conversation list with incoming and
outgoing audio in both themes. They verify usable waveform width, visible bars,
and controls contained within the panel:

```bash
npx vitest run --config vitest.e2e.config.ts tests/e2e/audio-message-layout.test.ts
```

## Adding coverage

For a bug fix, first add a test that reproduces the failure, then fix the code
and keep the test permanently. For a new or changed business rule, test the
expected behavior and meaningful boundaries from the requirement rather than
copying the current implementation.

Keep provider calls, production data, and destructive probes out of the
routine battery. Place intentional live probes under `tests/manual` and make
their prerequisites and side effects explicit in the file.

