// src/lib/knowledge/recursive-split.ts
// Port of LangChain's RecursiveCharacterTextSplitter (separators "\n\n", "\n",
// " ", ""; keepSeparator false; character length) so knowledge ingestion in the
// app produces the same chunks as the Deno process-embeddings function did with
// chunkSize 1000 / chunkOverlap 100, without importing LangChain.

const DEFAULT_SEPARATORS = ['\n\n', '\n', ' ', '']

function joinDocs(docs: string[], separator: string): string | null {
  const text = docs.join(separator).trim()
  return text === '' ? null : text
}

function mergeSplits(
  splits: string[],
  separator: string,
  chunkSize: number,
  chunkOverlap: number,
): string[] {
  const sepLen = separator.length
  const docs: string[] = []
  const current: string[] = []
  let total = 0
  for (const d of splits) {
    const len = d.length
    if (total + len + (current.length > 0 ? sepLen : 0) > chunkSize) {
      if (current.length > 0) {
        const doc = joinDocs(current, separator)
        if (doc !== null) docs.push(doc)
        while (
          total > chunkOverlap ||
          (total + len + (current.length > 0 ? sepLen : 0) > chunkSize && total > 0)
        ) {
          total -= current[0].length + (current.length > 1 ? sepLen : 0)
          current.shift()
        }
      }
    }
    current.push(d)
    total += len + (current.length > 1 ? sepLen : 0)
  }
  const doc = joinDocs(current, separator)
  if (doc !== null) docs.push(doc)
  return docs
}

function split(
  text: string,
  separators: string[],
  chunkSize: number,
  chunkOverlap: number,
): string[] {
  const finalChunks: string[] = []
  let separator = separators[separators.length - 1]
  let newSeparators: string[] = []
  for (let i = 0; i < separators.length; i++) {
    const s = separators[i]
    if (s === '') {
      separator = s
      break
    }
    if (text.includes(s)) {
      separator = s
      newSeparators = separators.slice(i + 1)
      break
    }
  }

  const pieces = (separator ? text.split(separator) : text.split('')).filter((s) => s !== '')

  let good: string[] = []
  for (const s of pieces) {
    if (s.length < chunkSize) {
      good.push(s)
      continue
    }
    if (good.length > 0) {
      finalChunks.push(...mergeSplits(good, separator, chunkSize, chunkOverlap))
      good = []
    }
    if (newSeparators.length === 0) finalChunks.push(s)
    else finalChunks.push(...split(s, newSeparators, chunkSize, chunkOverlap))
  }
  if (good.length > 0) finalChunks.push(...mergeSplits(good, separator, chunkSize, chunkOverlap))
  return finalChunks
}

export function recursiveSplitText(
  text: string,
  chunkSize = 1000,
  chunkOverlap = 100,
  separators: string[] = DEFAULT_SEPARATORS,
): string[] {
  if (chunkOverlap >= chunkSize) throw new Error('Cannot have chunkOverlap >= chunkSize')
  return split(text, separators, chunkSize, chunkOverlap)
}
