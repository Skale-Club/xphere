/**
 * Shared design tokens — single source of truth for the widget visual design.
 * Consumed by:
 *   - src/widget/index.ts  (bundled by esbuild into public/widget.js)
 *   - src/components/widget/widget-playground.tsx  (React preview in Settings)
 *
 * Changing a value here updates BOTH the real widget and the playground preview.
 */

export const WIDGET_THEME = {
  /**
   * The dark "stage" backdrop used in the widget playground preview and the
   * Workflows canvas. Both reference this token so they always match.
   * Uses the app's --bg-primary CSS variable (same var ReactFlow reads).
   */
  stageBg: 'var(--bg-primary)',

  /**
   * Dot grid pattern — mirrors ReactFlow's <Background gap={16} size={0.85}
   * color="rgba(148,163,184,0.34)" /> that renders on the Workflows canvas.
   * Apply as `backgroundImage` alongside `stageBg` as `backgroundColor`.
   */
  stageDots: 'radial-gradient(circle, rgba(148,163,184,0.12) 1px, transparent 1px)',
  stageDotsSize: '16px 16px',

  /** Main panel / messages area / input area background */
  panelBg: '#ceced2',

  /** Header background */
  headerBg: '#f4f4f5',

  /** Border between sections */
  borderColor: '#e4e4e7',

  /** Assistant message: no bubble — plain text on panel background */
  assistantBubbleBg: null as null,

  /** User message input field background */
  inputFieldBg: '#ffffff',

  /** Primary text */
  textPrimary: '#09090b',

  /** Secondary / placeholder text */
  textSecondary: '#71717a',

  /** Border radius for user bubble — uniform, slightly rounded */
  userBubbleRadius: '10px',
} as const
