// check_trade: arithmetic first, a model only for the 3 non-numeric questions. Owned by T-C06.
//
// Pure. Plain data in, a verdict out, 0 network calls, so the MCP server, the API route, benchmark
// B and a replayed test all run this same function and cannot answer differently.
//
// The 3 reads it consumes are the 3 the PRD budgets: 1 account batch (`checkMints`), 1 quote, 1
// Jev call (`ask`). The caller makes them; this file only composes what came back.
//
// The fast path, which is the whole point of "0 model calls when all guards resolve
// arithmetically", is 2 calls to this same function and no extra API:
//
//   const first = checkTrade(input, { ...facts, jev: null })
//   if (first.verdict === 'block') return first   // the numbers decided; no Jev call was made
//   return checkTrade(input, { ...facts, jev: await ask(...) })
//
// With `jev: null` nothing here reads a model answer, so a block from that call is arithmetic and
// a chain read alone. It is never a pass: text nobody screened is `unsure`, and `unsure` is not a
// soft pass.
//
// Every check whose input is missing is `unsure`, not `pass`. That is the one rule to remember
// here, and it has exactly one exception: a trade that names no stop has no stop to compare, which
// is not the same as a fact we failed to fetch.

import {
  CheckTradeInput,
  CheckTradeOutput,
  tooLittleHistory,
  type MinedRule,
  type Reason,
  type Verdict,
} from '@agon/core'
import type { JevVerdict, TokenCategory } from './jev/index.js'
import type { MintCheck } from './mint-check.js'

/** Stamped onto every verdict beside the mined profile's version. Not exported: it is already in
 *  every output's `ruleVersion`, so nothing outside needs to read it separately. */
const RULE_VERSION = 'check-trade/1'

/**
 * Every threshold, in one place, each with where its number comes from. A limit invented here
 * would be a rule the user never had, presented with the authority of their own history.
 */
export const LIMITS = {
  /**
   * How many times the wallet's own median size a single trade may be. 2 is the limit written into
   * the frozen contract's own example, `fixtures/contracts/check-trade-output.json`.
   */
  sizeMultiple: 2,
  /**
   * How far this route may move the price, in percent. The PRD's 1% band, the same band its
   * failure table quotes as "beyond your 1% band".
   */
  priceBandPct: 1,
  /** How much worse than quoted the fill may land. The same 1% band, in basis points. */
  slippageBps: 100,
} as const

/**
 * How far from the wallet's usual stop a proposed stop may sit and still be the same habit, in
 * percentage points.
 *
 * This is the miner's `STOP_MAX_MAD_POINTS`. The miner calls a set of losses one habit when they
 * sit within 2 points of their median; a stop further out than that is, by that same definition,
 * not this wallet's habit. The two are one number and have to move together, and they are written
 * twice rather than shared because the guard does not otherwise depend on the miner.
 */
export const STOP_TOLERANCE_POINTS = 2

/** The asset `size` is counted in: the quote asset on a buy, the mint on a sell. */
export interface SpendAsset {
  symbol: string
  decimals: number
}

/** The 3 fields of a Jupiter quote the arithmetic reads. The rest of the response is not used. */
export interface Quote {
  /** Jupiter's price impact for this route, a fraction carried as a string. */
  priceImpactPct: string
  /** The slippage this route was quoted with, in basis points. */
  slippageBps: number
  /** The slot the quote was taken at, or null when the response carried none. */
  contextSlot: number | null
}

/** Everything the caller fetched, as plain data. Null means "not read", never "fine". */
export interface TradeFacts {
  /** From `checkMints()`. Categorical and already fails closed. */
  mint: MintCheck
  /** From `mine()`: stop, size and hold. An unfound rule has no limit, so it cannot be checked. */
  rules: readonly MinedRule[]
  quote: Quote | null
  /** From `ask()`. Null when no Jev call was made, which is the fast path above. */
  jev: JevVerdict | null
  spendAsset: SpendAsset
  /** The share of this wallet's closed trades in each token category. */
  categoryMix: Partial<Record<TokenCategory, number>> | null
  /** The stop the trade proposes, as a positive percentage, the miner's sign convention. */
  proposedStopPct?: number
  /** The mined profile behind `rules`, stamped onto the verdict beside this file's version. */
  ruleVersion: string
}

