// src/lib/knowledge/embed.ts
// text-embedding-3-small wrapper | accepts apiKey directly.
// No module-level client; caller is responsible for fetching key from DB.
//
// Works against OpenAI directly (default) or any OpenAI-compatible gateway via
// `baseURL` — notably OpenRouter (https://openrouter.ai/api/v1), which routes
// `text-embedding-3-small` to OpenAI underneath, so vectors share the exact
// same 1536-dim space regardless of which path produced them.

import OpenAI from 'openai'

export interface EmbedOptions {
  /** OpenAI-compatible base URL, e.g. 'https://openrouter.ai/api/v1'. */
  baseURL?: string
  /** Embedding model. Keep text-embedding-3-small for 1536-dim compatibility. */
  model?: string
}

export async function embed(
  text: string,
  apiKey: string,
  opts: EmbedOptions = {},
): Promise<number[]> {
  const client = new OpenAI({ apiKey, ...(opts.baseURL ? { baseURL: opts.baseURL } : {}) })
  const response = await client.embeddings.create({
    model: opts.model ?? 'text-embedding-3-small',
    input: text,
    encoding_format: 'float',
  })
  return response.data[0].embedding
}
