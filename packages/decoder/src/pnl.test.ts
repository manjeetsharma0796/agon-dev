import { describe, expect, test } from 'vitest'
import type { Swap } from './index.js'
import { fifoLedger, openPositions } from './pnl.js'

// monad T3.7 shipped "positions" that were trade flow, off by 67x, which is this task's kill
// criterion. So these tests are as much about what each number is called as what it equals: a
// field named `realisedPnl` that holds proceeds, or `closedTrades` that counts legs, is the bug.

const SOL = 'So11111111111111111111111111111111111111112'
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'
const WIF = 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm'

let n = 0
const buy = (mint: string, amount: string, quote: string, cost: string, slot = ++n): Swap => ({
  kind: 'swap',
  signature: `buy-${mint.slice(0, 4)}-${slot}`,
  slot,
  side: 'buy',
  soldMint: quote,
  soldAmount: cost,
  boughtMint: mint,
  boughtAmount: amount,
})
const sell = (mint: string, amount: string, quote: string, proceeds: string, slot = ++n): Swap => ({
  kind: 'swap',
  signature: `sell-${mint.slice(0, 4)}-${slot}`,
  slot,
  side: 'sell',
  soldMint: mint,
  soldAmount: amount,
  boughtMint: quote,
  boughtAmount: proceeds,
})

test('a round trip realises proceeds minus what those units cost', () => {
  const led = fifoLedger([buy(BONK, '1000', SOL, '100'), sell(BONK, '1000', SOL, '150')])
  expect(led.closedTrades).toHaveLength(1)
  expect(led.closedTrades[0]?.costBasis).toBe('100')
  expect(led.closedTrades[0]?.proceeds).toBe('150')
  expect(led.closedTrades[0]?.realisedPnl).toBe('50')
  expect(led.realisedPnlByQuote[SOL]).toBe('50')
})

test('FIFO means the oldest lot goes first, not the cheapest', () => {
  // Buy 100 at 10, then 100 at 90. Sell 100. FIFO realises against the 10, not an average of 50
  // and not the 90. Getting this wrong is invisible until someone checks one wallet by hand.
  const led = fifoLedger([
    buy(BONK, '100', SOL, '10'),
    buy(BONK, '100', SOL, '90'),
    sell(BONK, '100', SOL, '60'),
  ])
  expect(led.closedTrades[0]?.costBasis).toBe('10')
  expect(led.closedTrades[0]?.realisedPnl).toBe('50')
  expect(led.openLots).toHaveLength(1)
  expect(led.openLots[0]?.costBasis).toBe('90')
})

test('a partial sell consumes part of a lot and leaves the rest open', () => {
  const led = fifoLedger([buy(BONK, '1000', SOL, '400'), sell(BONK, '250', SOL, '150')])
  expect(led.closedTrades[0]?.costBasis).toBe('100')
  expect(led.closedTrades[0]?.realisedPnl).toBe('50')
  expect(led.openLots[0]?.amount).toBe('750')
  expect(led.openLots[0]?.costBasis).toBe('300')
})

test('one sell across two lots is one closed trade, not two, so nothing double counts', () => {
  // The acceptance says decoded events must match unique signature and leg counts. A sell that
  // eats 2 lots is still 1 trade the user made.
  const led = fifoLedger([
    buy(BONK, '100', SOL, '10'),
    buy(BONK, '100', SOL, '30'),
    sell(BONK, '200', SOL, '100'),
  ])
  expect(led.closedTrades).toHaveLength(1)
  expect(led.closedTrades[0]?.costBasis).toBe('40')
  expect(led.closedTrades[0]?.realisedPnl).toBe('60')
})

test('base units are exact past 2^53, because this is money', () => {
  // 9007199254740993 is Number.MAX_SAFE_INTEGER + 2. Anything doing this in floats loses it.
  const led = fifoLedger([
    buy(BONK, '1', SOL, '9007199254740993'),
    sell(BONK, '1', SOL, '9007199254740995'),
  ])
  expect(led.closedTrades[0]?.realisedPnl).toBe('2')
})