type Severity = 'block' | 'unsure' | 'note'
interface Finding {
  severity: Severity
  reason: Reason
}

const block = (reason: Reason): Finding => ({ severity: 'block', reason })
const unsure = (rule: string, message: string): Finding => ({
  severity: 'unsure',
  reason: { rule, message },
})

/** Base units as the user counts them. 800000000 lamports reads back as "0.8 SOL". */
const human = (baseUnits: number, asset: SpendAsset): string =>
  `${Number((baseUnits / 10 ** asset.decimals).toPrecision(3))} ${asset.symbol}`

const round = (n: number, places: number): number => {
  const scale = 10 ** places
  return Math.round(n * scale) / scale
}

/**
 * A number past its limit, rounded for a person to read, with as many places as it takes to still
 * read as past the limit. 2.025 against a limit of 2 is shown as 2.03, never as 2: a message that
 * says "2x, past your 2x limit" is a refusal the user cannot make sense of.
 */
const shownPast = (value: number, limit: number, places: number): number => {
  for (let p = places; p < 6; p++) if (round(value, p) > limit) return round(value, p)
  return value
}

const ruleOf = (rules: readonly MinedRule[], kind: MinedRule['kind']): MinedRule | undefined =>
  rules.find((r) => r.kind === kind)

/**
 * Size against the wallet's own median, on a buy only.
 *
 * `medianSize` is the median cost basis, counted in the quote asset. A sell's `size` is counted in
 * the mint's own base units, so comparing the two is a unit error that would read as a 50x rule
 * break on an ordinary exit. The guard also does not stand between a user and the exit: selling
 * reduces exposure, which is the direction every rule here exists to push.
 */
const sizeFinding = (
  size: number,
  rules: readonly MinedRule[],
  asset: SpendAsset,
): Finding | null => {
  const mined = ruleOf(rules, 'size')
  if (mined === undefined || !mined.found || mined.value === null || mined.value <= 0) {
    return unsure(
      'size-rule-missing',
      `No median trade size for this wallet yet: ${mined?.sampleSize ?? 0} closed trades read, ` +
        `and sizing needs ${mined?.requiredSampleSize ?? 1}. Run a report on a wallet with more ` +
        `history, or set a size cap yourself.`,
    )
  }
  // Compared unrounded. Rounding first let 2.025x read as 2x and pass a 2x limit (found by F4).
  const ratio = size / mined.value
  if (ratio <= LIMITS.sizeMultiple) return null
  const multiple = shownPast(ratio, LIMITS.sizeMultiple, 1)
  return block({
    rule: 'size-vs-median',
    message:
      `${multiple}x your median size of ${human(mined.value, asset)}, past your ` +
      `${LIMITS.sizeMultiple}x limit. Send ${human(mined.value * LIMITS.sizeMultiple, asset)} or less.`,
    observed: multiple,
    limit: LIMITS.sizeMultiple,
    unit: 'x-median',
  })
}

/** The proposed stop against the mined one. Only runs when the trade actually names a stop. */
const stopFinding = (proposed: number | undefined, rules: readonly MinedRule[]): Finding | null => {
  if (proposed === undefined) return null
  const mined = ruleOf(rules, 'stop')
  if (mined === undefined || !mined.found || mined.value === null) {
    const m = tooLittleHistory({
      closedTrades: mined?.sampleSize ?? 0,
      needed: mined?.requiredSampleSize ?? 20,
      shown: ['sizing', 'hold time'],
    })
    return unsure(
      'stop-rule-missing',
      `${m.text} So a ${proposed}% stop could not be compared to anything.`,
    )
  }
  const limit = round(mined.value + STOP_TOLERANCE_POINTS, 2)
  if (proposed <= limit) return null
  return block({
    rule: 'stop-vs-usual',
    message:
      `A ${proposed}% stop, past your ${limit}% limit; you cut at ${mined.value}%. ` +
      `Set ${limit}% or closer.`,
    observed: proposed,
    limit,
    unit: '%',
  })
}

