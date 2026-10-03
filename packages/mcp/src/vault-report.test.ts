import { VaultStatus } from '@agon/core'
import type { Decoded } from '@agon/decoder'
import { expect, test } from 'vitest'
import type { Prices, VaultActivity } from './io.js'
import { usdToLamports, vaultReport, type Valuation } from './vault-report.js'

// Pure: every case here is inputs in, the answer out, checked against the contract it ships under.

const VAULT = '6L3SNQ1UJmDm7FfjnfRvwXj1ECyEciSAQsk2hndTqNye'
const OWNER = 'Arp9sY4pxiaFKJsQAAQWbyKCX5Pym7Br7Ni7myNkjpJU'
const SOL = 'So11111111111111111111111111111111111111112'
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'

let n = 0
/** A decoded swap; `sig` names it so a test can find its row. */
const swap = (
  side: 'buy' | 'sell',
  mint: string,
  tokens: bigint,
  lamports: bigint,
  slot: number,
  sig = `s${++n}`,
): Decoded =>
  side === 'buy'
    ? {
        kind: 'swap',
        signature: sig,
        slot,
        side,
        soldMint: SOL,
        soldAmount: String(lamports),
        boughtMint: mint,
        boughtAmount: String(tokens),
      }
    : {
        kind: 'swap',
        signature: sig,
        slot,
        side,
        soldMint: mint,
        soldAmount: String(tokens),
        boughtMint: SOL,
        boughtAmount: String(lamports),
      }

/** The chain's order is newest first, so `oldestFirst` is reversed into it. */
const activity = (
  oldestFirst: Decoded[],
  balances: Array<[string, bigint]>,
  decimals: Array<[string, number]> = [
    [USDC, 6],
    [BONK, 5],
  ],
): VaultActivity => ({
  vault: VAULT,
  nativeSol: 2_039_280n,
  balances: balances.map(([mint, amount]) => ({ mint, amount })),
  agents: [{ address: '1HVWcU6i42t4hCuAUgHtoizLpXxsPxmsZnqxiTB5jYU', feeSol: 9_990_000n }],
  decoded: [...oldestFirst].reverse().map((d) => ({ d, time: 1_790_000_000 + d.slot })),
  decimals: new Map(decimals),
  signaturesRead: oldestFirst.length,
  incomplete: null,
  slot: 500,
})

const PRICES: Prices = {
  sol: [
    { name: 'Pyth', usd: 100 },
    { name: 'Jupiter', usd: 101 },
  ],
  usd: new Map(),
  errors: [],
}

const report = (a: VaultActivity, valuations: Array<[string, Valuation]>, prices = PRICES) =>
  VaultStatus.parse(
    vaultReport({
      owner: OWNER,
      activity: a,
      prices,
      valuations: new Map(valuations),
      network: 'fork',
      now: new Date('2026-10-02T10:00:00Z'),
      explorer: (kind, id) => `https://explorer.solana.com/${kind}/${id}`,
    }),
  )

test('a buy then a partial sell: realised by FIFO, the rest open, in SOL and whole cents', () => {
  // 1 SOL buys 100 USDC; 50 sell for 0.6 SOL: realised 0.1. The 50 open cost 0.5, fetch 0.55.
  const out = report(
    activity(
      [
        swap('buy', USDC, 100_000_000n, 1_000_000_000n, 1),
        swap('sell', USDC, 50_000_000n, 600_000_000n, 2),
      ],
      [[USDC, 50_000_000n]],
    ),
    [[USDC, { value: 550_000_000n, source: 'Jupiter sell quote' }]],
  )
  expect(out.totals.realised).toEqual({
    sol: { amount: '100000000', ui: '0.1', unit: 'SOL' },
    usd: '10.00',
  })
  expect(out.totals.unrealised.usd).toBe('5.00')
  expect(out.totals.total).toEqual({
    sol: { amount: '150000000', ui: '0.15', unit: 'SOL' },
    usd: '15.00',
  })
  expect(out.positions[0]?.held).toEqual({ amount: '50000000', ui: '50', unit: 'USDC' })
  expect(out.trades.map((t) => [t.side, t.token.ui, t.sol.ui, t.realised?.ui ?? null])).toEqual([
    ['sell', '50', '0.6', '0.1'],
    ['buy', '100', '1', null],
  ])
  expect(out.summary[0]).toBe(
    'Total P&L +0.15 SOL (+$15.00): realised +0.1 SOL (+$10.00) over 1 sell, unrealised +0.05 SOL (+$5.00) on 1 of 1 open position.',
  )
})

