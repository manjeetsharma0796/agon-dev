import { readFileSync } from 'node:fs'
import { Overview, VaultStatus } from '@agon/core'
import { expect, test } from 'vitest'
import {
  capMeter,
  decimalOf,
  equityCurve,
  overviewRoute,
  timeWeightedReturn,
  type PriceSeries,
  type VaultHistory,
} from './overview.js'

// /overview's 3 numbers, each by arithmetic on a hand-built vault, checked against the hand
// calculation written out beside it. Pure: plain data in, the answer out, 0 network calls.

const SOL = 'So11111111111111111111111111111111111111112'
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const AGENT = '1HVWcU6i42t4hCuAUgHtoizLpXxsPxmsZnqxiTB5jYU'
const H = 3_600
/** 5 consecutive hourly buckets, b0 to b4. */
const b = (k: number) => 1_790_000_000 - (1_790_000_000 % H) + k * H
const SOLS = 1_000_000_000n

/**
 * The vault, oldest first. Every event lands 10 s into its own hour.
 *   E1 slot 100, b0: deposit 10 SOL
 *   E2 slot 200, b1: buy 500 USDC for 5 SOL (a trade, not a flow)
 *   E3 slot 300, b2: deposit 2 SOL
 *   E4 slot 400, b3: withdraw 1 SOL
 *   now slot 500, b4: holds 10 - 5 + 2 - 1 = 6 SOL and 500 USDC
 */
const history = (series: PriceSeries[], fees: bigint[] = [0n, 0n, 0n, 0n]): VaultHistory => ({
  events: [
    { signature: 'E1', slot: 100, time: b(0) + 10, deltas: new Map([[SOL, 10n * SOLS]]) },
    {
      signature: 'E2',
      slot: 200,
      time: b(1) + 10,
      deltas: new Map([
        [SOL, -5n * SOLS],
        [USDC, 500_000_000n],
      ]),
    },
    { signature: 'E3', slot: 300, time: b(2) + 10, deltas: new Map([[SOL, 2n * SOLS]]) },
    { signature: 'E4', slot: 400, time: b(3) + 10, deltas: new Map([[SOL, -1n * SOLS]]) },
  ].map((e, k) => ({ ...e, agentFee: fees[k] ?? 0n })),
  holdings: new Map([
    [SOL, 6n * SOLS],
    [USDC, 500_000_000n],
  ]),
  decimals: new Map([[USDC, 6]]),
  now: { slot: 500, time: b(4) + 10 },
  trades: 1,
  series,
})

/** Hourly closes in USD: SOL 100, 100, 125, 100, 80; USDC 1 throughout. */
const closes = (mint: string, usd: string[], drop: number[] = []): PriceSeries => ({
  mint,
  stepSeconds: H,
  source: `GeckoTerminal 1h candles, pool P-${mint.slice(0, 4)}`,
  fetchedAt: '2026-10-04T00:00:00.000Z',
  stale: null,
  error: null,
  closes: usd.map((u, k) => ({ t: b(k), usd: u })).filter((_, k) => !drop.includes(k)),
  gaps: drop.map((k) => ({
    from: b(k),
    to: b(k),
    reason: 'GeckoTerminal sent no usable candle for 1 bucket of 3600 s',
  })),
})
const SOL_USD = ['100', '100', '125', '100', '80']
const USDC_USD = ['1', '1', '1', '1', '1']

test('time-weighted return chains 3 sub-periods, 2 deposits and 1 withdrawal revalued at their own hour', () => {
  // By hand, in SOL, USDC worth 1/SOL_USD SOL:
  //   period 1, E1 to E3: starts at 10 SOL; before E3 (b2, SOL $125) 5 SOL + 500/125 = 9. r1 = 9/10
  //   period 2, E3 to E4: starts at 7 + 4 = 11; before E4 (b3, SOL $100) 7 + 500/100 = 12. r2 = 12/11
  //   period 3, E4 to now: starts at 6 + 5 = 11; now (b4, SOL $80) 6 + 500/80 = 12.25. r3 = 12.25/11
  //   chained 9/10 * 12/11 * 12.25/11 = 1323/1210 = 1.0933884, so +9.34%
  const r = timeWeightedReturn(history([closes(SOL, SOL_USD), closes(USDC, USDC_USD)]))
  expect(r.pct).toBe('9.34')
  expect(r.why).toBeNull()
  expect(r.flows).toBe(3)
  expect(r.fromSlot).toBe(100)
  expect(r.toSlot).toBe(500)
  expect(r.method).toBe(
    'In SOL; holding SOL scores 0. Net of 0 lamports of network fees paid by the agent key. ' +
      '3 deposits and withdrawals adjusted at their own slot. Slots 100 to 500.',
  )
  expect(r.sample).toBe('1 trade is too few to judge a strategy.')
  // Every price it used, with its source and the hour it is the close of.
  expect(r.prices).toContainEqual(
    expect.objectContaining({ mint: SOL, usd: '125', t: b(2), source: expect.any(String) }),
  )
})

