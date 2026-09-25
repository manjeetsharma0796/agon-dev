// Helius's enhanced transaction shape, translated into the one shape the decoder reads.
//
// Helius has two transaction endpoints and they do not agree. `getTransaction` returns
// `meta.preTokenBalances` and `meta.postTokenBalances`, which is the shape the decoder reads and
// the shape every decoder fixture was recorded in. The enhanced endpoint, which is the only one
// that returns a wallet's history a page at a time, returns a flat `signature` and
// `accountData[].tokenBalanceChanges`, which are already deltas. Every decoder test passed against
// a shape the product never fetches, and the first end to end run threw on the difference.
//
// The decoder stays single shaped on purpose: it is pure, it is what the benchmark replays, and
// teaching it two input formats would mean two code paths behind one coverage number. So the
// translation lives here, at the edge, where a provider changing its mind is somebody's problem
// exactly once.
//
// It lives in the decoder rather than beside a caller because it is pure and because more than one
// caller needs it: the CLI and the MCP server both read a wallet's history from this endpoint, and
// a second copy of this mapping is a second place for a provider's shape change to hide.

import type { RawTransaction } from './index.js'

/** One entry of `accountData[].tokenBalanceChanges`, which carries a signed change, not a balance. */
interface EnhancedChange {
  userAccount?: string
  mint?: string
  rawTokenAmount?: { tokenAmount?: string }
}

export interface EnhancedTransaction {
  signature?: string
  slot?: number
  transactionError?: unknown
  instructions?: { programId?: string }[]
  accountData?: { tokenBalanceChanges?: EnhancedChange[] }[]
}

/**
 * Turn one enhanced transaction into the shape the decoder reads.
 *
 * The decoder derives its deltas as post minus pre. The enhanced endpoint has already done that
 * subtraction, so the change is written as the post balance against an absent pre, and the
 * decoder's arithmetic reproduces exactly the number Helius reported. No amount is parsed,
 * rounded or re-derived on the way through: the string is carried across as it arrived.
 */
export function fromEnhanced(tx: EnhancedTransaction): RawTransaction {
  const post = (tx.accountData ?? [])
    .flatMap((a) => a.tokenBalanceChanges ?? [])
    .filter((c) => c.mint !== undefined && c.rawTokenAmount?.tokenAmount !== undefined)
    .map((c) => ({
      mint: c.mint as string,
      owner: c.userAccount,
      uiTokenAmount: { amount: c.rawTokenAmount?.tokenAmount as string },
    }))

  return {
    slot: tx.slot ?? 0,
    transaction: {
      signatures: tx.signature === undefined ? [] : [tx.signature],
      message: { instructions: tx.instructions ?? [] },
    },
    meta: {
      // Helius reports no error as null here, and the decoder treats anything non-null as a
      // failed transaction, which is the same rule.
      err: tx.transactionError ?? null,
      preTokenBalances: [],
      postTokenBalances: post,
    },
  }
}
