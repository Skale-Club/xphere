/** A count that always fits a small badge. */
export function unreadLabel(count: number): string {
  return count > 99 ? '99+' : String(count)
}
