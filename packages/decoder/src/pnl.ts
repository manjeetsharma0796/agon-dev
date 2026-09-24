// Realised P&L, FIFO, over decoded swaps. Pure: plain data in, a ledger out, 0 network calls.
//
// Everything here is BigInt over base units. Not a style choice: a float loses the low digits of a
// lamport count above 2^53, and the loss is silent and small enough to look like rounding.
//
// The kill criterion on this task is monad T3.7, which shipped "positions" that were trade flow and
// was wrong by 67x. So the naming rule is strict: a field holds what its name says and nothing
// adjacent. `closedTrades` is trades the user closed, not legs and not signatures. `realisedPnl` is
// proceeds minus what those exact units cost, not proceeds. `openLots` is not P&L of any kind.

import { QUOTE_MINTS, type Swap } from './index.js'

/** Units of one mint acquired in one buy, and what they cost in the quote that bought them. */
export interface Lot {
  mint: string
  /** The quote this lot was bought with. A lot bought in SOL can only be closed against SOL. */
  quoteMint: string
  /** Base units of `mint` still open in this lot. */
  amount: string
  /** Base units of `quoteMint` still attributable to the open `amount`. */
  costBasis: string
  openedSlot: number
  openedBySignature: string
}

/** One sell, and the cost of the exact units it closed. One sell is one trade, across any number
 *  of lots, because that is what the person did. */
export interface ClosedTrade {
  mint: string
  quoteMint: string
  /** Base units of `mint` closed by this sell and matched to a cost. */
  soldAmount: string
  /** Base units of `quoteMint` those units cost, summed over the lots consumed. */
  costBasis: string
  /** Base units of `quoteMint` received, for the matched units only. */
  proceeds: string
  /** `proceeds` minus `costBasis`, in `quoteMint` base units. Signed. */
  realisedPnl: string
  openedSlot: number
  closedSlot: number
  closedBySignature: string
}

export type LedgerExceptionKind = 'sold-more-than-held' | 'quote-mismatch' | 'duplicate-signature'

/** Something the ledger refused to guess at. Each one costs coverage, so each one is named. */
export interface LedgerException {
  kind: LedgerExceptionKind
  signature: string
  mint: string
  /** Names the cause, the number involved, and what it means for the total. */
  detail: string
}

export interface Ledger {
  closedTrades: ClosedTrade[]
  /** Realised P&L in base units, keyed by the quote it is denominated in. Never summed across
   *  quotes: SOL and USDC are different units and adding them produces a number of nothing. */
  realisedPnlByQuote: Record<string, string>
  openLots: Lot[]
  exceptions: LedgerException[]
}

/**
 * Builds the ledger. Swaps are read in slot order whatever order they arrive in, and a repeated
 * signature is counted once.
 *
 * `quoteMints` is passed in rather than imported so a caller, or a test, can state its own set.
 */
