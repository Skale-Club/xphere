// src/lib/medusa/wishlist-owner.ts
// Owner resolution for the wishlist executors — anti-IDOR core rule (contract
// §3 identity pinning rules). Owner comes EXCLUSIVELY from the pinned
// conversations.memory.commerce; tool schemas contain no owner fields.
// Pinned keys are `cus` and `wishlist_ref` (contract §3 claim names). Maps to
// the Stuscle ownerSchema, which requires EXACTLY ONE of customer_id /
// guest_ref (Zod `.refine(!!customer_id !== !!guest_ref)` — zero or two
// owner keys is a 400 invalid_body). See 135-RESEARCH.md Pattern 3.

/**
 * Returns exactly one owner key, or null when neither `cus` nor
 * `wishlist_ref` is pinned. `cus` (customer_id) takes priority over
 * `wishlist_ref` (guest_ref) when both are present — a verified customer
 * identity is preferred over the guest cookie fallback.
 */
export function resolveWishlistOwner(
  commerce: Record<string, unknown>,
): { customer_id: string } | { guest_ref: string } | null {
  if (typeof commerce.cus === 'string' && commerce.cus) return { customer_id: commerce.cus }
  if (typeof commerce.wishlist_ref === 'string' && commerce.wishlist_ref) return { guest_ref: commerce.wishlist_ref }
  return null
}
