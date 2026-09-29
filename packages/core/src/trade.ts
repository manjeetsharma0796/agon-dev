import { z } from 'zod'
import { CheckTradeOutput } from './check-trade.js'
import { Address, BaseUnits } from './primitives.js'

// The prepare_swap tool (T-C21): the MCP builds the trade, the agent signs it on its own machine.
// The server never signs and never sees a key; it returns bytes for the agent to sign.

export const PrepareSwapInput = z.object({
  /** The vault owner: the wallet whose derived vault holds the funds. On the fork, a test key. */
  owner: Address,
  /**
   * The wallet whose own mined rules check_trade judges this trade against. Read only, because an
   * address is public. On mainnet it is the owner; on the fork it is the user's real address, since
   * a fresh test key has no history and check_trade fails closed on none.
   */
  historyWallet: Address,
  /** The agent key: the fee payer and the only signer of the returned transaction. */
  agent: Address,
  inputMint: Address,
  outputMint: Address,
  /** Base units of the input mint to spend. */
  amount: BaseUnits,
  /** The most the price may move before the swap fails. Required, never defaulted. */
  slippageBps: z.number().int().positive(),
})

export const PreparedSwap = z.object({
  /** The unsigned transaction, base64, all accounts inline. The agent signs it and sends it. */
  transaction: z.string().min(1),
  /** Where the funds leave from. */
  vault: Address,
  /** check_trade's answer for this exact trade. A transaction is only built on a pass. */
  verdict: CheckTradeOutput,
  quote: z.object({
    inAmount: BaseUnits,
    outAmount: BaseUnits,
    /** The least the swap may return before it fails, from the slippage asked for. */
    minOutAmount: BaseUnits,
    slippageBps: z.number().int().positive(),
    /** The pool address of each leg, in order. Addresses, not names: names are outside text. */
    route: z.array(Address),
  }),
  /** What the agent may still spend in this window, before this trade. */
  effectiveRemaining: BaseUnits,
  /** The transaction is valid until this block height; after it, prepare again. */
  lastValidBlockHeight: z.number().int().nonnegative(),
  /** Compute units the simulation used, so a caller can see it ran. */
  unitsConsumed: z.number().int().nonnegative(),
})

/**
 * The fields of Jupiter's quote prepare_swap reads, checked where the answer comes in: it is
 * outside data. Every other field passes through untouched to /swap-instructions. The route is
 * read as pool addresses only; each leg's label is outside text and is never read.
 */
export const JupiterQuote = z.looseObject({
  inAmount: BaseUnits,
  outAmount: BaseUnits,
  otherAmountThreshold: BaseUnits,
  slippageBps: z.number().int().nonnegative(),
  inputMint: Address,
  outputMint: Address,
  priceImpactPct: z.string().regex(/^-?[0-9]+(\.[0-9]+)?(e-?[0-9]+)?$/),
  contextSlot: z.number().int().optional(),
  routePlan: z.array(z.looseObject({ swapInfo: z.looseObject({ ammKey: Address }) })).min(1),
})

export type JupiterQuote = z.infer<typeof JupiterQuote>
export type PrepareSwapInput = z.infer<typeof PrepareSwapInput>
export type PreparedSwap = z.infer<typeof PreparedSwap>