export function fifoLedger(
  swaps: readonly Swap[],
  quoteMints: readonly string[] = QUOTE_MINTS,
): Ledger {
  const quotes = new Set(quoteMints)
  const closedTrades: ClosedTrade[] = []
  const exceptions: LedgerException[] = []
  /**
   * Open lots per mint AND quote, oldest first. FIFO is the order of this array and nothing else.
   *
   * Keyed by both because a lot bought with SOL and a lot bought with USDC are costs in different
   * currencies, and there is no fill price here to convert between them. One queue per pair means
   * a sale always meets lots it can actually be priced against. Keying by mint alone put a lot
   * that could never be matched at the head of the queue, where every later sale of that mint hit
   * it and stopped: one cross-quote buy froze the mint's P&L permanently.
   */
  const lots = new Map<string, Lot[]>()
  const queueKey = (mint: string, quote: string): string => `${mint}|${quote}`

  const seen = new Set<string>()
  const ordered = [...swaps]
    .sort((a, b) => a.slot - b.slot || a.signature.localeCompare(b.signature))
    .filter((swap) => {
      if (!seen.has(swap.signature)) {
        seen.add(swap.signature)
        return true
      }
      exceptions.push({
        kind: 'duplicate-signature',
        signature: swap.signature,
        mint: swap.side === 'buy' ? swap.boughtMint : swap.soldMint,
        detail:
          `Signature ${swap.signature} appears more than once and was counted once. Counting it ` +
          `twice would double both the position and the P&L it produces.`,
      })
      return false
    })

  for (const swap of ordered) {
    // A quote traded for a quote is moving between currencies, not opening a position in one.
    const asset = swap.side === 'buy' ? swap.boughtMint : swap.soldMint
    const quote = swap.side === 'buy' ? swap.soldMint : swap.boughtMint
    if (quotes.has(asset) || !quotes.has(quote)) continue

    const key = queueKey(asset, quote)

    if (swap.side === 'buy') {
      const open = lots.get(key) ?? []
      open.push({
        mint: asset,
        quoteMint: quote,
        amount: swap.boughtAmount,
        costBasis: swap.soldAmount,
        openedSlot: swap.slot,
        openedBySignature: swap.signature,
      })
      lots.set(key, open)
      continue
    }

    const open = lots.get(key) ?? []
    let remaining = BigInt(swap.soldAmount)
    const proceeds = BigInt(swap.boughtAmount)
    const total = remaining
    let cost = 0n
    let matched = 0n
    let openedSlot = swap.slot

    while (remaining > 0n && open.length > 0) {
      const lot = open[0] as Lot
      if (matched === 0n) openedSlot = lot.openedSlot

      const take = remaining < BigInt(lot.amount) ? remaining : BigInt(lot.amount)
      // Cost of the units taken, apportioned by amount so a partial sell carries its own share.
      const lotAmount = BigInt(lot.amount)
      const takeCost =
        take === lotAmount ? BigInt(lot.costBasis) : (BigInt(lot.costBasis) * take) / lotAmount
      cost += takeCost
      matched += take
      remaining -= take

      if (take === lotAmount) open.shift()
      else {
        lot.amount = (lotAmount - take).toString()
        lot.costBasis = (BigInt(lot.costBasis) - takeCost).toString()
      }
    }
    lots.set(key, open)

    if (remaining > 0n) {
      // Units of this mint still open, but bought with a different currency. Naming that is the
      // difference between "we cannot price this" and "you got these for free", which are very
      // different things to tell someone about their own money.
      const otherQuotes = [...lots]
        .filter(([k, v]) => k.startsWith(`${asset}|`) && k !== key && v.length > 0)
        .map(([k]) => k.split('|')[1] ?? '')
      if (otherQuotes.length > 0) {
        exceptions.push({
          kind: 'quote-mismatch',
          signature: swap.signature,
          mint: asset,
          detail:
            `Sold ${total} base units for ${quote} but ${remaining} of them were bought with ` +
            `${otherQuotes.join(' and ')}. Those units stay open, because closing them needs a ` +
            `price at the fill to convert between the two currencies and there is none here.`,
        })
      } else {
        exceptions.push({
          kind: 'sold-more-than-held',
          signature: swap.signature,
          mint: asset,
          detail:
            `Sold ${total} base units but only ${matched} have a cost in the decoded history, so ` +
            `${remaining} are unaccounted. They most often arrived by airdrop or transfer. Only the ` +
            `matched units are in the realised total, because the rest would be pure invented profit.`,
        })
      }
    }

    if (matched === 0n) continue

    // Proceeds for the matched share only, so an unaccounted remainder does not inflate the gain.
    const matchedProceeds = matched === total ? proceeds : (proceeds * matched) / total
    closedTrades.push({
      mint: asset,
      quoteMint: quote,
      soldAmount: matched.toString(),
      costBasis: cost.toString(),
      proceeds: matchedProceeds.toString(),
      realisedPnl: (matchedProceeds - cost).toString(),
      openedSlot,
      closedSlot: swap.slot,
      closedBySignature: swap.signature,
    })
  }

  const realisedPnlByQuote: Record<string, string> = {}
  for (const trade of closedTrades) {
    const running = BigInt(realisedPnlByQuote[trade.quoteMint] ?? '0') + BigInt(trade.realisedPnl)
    realisedPnlByQuote[trade.quoteMint] = running.toString()
  }

  return {
    closedTrades,
    realisedPnlByQuote,
    openLots: [...lots.values()].flat(),
    exceptions,
  }
}