test('selling more than the lots hold is an exception, not a silent zero', () => {
  // Real and common: the wallet was airdropped the token, or received it by transfer, so the buy
  // is not in the decoded history. Realising the whole sale as profit would invent P&L.
  const led = fifoLedger([buy(BONK, '100', SOL, '10'), sell(BONK, '500', SOL, '200')])
  expect(led.exceptions.map((e) => e.kind)).toContain('sold-more-than-held')
  expect(led.closedTrades[0]?.soldAmount, 'only the units we have a cost for are closed').toBe(
    '100',
  )
  expect(led.closedTrades[0]?.realisedPnl).toBe('30')
})

test('a position bought in SOL and sold for USDC is not subtracted across currencies', () => {
  // 150 USDC minus 100 SOL is not 50 of anything. Without a price at the fill there is no honest
  // number here, so it is an exception and the lot stays open rather than a fabricated profit.
  const led = fifoLedger([buy(BONK, '1000', SOL, '100'), sell(BONK, '1000', USDC, '150')])
  expect(led.exceptions.map((e) => e.kind)).toContain('quote-mismatch')
  expect(led.closedTrades).toHaveLength(0)
  expect(led.realisedPnlByQuote[SOL]).toBeUndefined()
  expect(led.realisedPnlByQuote[USDC]).toBeUndefined()
})

test('open lots are not realised P&L, however far up they are', () => {
  const led = fifoLedger([buy(BONK, '1000', SOL, '100')])
  expect(led.closedTrades).toHaveLength(0)
  expect(led.realisedPnlByQuote[SOL]).toBeUndefined()
  expect(led.openLots).toHaveLength(1)
})

test('the same signature twice is counted once', () => {
  const one = buy(BONK, '100', SOL, '10')
  const led = fifoLedger([one, one, sell(BONK, '100', SOL, '20')])
  expect(led.exceptions.map((e) => e.kind)).toContain('duplicate-signature')
  expect(led.closedTrades[0]?.costBasis).toBe('10')
  expect(led.openLots).toHaveLength(0)
})

test('two mints keep separate lots, and P&L sums per quote', () => {
  const led = fifoLedger([
    buy(BONK, '100', SOL, '10'),
    buy(WIF, '100', SOL, '20'),
    sell(BONK, '100', SOL, '30'),
    sell(WIF, '100', SOL, '25'),
  ])
  expect(led.closedTrades).toHaveLength(2)
  expect(led.realisedPnlByQuote[SOL]).toBe('25')
})

test('swaps are read in slot order, whatever order they arrive in', () => {
  const b1 = buy(BONK, '100', SOL, '10', 10)
  const b2 = buy(BONK, '100', SOL, '90', 20)
  const s = sell(BONK, '100', SOL, '60', 30)
  expect(fifoLedger([s, b2, b1]).closedTrades[0]?.costBasis).toBe('10')
})

describe('field names say what the value is', () => {
  test('closedTrades counts trades closed, not legs and not signatures', () => {
    const led = fifoLedger([
      buy(BONK, '100', SOL, '10'),
      buy(BONK, '100', SOL, '10'),
      sell(BONK, '200', SOL, '100'),
    ])
    expect(led.closedTrades).toHaveLength(1)
  })
})

test('cost is conserved across many partial sells, so no basis leaks to rounding', () => {
  // Apportioning a lot's cost by amount uses integer division, which truncates. Recomputing the
  // remainder from the original numbers would drop those truncated units on every partial sell and
  // the loss would look like rounding while quietly inflating P&L. Subtracting what was taken puts
  // the remainder back into the lot instead. Measured: 333 partial sells of an awkward size, 0 lost.
  const swaps: Swap[] = [buy(BONK, '333333333', SOL, '1000000001', 1)]
  for (let i = 0; i < 333; i++) swaps.push(sell(BONK, '1000001', SOL, '3000000', 2 + i))
  const led = fifoLedger(swaps)

  const closed = led.closedTrades.reduce((a, t) => a + BigInt(t.costBasis), 0n)
  const open = led.openLots.reduce((a, l) => a + BigInt(l.costBasis), 0n)
  expect(led.closedTrades).toHaveLength(333)
  expect(led.exceptions).toEqual([])
  expect(
    (closed + open).toString(),
    'basis leaked between the closed trades and the open lot',
  ).toBe('1000000001')
})

