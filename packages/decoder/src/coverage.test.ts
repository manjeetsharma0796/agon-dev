import { expect, test } from 'vitest'
import { Coverage } from '@agon/core'
import { decodeAll, fifoLedger, type RawTransaction, type Swap } from './index.js'

const WALLET = 'HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC'
const SOL = 'So11111111111111111111111111111111111111112'
const MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'

/** A transaction the decoder will bucket as not-a-swap: a plain transfer, no swap program. */
const transfer = (signature: string, slot: number): RawTransaction => ({
  slot,
  transaction: {
    signatures: [signature],
    message: { instructions: [{ programId: '11111111111111111111111111111111' }] },
  },
  meta: {
    err: null,
    preTokenBalances: [],
    postTokenBalances: [{ mint: SOL, owner: WALLET, uiTokenAmount: { amount: '1000' } }],
  },
})

test('a wallet with 0 decoded swaps reports 0 coverage, not 100 percent', () => {
  // The defect this task names. A share of 1 over 0 swaps reads as "we understood everything",
  // which is the opposite of what happened, and it is the number a user is shown.
  const decoded = decodeAll([], WALLET)

  expect(decoded.coverage.decodedSwaps).toBe(0)
  expect(decoded.coverage.share, 'nothing was decoded and the share claimed everything was').toBe(0)
})

test('the Coverage contract no longer exempts an empty wallet from its own arithmetic', () => {
  // The exemption is what let the lie through: `totalSwaps === 0 ||` short-circuited the check
  // that share equals decodedSwaps over totalSwaps, so share could be anything at all.
  expect(() => Coverage.parse({ decodedSwaps: 0, totalSwaps: 0, share: 1 })).toThrow()
  expect(() => Coverage.parse({ decodedSwaps: 0, totalSwaps: 0, share: 0 })).not.toThrow()
})

test('totalSwaps counts every transaction seen, so the share can fall below 95 percent', () => {
  // Counting only swaps plus undecoded meant a wallet of transfers scored 100%: the denominator
  // quietly dropped everything the decoder had chosen not to call a swap.
  const decoded = decodeAll([transfer('a', 1), transfer('b', 2), transfer('c', 3)], WALLET)

  expect(decoded.coverage.totalSwaps, 'not-a-swap transactions left the denominator').toBe(3)
  expect(decoded.coverage.share).toBe(0)
  expect(() => Coverage.parse(decoded.coverage)).not.toThrow()
})

/** A buy spends the quote and receives the mint. A sell is the same trade the other way round. */
const swap = (signature: string, slot: number, side: 'buy' | 'sell'): Swap =>
  side === 'buy'
    ? {
        kind: 'swap',
        signature,
        slot,
        side,
        soldMint: SOL,
        soldAmount: '2000',
        boughtMint: MINT,
        boughtAmount: '1000',
      }
    : {
        kind: 'swap',
        signature,
        slot,
        side,
        soldMint: MINT,
        soldAmount: '1000',
        boughtMint: SOL,
        boughtAmount: '2000',
      }

test('a same-slot buy and sell close one trade whichever order they arrive in', () => {
  // The ledger tie-broke same-slot swaps on the base58 signature, which is an arbitrary string and
  // has nothing to do with what happened first. A buy and a sell in the same slot would net to a
  // closed trade or to a sold-more-than-held exception depending on which signature sorted first,
  // so the same wallet could report different P&L on a rerun.
  const forwards = fifoLedger([swap('AAAA', 10, 'buy'), swap('zzzz', 10, 'sell')])
  const backwards = fifoLedger([swap('zzzz', 10, 'sell'), swap('AAAA', 10, 'buy')])

  expect(forwards.closedTrades).toHaveLength(1)
  expect(backwards.closedTrades, 'the order they were passed in changed the answer').toHaveLength(1)
  expect(backwards.closedTrades[0]?.realisedPnl).toBe(forwards.closedTrades[0]?.realisedPnl)
})
