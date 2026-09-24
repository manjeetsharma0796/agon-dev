// The one place `agon report` touches the network, and the one place a provider's shape is
// translated into ours.
//
// Helius has two transaction endpoints and they do not agree. `getTransaction` returns
// `meta.preTokenBalances` and `meta.postTokenBalances`, which is the shape the decoder reads and
// the shape every decoder fixture was recorded in. The enhanced endpoint, which is the only one
// that returns a wallet's history a page at a time, returns a flat `signature` and
// `accountData[].tokenBalanceChanges`, which are already deltas.
//
// The decoder stays single shaped on purpose: it is pure, it is what the benchmark replays, and
// teaching it two input formats would mean two code paths behind one coverage number. So the
// translation lives here, at the edge, where a provider changing its mind is somebody's problem
// exactly once.

import { call, heliusTransactions } from '@agon/core'
import type { RawTransaction } from '@agon/decoder'
import type { ReportIo } from './report.js'

/** Helius returns newest first and one page is 100, which is enough to mine a habit from. */
const PAGE = 100

/** One entry of `accountData[].tokenBalanceChanges`, which carries a signed change, not a balance. */
interface EnhancedChange {
  userAccount?: string
  mint?: string
  rawTokenAmount?: { tokenAmount?: string }
}
interface EnhancedTransaction {
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

export function liveIo(): ReportIo {
  return {
    async loadTransactions(wallet: string): Promise<RawTransaction[]> {
      const res = await call(heliusTransactions(wallet, PAGE))
      if (res.status !== 200) {
        throw new Error(
          `Helius answered ${res.status} for ${wallet}. Nothing was read, so no report is shown ` +
            `rather than a report based on part of the history without saying so.`,
        )
      }
      // Anything other than an array is a response shape change, and guessing at it is how a
      // decoder silently reports 0 swaps for a wallet that has hundreds.
      if (!Array.isArray(res.body)) {
        throw new Error(
          `Helius returned ${typeof res.body} where an array of transactions was expected, so the ` +
            `history could not be read. This is a response shape change, not an empty wallet.`,
        )
      }
      return (res.body as EnhancedTransaction[]).map(fromEnhanced)
    },
  }
}
