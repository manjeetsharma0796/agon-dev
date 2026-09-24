// `agon report <wallet>`. The end to end slice: every layer, once, in one command.
//
// One command, every layer once: read a real wallet's transactions, decode its swaps from balance
// changes, build the FIFO ledger, mine the rules, and print what this wallet actually does. Until
// this ran, roughly 9,000 lines were each tested alone and no path had ever been walked end to end.
//
// Chain access is injected, the same way `revoke` does it, so the whole read is testable against
// recorded fixtures with no key and no network.

import { decodeAll, fifoLedger, type RawTransaction } from '@agon/decoder'
import { mine } from '@agon/miner'

export interface ReportIo {
  /** Every transaction this wallet signed, newest first, as the RPC returns them. */
  loadTransactions(wallet: string): Promise<RawTransaction[]>
}

/** SOL. The quote a report is denominated in, because P&L is per quote and never summed across. */
const DEFAULT_QUOTE = 'So11111111111111111111111111111111111111112'

/**
 * The whole slice as a pure function: transactions in, the lines a user reads out.
 *
 * Pure so the path can be tested against recorded fixtures, and so the same numbers appear in the
 * report, the benchmark and a replayed test rather than being recomputed differently in each.
 */
export function reportLines(
  txs: readonly RawTransaction[],
  wallet: string,
  quoteMint: string = DEFAULT_QUOTE,
): string[] {
  const decoded = decodeAll([...txs], wallet)
  const ledger = fifoLedger(decoded.swaps)
  const mined = mine(ledger.closedTrades, quoteMint)

  const lines = [
    `Wallet ${wallet}`,
    `Read ${txs.length} transactions. Decoded ${decoded.coverage.decodedSwaps} of ` +
      `${decoded.coverage.totalSwaps} swaps, ${Math.round(decoded.coverage.share * 100)}%.`,
  ]

  // Never a bare count. A share with no denominator is a claim, and an unsupported list with no
  // reason is a silent drop wearing a number.
  for (const u of decoded.unsupported) {
    lines.push(`  Not decoded: ${u.count} from ${u.programId}. ${u.reason}.`)
  }

  lines.push(
    `Closed trades ${mined.metrics.closedTrades}, median size ${mined.metrics.medianSize} base ` +
      `units, median hold ${mined.metrics.medianHoldSeconds}s, realised ${mined.metrics.realisedPnl}.`,
  )

  for (const rule of mined.rules) {
    lines.push(
      rule.found
        ? `  ${rule.kind}: ${String(rule.value)} (from ${rule.sampleSize} trades)`
        : `  ${rule.kind}: no rule. ${rule.reason ?? ''}`,
    )
  }

  // Exceptions are part of the answer, not a footnote: each is P&L the ledger refused to guess. But
  // a line each buries the report on any real wallet, so they are counted by kind and one is shown
  // in full. The count is the honest part; the example is what makes it legible.
  const byKind = new Map<string, { count: number; first: string }>()
  for (const e of ledger.exceptions) {
    const seen = byKind.get(e.kind)
    if (seen) seen.count += 1
    else byKind.set(e.kind, { count: 1, first: e.detail })
  }
  for (const [kind, { count, first }] of byKind) {
    lines.push(`  ${kind}, ${count} time${count === 1 ? '' : 's'}. For example: ${first}`)
  }

  if (ledger.openLots.length > 0) {
    lines.push(`  ${ledger.openLots.length} lots still open. Open lots are not realised P&L.`)
  }

  return lines
}

export async function runReport(argv: readonly string[], io: ReportIo): Promise<number> {
  const wallet = argv[0]
  if (wallet === undefined || wallet.length === 0) {
    console.error('usage: agon report <wallet>. A wallet address is required, and is not guessed.')
    return 2
  }

  let txs: RawTransaction[]
  try {
    txs = await io.loadTransactions(wallet)
  } catch (error) {
    // Analytics fail open, but they always state what they are based on, and "based on nothing"
    // is not a report.
    console.error(
      `Could not read this wallet's history, so there is no report to show. ` +
        `Reason: ${error instanceof Error ? error.message : String(error)}.`,
    )
    return 1
  }

  if (txs.length === 0) {
    console.log(`Wallet ${wallet}`)
    console.log('0 transactions read. There is no history here to mine, so no rule is claimed.')
    return 0
  }

  for (const line of reportLines(txs, wallet)) console.log(line)
  return 0
}