/**
 * The price band, arithmetic over the 1 quote the caller took.
 *
 * With a single quote the distance between the price the user gets and the price the market is at
 * is the route's own price impact, so that is the number compared to the band and the number the
 * message names. The other band, a quote that moves between the check and the submit, is the
 * daemon's and belongs to T-C08: this verdict is stamped with the quote's slot so the daemon can
 * tell that it moved.
 */
const bandFinding = (quote: Quote): Finding | null => {
  const raw = Number(quote.priceImpactPct) * 100
  if (!Number.isFinite(raw)) {
    return unsure(
      'price-band-unreadable',
      `The quote reported its price impact as "${quote.priceImpactPct}", which is not a number, ` +
        `so how far this fill sits from the market is unknown. Ask for a fresh quote.`,
    )
  }
  // Compared unrounded, for the same reason as size: 1.004% must not read as 1% and pass.
  if (raw <= LIMITS.priceBandPct) return null
  const impact = shownPast(raw, LIMITS.priceBandPct, 2)
  return block({
    rule: 'price-band',
    message: `Price impact ${impact}%, past your ${LIMITS.priceBandPct}% band. Trade smaller.`,
    observed: impact,
    limit: LIMITS.priceBandPct,
    unit: '%',
  })
}

const slippageFinding = (quote: Quote): Finding | null => {
  if (quote.slippageBps <= LIMITS.slippageBps) return null
  return block({
    rule: 'slippage-tolerance',
    message:
      `Slippage allowed ${round(quote.slippageBps / 100, 2)}%, past your ` +
      `${LIMITS.slippageBps / 100}% band. Quote at ${LIMITS.slippageBps} bps or less.`,
    observed: quote.slippageBps,
    limit: LIMITS.slippageBps,
    unit: 'bps',
  })
}

/**
 * Style fit: arithmetic over the wallet's own category mix.
 *
 * Jev supplies only the category, which is one of the 3 non-numeric questions it is allowed. The
 * comparison is a count of the user's own trades, so no model decides it. Buys only, for the same
 * reason as size: a category you have never bought is a new risk, and a category you are selling
 * out of is the risk going away.
 */
const styleFinding = (
  category: TokenCategory | undefined,
  mix: Partial<Record<TokenCategory, number>> | null,
  rules: readonly MinedRule[],
): Finding | null => {
  // No category at all: the lookup could not place the token, or Jev's answer was not one of the
  // 6. 'other' is not this case: it is one of the 6 and scores against the mix like any other.
  if (category === undefined) {
    return unsure(
      'category-unknown',
      `This token could not be placed in a category, so it could not be checked against the ` +
        `categories you trade. Check the mint yourself before trading it.`,
    )
  }
  // Buying a stablecoin is stepping out of risk, not into a new kind of it, so style fit never
  // stops one. Size, the price band and the mint checks still apply, and a fake stablecoin is
  // caught as an impostor before this (decided 2026-09-29 on T-A05's first measurement).
  if (category === 'stablecoin') return null
  if (mix === null) {
    return unsure(
      'category-mix-missing',
      `No category mix for this wallet yet, so "do you trade this kind of token" has no answer. ` +
        `Run a report on this wallet first.`,
    )
  }
  const closedTrades = ruleOf(rules, 'size')?.sampleSize ?? 0
  const traded = Math.round((mix[category] ?? 0) * closedTrades)
  if (traded >= 1) return null
  return block({
    rule: 'style-fit',
    message:
      `0 of your ${closedTrades} closed trades are in the ${category} category. ` +
      `Trade one you already trade.`,
    observed: traded,
    limit: 1,
    unit: 'trades',
  })
}

/** The slot a verdict is only as fresh as: the stalest of the reads behind it. */
const stalestSlot = (facts: TradeFacts): number => {
  const slots = [facts.mint.dataSlot, facts.quote?.contextSlot, facts.jev?.dataSlot].filter(
    (s): s is number => typeof s === 'number',
  )
  // 0 only when nothing was read at all, which is itself a block carrying the reason that says so.
  return slots.length === 0 ? 0 : Math.min(...slots)
}

