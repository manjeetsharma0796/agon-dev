// One wallet's history plus one proposed trade, in. One verdict, out.
//
// This is the composition the whole product is: decode the swaps from balance changes, build the
// FIFO ledger, mine the habits, then check the trade against them. It lives here, in exactly one
// place, because the CLI, the MCP server, the API and the benchmark all need it and a second copy
// is how a benchmark number stops matching what a user is told.
//
// Pure, and 0 network calls inside. Every read the caller needs, the wallet's transactions and the
// mint's authorities, is passed in already done. That is what lets the same function serve a
// replayed test with no key and a live agent call.

import { decodeAll, fifoLedger, type RawTransaction } from '@agon/decoder'
import { mine } from '@agon/miner'
import type { CheckTradeOutput } from '@agon/core'
import { checkTrade } from './check-trade.js'
import type { MintCheck } from './mint-check.js'

/** SOL. The quote a wallet's sizing is counted in, and what a size cap is expressed against. */
export const DEFAULT_QUOTE = 'So11111111111111111111111111111111111111112'

/** What the spend is counted in on a buy. 9 decimals, so 800000000 base units reads as 0.8 SOL. */
const SOL = { symbol: 'SOL', decimals: 9 }

export interface ProposedTrade {
  wallet: string
  mint: string
  side: 'buy' | 'sell'
  /** Base units, never a decimal amount. Rounding a size tests a cap against a number nobody asked for. */
  size: string
}

export interface Assessment {
  verdict: CheckTradeOutput
  /** The mined profile the verdict was reached against, so a caller can show what it was judged by. */
  closedTrades: number
  rules: ReturnType<typeof mine>['rules']
}

/**
 * Assess a proposed trade against the wallet's own mined history.
 *
 * Deliberately arithmetic only: the quote and the Jev screen are both passed to the guard as null,
 * which is its documented fast path. A `block` that comes back this way was reached by comparing
 * numbers to this wallet's own history and nothing else, so it asks a model nothing.
 *
 * The consequence, stated rather than left to be discovered: with no quote and no screen this can
 * never return `pass`. Unscreened text is `unsure`, and `unsure` is not a soft pass. A caller that
 * wants a pass has to supply both, and until it does every answer here is a refusal that names
 * what was not read.
 */
export function assessTrade(
  txs: readonly RawTransaction[],
  trade: ProposedTrade,
  mintCheck: MintCheck,
  quoteMint: string = DEFAULT_QUOTE,
): Assessment {
  const decoded = decodeAll([...txs], trade.wallet)
  const mined = mine(fifoLedger(decoded.swaps).closedTrades, quoteMint)

  const verdict = checkTrade(
    { wallet: trade.wallet, mint: trade.mint, side: trade.side, size: trade.size },
    {
      mint: mintCheck,
      rules: mined.rules,
      quote: null,
      jev: null,
      spendAsset: SOL,
      categoryMix: null,
      ruleVersion: mintCheck.ruleVersion,
    },
  )

  return { verdict, closedTrades: mined.metrics.closedTrades, rules: mined.rules }
}