test('2 buys in 1 slot are matched in the order they happened, not the order the chain lists them', () => {
  // Slot 100: buy A (1 SOL for 100 USDC) then buy B (2 SOL for 100 USDC). Slot 101 sells 100 USDC
  // for 1.5 SOL. FIFO takes A: realised +0.5, and B stays open at cost 2. Matched latest first it
  // would read -0.5 with cost 1.
  const out = report(
    activity(
      [
        swap('buy', USDC, 100_000_000n, 1_000_000_000n, 100),
        swap('buy', USDC, 100_000_000n, 2_000_000_000n, 100),
        swap('sell', USDC, 100_000_000n, 1_500_000_000n, 101),
      ],
      [[USDC, 100_000_000n]],
    ),
    [[USDC, { value: 2_000_000_000n, source: 'Jupiter sell quote' }]],
  )
  expect(out.totals.realised.sol.amount).toBe('500000000')
  expect(out.positions[0]?.cost.amount).toBe('2000000000')
})

test('tokens that left the vault without a counted trade are not held, valued or hidden', () => {
  // 10 BONK bought for 1 SOL, then swapped for USDC (not against SOL, so not a counted trade):
  // the vault holds 0 BONK, so nothing is open, and the reason says where the BONK went.
  const out = report(
    activity(
      [
        swap('buy', BONK, 1_000_000n, 1_000_000_000n, 1),
        {
          kind: 'undecoded',
          signature: 'tok',
          slot: 2,
          programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
          reason: 'neither side is a quote asset, so there is no direction to name',
        },
      ],
      [[USDC, 30_000_000n]],
    ),
    [],
  )
  expect(out.positions).toEqual([])
  expect(out.totals.unrealised.sol.amount).toBe('0')
  expect(out.history.notCounted.map((x) => x.reason)).toEqual([
    'swaps where neither side is SOL, so they have no cost in SOL',
    '10 DezX..B263 left the vault without a counted trade, so it is not valued',
  ])
})

test('a withdrawal caps the position at what the vault holds, and its cost shrinks with it', () => {
  // 100 USDC bought for 1 SOL; the owner withdrew 60, so 40 are held at 0.4 SOL of cost.
  const out = report(
    activity([swap('buy', USDC, 100_000_000n, 1_000_000_000n, 1)], [[USDC, 40_000_000n]]),
    [[USDC, { value: 450_000_000n, source: 'DexScreener' }]],
  )
  expect(out.positions[0]).toMatchObject({
    held: { ui: '40', unit: 'USDC' },
    cost: { ui: '0.4' },
    unrealised: { sol: { ui: '0.05' } },
    source: 'DexScreener',
  })
})

test('SOL is always 9 decimals, even when no balance or trade named wSOL', () => {
  const out = report(activity([], [], []), [])
  expect(out.nativeSol).toEqual({ amount: '2039280', ui: '0.00203928', unit: 'SOL' })
  expect(out.agents[0]?.feeSol.ui).toBe('0.00999')
  expect(out.totals.note).toContain('fork')
})

test('a mint whose decimals are unknown is labelled base units, never as whole tokens', () => {
  const out = report(activity([swap('buy', BONK, 7_000n, 20_000_000n, 1)], [[BONK, 7_000n]], []), [
    [BONK, { why: 'its decimals were in no balance the chain returned' }],
  ])
  expect(out.positions[0]?.held).toEqual({
    amount: '7000',
    ui: '7000',
    unit: 'base units of DezX..B263',
  })
  expect(out.positions[0]?.whyUnpriced).toContain('decimals')
})