/**
 * The verdict for one proposed trade.
 *
 * `block` when the chain, the screen or one of the numbers says no. `unsure` when a check could
 * not be made, which hands back to the user with the reason and the numbers and never retries.
 * `pass` only when every check that applies actually ran and cleared.
 */
export function checkTrade(input: unknown, facts: TradeFacts): CheckTradeOutput {
  const trade = CheckTradeInput.parse(input)
  const findings: Finding[] = []

  // The chain read comes first: nothing about a wallet's habits matters if the token can take the
  // position back. The mint check already fails closed, so this trusts its verdict and not its
  // shape, after checking it is about the mint actually being traded.
  if (facts.mint.mint !== trade.mint) {
    findings.push(
      block({
        rule: 'mint-check-mismatch',
        message:
          `The token check that came back is for ${facts.mint.mint}, but this trade is for ` +
          `${trade.mint}. Not safe to proceed. Check the mint again for this trade.`,
      }),
    )
  } else {
    // Mapped rather than copied. `pass` is the only verdict that lets a mint reason through as a
    // note: anything else carries its own severity, so a mint check that grows an `unsure` answer
    // later cannot arrive here as a warning on a passing trade.
    const severity: Severity = facts.mint.verdict === 'pass' ? 'note' : facts.mint.verdict
    for (const reason of facts.mint.reasons) findings.push({ severity, reason })
    if (severity !== 'note' && facts.mint.reasons.length === 0) {
      findings.push(
        block({
          rule: 'mint-check-blocked',
          message: `The token check refused ${trade.mint} and named no reason. Not safe to proceed.`,
        }),
      )
    }
  }

  if (trade.side === 'buy') {
    const size = sizeFinding(Number(trade.size), facts.rules, facts.spendAsset)
    if (size !== null) findings.push(size)
  }

  const stop = stopFinding(facts.proposedStopPct, facts.rules)
  if (stop !== null) findings.push(stop)

  if (facts.quote === null) {
    findings.push(
      unsure(
        'quote-missing',
        `No quote was taken for this trade, so what the fill costs and how far it moves the ` +
          `price are both unknown. Not safe to proceed. Quote the route and check again.`,
      ),
    )
  } else {
    for (const f of [bandFinding(facts.quote), slippageFinding(facts.quote)]) {
      if (f !== null) findings.push(f)
    }
  }

  if (facts.jev === null) {
    // No model screen: the category comes from the mint check's lookup, and the token's
    // name and description never reach this response, so there is no outside text for an
    // instruction to hide in. That is asserted in check-trade.test.ts.
    if (trade.side === 'buy') {
      const style = styleFinding(facts.mint.category ?? undefined, facts.categoryMix, facts.rules)
      if (style !== null) findings.push(style)
    }
  } else {
    // The screen is a block and never a warning: nothing fetched can change a rule. Jev's other
    // reasons are `unsure` rather than notes, because the 2 it can raise, an impersonated token
    // and a screen that did not answer, both mean we cannot say this is the token the user meant.
    // T-C05 sets `blocked` for the injection screen alone, and turning its impersonation answer
    // into a block here would be a model deciding a trade.
    for (const reason of facts.jev.reasons) {
      findings.push({ severity: facts.jev.blocked ? 'block' : 'unsure', reason })
    }
    if (trade.side === 'buy') {
      const style = styleFinding(
        facts.jev.answers.tokenCategory?.category,
        facts.categoryMix,
        facts.rules,
      )
      if (style !== null) findings.push(style)
    }
  }

  const verdict: Verdict = findings.some((f) => f.severity === 'block')
    ? 'block'
    : findings.some((f) => f.severity === 'unsure')
      ? 'unsure'
      : 'pass'

  // What stopped the trade reads first; the facts that did not stop it read after.
  const order: Record<Severity, number> = { block: 0, unsure: 1, note: 2 }
  const reasons = [...findings]
    .sort((a, b) => order[a.severity] - order[b.severity])
    .map((f) => f.reason)

  return CheckTradeOutput.parse({
    verdict,
    reasons,
    dataSlot: stalestSlot(facts),
    ruleVersion: `${RULE_VERSION}+${facts.ruleVersion}`,
  })
}
