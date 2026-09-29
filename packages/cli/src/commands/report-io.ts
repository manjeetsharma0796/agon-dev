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
import { fromEnhanced, type EnhancedTransaction, type RawTransaction } from '@agon/decoder'

// Re-exported because the CLI's own tests import it from here. The mapping itself moved into the
// decoder, where the MCP server can reach it too.
export { fromEnhanced, type EnhancedTransaction }
import { categoriesOf, checkMints, type MintCheck } from '@agon/guard'
import type { ReportIo } from './report.js'
import type { CheckIo } from './check.js'

/** Helius returns newest first and one page is 100, which is enough to mine a habit from. */
const PAGE = 100

/**
 * The same reads, plus the mint check `agon check` needs.
 *
 * `checkMints` already fails closed and already goes through the recorded and replayed wrapper, so
 * there is nothing to add here beyond taking the one verdict out of the batch it returns.
 */
export function liveCheckIo(): CheckIo {
  return {
    ...liveIo(),
    async loadMintCheck(mint: string): Promise<MintCheck> {
      const check = (await checkMints([mint])).get(mint)
      if (check === undefined) {
        throw new Error(
          `The mint check returned 0 verdicts for ${mint}, where 1 was asked for. Nothing was ` +
            `read about this token, so it is not a token we can say anything about.`,
        )
      }
      return check
    },
    loadCategories: (mints, slot) => categoriesOf(mints, {}, slot),
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
