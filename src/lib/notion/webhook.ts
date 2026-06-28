const encoder = new TextEncoder()

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}

export async function verifyNotionWebhookSignature(
  rawBody: string,
  signature: string | null,
  verificationToken: string,
): Promise<boolean> {
  if (!signature?.startsWith('sha256=') || !verificationToken) return false

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(verificationToken),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody))
  const expected = `sha256=${hex(new Uint8Array(digest))}`
  return constantTimeEqual(expected, signature)
}

