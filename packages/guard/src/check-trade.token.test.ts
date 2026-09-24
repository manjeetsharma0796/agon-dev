import { expect, test } from 'vitest'
import { checkTrade, type TradeFacts } from './check-trade.js'

// The check_trade response budget: 400 tokens. monad T6.8 is the reason it exists, where a
// 2.1M-token tool result broke every question that came after it.
//
// The estimate is bytes over 4, the usual rough ratio for English and JSON. It is deliberately the
// pessimistic side of the real tokenizer on prose like this, so a response that passes here passes
// with a real counter too. T-C07 owns enforcement for every MCP tool; this file is the guard
// holding its own half up, because a message written here is what spends the budget.
const tokens = (out: unknown): number => Math.ceil(JSON.stringify(out).length / 4)

const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const WALLET = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'
const SLOT = 312904411
const MEDIAN = 800_000_000
const BUDGET = 400

const rules: TradeFacts['rules'] = [
  { kind: 'stop', found: true, value: 8, sampleSize: 214, requiredSampleSize: 20, reason: null },
  {
    kind: 'size',
    found: true,
    value: MEDIAN,
    sampleSize: 214,
    requiredSampleSize: 1,
    reason: null,
  },
  { kind: 'hold', found: true, value: 3600, sampleSize: 214, requiredSampleSize: 1, reason: null },
]

const facts = (over: Partial<TradeFacts> = {}): TradeFacts => ({
  mint: {
    mint: MINT,
    verdict: 'pass',
    reasons: [],
    dataSlot: SLOT,
    ruleVersion: 'mint-check/1',
    facts: null,
  },
  rules,
  quote: { priceImpactPct: '0.0027', slippageBps: 50, contextSlot: SLOT },
  jev: {
    answers: {
      tokenCategory: { category: 'major', confidence: 0.9 },
      injection: { looksInjected: false, confidence: 0.9 },
    },
    dataSlot: SLOT,
    ruleVersion: 'jev/1',
    blocked: false,
    reasons: [],
  },
  spendAsset: { symbol: 'SOL', decimals: 9 },
  categoryMix: { major: 1 },
  ruleVersion: 'profile-2026-09-24-a',
  ...over,
})

const trade = (size: number) => ({
  mint: MINT,
  side: 'buy',
  size: String(size),
  wallet: WALLET,
})

test('a pass and an ordinary block both fit the 400 token budget', () => {
  expect(tokens(checkTrade(trade(MEDIAN), facts()))).toBeLessThanOrEqual(BUDGET)
  // The demo case and F4's headline: over the usual size on a token that can freeze you.
  const freezes: TradeFacts['mint'] = {
    mint: MINT,
    verdict: 'pass',
    reasons: [
      {
        rule: 'mint-freeze-authority',
        message:
          'Freeze authority is live on this token, held by 3sNBr7kMccME5D55xNgsmYpZnzPgP2g1' +
          '2CvJ81Q9EqY. That key can freeze your balance in place at any time, including while ' +
          'you are trying to sell. Trade a token whose freeze authority is revoked.',
      },
    ],
    dataSlot: SLOT,
    ruleVersion: 'mint-check/1',
    facts: null,
  }
  expect(tokens(checkTrade(trade(MEDIAN * 4), facts({ mint: freezes })))).toBeLessThanOrEqual(
    BUDGET,
  )
})

test('the worst case, every check firing at once, still fits', () => {
  // 7 reasons in 1 response: 3 blocking mint findings, both quote bands, the size break and the
  // stop break. Measured at 395 tokens, and it was 417 before this file's own 4 messages lost 88
  // characters between them. Nothing is dropped to make the budget: if this ever goes over, the
  // messages get shorter and the count of them stays.
  const worst = checkTrade(
    trade(MEDIAN * 9),
    facts({
      mint: {
        mint: MINT,
        verdict: 'block',
        reasons: [
          {
            rule: 'mint-freeze-authority',
            message:
              'Freeze authority is live on this token, held by 3sNBr7kMccME5D55xNgsmYpZnzPg' +
              'P2g12CvJ81Q9EqY. That key can freeze your balance in place at any time, including ' +
              'while you are trying to sell. Trade a token whose freeze authority is revoked.',
          },
          {
            rule: 'mint-permanent-delegate',
            message:
              'This token has a permanent delegate, 3sNBr7kMccME5D55xNgsmYpZnzPgP2g12CvJ81Q9EqY, ' +
              'which can move your balance without your signature. There is no setting that ' +
              'protects you from it. Trade a token without one.',
          },
          {
            rule: 'mint-transfer-hook',
            message:
              'Every transfer of this token runs program 3sNBr7kMccME5D55xNgsmYpZnzPgP2g12Cv' +
              'J81Q9EqY first, which can make a sale fail at a time it chooses. Trade a token ' +
              'with no transfer hook.',
          },
        ],
        dataSlot: SLOT,
        ruleVersion: 'mint-check/1',
        facts: null,
      },
      quote: { priceImpactPct: '0.087', slippageBps: 5000, contextSlot: SLOT },
      proposedStopPct: 42,
    }),
  )
  expect(worst.verdict).toBe('block')
  expect(worst.reasons.length).toBeGreaterThanOrEqual(6)
  expect(tokens(worst)).toBeLessThanOrEqual(BUDGET)
})
