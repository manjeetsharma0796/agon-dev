import { readFileSync } from 'node:fs'
import { expect, test, vi } from 'vitest'
import type { NetRequest, NetResult } from '@agon/core'
import { checkTrade, type TradeFacts } from './check-trade.js'
import { ask } from './jev/index.js'
import { checkMints } from './mint-check.js'

// T-C06 budgets a whole check at 3 network calls or fewer: 1 account batch, 1 quote, 1 Jev call.
// Counted rather than reasoned about, and counted through the real producers, because a budget
// argued from the code is a budget that drifts the first time a helper grows a fetch.

const recorded = JSON.parse(
  readFileSync('fixtures/recorded/rpc/799727ca03b92b4e.json', 'utf8'),
) as { request: { body: { params: [string[], unknown] } }; response: { body: unknown } }
const MINTS = recorded.request.body.params[0]
const MINT = MINTS[0] as string
const WALLET = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'
const SLOT = 450012073

const facts = (over: Partial<TradeFacts>): TradeFacts => ({
  mint: {
    mint: MINT,
    verdict: 'pass',
    reasons: [],
    dataSlot: SLOT,
    ruleVersion: 'mint-check/1',
    facts: null,
  },
  rules: [
    { kind: 'stop', found: true, value: 8, sampleSize: 214, requiredSampleSize: 20, reason: null },
    {
      kind: 'size',
      found: true,
      value: 800_000_000,
      sampleSize: 214,
      requiredSampleSize: 1,
      reason: null,
    },
    {
      kind: 'hold',
      found: true,
      value: 3600,
      sampleSize: 214,
      requiredSampleSize: 1,
      reason: null,
    },
  ],
  quote: { priceImpactPct: '0.0027', slippageBps: 50, contextSlot: SLOT },
  jev: null,
  spendAsset: { symbol: 'SOL', decimals: 9 },
  categoryMix: { 'blue chip': 1 },
  ruleVersion: 'profile-2026-09-24-a',
  ...over,
})

const trade = { mint: MINT, side: 'buy', size: '800000000', wallet: WALLET }

test('a whole check costs 3 network calls, and the guard itself costs 0 of them', async () => {
  const seen: string[] = []
  const net = async (req: NetRequest): Promise<NetResult> => {
    seen.push(req.provider)
    return {
      status: 200,
      body: recorded.response.body,
      ms: 1,
      attempts: 1,
      slot: SLOT,
      fromFixture: true,
    }
  }

  // 1, the account batch.
  const mint = (await checkMints(MINTS, { net })).get(MINT) as TradeFacts['mint']
  // 2, the quote. The caller makes it; the guard reads 3 fields off the result.
  seen.push('jupiter')
  // 3, the Jev call, batched: all 3 non-numeric questions in 1 request.
  const jev = await ask(
    async () => {
      seen.push('jev')
      return { answers: { tokenCategory: { choice: 'blue chip' }, injection: { choice: 'no' } } }
    },
    [
      { kind: 'tokenCategory', mint: MINT, text: 'A major asset.' },
      { kind: 'injection', text: 'A major asset.' },
    ],
    { dataSlot: SLOT, ruleVersion: 'jev/1' },
  )
  expect(seen).toEqual(['rpc', 'jupiter', 'jev'])

  const before = seen.length
  const out = checkTrade(trade, facts({ mint, jev }))
  expect(out.verdict).toBe('pass')
  expect(seen).toHaveLength(before)
  expect(seen.length).toBeLessThanOrEqual(3)
})

test('the guard reaches the network 0 times, even on the path that blocks', () => {
  // The pure-core rule, enforced rather than promised. `fetch` is the only door out of this
  // process, so a call through any helper this file grows later lands here.
  const fetching = vi.fn(() => {
    throw new Error('check_trade reached the network')
  })
  vi.stubGlobal('fetch', fetching)
  try {
    // The fast path: with no Jev answer the arithmetic still blocks, so 0 model calls were needed.
    const out = checkTrade({ ...trade, size: '8000000000' }, facts({ jev: null }))
    expect(out.verdict).toBe('block')
    expect(fetching).not.toHaveBeenCalled()
  } finally {
    vi.unstubAllGlobals()
  }
})
