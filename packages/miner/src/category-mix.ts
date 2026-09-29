// The share of a wallet's closed trades in each token category: the thing style fit compares a
// proposed trade against. Pure, like the rest of the miner: the categories arrive as a map the
// caller already looked up, so 0 network calls happen here.

import type { ClosedTrade } from '@agon/decoder'

/**
 * Each category's share of the closed trades against `quoteMint`, summing to 1. Null rather than
 * partial when any traded mint has no category, because a share nobody placed would read as "you
 * have never traded that kind of token". Null too when there are no closed trades.
 */
export function categoryMix(
  trades: readonly ClosedTrade[],
  quoteMint: string,
  categories: ReadonlyMap<string, string>,
): Record<string, number> | null {
  const ours = trades.filter((t) => t.quoteMint === quoteMint)
  if (ours.length === 0) return null
  const counts: Record<string, number> = {}
  for (const t of ours) {
    const category = categories.get(t.mint)
    if (category === undefined) return null
    counts[category] = (counts[category] ?? 0) + 1
  }
  return Object.fromEntries(Object.entries(counts).map(([k, n]) => [k, n / ours.length]))
}
