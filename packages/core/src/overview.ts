import { z } from 'zod'
import { Address, Slot } from './primitives.js'
import { Quantity, VaultStatus } from './vault.js'

// GET /overview?wallet= (T-C31): vault_status's report plus 3 numbers built by arithmetic, each
// stamped with the network, its slot and the rule version, each price with its source and time.
// A figure that cannot be computed is null with its reason, never 0.

/** A USD price as GeckoTerminal sent it, written as an exact decimal. Never a float. */
const UsdDecimal = z.string().regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/)

const Stamp = {
  network: z.string().min(1),
  slot: Slot,
  ruleVersion: z.string().min(1),
}

/** 1 close a number used: the mint, its USD, the bucket it closes and where it came from. */
const PriceUsed = z.object({
  mint: Address,
  usd: UsdDecimal,
  /** The bucket start, Unix seconds. */
  t: z.number().int(),
  stepSeconds: z.number().int().positive(),
  source: z.string().min(1),
  fetchedAt: z.iso.datetime(),
})

/** Time-weighted, in SOL, revalued at each deposit and withdrawal at its own slot's close. */
export const ReturnInSol = z.object({
  ...Stamp,
  /** Percent to 2 places, signed, e.g. "9.34". Null with `why` when it cannot be computed. */
  pct: z
    .string()
    .regex(/^-?[0-9]+\.[0-9]{2}$/)
    .nullable(),
  why: z.string().min(1).nullable(),
  /** Printed beside the number: in SOL, the fees it is net of, the flows, the slots. */
  method: z.string().min(1),
  /** "N trades is too few to judge a strategy." below 30 trades, else null. */
  sample: z.string().min(1).nullable(),
  trades: z.number().int().nonnegative(),
  flows: z.number().int().nonnegative(),
  agentFees: Quantity,
  fromSlot: Slot.nullable(),
  toSlot: Slot,
  prices: z.array(PriceUsed),
})

/** The candles a curve was valued from, 1 entry per mint, with how fresh they are. */
const Series = z.object({
  mint: Address,
  source: z.string().min(1),
  stepSeconds: z.number().int().positive(),
  fetchedAt: z.iso.datetime().nullable(),
  /** Why the last good candles are served instead of fresh ones, or null when they are fresh. */
  stale: z.string().min(1).nullable(),
  /** Why there are no candles at all for this mint, or null. */
  error: z.string().min(1).nullable(),
})

/** Holdings at the end of each bucket times its close. A gap is null with its reason, never joined. */
export const EquityCurve = z.object({
  ...Stamp,
  points: z.array(
    z.object({
      t: z.number().int(),
      value: Quantity.nullable(),
      gap: z.string().min(1).nullable(),
    }),
  ),
  gaps: z.number().int().nonnegative(),
  method: z.string().min(1),
  /** Why there is no curve at all, or null. */
  why: z.string().min(1).nullable(),
  series: z.array(Series),
})

/** used = cap - what the agent can spend now, per role and mint, in the current window. */
export const CapRole = z.object({
  roleId: z.number().int().nonnegative(),
  agent: Address,
  mint: Address,
  cap: Quantity,
  used: Quantity,
  left: Quantity,
  windowSlots: z.number().int().positive(),
  /** The first slot the allowance is whole again; null with `refillWhy` when there is none to give. */
  refillSlot: Slot.nullable(),
  refillWhy: z.string().min(1).nullable(),
  /** 2 full windows back to back across an edge. */
  burstWorstCase: Quantity,
  line: z.string().min(1),
})

export const CapMeter = z.object({
  ...Stamp,
  roles: z.array(CapRole),
  method: z.string().min(1),
  /** Why the roles could not be read, or null. */
  why: z.string().min(1).nullable(),
})

export const Overview = z.object({
  network: z.string().min(1),
  dataSlot: Slot,
  ruleVersion: z.string().min(1),
  asOf: z.iso.datetime(),
  report: VaultStatus,
  returnInSol: ReturnInSol,
  equityCurve: EquityCurve,
  capMeter: CapMeter,
})

export type ReturnInSol = z.infer<typeof ReturnInSol>
export type EquityCurve = z.infer<typeof EquityCurve>
export type CapRole = z.infer<typeof CapRole>
export type CapMeter = z.infer<typeof CapMeter>
export type Overview = z.infer<typeof Overview>
