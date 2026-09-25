// `agon check <wallet> <mint> <buy|sell> <size>`. The other half of the end to end slice.
//
// `agon report` proved the read path: transactions in, mined rules out. This proves the path that
// matters, the one that can stop a trade. It mines the wallet's own rules from its own history and
// then asks the guard about a trade nobody has made yet, and prints the refusal with the numbers
// behind it.
//
// Deliberately arithmetic only. The quote and the Jev screen are both passed as null, which is the
// guard's documented fast path: a `block` that comes back this way was reached by comparing numbers
// to this wallet's own history and nothing else. That is worth showing on its own, because it is
// the claim the product makes. It also means this command asks a model nothing and costs nothing.
//
// The consequence, stated rather than hidden: with no quote and no screen this command can never
// print `pass`. Unscreened text is `unsure`, and `unsure` is not a soft pass. A trade that clears
// the arithmetic still says so as `unsure`, and names what was not read.

import type { RawTransaction } from '@agon/decoder'
import { assessTrade, DEFAULT_QUOTE, type MintCheck, type ProposedTrade } from '@agon/guard'

import type { ReportIo } from './report.js'

export interface CheckIo extends ReportIo {
  /** Reads the mint's authorities off the chain. Fails closed, and the guard treats it that way. */
  loadMintCheck(mint: string): Promise<MintCheck>
}

/**
 * The whole check as a pure function: a history and a proposed trade in, the lines a user reads out.
 *
 * Pure for the same reason `reportLines` is: the benchmark, a replayed test and the command itself
 * then produce the same verdict from the same data, rather than each composing the guard slightly
 * differently.
 */
export function checkLines(
  txs: readonly RawTransaction[],
  trade: ProposedTrade,
  mintCheck: MintCheck,
  quoteMint: string = DEFAULT_QUOTE,
): { verdict: 'pass' | 'block' | 'unsure'; lines: string[] } {
  const { verdict: out, closedTrades, rules } = assessTrade(txs, trade, mintCheck, quoteMint)

  const lines = [
    `Wallet ${trade.wallet}`,
    `Mined from ${closedTrades} closed trades: ` +
      rules.map((r) => `${r.kind} ${r.found ? String(r.value) : 'none'}`).join(', '),
    `Proposed: ${trade.side} ${trade.size} base units of ${trade.mint}`,
    '',
    `Verdict: ${out.verdict}`,
  ]

  // Never a bare verdict. A refusal with no reason is the failure mode this whole command exists to
  // rule out, so every reason is printed, with its numbers when the rule is arithmetic.
  for (const r of out.reasons) {
    const numbers =
      r.observed !== undefined && r.limit !== undefined && r.unit !== undefined
        ? ` (${r.observed} against ${r.limit} ${r.unit})`
        : ''
    lines.push(`  ${r.rule}: ${r.message}${numbers}`)
  }

  lines.push('', `Stamped ${out.ruleVersion} at slot ${String(out.dataSlot)}.`)
  return { verdict: out.verdict, lines }
}

export async function runCheck(argv: readonly string[], io: CheckIo): Promise<number> {
  const [wallet, mint, side, size] = argv
  if (
    wallet === undefined ||
    mint === undefined ||
    (side !== 'buy' && side !== 'sell') ||
    size === undefined ||
    !/^[0-9]+$/.test(size)
  ) {
    console.error(
      'usage: agon check <wallet> <mint> <buy|sell> <size-in-base-units>. None of the four are ' +
        'guessed: the size is base units, not a decimal amount, because rounding a size is how a ' +
        'cap gets tested against a number the user never asked for.',
    )
    return 2
  }

  let txs: RawTransaction[]
  let mintCheck: MintCheck
  try {
    // Sequential, not parallel: on a wallet we cannot read there is nothing to check the mint
    // against, and a second call would be spent to print the same refusal.
    txs = await io.loadTransactions(wallet)
    mintCheck = await io.loadMintCheck(mint)
  } catch (error) {
    // Anything that can move funds fails closed. A check that could not read is a block, and it
    // says which read failed rather than returning a verdict nothing stands behind.
    console.error(
      `Blocked: could not run the check, so this trade does not go out. ` +
        `Reason: ${error instanceof Error ? error.message : String(error)}.`,
    )
    return 1
  }

  if (txs.length === 0) {
    console.error(
      `Blocked: 0 transactions read for ${wallet}, so there are no rules of its own to check ` +
        `this trade against. Trade from a wallet with history, or arm a rule by hand.`,
    )
    return 1
  }

  const { verdict, lines } = checkLines(txs, { wallet, mint, side, size }, mintCheck)
  for (const line of lines) console.log(line)
  // Non-zero on anything that is not a pass, so a script wiring this in cannot read a refusal as
  // success. `unsure` exits non-zero with `block`, because `unsure` is not a soft pass: the two
  // differ in what the user is told, not in whether the trade goes out.
  return verdict === 'pass' ? 0 : 1
}
