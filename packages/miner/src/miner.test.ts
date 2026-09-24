import { describe, expect, test } from 'vitest'
import { MinedRule, Metrics } from '@agon/core'
import type { ClosedTrade } from '@agon/decoder'
import { STOP_MIN_LOSSES, STOP_MIN_TRADES, mine } from './miner.js'

const SOL = 'So11111111111111111111111111111111111111112'
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'

/** A closed trade that cost `cost` and returned `cost * (1 + pct/100)`, held `slots`. */
const trade = (i: number, cost: bigint, pct: number, slots = 100, quoteMint = SOL): ClosedTrade => {
  const proceeds = (cost * BigInt(Math.round((100 + pct) * 1000))) / 100000n
  return {
    mint: BONK,
    quoteMint,
    soldAmount: '1000',
    costBasis: cost.toString(),
    proceeds: proceeds.toString(),
    realisedPnl: (proceeds - cost).toString(),
    openedSlot: i * 1000,
    closedSlot: i * 1000 + slots,
    closedBySignature: `sig-${i}`,
  }
}

/** `n` trades, every loser at `stopPct`, winners mixed in so the sample is not all losses. */
const walletWithStop = (n: number, stopPct: number): ClosedTrade[] =>
  Array.from({ length: n }, (_, i) =>
    i % 2 === 0 ? trade(i, 1_000_000n, stopPct) : trade(i, 1_000_000n, 12 + (i % 5)),
  )

test('a planted stop is found within 1 percentage point', () => {
  const rules = mine(walletWithStop(30, -8), SOL).rules
  const stop = rules.find((r) => r.kind === 'stop')
  expect(stop?.found).toBe(true)
  expect(Math.abs((stop?.value ?? 0) - -8)).toBeLessThanOrEqual(1)
})

test('a planted stop is found within 1 point even with noise around it', () => {
  const noisy = Array.from({ length: 30 }, (_, i) =>
    i % 2 === 0 ? trade(i, 1_000_000n, -8 + ((i % 3) - 1) * 0.5) : trade(i, 1_000_000n, 15),
  )
  const stop = mine(noisy, SOL).rules.find((r) => r.kind === 'stop')
  expect(stop?.found).toBe(true)
  expect(Math.abs((stop?.value ?? 0) - -8)).toBeLessThanOrEqual(1)
})

test('scattered losses are said to be no rule, not averaged into one', () => {
  // Losses at 2, 9, 16, 23 ... percent. A median exists; a habit does not. Reporting the median
  // here would tell somebody they have a 20% stop when they have never used one.
  const scattered = Array.from({ length: 30 }, (_, i) =>
    i % 2 === 0 ? trade(i, 1_000_000n, -(2 + i * 1.5)) : trade(i, 1_000_000n, 15),
  )
  const stop = mine(scattered, SOL).rules.find((r) => r.kind === 'stop')
  expect(stop?.found).toBe(false)
  expect(stop?.value).toBeNull()
  expect(stop?.reason).toBe('no consistent stop rule')
})

test('under 20 closed trades it says so in the words the acceptance fixes', () => {
  const stop = mine(walletWithStop(12, -8), SOL).rules.find((r) => r.kind === 'stop')
  expect(stop?.found).toBe(false)
  expect(stop?.reason).toBe(
    '12 closed trades. A stop rule needs 20; sizing and hold time are shown',
  )
  expect(stop?.sampleSize).toBe(12)
  expect(stop?.requiredSampleSize).toBe(STOP_MIN_TRADES)
})

test('and sizing and hold time really are shown below 20, not just promised', () => {
  const { rules, metrics } = mine(walletWithStop(12, -8), SOL)
  expect(rules.find((r) => r.kind === 'size')?.found).toBe(true)
  expect(rules.find((r) => r.kind === 'hold')?.found).toBe(true)
  expect(metrics.closedTrades).toBe(12)
  expect(BigInt(metrics.medianSize)).toBeGreaterThan(0n)
})

test('20 closed trades with too few losses is not a stop rule', () => {
  // 20 trades and 2 losses is not a habit, whatever the 2 agree on.
  const mostlyWins = Array.from({ length: 20 }, (_, i) =>
    i < 2 ? trade(i, 1_000_000n, -8) : trade(i, 1_000_000n, 14),
  )
  const stop = mine(mostlyWins, SOL).rules.find((r) => r.kind === 'stop')
  expect(stop?.found).toBe(false)
  expect(stop?.reason).toContain(`${STOP_MIN_LOSSES}`)
})

test('every rule satisfies the frozen contract, found or not', () => {
  for (const trades of [walletWithStop(30, -8), walletWithStop(12, -8), []]) {
    for (const rule of mine(trades, SOL).rules) {
      expect(() => MinedRule.parse(rule), JSON.stringify(rule)).not.toThrow()
    }
    expect(() => Metrics.parse(mine(trades, SOL).metrics)).not.toThrow()
  }
})

test('output is byte identical across 2 runs on the same input', () => {
  const trades = walletWithStop(30, -8)
  expect(JSON.stringify(mine(trades, SOL))).toBe(JSON.stringify(mine(trades, SOL)))
})

test('only the asked-for quote is counted, because SOL and USDC do not add', () => {
  // T-A02 keeps realised P&L per quote for this reason. Metrics.realisedPnl is 1 signed number, so
  // the quote has to be chosen by the caller rather than silently summed here.
  const mixed = [...walletWithStop(20, -8), trade(99, 5_000_000n, 40, 100, USDC)]
  const solOnly = mine(mixed, SOL)
  expect(solOnly.metrics.closedTrades).toBe(20)
  expect(solOnly.metrics.realisedPnl).toBe(mine(walletWithStop(20, -8), SOL).metrics.realisedPnl)
})

test('an empty history is 0 trades and 3 unfound rules, not an error', () => {
  const { metrics, rules } = mine([], SOL)
  expect(metrics.closedTrades).toBe(0)
  expect(metrics.realisedPnl).toBe('0')
  expect(rules).toHaveLength(3)
  expect(rules.every((r) => !r.found)).toBe(true)
})

describe('hold time', () => {
  test('is derived from slots and says so by being a whole number of seconds', () => {
    const { metrics } = mine(walletWithStop(20, -8), SOL)
    // 100 slots at 400 ms is 40 s.
    expect(metrics.medianHoldSeconds).toBe(40)
  })
})
