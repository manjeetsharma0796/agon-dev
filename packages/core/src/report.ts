import { z } from 'zod'
import { Address, BaseUnits, Share, SignedBaseUnits, Slot } from './primitives.js'

// Frozen contract 2 of 3: the mined wallet report.
//
// The shape enforces the report's honesty rules, so a partial read or a missing rule cannot be
// rendered as a complete one. Decoder and miner (T-A01 to T-A04) produce it; the report page
// (T-E04) and the share card (T-E05) read it.

/**
 * How much history this report is actually based on. A read that stopped early says so and says
 * why, because showing a report as if the history were complete is the one thing we never do.
 */
export const ReportRange = z
  .object({
    readTransactions: z.number().int().nonnegative(),
    /** Null when the total is unknown, which is honest. Never a guess dressed as a count. */
    estimatedTotal: z.number().int().nonnegative().nullable(),
    throughSlot: Slot,
    complete: z.boolean(),
    /** Why the read stopped short, for example `Helius returned 429`. Null only when complete. */
    stoppedBecause: z.string().min(1).nullable(),
  })
  .refine((r) => r.complete === (r.stoppedBecause === null), {
    message:
      'an incomplete range must say why it stopped, and a complete one must not claim a cause',
  })

/** Descriptive statistics. These need no mined rule and are shown even when no rule was found. */
export const Metrics = z.object({
  closedTrades: z.number().int().nonnegative(),
  medianSize: BaseUnits,
  medianHoldSeconds: z.number().int().nonnegative(),
  realisedPnl: SignedBaseUnits,
})

/**
 * One mined habit. `found: false` is a first-class answer: with too few closed trades the report
 * says "a stop rule needs 20" rather than inventing a rule from three trades.
 */
export const MinedRule = z
  .object({
    kind: z.enum(['stop', 'size', 'hold']),
    found: z.boolean(),
    value: z.number().nullable(),
    sampleSize: z.number().int().nonnegative(),
    requiredSampleSize: z.number().int().positive(),
    /** Why no rule, for example `no consistent stop rule`. Null only when found. */
    reason: z.string().min(1).nullable(),
  })
  .refine(
    (r) =>
      r.found ? r.value !== null && r.reason === null : r.value === null && r.reason !== null,
    {
      message:
        'a found rule carries a value and no reason; an unfound rule carries a reason and no value',
    },
  )

/** What breaking your own rule cost. The number the share card is built on. */
export const Exceptions = z.object({
  count: z.number().int().nonnegative(),
  cost: SignedBaseUnits,
})

/** The share of the wallet's swaps we could decode, so the report can say "based on 83% of your swaps". */
export const Coverage = z
  .object({
    decodedSwaps: z.number().int().nonnegative(),
    totalSwaps: z.number().int().nonnegative(),
    share: Share,
  })
  .refine((c) => c.decodedSwaps <= c.totalSwaps, {
    message: 'cannot decode more swaps than were seen',
  })
  // No exemption for an empty wallet, and the exemption is what let the lie through. With
  // `totalSwaps === 0 ||` in front, the check short-circuited and `share` could be anything, so a
  // wallet where nothing decoded reported 1 and read as "we understood all of it". 0 over 0 is 0
  // here: we decoded none of what we saw, which is the true statement.
  .refine(
    (c) => Math.abs(c.share - (c.totalSwaps === 0 ? 0 : c.decodedSwaps / c.totalSwaps)) < 1e-6,
    {
      message:
        'share must equal decodedSwaps / totalSwaps, and 0 when nothing was seen, not a separately reported number',
    },
  )

/**
 * Transactions we did not decode, counted and named. Every transaction is either decoded or listed
 * here with a reason: there is no third bucket, and nothing is dropped silently.
 */
export const Unsupported = z.object({
  programId: Address,
  count: z.number().int().positive(),
  reason: z.string().min(1),
})

export const Report = z.object({
  wallet: Address,
  range: ReportRange,
  metrics: Metrics,
  rules: z.array(MinedRule),
  exceptions: Exceptions,
  coverage: Coverage,
  unsupported: z.array(Unsupported),
  dataSlot: Slot,
  ruleVersion: z.string().min(1),
})

export type ReportRange = z.infer<typeof ReportRange>
export type Metrics = z.infer<typeof Metrics>
export type MinedRule = z.infer<typeof MinedRule>
export type Exceptions = z.infer<typeof Exceptions>
export type Coverage = z.infer<typeof Coverage>
export type Unsupported = z.infer<typeof Unsupported>
export type Report = z.infer<typeof Report>
