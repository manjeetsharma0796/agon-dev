import { z } from 'zod'
import { Address, BaseUnits, Slot } from './primitives.js'

// vault_status and sync_fork (T-C25), appended after prepare_swap by a recorded decision.

/** A signed integer in base units, for a gain or a loss. Never a float: amounts stay exact. */
export const SignedUnits = z.string().regex(/^-?(0|[1-9][0-9]*)$/, 'not a signed integer')

const Amount = z.object({ mint: Address, amount: BaseUnits })

/**
 * What a vault holds and how its trades are doing, read from the chain this deployment names. Mints
 * only, never a token's name: names are outside text and never reach the agent.
 */
export const VaultStatus = z.object({
  vault: Address,
  owner: Address,
  /** Plain SOL on the vault's own address, in lamports; the trading balance is wSOL, in `balances`. */
  nativeSol: BaseUnits,
  balances: z.array(Amount),
  /** Each agent key the vault hires, with the SOL it holds to pay its own fees. */
  agents: z.array(z.object({ address: Address, feeSol: BaseUnits })),
  /** The vault's trades, newest first: what left it and what arrived, by mint. */
  trades: z.array(
    z.object({
      signature: z.string().min(1),
      slot: Slot,
      spent: Amount,
      received: Amount,
      /** What `received` is worth now, in wSOL base units, at a live quote; null with no quote. */
      worthNow: BaseUnits.nullable(),
      /** worthNow less the wSOL spent, in wSOL base units; null when either side is not wSOL-valued. */
      pnl: SignedUnits.nullable(),
      explorer: z.url(),
    }),
  ),
  /** The sum of the trades' P&L in wSOL base units, or null, and `pnlNote` then says why. */
  pnl: SignedUnits.nullable(),
  /** What the P&L is based on, or why there is none. Never blank. */
  pnlNote: z.string().min(1),
  explorer: z.url(),
  dataSlot: Slot,
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
