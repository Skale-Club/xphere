export const CANVAS_BASE_ZOOM = 1.32

export function toDisplayZoomPercent(reactFlowZoom: number) {
  return Math.round((reactFlowZoom / CANVAS_BASE_ZOOM) * 100)
}
