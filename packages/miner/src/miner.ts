// The rule miner: what habits does this wallet actually have?
//
// Pure. Plain data in, metrics and rules out, 0 network calls, so the same code answers the report,
// the benchmark and a replayed test, and 2 runs on the same input produce the same bytes.
//
// The hard part is not finding a rule. It is refusing to. A median always exists, so a miner that
// reports one will tell somebody they have a 20% stop when they have never used a stop in their
// life, and they will believe it because it came with a number.

import { Metrics, type MinedRule } from '@agon/core'
import type { ClosedTrade } from '@agon/decoder'

/** Below this many closed trades, no stop rule is claimed. Fixed by T-A03's acceptance line. */
export const STOP_MIN_TRADES = 20

/** And below this many losing trades there is no habit to find, however tightly they agree. A
 *  wallet with 20 closed trades and 2 losses has not shown you how it exits. */
export const STOP_MIN_LOSSES = 5

/**
 * How far the losses may sit from their own median, in percentage points, and still be one habit.
 * Median absolute deviation rather than a standard deviation, because 1 catastrophic exit should
 * not widen the band enough to swallow the real stop.
 */
export const STOP_MAX_MAD_POINTS = 2

/**
 * Solana targets 400 ms a slot. Hold time is therefore derived and not observed: a closed trade
 * carries the slots it opened and closed at, not wall-clock timestamps. Seconds are reported as a
 * whole number because the third digit would be invented precision.
 */
export const SECONDS_PER_SLOT = 0.4

const median = (sorted: readonly number[]): number => {
  if (sorted.length === 0) return 0
  const mid = sorted.length >> 1
  const a = sorted[mid - 1] as number
  const b = sorted[mid] as number
  return sorted.length % 2 === 1 ? b : (a + b) / 2
}

const medianBig = (sorted: readonly bigint[]): bigint => {
  if (sorted.length === 0) return 0n
  const mid = sorted.length >> 1
  const a = sorted[mid - 1] as bigint
  const b = sorted[mid] as bigint
  return sorted.length % 2 === 1 ? b : (a + b) / 2n
}

const unfound = (
  kind: MinedRule['kind'],
  sampleSize: number,
  requiredSampleSize: number,
  reason: string,
): MinedRule => ({ kind, found: false, value: null, sampleSize, requiredSampleSize, reason })

const found = (
  kind: MinedRule['kind'],
  value: number,
  sampleSize: number,
  requiredSampleSize: number,
): MinedRule => ({ kind, found: true, value, sampleSize, requiredSampleSize, reason: null })

/**
 * The stop rule, or an honest refusal.
 *
 * A loss is measured against what the position cost, in percentage points, positive, which is
 * what a trader means by "I cut at 8%". The habit is the median of those, and it is only a habit
 * if they sit close to it.
 */
const mineStop = (losses: readonly number[], closedTrades: number): MinedRule => {
  if (closedTrades < STOP_MIN_TRADES) {
    return unfound(
      'stop',
      closedTrades,
      STOP_MIN_TRADES,
      `${closedTrades} closed trades. A stop rule needs ${STOP_MIN_TRADES}; sizing and hold time are shown`,
    )
  }
  if (losses.length < STOP_MIN_LOSSES) {
    return unfound(
      'stop',
      closedTrades,
      STOP_MIN_TRADES,
      `${losses.length} losing trades out of ${closedTrades}. A stop rule needs ${STOP_MIN_LOSSES} losses to be a habit rather than a coincidence`,
    )
  }
  const sorted = [...losses].sort((a, b) => a - b)
  const mid = median(sorted)
  const mad = median([...sorted.map((l) => Math.abs(l - mid))].sort((a, b) => a - b))
  if (mad > STOP_MAX_MAD_POINTS) {
    return unfound('stop', closedTrades, STOP_MIN_TRADES, 'no consistent stop rule')
  }
  // 2 decimal places: the input is exact but the habit is not, and 8.3333333 claims otherwise.
  return found('stop', Math.round(mid * 100) / 100, closedTrades, STOP_MIN_TRADES)
}

export interface Mined {
  metrics: Metrics
  /** Always 3, in this order: stop, size, hold. A missing rule is `found: false`, never absent. */
  rules: MinedRule[]
}

/**
 * Mines one wallet's closed trades.
 *
 * `quoteMint` is required and not inferred. `Metrics.realisedPnl` is 1 signed number, and T-A02
 * keeps realised P&L per quote because SOL and USDC are different units: summing them here would
 * produce a total of nothing and it would look like a total of something.
 */
export function mine(trades: readonly ClosedTrade[], quoteMint: string): Mined {
  const ours = trades.filter((t) => t.quoteMint === quoteMint)
  const closedTrades = ours.length

  const sizes = ours.map((t) => BigInt(t.costBasis)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const holds = ours
    .map((t) => Math.round((t.closedSlot - t.openedSlot) * SECONDS_PER_SLOT))
    .sort((a, b) => a - b)
  const realisedPnl = ours.reduce((sum, t) => sum + BigInt(t.realisedPnl), 0n)

  // How far the loss ran, as a positive percentage of what the position cost. Positive because a
  // trader says "I cut at 8%", the demo script says 8% and the failure messages say 8%, and a
  // sign that flips between the miner and the guard is a comparison that silently inverts.
  const losses = ours
    .filter((t) => BigInt(t.realisedPnl) < 0n && BigInt(t.costBasis) > 0n)
    .map((t) => Math.abs((Number(t.realisedPnl) / Number(t.costBasis)) * 100))

  // Parsed, not cast. BaseUnits and SignedBaseUnits are branded in the frozen contract precisely
  // so a number cannot reach a report without passing the check that says it is one.
  const metrics = Metrics.parse({
    closedTrades,
    medianSize: medianBig(sizes).toString(),
    medianHoldSeconds: Math.round(median(holds)),
    realisedPnl: realisedPnl.toString(),
  })

  const rules: MinedRule[] = [
    mineStop(losses, closedTrades),
    closedTrades === 0
      ? unfound('size', 0, 1, 'no closed trades to size from')
      : found('size', Number(medianBig(sizes)), closedTrades, 1),
    closedTrades === 0
      ? unfound('hold', 0, 1, 'no closed trades to time')
      : found('hold', Math.round(median(holds)), closedTrades, 1),
  ]

  return { metrics, rules }
}
