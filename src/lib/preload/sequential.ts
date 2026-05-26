/**
 * Sequential image preloader.
 *
 * Loads a list of image URLs one at a time. Two reasons we don't fire
 * `new Image()` in a `forEach`:
 *   1) With 200 frames in the landing scroll animation, the parallel burst
 *      saturates the browser's connection pool, queues all requests behind
 *      a few open sockets, and delays the FIRST frame from arriving — the
 *      exact frame the user needs to see before anything else.
 *   2) Background scroll-animation traffic competes with real assets
 *      (fonts, hero CTA image, auth bundle). Serializing keeps the rest of
 *      the page snappy.
 *
 * Optional priority hook (`getPriorityIndex`) lets the caller jump the queue
 * to the frame the user is currently looking at, so fast scrollers don't see
 * a blank canvas while the loader is still on frame 12.
 */

export interface SequentialPreloaderHandle {
  /** Stop the loop. Safe to call multiple times. In-flight image keeps loading
   * (the browser doesn't expose a cancel for `Image.src`), but `onLoad` won't
   * fire after cancel, and the next item won't be picked up. */
  cancel(): void
}

export interface SequentialPreloaderOptions {
  /** URLs in priority/playback order. */
  urls: string[]
  /** Fired when each image finishes loading. The HTMLImageElement is fully
   * decoded (we await `img.decode()` when available) so callers can draw it
   * synchronously without flicker. */
  onLoad?: (url: string, img: HTMLImageElement, idx: number) => void
  /** Fired on network/decoding failure. Loader continues to the next URL. */
  onError?: (url: string, idx: number, err: unknown) => void
  /** Fired once the queue is fully drained (success or skipped failures). */
  onComplete?: () => void
  /**
   * Optional hook the loader calls before picking the next URL. Return the
   * index the caller would like loaded next (e.g. the frame currently under
   * the scroll position). If it's not loaded yet and exists in `urls`, it's
   * jumped to the front of the queue. Return `null`/`undefined` to let the
   * loader continue in linear order.
   */
  getPriorityIndex?: () => number | null | undefined
  /**
   * Skip URLs already known to be loaded. Caller passes the same cache it
   * uses for drawing, so reruns (e.g. when `urls` changes) don't re-fetch.
   */
  isLoaded?: (url: string) => boolean
}

export function loadSequential(opts: SequentialPreloaderOptions): SequentialPreloaderHandle {
  const { urls, onLoad, onError, onComplete, getPriorityIndex, isLoaded } = opts

  let cancelled = false
  // Indices we still need to touch. We don't pre-skip via `isLoaded` here so
  // that callers who hot-add URLs between reruns get a consistent traversal.
  const remaining = new Set<number>(urls.map((_, i) => i))

  function pickNext(): number | null {
    if (remaining.size === 0) return null

    const priority = getPriorityIndex?.()
    if (priority != null && remaining.has(priority)) return priority

    // Linear scan from lowest index — preserves intuitive "frame 0 first" order
    // even when priority bounces around.
    let lowest = Infinity
    for (const idx of remaining) {
      if (idx < lowest) lowest = idx
    }
    return Number.isFinite(lowest) ? lowest : null
  }

  function step() {
    if (cancelled) return
    const idx = pickNext()
    if (idx == null) {
      onComplete?.()
      return
    }
    remaining.delete(idx)
    const url = urls[idx]
    if (!url) {
      step()
      return
    }
    if (isLoaded?.(url)) {
      // Already in the caller's cache; skip the network round-trip.
      step()
      return
    }

    const img = new window.Image()
    img.crossOrigin = 'anonymous'

    img.onload = () => {
      if (cancelled) return
      // decode() resolves once the image is fully decoded into a paintable
      // form, removing the "first paint flicker" that drawImage(img) right
      // after onload can show in Chrome. Fall back gracefully if unsupported.
      const finish = () => {
        if (cancelled) return
        onLoad?.(url, img, idx)
        step()
      }
      if (typeof img.decode === 'function') {
        img.decode().then(finish, finish)
      } else {
        finish()
      }
    }
    img.onerror = (err) => {
      if (cancelled) return
      onError?.(url, idx, err)
      step()
    }
    img.src = url
  }

  // Kick off on a microtask so callers can finish wiring state before the
  // first onLoad fires (avoids a "set state during render" warning).
  Promise.resolve().then(step)

  return {
    cancel() {
      cancelled = true
    },
  }
}
