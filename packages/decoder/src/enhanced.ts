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

import type { RawTokenBalance, RawTransaction } from './index.js'

/** One entry of `accountData[].tokenBalanceChanges`, which carries a signed change, not a balance. */
interface EnhancedChange {
  userAccount?: string
  mint?: string
  rawTokenAmount?: { tokenAmount?: string }
}

export interface EnhancedTransaction {
  signature?: string
  slot?: number
  fee?: number
  transactionError?: unknown
  instructions?: { programId?: string }[]
  /** 1 entry per account of the transaction, in the transaction's own account order. */
  accountData?: {
    account?: string
    nativeBalanceChange?: number
    tokenBalanceChanges?: EnhancedChange[]
  }[]
}

/**
 * Turn one enhanced transaction into the shape the decoder reads.
 *
 * The decoder derives its deltas as post minus pre. The enhanced endpoint has already done that
 * subtraction, so each change is written as a balance against 0: a gain as post, a loss as pre.
 * The decoder's arithmetic then reproduces exactly the number Helius reported, and no amount is
 * parsed, rounded or re-derived on the way through.
 *
 * The native SOL leg comes across the same way, from `nativeBalanceChange`, with the fee beside it.
 * Without it a swap paid from native SOL has no SOL side and reads as not a swap. Writing a gain
 * against a pre of 0 is also what lets the decoder's rent rule see a token account this wallet
 * opened, and a loss against a post of 0 one it closed, because on a token account those are the
 * only moves that change its lamports; a wSOL wrap moves lamports too, and the rule nets that out.
 */
export function fromEnhanced(tx: EnhancedTransaction): RawTransaction {
  const accounts = tx.accountData ?? []
  const pre: RawTokenBalance[] = []
  const post: RawTokenBalance[] = []
  accounts.forEach((a, accountIndex) => {
    for (const c of a.tokenBalanceChanges ?? []) {
      const amount = c.rawTokenAmount?.tokenAmount
      if (c.mint === undefined || amount === undefined) continue
      const loss = amount.startsWith('-')
      ;(loss ? pre : post).push({
        mint: c.mint,
        owner: c.userAccount,
        accountIndex,
        uiTokenAmount: { amount: loss ? amount.slice(1) : amount },
      })
    }
  })
  const lamports = accounts.map((a) => a.nativeBalanceChange ?? 0)

  return {
    slot: tx.slot ?? 0,
    transaction: {
      signatures: tx.signature === undefined ? [] : [tx.signature],
      message: {
        accountKeys: accounts.map((a) => a.account ?? ''),
        instructions: tx.instructions ?? [],
      },
    },
    meta: {
      // Helius reports no error as null here, and the decoder treats anything non-null as a
      // failed transaction, which is the same rule.
      err: tx.transactionError ?? null,
      fee: tx.fee ?? 0,
      preBalances: lamports.map((c) => (c < 0 ? -c : 0)),
      postBalances: lamports.map((c) => (c > 0 ? c : 0)),
      preTokenBalances: pre,
      postTokenBalances: post,
    },
  }
}
