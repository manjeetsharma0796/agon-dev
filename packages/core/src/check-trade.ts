import { z } from 'zod'
import { Address, BaseUnits, Slot } from './primitives.js'

// Frozen contract 1 of 3: the check_trade tool.
//
// Changing a field here needs the owners of both sides to agree, and the examples change in the
// same commit. Guard (T-C06), MCP server (T-C07), API and web all read this one definition.

export const Side = z.enum(['buy', 'sell'])

export const CheckTradeInput = z.object({
  /** The mint being bought or sold. */
  mint: Address,
  side: Side,
  /** Base units of the asset being spent: the quote asset on a buy, the mint on a sell. */
  size: BaseUnits,
  /** The wallet whose own mined rules this trade is checked against. */
  wallet: Address,
})

/**
 * `unsure` is not a soft pass. Anything that can move funds fails closed: the agent hands back to
 * the user with the reason and the numbers, and nothing retries silently.
 */
export const Verdict = z.enum(['pass', 'block', 'unsure'])

/**
 * Why the guard reached its verdict. A reason always names the rule. It carries numbers when the
 * rule is arithmetic ("4.1x your median size of 0.8 SOL") and none when the finding is categorical
 * ("freeze authority is live"), because inventing a number for a categorical finding is worse than
 * having none.
 */
export const Reason = z
  .object({
    /** The rule that produced this, for example `size-vs-median` or `mint-freeze-authority`. */
    rule: z.string().min(1),
    /** What the user reads. Names the cause, the number involved, and what they can do next. */
    message: z.string().min(1),
    observed: z.number().optional(),
    limit: z.number().optional(),
    /** What `observed` and `limit` are counted in, for example `SOL` or `x-median`. */
    unit: z.string().min(1).optional(),
  })
  .refine(
    (r) =>
      (r.observed === undefined && r.limit === undefined && r.unit === undefined) ||
      (r.observed !== undefined && r.limit !== undefined && r.unit !== undefined),
    {
      message:
        'a numeric reason needs observed, limit and unit together: a number without its limit or ' +
        'its unit cannot be shown to the user',
    },
  )

export const CheckTradeOutput = z
  .object({
    verdict: Verdict,
    reasons: z.array(Reason),
    /** The slot the account reads behind this verdict were taken at. Makes a run reproducible. */
    dataSlot: Slot,
    /** Which mined profile produced it, so "why was this blocked?" has an answer later. */
    ruleVersion: z.string().min(1),
  })
  .refine((o) => o.verdict === 'pass' || o.reasons.length > 0, {
    message: 'a block or unsure verdict must carry at least one reason: no blank hand-backs',
  })

export type Side = z.infer<typeof Side>
export type CheckTradeInput = z.infer<typeof CheckTradeInput>
export type Verdict = z.infer<typeof Verdict>
export type Reason = z.infer<typeof Reason>
export type CheckTradeOutput = z.infer<typeof CheckTradeOutput>
