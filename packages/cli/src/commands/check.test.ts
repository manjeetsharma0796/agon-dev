import { readFileSync, readdirSync } from 'node:fs'
import { expect, test } from 'vitest'
import type { RawTransaction } from '@agon/decoder'
import type { MintCheck } from '@agon/guard'
import { checkLines, runCheck, type CheckIo } from './check.js'
import { fromEnhanced, type EnhancedTransaction } from './report-io.js'

// A real wallet's recorded history, replayed. No key, no network.
//
// Deliberately the enhanced recording rather than the 5 pinned `getTransaction` swaps that
// `report.test.ts` replays. Those 5 are 5 separate swaps and close 0 round trips, so they mine no
// median and the guard correctly answers `unsure` about every size. Checking a size against a
// median needs a wallet that actually opened and closed positions, which is what this page is.
const recordings: RawTransaction[] = readdirSync('fixtures/recorded/helius')
  .map(
    (f) =>
      JSON.parse(readFileSync(`fixtures/recorded/helius/${f}`, 'utf8')) as {
        response: { body: unknown }
      },
  )
  .flatMap((r) =>
    Array.isArray(r.response.body) ? (r.response.body as EnhancedTransaction[]) : [],
  )
  .map(fromEnhanced)

const TRADER = 'HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC'
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

/** A mint that reads clean, so a block in these tests comes from the arithmetic and not the token. */
const cleanMint: MintCheck = {
  mint: USDC,
  verdict: 'pass',
  reasons: [],
  dataSlot: 450115322,
  ruleVersion: 'mint-check/1',
  facts: {
    mint: USDC,
    program: 'spl-token',
    mintAuthority: null,
    freezeAuthority: null,
    permanentDelegate: null,
    transferHookProgram: null,
    transferFeeBps: null,
  },
}

const io = (txs: RawTransaction[]): CheckIo => ({
  loadTransactions: () => Promise.resolve(txs),
  loadMintCheck: () => Promise.resolve(cleanMint),
})

const capture = async (fn: () => Promise<number>): Promise<{ code: number; out: string }> => {
  const lines: string[] = []
  const log = console.log
  const err = console.error
  console.log = (m: unknown) => lines.push(String(m))
  console.error = (m: unknown) => lines.push(String(m))
  try {
    return { code: await fn(), out: lines.join('\n') }
  } finally {
    console.log = log
    console.error = err
  }
}

test('an oversized trade is refused against the median mined from its own history', () => {
  // 20 SOL against a median mined from this wallet's real history, so the multiple is arithmetic
  // over recorded data rather than a number chosen to make the test pass.
  const { verdict, lines } = checkLines(
    recordings,
    { wallet: TRADER, mint: USDC, side: 'buy', size: '20000000000' },
    cleanMint,
  )
  const all = lines.join('\n')

  expect(verdict).toBe('block')

  // The refusal names the cause, the number involved and what the user can do next. A block with
  // no number is the failure this command exists to rule out.
  const size = /size-vs-median: ([\d.]+)x your median size of ([\d.]+) SOL/.exec(all)
  expect(size).not.toBeNull()
  expect(Number(size?.[1])).toBeGreaterThan(2)
  expect(all).toMatch(/Send [\d.]+ SOL or less, or raise the limit/)

  // Every verdict is stamped with its data slot and rule version.
  expect(all).toContain('check-trade/1+mint-check/1')
  expect(all).toContain('450115322')
  expect(all).not.toMatch(/N\/A|something went wrong|undefined|\bnull\b/i)
})

test('a refusal never exits 0, because a script would read that as permission', async () => {
  const { code, out } = await capture(() =>
    runCheck([TRADER, USDC, 'buy', '20000000000'], io(recordings)),
  )
  expect(out).toContain('Verdict: block')
  expect(code).not.toBe(0)
})

test('a wallet that could not be read is a block, not a report with nothing behind it', async () => {
  const { code, out } = await capture(() =>
    runCheck([TRADER, USDC, 'buy', '1000'], {
      ...io([]),
      loadTransactions: () => Promise.reject(new Error('Helius answered 503')),
    }),
  )
  // Anything that can move funds fails closed, and the message says which read failed.
  expect(out).toContain('Blocked')
  expect(out).toContain('503')
  expect(code).not.toBe(0)
})

test('0 transactions cannot become a rule, so the trade is refused rather than waved through', async () => {
  const { code, out } = await capture(() => runCheck([TRADER, USDC, 'buy', '1000'], io([])))
  expect(out).toContain('Blocked')
  expect(out).toContain('0 transactions')
  expect(code).not.toBe(0)
})

test('a size that is not base units is refused before any chain read', async () => {
  // "0.5" is the shape of a decimal amount. Rounding it into base units is how a cap gets tested
  // against a number the user never asked for, so it is refused rather than interpreted.
  const { code, out } = await capture(() =>
    runCheck([TRADER, USDC, 'buy', '0.5'], {
      loadTransactions: () => Promise.reject(new Error('should not be reached')),
      loadMintCheck: () => Promise.reject(new Error('should not be reached')),
    }),
  )
  expect(out).toContain('base units')
  expect(code).toBe(2)
})