test('dollars are whole cents, so the parts always add up to the total', () => {
  // 0.00005 SOL each at $100 is half a cent each: rounded alone they read 1 + 1 = 1.
  const out = report(
    activity(
      [
        swap('buy', USDC, 100_000_000n, 1_000_000_000n, 1),
        swap('sell', USDC, 50_000_000n, 500_050_000n, 2),
      ],
      [[USDC, 50_000_000n]],
    ),
    [[USDC, { value: 500_050_000n, source: 'Jupiter sell quote' }]],
    { ...PRICES, sol: [{ name: 'Pyth', usd: 100 }] },
  )
  const c = (s: string | null) => Math.round(Number(s) * 100)
  expect(c(out.totals.realised.usd) + c(out.totals.unrealised.usd)).toBe(c(out.totals.total.usd))
})

test('an absurd price is shown in plain digits and never takes the answer down', () => {
  const out = report(
    activity([swap('buy', BONK, 100_000_000_000n, 1_000_000_000n, 1)], [[BONK, 100_000_000_000n]]),
    [[BONK, { value: 10n ** 29n, source: 'DexScreener' }]],
  )
  expect(out.totals.unrealised.usd).toMatch(/^[0-9]+\.[0-9]{2}$/)
  expect(usdToLamports(1n, 0, Infinity, 100)).toBeNull()
  expect(usdToLamports(1n, 0, 0, 100)).toBeNull()
})

test('an unpriced position says why in the line read aloud, and the headline counts it', () => {
  const out = report(
    activity([swap('buy', BONK, 1_000_000n, 1_000_000_000n, 1)], [[BONK, 1_000_000n]]),
    [
      [
        BONK,
        { why: 'Jupiter quote answered 429; Jupiter price has none; DexScreener answered 429' },
      ],
    ],
    { sol: [], usd: new Map(), errors: ['Pyth answered 429', 'Jupiter price answered 429'] },
  )
  expect(out.summary[0]).toContain('on 0 of 1 open position; 1 unpriced and left out (DezX..B263).')
  expect(out.summary[1]).toContain('no price (Jupiter quote answered 429')
  expect(out.summary).toContain('No dollars: Pyth answered 429; Jupiter price answered 429.')
  expect(out.totals.unpriced).toEqual([BONK])
  expect(out.solUsd).toBeNull()
})

test('a sell of more than the counted buys names its token and transaction, and how much counts', () => {
  const out = report(
    activity(
      [
        swap('buy', BONK, 50n, 400_000_000n, 1),
        swap('sell', BONK, 100n, 1_000_000_000n, 2, '5vGJ8Rk2sNw1ZbqY'),
      ],
      [],
    ),
    [],
  )
  expect(out.history.notCounted.map((x) => x.reason)).toEqual([
    'sells of more than the counted buys hold (e.g. DezX..B263 in 5vGJ..ZbqY): only the part bought here is realised',
  ])
  expect(out.totals.realised.sol.amount).toBe('100000000')
})

test('the answer stays bounded however many mints the vault has touched', () => {
  const mints = Array.from({ length: 20 }, (_, i) => `${'ABCDEFGHJKLMNPQRSTUV'[i]}${BONK.slice(1)}`)
  const out = report(
    activity(
      mints.map((m, i) => swap('buy', m, 1_000n, BigInt(i + 1) * 1_000_000n, i + 1)),
      mints.map((m) => [m, 1_000n]),
      mints.map((m) => [m, 3]),
    ),
    mints.map((m) => [m, { why: 'Jupiter quote answered 429' }]),
  )
  expect(out.positions).toHaveLength(5)
  expect(out.history).toMatchObject({ positions: 20, positionsShown: 5, trades: 20, shown: 3 })
  expect(out.summary.length).toBeLessThanOrEqual(8)
  // Largest cost first, so what is shown is what matters most.
  expect(out.positions[0]?.cost.ui).toBe('0.02')
})
