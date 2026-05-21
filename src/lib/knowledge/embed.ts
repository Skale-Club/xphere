// src/lib/knowledge/embed.ts
// OpenAI text-embedding-3-small wrapper | accepts apiKey directly.
// No module-level client; caller is responsible for fetching key from DB.

import OpenAI from 'openai'

export async function embed(text: string, apiKey: string): Promise<number[]> {
  const client = new OpenAI({ apiKey })
  const response = await client.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
    encoding_format: 'float',
  })
  return response.data[0].embedding
}
