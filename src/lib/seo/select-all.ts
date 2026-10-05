const PAGE_SIZE = 1000

/**
 * Page through a PostgREST select. PostgREST caps responses at 1000 rows, so a
 * plain select silently truncates audits with more pages or issues than that.
 */
export async function selectAll<T>(
  query: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
  maxRows = 50_000,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; from < maxRows; from += PAGE_SIZE) {
    const { data, error } = await query(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    out.push(...((data ?? []) as T[]))
    if (!data || data.length < PAGE_SIZE) break
  }
  return out
}
