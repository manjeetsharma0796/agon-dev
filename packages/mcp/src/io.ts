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
  /**
   * True once any read behind this call came out of a recording rather than the network.
   *
   * It exists because an outside agent tested the deployed server, saw `check_trade` name USDC's
   * real freeze and mint authorities, checked that those facts are true of mainnet, and concluded
   * the tool was reading chain state. It was not: the deployment runs in replay and the facts were
   * recorded. The inference was reasonable and the payload gave it nothing to correct itself with.
   *
   * `NetResult` has carried `fromFixture` since the record wrapper was written and nothing outside
   * the tests ever read it. This is the first consumer.
   */
  usedFixture(): boolean
}

export const liveIo = (): ToolIo => {
  // Per instance, and `callAsTool` builds one per call, so two concurrent requests cannot see each
  // other's flag. A single flag shared across a server's lifetime would mark every later answer
  // the moment one early read hit a recording.
  let fromFixture = false

  return {
    usedFixture: () => fromFixture,

    async loadTransactions(wallet: string): Promise<RawTransaction[]> {
      let res
      try {
        res = await call(heliusTransactions(wallet, PAGE))
      } catch (error) {
        // The wrapper's own message is written for whoever is adding a fixture: it names the file
        // path it wanted and the env var that records it. That is the right message in a terminal
        // and the wrong one on a public endpoint, where it hands a stranger internal paths and
        // configuration names and tells a caller nothing it can act on. An outside agent hit this
        // and reported it as a path leak, correctly. The cause is stated without the internals.
        const replay = /replay mode|No recorded response/i.test(
          error instanceof Error ? error.message : String(error),
        )
        throw new Error(
          replay
            ? `No history is available for ${wallet} on this deployment. It answers from recorded ` +
              `data and there is no recording for this wallet, so nothing was read and no verdict ` +
              `is given. Ask about a wallet this deployment has, or run against live mainnet.`
            : `Could not read the history for ${wallet}, so no verdict is given rather than one ` +
              `based on a partial read.`,
        )
      }
      if (res.fromFixture) fromFixture = true
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
      // checkMints makes its own net call, so the wrapper is handed in rather than guessed at.
      // Inferring it from the verdict instead would be a second rule about what counts as
      // recorded, and the two would drift.
      const check = (
        await checkMints([mint], {
          net: async (req) => {
            const res = await call(req)
            if (res.fromFixture) fromFixture = true
            return res
          },
        })
      ).get(mint)
      if (check === undefined) {
        throw new Error(
          `The mint check returned 0 verdicts for ${mint}, where 1 was asked for. Nothing was read ` +
            `about this token, so it is not a token we can say anything about.`,
        )
      }
      return check
    },
  }
}
