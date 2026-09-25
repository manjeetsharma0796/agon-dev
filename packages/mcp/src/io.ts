// The reads the tools need, and the only part of this package that touches the network.
//
// Everything below goes through the record and replay wrapper, so the same server answers from a
// committed recording with 0 keys set. That is what makes a demo reproducible: the agent talking to
// this server gets the same numbers whether or not anyone's key is live.

import { call, heliusTransactions } from '@agon/core'
import { fromEnhanced, type EnhancedTransaction, type RawTransaction } from '@agon/decoder'
import { checkMints, type MintCheck } from '@agon/guard'

/** Helius returns newest first and one page is 100, which is enough to mine a habit from. */
const PAGE = 100

export interface ToolIo {
  loadTransactions(wallet: string): Promise<RawTransaction[]>
  loadMintCheck(mint: string): Promise<MintCheck>
}

export const liveIo = (): ToolIo => ({
  async loadTransactions(wallet: string): Promise<RawTransaction[]> {
    const res = await call(heliusTransactions(wallet, PAGE))
    if (res.status !== 200) {
      throw new Error(
        `Helius answered ${res.status} for ${wallet}. Nothing was read, so this returns no ` +
          `answer rather than one based on part of the history without saying so.`,
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

  async loadMintCheck(mint: string): Promise<MintCheck> {
    const check = (await checkMints([mint])).get(mint)
    if (check === undefined) {
      throw new Error(
        `The mint check returned 0 verdicts for ${mint}, where 1 was asked for. Nothing was read ` +
          `about this token, so it is not a token we can say anything about.`,
      )
    }
    return check
  },
})
