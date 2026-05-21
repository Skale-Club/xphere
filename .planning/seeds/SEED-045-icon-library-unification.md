---
id: SEED-045
status: dormant
planted: 2026-05-21
planted_during: v2.8 post-ship — canvas visual refinement (SEED-043)
trigger_when: any milestone touching the flow canvas UX, or a dedicated design-system / polish milestone
scope: Medium
---

# SEED-045: Unify Icon Library Across Flow Canvas and Site

## Why This Matters

The flow canvas has two competing icon libraries in use simultaneously:

| Location | Library | Style |
|---|---|---|
| Canvas node cards (`nodes/index.tsx`) | `@phosphor-icons/react` | Filled, bold — looks polished |
| Action picker dropdown (`node-metadata.ts`) | `lucide-react` | Outline, thinner — mismatches |
| Canvas toolbar controls | `lucide-react` | Mixed |
| Empty canvas state triggers | `lucide-react` | Mixed |

When a user opens the Action dropdown in the node config panel, the icons
(`ClipboardList`, `StickyNote`, `TrendingUp`, `BookOpen`, etc. from Lucide)
look visually inconsistent with the Phosphor-filled icons on the canvas nodes
themselves. The mismatch is most obvious when comparing the action picker to
the node cards right next to it.

Across `src/components/`: **188 files** use `lucide-react` vs **3 files**
(`flow-palette.tsx`, `nodes/index.tsx`, `workflows-list.tsx`) that use
Phosphor. The canvas-specific components that benefit most from the Phosphor
"filled" style should be migrated; the rest of the app can stay on Lucide.

## What Needs to Change

### 1. Migrate `src/lib/flows/node-metadata.ts`

Replace Lucide imports with Phosphor equivalents using `weight="fill"` or
`weight="duotone"`. Approximate mapping:

| Lucide | Phosphor equivalent |
|---|---|
| `Hand` | `HandWaving` |
| `CalendarClock` | `CalendarClock` |
| `Webhook` | `Webhook` |
| `PhoneCall` | `PhoneCall` |
| `MessageCircle` | `ChatCircle` |
| `Camera` | `Camera` |
| `MessagesSquare` | `ChatTeardropDots` |
| `CalendarCheck` | `CalendarCheck` |
| `UserPlus` | `UserPlus` |
| `Globe` | `Globe` |
| `Mail` | `EnvelopeSimple` |
| `ClipboardList` | `ClipboardText` |
| `StickyNote` | `Note` |
| `TrendingUp` | `TrendAt` or `ArrowTrendUp` |
| `BookOpen` | `BookOpen` |
| `Workflow` | `GitBranch` or `TreeStructure` |

The `icon` field in `ActionMetadata` / `TriggerMetadata` is typed as
`LucideIcon` — this type needs to be widened to accept Phosphor icon components
too (or a union type / generic `React.ComponentType<{ weight?: string; className?: string }>` ).

### 2. Audit `src/components/flows/empty-canvas-state.tsx`

Currently uses `Zap, Clock, Calendar, MousePointerClick, Webhook` from Lucide.
These trigger picker icons should match the canvas node style.

### 3. Audit other flows components for Lucide usage

Files to review:
- `src/components/flows/flow-toolbar.tsx` — toolbar actions
- `src/components/flows/canvas-toolbar.tsx` — zoom/fit controls
- `src/components/flows/node-config-panel.tsx` — structural icons (ChevronDown, Trash2, X)

Structural UI icons (chevrons, close, trash) can stay Lucide — they're
framework chrome, not content icons. Only content/action icons need Phosphor.

### 4. Broader site audit (opportunistic)

The user flagged wanting to "vascular outros ícones pelo site" (audit icons
site-wide). A broader audit would identify Lucide icons used in places where a
Phosphor filled alternative would look better. This is lower priority than
the canvas-specific fix.

## Scope Estimate

**Medium** — `node-metadata.ts` is the highest-value single change. The type
widening is the only tricky part. Full canvas audit adds another day. Site-wide
is optional stretch.

## Breadcrumbs

- `src/lib/flows/node-metadata.ts` — all `ACTION_METADATA` and `TRIGGER_METADATA`
  icons; currently imports 16 Lucide icons
- `src/components/flows/nodes/index.tsx:12` — Phosphor imports:
  `Lightning, PlayCircle, FlowArrow, ClockCountdown, Robot, StopCircle`
- `src/components/flows/flow-palette.tsx:10` — Phosphor imports for palette labels
- `src/components/flows/empty-canvas-state.tsx:7` — Lucide trigger picker icons
- `src/components/flows/node-config-panel.tsx:4` — structural Lucide icons (ok to keep)
- `package.json` — `@phosphor-icons/react` already installed (no new dep needed)
