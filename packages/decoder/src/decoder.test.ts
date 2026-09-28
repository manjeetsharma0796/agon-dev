import { readFileSync, readdirSync } from 'node:fs'
import { expect, test } from 'vitest'
import { BaseUnits } from '@agon/core'
import { decodeAll, decodeTransaction, type RawTransaction } from './index.js'

/**
 * Real mainnet transactions, replayed. Recorded by the T-C02 wrapper and pinned by signature, so
 * these are the same 5 every run and the test needs no key and no network.
 *
 * The wallet is pinned beside the signature rather than derived, because the fee payer is not the
 * trader in any of these: they came from AMM pool activity, which is mostly router and MEV flow,
 * and the payer is a relayer. Decoding is per wallet by design, and naming the wrong one gives a
 * confidently wrong answer rather than an error.
 */
const TRADERS: Record<string, { wallet: string; expect: 'buy' | 'sell' | 'rotation' }> = {
  '5jYeUs2KMuGoJcwuAtGSQrDEB1y6SvAS4nX95FnMso5xnCtvU7CfwZfg8i2m8M3ioBM4fb6j2wB3omRPa729fiFC': {
    wallet: 'HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC',
    expect: 'buy',
  },
  '2WKps9WjidkM7meN4EoHoqGbMjQ5QQs1j2fEgPsfXcdWb3op61YWMhxbFEsMZfATwgieVSYLJDUNH5DZBYHT7PjN': {
    wallet: 'GF3jPRGAucKaJ1SXbR7TR1vyMyVvjpDfQQXw2jgi6jre',
    expect: 'buy',
  },
  NXfZV1Ec9RA45zHhULWYcB1MTysLfDE5J59CEGYm6rHnj4L3FBWhri4NB6WNC4FZH7qSvqNz8whsqv1epmE31AW: {
    wallet: '5byS2sGSupT8Sb4z9VQNzwHCQm12XMcYrnM1oNeqAYgt',
    expect: 'buy',
  },
  '58PvmyKJeQEvUphgy3RG1YM1hZuWRJFJyCJ4ys9MAycasAQNc1wBkAE8THtdieZJQEhHGe5wc3fcmGGErBW8w81D': {
    wallet: '4pANrqEvjad4xEghrCbAAJfBm8KyNvYMKk1cuGW8erE4',
    expect: 'sell',
  },
  '35SY47kNv5319aLjo9i8oCE92ss3mQvNd8quPr6Ayp1yHkrxAqNr6saMswiFf4DFvKdDG9AqJJoVh2GdVE53PmRJ': {
    wallet: 'J7eW5qpETtJ7S8JSQ5zgz4ntyXpoP4hpoXtvy3oyjJfb',
    expect: 'rotation',
  },
}

const recordings = readdirSync('fixtures/recorded/rpc')
  .map(
    (f) =>
      JSON.parse(readFileSync(`fixtures/recorded/rpc/${f}`, 'utf8')) as {
        response: { body: { result?: unknown } }
      },
  )
  .map((r) => r.response.body.result)
  .filter((r): r is RawTransaction => typeof r === 'object' && r !== null && 'transaction' in r)
  .filter((tx) => TRADERS[tx.transaction.signatures[0] ?? ''] !== undefined)

test('5 real mainnet transactions were replayed', () => {
  expect(recordings).toHaveLength(5)
})

test('each real transaction decodes to the side it actually was', () => {
  for (const tx of recordings) {
    const pin = TRADERS[tx.transaction.signatures[0] ?? '']
    if (pin === undefined) continue
    const d = decodeTransaction(tx, pin.wallet)
    const got = d.kind === 'swap' ? d.side : 'rotation'
    expect(got, `${d.signature.slice(0, 12)} decoded as ${d.kind}`).toBe(pin.expect)

    if (d.kind !== 'swap') continue
    // Exact, not approximate. These parse as the frozen BaseUnits contract, a decimal string of a
    // non-negative integer. A float would have rounded a u64 here and become a wrong cost basis
    // three tasks downstream, where nobody would trace it back.
    expect(() => BaseUnits.parse(d.soldAmount)).not.toThrow()
    expect(() => BaseUnits.parse(d.boughtAmount)).not.toThrow()
    expect(BigInt(d.soldAmount)).toBeGreaterThan(0n)
    expect(BigInt(d.boughtAmount)).toBeGreaterThan(0n)
    expect(d.soldMint).not.toBe(d.boughtMint)
  }
})

test('both directions come out of real data, so "buy" is not just the default', () => {
  const sides = recordings.map((tx) => {
    const d = decodeTransaction(tx, TRADERS[tx.transaction.signatures[0] ?? '']?.wallet ?? '')
    return d.kind === 'swap' ? d.side : d.kind
  })
  expect(sides).toContain('buy')
  expect(sides).toContain('sell')
})

