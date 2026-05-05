// src/lib/chat/stream/encoder.ts
// SSE encoder helper extracted from stream.ts.
// Produces a function that encodes one JSON line + newline (D-02 wire format).

// SSE encoder: produces a TextEncoder that encodes one JSON line + newline
export function createEncoder() {
  const enc = new TextEncoder()
  return (obj: object) => enc.encode(JSON.stringify(obj) + '\n')
}
