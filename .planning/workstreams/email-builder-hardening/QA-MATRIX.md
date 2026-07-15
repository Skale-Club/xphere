# Email builder — manual client QA matrix

**Phase 4 of `PLAN.md`.** The renderer (`src/lib/email/render-template.ts`) is
unit-tested (see `tests/email-render-styling.test.ts`,
`tests/email-kitchen-sink.test.ts`), but unit tests can't tell you what
Outlook actually does with a `<v:roundrect>`. This matrix is the manual pass:
render the kitchen-sink template, send/preview it in each client below, and
check off what actually looks right.

Not blocking a ship — this is a recording device, not a gate. File bugs found
here as new rows/notes, and fix P0 rendering breaks (mis-clickable buttons,
unreadable text, broken layout) before the "out of beta" milestone in
`PLAN.md` is marked done.

---

## How to run

1. Generate the kitchen-sink HTML fixture (gated behind an env var so a
   normal test run has no filesystem side effects):

   ```bash
   WRITE_KITCHEN_SINK=1 npx vitest run tests/email-kitchen-sink.test.ts
   ```

   This writes `.planning/workstreams/email-builder-hardening/kitchen-sink.html`
   — the exact HTML `renderTemplate()` produces for the document built by
   `buildKitchenSinkDocument()` in that test file (every block type, every
   documented prop variant, 2-col + 3-col layouts, section background
   color/image, border radius, and every button style including a
   `fullWidth` and a large-radius "pill" button).

2. **Preview it** (pick whichever is fastest for the client you're testing):
   - **Litmus / Email on Acid** (recommended for the Outlook desktop row —
     neither of us has a Windows+Outlook desktop box handy): paste the raw
     HTML into a new test and let it screenshot across clients.
   - **Send it for real**: use the editor's "Send test email" (Phase 3) to
     mail the template to a real inbox in each client below. This is the
     only way to check actual inbox behavior (preheader snippet, spam
     folder placement, image blocking defaults) rather than just rendering.
   - **Local eyeball check**: open `kitchen-sink.html` directly in a browser
     as a sanity check before spending Litmus credits — this validates the
     non-Outlook/non-legacy-Apple-Mail rendering path only (a plain browser
     has no VML/MSO conditional-comment support, so it always takes the
     `<!--[if !mso]>` branch).

3. Check off cells below as you confirm them. Leave a one-line note next to
   any `[ ]` you can't check off cleanly (link to a screenshot if you have
   one).

---

## Matrix

Columns: **Gmail web**, **Gmail Android/iOS app**, **Outlook desktop
(Windows)**, **Outlook web (OWA)**, **Apple Mail (macOS/iOS)**.

| Feature | Gmail web | Gmail Android/iOS | Outlook desktop (Win) | Outlook web | Apple Mail |
|---|---|---|---|---|---|
| **Text block** — font size/line-height/color/align | [ ] | [ ] | [ ] | [ ] | [ ] |
| **Heading block** — H1/H2/H3, custom size/color | [ ] | [ ] | [ ] | [ ] | [ ] |
| **Image block** — width, align, border-radius, link-wrapped | [ ] | [ ] | [ ] | [ ] | [ ] |
| **Button — default** (HTML anchor path) | [ ] | [ ] | [ ] | [ ] | [ ] |
| **Button — VML fallback renders** (rounded, correct fill color, clickable) | n/a | n/a | [ ] | n/a | n/a |
| **Button — fullWidth** | [ ] | [ ] | [ ] | [ ] | [ ] |
| **Button — large radius ("pill")** | [ ] | [ ] | [ ] | [ ] | [ ] |
| **Divider — solid/dashed/dotted, width %, align** | [ ] | [ ] | [ ] | [ ] | [ ] |
| **Spacer** — renders as blank vertical space (no collapse) | [ ] | [ ] | [ ] | [ ] | [ ] |
| **Raw HTML block** — passthrough table renders | [ ] | [ ] | [ ] | [ ] | [ ] |
| **2-column layout** — side-by-side on desktop | [ ] | [ ] | [ ] | [ ] | [ ] |
| **2-column layout** — stacks on mobile width (`.col-block`) | n/a | [ ] | n/a | n/a | [ ] (iOS) |
| **3-column layout** — side-by-side on desktop | [ ] | [ ] | [ ] | [ ] | [ ] |
| **3-column layout** — stacks on mobile width | n/a | [ ] | n/a | n/a | [ ] (iOS) |
| **columnsGap** — visible gutter between columns | [ ] | [ ] | [ ] | [ ] | [ ] |
| **Section background color** | [ ] | [ ] | [ ] | [ ] | [ ] |
| **Section background image** | [ ] | [ ] | [ ] (expected to fail — see limitation below) | [ ] | [ ] |
| **Section border-radius** | [ ] | [ ] | [ ] (expected to fail — MSO ignores CSS radius) | [ ] | [ ] |
| **Section verticalAlign** | [ ] | [ ] | [ ] | [ ] | [ ] |
| **Preheader** — inbox snippet shows `previewText`, not body copy | [ ] | [ ] | n/a (no snippet UI) | [ ] | [ ] |
| **Subject `<title>`** — no visible artifact in the body | [ ] | [ ] | [ ] | [ ] | [ ] |
| **Dark mode** — text/background stay readable (no client dark-mode inversion breakage) | [ ] | [ ] | [ ] | [ ] | [ ] |

### Known/expected limitations (not bugs — confirm they match, don't "fix" them mid-QA)

- **Outlook desktop + section `backgroundImage`**: no VML `v:fill` fallback
  is implemented (see the comment in `renderSection` in
  `render-template.ts`). Outlook desktop will show the section's
  `backgroundColor` only, no image. Deliberate simplicity call in Phase 4 —
  re-litigate only if a client actually needs section background images in
  their sends.
- **Outlook desktop + section `borderRadius`**: MSO ignores `border-radius`
  entirely; sections render as sharp rectangles in Outlook desktop only.
- **Button VML width**: the `<v:roundrect>` width is a documented
  approximation (character-count estimate for fixed-width buttons, the
  document's `contentWidth` for `fullWidth` buttons — see
  `estimateButtonVmlGeometry` in `render-template.ts`), not exact
  typesetting. A button may look a few pixels narrower/wider in Outlook
  desktop than in the HTML-path clients. Only flag it here if the button
  text is *clipped* or the button is *dramatically* mis-sized, not for
  pixel-level differences.

---

## Regenerating after a renderer change

Any time `render-template.ts` changes in a way that could affect visual
output (new block prop, new default, MSO/VML markup edits), re-run step 1
above to refresh `kitchen-sink.html`, and re-run at least the Outlook
desktop + Gmail web rows before merging — those two catch the overwhelming
majority of email-HTML regressions (MSO conditional-comment breakage and
general HTML-table-layout breakage, respectively).