test('a quote to quote rotation is understood, not counted as a miss', () => {
  // SOL to USDC is the most common shape on the chain and carries no position. Putting it in the
  // unsupported list would deflate coverage on a transaction we understand perfectly well.
  const s = decodeAll(
    recordings.filter((tx) => TRADERS[tx.transaction.signatures[0] ?? '']?.expect === 'rotation'),
    'J7eW5qpETtJ7S8JSQ5zgz4ntyXpoP4hpoXtvy3oyjJfb',
  )
  expect(s.notSwaps).toHaveLength(1)
  expect(s.notSwaps[0]?.reason).toContain('both sides are quote assets')
  expect(s.unsupported).toHaveLength(0)
  // It counts in the denominator now, and not as a miss: `decodedSwaps` stays 0 and the rotation
  // is named in `notSwaps` with its reason. T-A06 changed this. Leaving it out of the denominator
  // was what let a wallet of rotations and transfers score 100%, because the decoder dropped from
  // the count exactly what it had chosen not to explain.
  expect(s.coverage.totalSwaps).toBe(1)
  expect(s.coverage.decodedSwaps).toBe(0)
})

test('nothing is dropped silently: a transfer and an ambiguous swap each land in their bucket', () => {
  const W = 'WaLLeTwaLLeTwaLLeTwaLLeTwaLLeTwaLLeTwaLLeT'
  const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
  const SOL = 'So11111111111111111111111111111111111111112'
  const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'
  const JUPITER = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'
  const bal = (mint: string, amount: string) => ({ mint, owner: W, uiTokenAmount: { amount } })

  const transfer: RawTransaction = {
    slot: 1,
    transaction: { signatures: ['transfer'], message: { instructions: [{ programId: JUPITER }] } },
    meta: { err: null, preTokenBalances: [bal(USDC, '100')], postTokenBalances: [bal(USDC, '40')] },
  }
  const ambiguous: RawTransaction = {
    slot: 2,
    transaction: { signatures: ['ambiguous'], message: { instructions: [{ programId: JUPITER }] } },
    meta: {
      err: null,
      preTokenBalances: [bal(SOL, '100'), bal(USDC, '100')],
      postTokenBalances: [bal(SOL, '50'), bal(USDC, '50'), bal(BONK, '7')],
    },
  }

  const s = decodeAll([transfer, ambiguous], W)
  expect(s.notSwaps.map((n) => n.signature)).toContain('transfer')
  expect(s.unsupported.map((u) => u.programId)).toEqual([JUPITER])
  for (const u of s.unsupported) expect(u.reason.length).toBeGreaterThan(0)

  // Both count in the denominator, and they count for different reasons. The ambiguous one is a
  // swap we failed to read. The transfer never was a swap, and it still belongs in the count,
  // because the share this feeds is "how much of what we saw did we explain" rather than "how much
  // of what we already agreed was a swap". T-A06 changed this: the old denominator could not fall
  // below the 95% the PRD treats as a finding, however little was understood.
  expect(s.coverage.totalSwaps).toBe(2)
  expect(s.coverage.decodedSwaps).toBe(0)
  expect(s.coverage.share).toBe(0)
})

/**
 * T-A07. A swap paid from native SOL was invisible: the wallet's wSOL account is opened, funded,
 * swapped and closed inside the one transaction, so it appears in neither `preTokenBalances` nor
 * `postTokenBalances`, and the only trace is a lamport change nothing in `packages/` read. The
 * decoder called it not-a-swap, "value only arrived the wallet", which carries no program id and
 * so is absent from the unsupported list too.
 */