test('holding SOL scores 0, and an agent fee is netted out of the period it was paid in', () => {
  // Only SOL deposits, never a trade: every sub-period ends where it started, so 0.00 exactly.
  const plain: VaultHistory = {
    ...history([]),
    events: [
      { signature: 'D1', slot: 10, time: b(0), deltas: new Map([[SOL, 3n * SOLS]]), agentFee: 0n },
      { signature: 'D2', slot: 20, time: b(1), deltas: new Map([[SOL, 7n * SOLS]]), agentFee: 0n },
    ],
    holdings: new Map([[SOL, 10n * SOLS]]),
    trades: 0,
  }
  expect(timeWeightedReturn(plain).pct).toBe('0.00')
  // The same vault with 0.1 SOL of fees paid by the agent key after D2: (10 - 0.1) / 10 = 0.99.
  const paid = { ...plain, events: [...plain.events] }
  paid.events.push({
    signature: 'F1',
    slot: 30,
    time: b(2),
    deltas: new Map(),
    agentFee: 100_000_000n,
  })
  const r = timeWeightedReturn(paid)
  expect(r.pct).toBe('-1.00')
  expect(r.method).toContain('Net of 100000000 lamports of network fees paid by the agent key.')
  expect(r.sample).toBe('0 trades is too few to judge a strategy.')
})

test('a missing close at a flow while a token is held makes the return null with its reason, never 0', () => {
  const r = timeWeightedReturn(history([closes(SOL, SOL_USD), closes(USDC, USDC_USD, [2])]))
  expect(r.pct).toBeNull()
  expect(r.why).toContain('EPjF..Dt1v')
  expect(r.why).toContain('slot 300')
})

test('the equity curve values each hour and leaves a missing candle as a named gap, never joined', () => {
  // Holdings at the end of each hour times that hour's close, in lamports:
  //   b0: 10 SOL (no price needed, and SOL's own candle is missing here on purpose) = 10 SOL
  //   b1: 5 SOL + 500 USDC at 1/100 = 10 SOL
  //   b2: 7 SOL + 500/125 = 11 SOL
  //   b3: 6 SOL + 500 USDC, and USDC has no candle for b3: a gap, not (11 + 12.25) / 2
  //   b4: 6 SOL + 500/80 = 12.25 SOL
  const c = equityCurve(history([closes(SOL, SOL_USD, [0]), closes(USDC, USDC_USD, [3])]))
  expect(c.points.map((p) => p.t)).toEqual([b(0), b(1), b(2), b(3), b(4)])
  expect(c.points.map((p) => p.value?.amount ?? null)).toEqual([
    '10000000000',
    '10000000000',
    '11000000000',
    null,
    '12250000000',
  ])
  expect(c.points[3]?.gap).toContain('EPjF..Dt1v')
  expect(c.points[3]?.gap).toContain('no usable candle')
  expect(c.points[4]?.value?.ui).toBe('12.25')
  expect(c.gaps).toBe(1)
  expect(c.method).toContain('never a line drawn across it')
})

test('cap used, left and refill slot per role and mint, either side of a window edge', () => {
  // 1 SOL per 150 slots, last reset at slot 300, 0.65 left. Swig refills once more than 150 slots
  // have passed, so slot 450 is still the old window and 451 the new one.
  const rule = {
    roleId: 2,
    agent: AGENT,
    mint: SOL,
    spend: { spendLimit: 650_000_000n, recurringLimit: SOLS, window: 150n, lastReset: 300n },
  }
  const before = capMeter([rule], 450n, new Map())
  // used = 1 - 0.65 = 0.35; refills at 300 + 150 + 1 = 451; worst case 2 * 1 across the edge.
  expect(before[0]).toMatchObject({
    used: { amount: '350000000', ui: '0.35' },
    left: { amount: '650000000' },
    refillSlot: 451,
    refillWhy: null,
    burstWorstCase: { amount: '2000000000' },
  })
  expect(before[0]?.line).toBe(
    'Spent 0.35 of 1 wSOL this window; refills at slot 451. Across a window edge the agent can ' +
      'spend up to 2 wSOL. This limits what the agent can spend, not what you can lose.',
  )
  const after = capMeter([rule], 451n, new Map())
  expect(after[0]).toMatchObject({ used: { amount: '0' }, left: { amount: '1000000000' } })
  expect(after[0]?.refillSlot).toBeNull()
  expect(after[0]?.refillWhy).toContain('nothing spent')
})

test('decimalOf turns a float close into its exact decimal string, exponent or not', () => {
  expect(decimalOf(125)).toBe('125')
  expect(decimalOf(0.000012345)).toBe('0.000012345')
  expect(decimalOf(1.2e-7)).toBe('0.00000012')
  expect(decimalOf(Number.NaN)).toBeNull()
  expect(decimalOf(-1)).toBeNull()
})

test('the wallet is checked at the boundary and never echoed', async () => {
  const r = await overviewRoute(new URL('http://l/overview?wallet=<script>'), async () => {
    throw new Error('must not read')
  })
  expect(r.status).toBe(400)
  expect(JSON.stringify(r.body)).not.toContain('<script>')
})

test('the contract fixture parses, with the report inside it', () => {
  const raw = JSON.parse(
    readFileSync(new URL('../../../fixtures/contracts/overview.json', import.meta.url), 'utf8'),
  ) as Record<string, unknown>
  delete raw['synthetic']
  const o = Overview.parse(raw)
  expect(VaultStatus.parse(o.report).vault).toBe(o.report.vault)
})
