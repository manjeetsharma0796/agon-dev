import { z } from 'zod'
import { Address, BaseUnits, Slot } from './primitives.js'

// vault_status and sync_fork (T-C25), appended after prepare_swap by a recorded decision.

/** A signed integer in base units, for a gain or a loss. Never a float: amounts stay exact. */
export const SignedUnits = z.string().regex(/^-?(0|[1-9][0-9]*)$/, 'not a signed integer')

/** "SOL", a pinned symbol, or the mint's short address. Never a name a token gave itself. */
const Unit = z.string().min(1)

/** A gain or a loss 3 ways: exact base units, the decimal a person reads, and its unit. */
export const Money = z.object({
  amount: SignedUnits,
  /** The same amount with the mint's decimals applied, e.g. "-0.25". Never a float. */
  ui: z.string().regex(/^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/),
  unit: Unit,
})

/** An amount held, paid or fetched: the same 3 ways, never negative. */
export const Quantity = z.object({
  amount: BaseUnits,
  ui: z.string().regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/),
  unit: Unit,
})

/** Dollars to the cent, signed, from a SOL figure times SOL/USD. An estimate, so never a basis. */
const Usd = z.string().regex(/^-?[0-9]+\.[0-9]{2}$/)

const InSolAndUsd = z.object({ sol: Money, usd: Usd.nullable() })

/**
 * What a vault holds and how its trades are doing, read from the chain this deployment names.
 * P&L is first in, first out over every trade, with SOL as the only quote: a buy opens a lot, a sell
 * closes the oldest lots, and USDC is a position like any other. Realised P&L is chain arithmetic and
 * needs no price; open positions are valued at what selling them fetches now, from the first source
 * that answers. Mints only, never a token's name: names are outside text and never reach the agent.
 */
export const VaultStatus = z.object({
  vault: Address,
  owner: Address,
  /** Lines a person can read as they are: the totals, the open positions, the prices and sources. */
  summary: z.array(z.string().min(1)).min(1).max(8),
  totals: z.object({
    realised: InSolAndUsd,
    /** Over the positions some source priced; `unpriced` lists the rest. */
    unrealised: InSolAndUsd,
    total: InSolAndUsd,
    unpriced: z.array(Address),
    note: z.string().min(1),
  }),
  /** SOL/USD from every source that answered, or null with `totals.note` saying why. */
  solUsd: z
    .object({
      usd: z.string().min(1),
      sources: z.array(z.object({ name: z.string().min(1), usd: z.string().min(1) })).min(1),
      spreadPct: z.string().min(1),
    })
    .nullable(),
  positions: z.array(
    z.object({
      mint: Address,
      /** What the vault holds of it now: at most its on-chain balance. */
      held: Quantity,
      cost: Quantity,
      value: Quantity.nullable(),
      unrealised: InSolAndUsd.nullable(),
      source: z.string().min(1).nullable(),
      whyUnpriced: z.string().min(1).nullable(),
    }),
  ),
  /** Token balances the vault holds now: SOL, then the open positions' mints, at most 5. */
  balances: z.array(z.object({ mint: Address, held: Quantity })),
  /** Plain SOL on the vault's own address; the trading balance is wSOL, in `balances`. */
  nativeSol: Quantity,
  /** Each agent key the vault hires, with the SOL it holds to pay its own fees. */
  agents: z.array(z.object({ address: Address, feeSol: Quantity })),
  /** The latest trades, newest first; the totals cover every one, `history` says how many. */
  trades: z.array(
    z.object({
      signature: z.string().min(1),
      slot: Slot,
      time: z.iso.datetime().nullable(),
      side: z.enum(['buy', 'sell']),
      mint: Address,
      token: Quantity,
      sol: Quantity,
      /** A sell's realised P&L in SOL; null for a buy. */
      realised: Money.nullable(),
      explorer: z.url(),
    }),
  ),
  history: z.object({
    trades: z.number().int().nonnegative(),
    shown: z.number().int().nonnegative(),
    positions: z.number().int().nonnegative(),
    positionsShown: z.number().int().nonnegative(),
    /** How many token balances the vault holds; `balances` lists SOL and then the largest positions. */
    balances: z.number().int().nonnegative(),
    signaturesRead: z.number().int().nonnegative(),
    /** False when older transactions were not read, and `incomplete` then says why. */
    complete: z.boolean(),
    incomplete: z.string().min(1).nullable(),
    /** What the ledger did not count, grouped by reason, so the list is bounded by its kinds. */
    notCounted: z.array(
      z.object({ count: z.number().int().positive(), reason: z.string().min(1) }),
    ),
  }),
  explorer: z.url(),
  dataSlot: Slot,
  asOf: z.iso.datetime(),
})

/** sync_fork takes the pair whose route to refresh; wSOL to USDC when it is left out. */
export const SyncForkInput = z.strictObject({
  inputMint: Address.optional(),
  outputMint: Address.optional(),
})

/** What sync_fork did. It never restarts the fork or resets a vault. */
export const SyncForkResult = z.object({
  /** How far the fork's clock was behind real time, in ms; negative when it was ahead. */
  clockLagBeforeMs: z.number().int(),
  clockLagAfterMs: z.number().int(),
  clockMoved: z.boolean(),
  /** Accounts the pair's route reads, copied from mainnet again. */
  refreshedAccounts: z.number().int().nonnegative(),
  pair: z.tuple([Address, Address]),
  note: z.string().min(1),
})

export type VaultStatus = z.infer<typeof VaultStatus>
export type SyncForkResult = z.infer<typeof SyncForkResult>
