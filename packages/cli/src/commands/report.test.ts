import { readFileSync, readdirSync } from 'node:fs'
import { expect, test } from 'vitest'
import type { RawTransaction } from '@agon/decoder'
import { reportLines, runReport } from './report.js'
import { fromEnhanced } from './report-io.js'

// The 5 real mainnet transactions T-C02 recorded, replayed. No key, no network.
const recordings = readdirSync('fixtures/recorded/rpc')
  .map(
    (f) =>
      JSON.parse(readFileSync(`fixtures/recorded/rpc/${f}`, 'utf8')) as {
        response: { body: { result?: unknown } }
      },
  )
  .map((r) => r.response.body.result)
  .filter((r): r is RawTransaction => typeof r === 'object' && r !== null && 'transaction' in r)

const TRADER = 'HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC'

test('the whole path runs on real recorded transactions and says what it is based on', () => {
  // The whole slice in one call: decode, ledger, mine, on real recorded mainnet data.
  const lines = reportLines(recordings, TRADER)
  const all = lines.join('\n')

  expect(lines[0]).toContain(TRADER)
  // A share with no denominator is a claim, so the counts are always beside it.
  expect(all).toMatch(/Decoded \d+ of \d+ swaps, \d+%/)
  expect(all).toContain('Closed trades')

  // All 3 rules are always present, found or not. A missing rule is `found: false`, never absent,
  // so a report cannot quietly omit the one it could not mine.
  for (const kind of ['stop', 'size', 'hold']) expect(all).toContain(`${kind}:`)

  // The catalogue's rule: no blank fields, no "N/A", no "something went wrong".
  expect(all).not.toMatch(/N\/A|something went wrong|undefined|\bnull\b/i)
})

test('a wallet with no history is told so, rather than shown an invented rule', async () => {
  const out: string[] = []
  const log = console.log
  console.log = (m: unknown) => out.push(String(m))
  try {
    const code = await runReport([TRADER], { loadTransactions: () => Promise.resolve([]) })
    expect(code).toBe(0)
  } finally {
    console.log = log
  }
  expect(out.join('\n')).toContain('no rule is claimed')
})

test('a read that fails says why and exits non-zero, rather than reporting on nothing', async () => {
  const errs: string[] = []
  const err = console.error
  console.error = (m: unknown) => errs.push(String(m))
  try {
    const code = await runReport([TRADER], {
      loadTransactions: () => Promise.reject(new Error('connect ETIMEDOUT')),
    })
    expect(code).toBe(1)
  } finally {
    console.error = err
  }
  // Analytics fail open, but a report based on nothing is not a report.
  expect(errs.join('\n')).toContain('ETIMEDOUT')
  expect(errs.join('\n')).toContain('no report')
})

test('a missing wallet argument is refused, not guessed', async () => {
  const errs: string[] = []
  const err = console.error
  console.error = (m: unknown) => errs.push(String(m))
  try {
    expect(await runReport([], { loadTransactions: () => Promise.resolve([]) })).toBe(2)
  } finally {
    console.error = err
  }
  expect(errs.join('\n')).toContain('is required')
})

test('an enhanced transaction is translated into the shape the decoder reads', () => {
  // The bug this test exists for: Helius has 2 transaction endpoints and they do not agree.
  // getTransaction returns meta.preTokenBalances and meta.postTokenBalances; the enhanced endpoint,
  // the only one that pages a wallet's history, returns a flat signature and already-subtracted
  // tokenBalanceChanges. Every decoder fixture was recorded in the first shape, so nothing caught
  // it until the command ran end to end and threw on `tx.transaction.signatures`.
  const enhanced = {
    signature: 'sig-1',
    slot: 450080486,
    transactionError: null,
    instructions: [{ programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4' }],
    accountData: [
      {
        tokenBalanceChanges: [
          {
            userAccount: 'W',
            mint: 'So11111111111111111111111111111111111111112',
            rawTokenAmount: { tokenAmount: '-1000000000' },
          },
          {
            userAccount: 'W',
            mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
            rawTokenAmount: { tokenAmount: '5000' },
          },
        ],
      },
    ],
  }

  const tx = fromEnhanced(enhanced)
  expect(tx.transaction.signatures[0]).toBe('sig-1')
  expect(tx.slot).toBe(450080486)
  expect(tx.meta?.err).toBeNull()

  // The amounts are carried across as the digits that arrived, never re-derived: a gain as a post
  // balance and a loss as a pre balance against 0, so the decoder's post minus pre reproduces
  // exactly the number Helius reported.
  expect(tx.meta?.preTokenBalances?.map((b) => b.uiTokenAmount.amount)).toEqual(['1000000000'])
  expect(tx.meta?.postTokenBalances?.map((b) => b.uiTokenAmount.amount)).toEqual(['5000'])

  // And the decoder can now actually read it, which is the whole point.
  const line = reportLines([tx], 'W').join('\n')
  expect(line).toContain('Decoded 1 of 1 swaps, 100%')
})