test('a lot bought in another currency does not freeze the rest of the mint forever', () => {
  // The bug this test exists for: lots were queued per mint, so a SOL bought lot sat at the head
  // of the queue and every later USDC sale hit it and stopped. One cross currency buy silently
  // zeroed that mint's P&L for good, and the user was told they had made nothing.
  const led = fifoLedger([
    buy(BONK, '100', SOL, '1000000000'),
    buy(BONK, '100', USDC, '50000000'),
    sell(BONK, '100', USDC, '60000000'),
    sell(BONK, '100', USDC, '70000000'),
  ])

  // The USDC lot closes against the USDC sale, which is the whole point.
  expect(led.closedTrades, 'the matchable lot must still close').toHaveLength(1)
  expect(led.realisedPnlByQuote[USDC]).toBe('10000000')

  // The SOL bought lot stays open, because converting it still needs a price at the fill.
  expect(led.openLots).toHaveLength(1)
  expect(led.openLots[0]?.quoteMint).toBe(SOL)

  // And the second sale says why, naming the currency rather than implying the units were free.
  const mismatch = led.exceptions.find((e) => e.kind === 'quote-mismatch')
  expect(mismatch?.detail).toContain('bought with')
  expect(led.exceptions.some((e) => e.kind === 'sold-more-than-held')).toBe(false)
})

// ---- A vault's P&L: wSOL is the only quote, so USDC is a position like any other. ----

describe('a vault ledger in SOL, where USDC is a position like any other', () => {
  const ONLY_SOL = [SOL]

  test('a buy then a partial sell: realised is exact, the rest stays open at its cost', () => {
    // 1 SOL buys 100 USDC; 50 USDC sells for 0.6 SOL, so the 50 sold cost 0.5 and realised 0.1.
    const ledger = fifoLedger(
      [buy(USDC, '100000000', SOL, '1000000000'), sell(USDC, '50000000', SOL, '600000000')],
      ONLY_SOL,
    )
    expect(ledger.realisedPnlByQuote[SOL]).toBe('100000000')
    expect(openPositions(ledger.openLots)).toEqual([
      { mint: USDC, quoteMint: SOL, amount: '50000000', costBasis: '500000000' },
    ])
  })

  test('a sell with no buy recorded counts nothing it cannot match, and says so', () => {
    const ledger = fifoLedger([sell(BONK, '1000', SOL, '5000')], ONLY_SOL)
    expect(ledger.realisedPnlByQuote[SOL] ?? '0').toBe('0')
    expect(ledger.exceptions.map((e) => e.kind)).toEqual(['sold-more-than-held'])
  })

  test('lots of 1 mint add up into 1 position, and 2 mints stay 2', () => {
    const ledger = fifoLedger(
      [
        buy(USDC, '10000000', SOL, '100000000'),
        buy(USDC, '30000000', SOL, '250000000'),
        buy(WIF, '7000', SOL, '20000000'),
      ],
      ONLY_SOL,
    )
    expect(openPositions(ledger.openLots).map((p) => [p.mint, p.amount, p.costBasis])).toEqual([
      [USDC, '40000000', '350000000'],
      [WIF, '7000', '20000000'],
    ])
  })

  test('the same mint against 2 quotes is 2 positions, never 1 sum of 2 currencies', () => {
    const ledger = fifoLedger([
      buy(BONK, '1000', SOL, '1000000000'),
      buy(BONK, '500', USDC, '2000000'),
    ])
    expect(openPositions(ledger.openLots).map((p) => [p.quoteMint, p.amount])).toEqual([
      [SOL, '1000'],
      [USDC, '500'],
    ])
  })

  test('a loss is negative, never clamped', () => {
    const ledger = fifoLedger(
      [buy(BONK, '1000', SOL, '1000000000'), sell(BONK, '1000', SOL, '400000000')],
      ONLY_SOL,
    )
    expect(ledger.realisedPnlByQuote[SOL]).toBe('-600000000')
    expect(openPositions(ledger.openLots)).toEqual([])
  })
})