const nativeTx = (
  signature: string,
  wallet: string,
  lamports: { pre: number; post: number },
  token: { mint: string; pre: string; post: string },
  fee = 5000,
): RawTransaction => ({
  slot: 1,
  transaction: {
    signatures: [signature],
    message: {
      accountKeys: [{ pubkey: wallet }, { pubkey: 'TokenAccountOfTheWallet1111111111111111111' }],
      instructions: [
        { programId: 'ComputeBudget111111111111111111111111111111' },
        { programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4' },
      ],
    },
  },
  meta: {
    err: null,
    fee,
    preBalances: [lamports.pre, 0],
    postBalances: [lamports.post, 0],
    preTokenBalances: [
      { accountIndex: 1, mint: token.mint, owner: wallet, uiTokenAmount: { amount: token.pre } },
    ],
    postTokenBalances: [
      { accountIndex: 1, mint: token.mint, owner: wallet, uiTokenAmount: { amount: token.post } },
    ],
  },
})

test('a buy paid in native SOL decodes as a buy, with the fee left out of the size', () => {
  const W = 'WaLLeTwaLLeTwaLLeTwaLLeTwaLLeTwaLLeTwaLLeT'
  const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'
  // 1 SOL leaves as lamports, 5000 of which is the fee, and BONK arrives.
  const d = decodeTransaction(
    nativeTx(
      'native-buy',
      W,
      { pre: 2_000_000_000, post: 999_995_000 },
      {
        mint: BONK,
        pre: '0',
        post: '4200',
      },
    ),
    W,
  )

  expect(d.kind, `decoded as ${d.kind}`).toBe('swap')
  if (d.kind !== 'swap') return
  expect(d.side).toBe('buy')
  expect(d.soldMint).toBe('So11111111111111111111111111111111111111112')
  // Exactly 1 SOL. The fee is the cost of sending the transaction, not part of what was traded,
  // and counting it would overstate the cost basis of every position by a different amount.
  expect(d.soldAmount).toBe('1000000000')
  expect(d.boughtAmount).toBe('4200')
})

test('a sell into native SOL decodes as a sell', () => {
  const W = 'WaLLeTwaLLeTwaLLeTwaLLeTwaLLeTwaLLeTwaLLeT'
  const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'
  const d = decodeTransaction(
    nativeTx(
      'native-sell',
      W,
      { pre: 1_000_000_000, post: 1_499_995_000 },
      {
        mint: BONK,
        pre: '4200',
        post: '0',
      },
    ),
    W,
  )

  expect(d.kind, `decoded as ${d.kind}`).toBe('swap')
  if (d.kind !== 'swap') return
  expect(d.side).toBe('sell')
  expect(d.boughtMint).toBe('So11111111111111111111111111111111111111112')
  expect(d.boughtAmount).toBe('500000000')
  expect(d.soldAmount).toBe('4200')
})

test('wrapping SOL is not a trade, because lamports and wSOL are the same asset', () => {
  const W = 'WaLLeTwaLLeTwaLLeTwaLLeTwaLLeTwaLLeTwaLLeT'
  const SOL = 'So11111111111111111111111111111111111111112'
  // Native out, wSOL in, same amount. Read as 2 mints this is a swap of SOL for SOL.
  const d = decodeTransaction(
    nativeTx(
      'wrap',
      W,
      { pre: 2_000_000_000, post: 999_995_000 },
      {
        mint: SOL,
        pre: '0',
        post: '1000000000',
      },
    ),
    W,
  )

  expect(d.kind).toBe('not-a-swap')
  if (d.kind !== 'not-a-swap') return
  expect(d.reason).toContain('no token balance of this wallet changed')
})

test('an undecoded transaction names the venue rather than ComputeBudget', () => {
  // Every real mainnet transaction starts with a ComputeBudget instruction, so the first program
  // with an id is always ComputeBudget, and every undecoded transaction on the 5 recorded fixtures
  // collapsed into 1 unsupported row named after a program that never traded anything.
  for (const tx of recordings) {
    const pin = TRADERS[tx.transaction.signatures[0] ?? '']
    if (pin === undefined) continue
    const d = decodeTransaction({ ...tx, meta: null }, pin.wallet)
    if (d.kind !== 'undecoded') continue
    expect(d.programId, `${d.signature.slice(0, 12)} named a program that never traded`).not.toBe(
      'ComputeBudget111111111111111111111111111111',
    )
  }
})

test('every distinct reason is kept per program, not just the first', () => {
  const W = 'WaLLeTwaLLeTwaLLeTwaLLeTwaLLeTwaLLeTwaLLeT'
  const VENUE = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'
  const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'
  const WIF = 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm'
  const bal = (mint: string, amount: string) => ({ mint, owner: W, uiTokenAmount: { amount } })
  const at = (signature: string, pre: string[][], post: string[][]): RawTransaction => ({
    slot: 1,
    transaction: { signatures: [signature], message: { instructions: [{ programId: VENUE }] } },
    meta: {
      err: null,
      preTokenBalances: pre.map(([m, a]) => bal(m as string, a as string)),
      postTokenBalances: post.map(([m, a]) => bal(m as string, a as string)),
    },
  })

  const s = decodeAll(
    [
      // Ambiguous: 2 mints left, 1 arrived.
      at(
        'ambiguous',
        [
          [BONK, '100'],
          [WIF, '100'],
        ],
        [
          [BONK, '50'],
          [WIF, '50'],
          ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', '7'],
        ],
      ),
      // Neither side is a quote asset, which is a different failure of the same program.
      at('no-quote', [[BONK, '100']], [[WIF, '7']]),
    ],
    W,
  )

  expect(s.unsupported).toHaveLength(1)
  const row = s.unsupported[0]
  expect(row?.count).toBe(2)
  expect(
    row?.reason,
    'the second reason was dropped, so the row explained half of what it counted',
  ).toContain('ambiguous')
  expect(row?.reason).toContain('quote asset')
})
