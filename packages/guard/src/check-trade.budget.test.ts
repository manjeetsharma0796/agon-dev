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

test('a whole check costs 3 network calls and 0 model calls, and the guard itself costs 0 of them', async () => {
  // Since T-F11b measured Jev there is no model on this path: the category and the impostor check are 1 keyless
  // listing lookup, so a check is the chain, the listing and the quote.
  const seen: string[] = []
  const net = async (req: NetRequest): Promise<NetResult> => {
    seen.push(req.provider)
    const listing = req.url.includes('tokens/v2/search')
    return {
      status: 200,
      body: listing
        ? [{ id: MINT, symbol: 'MAJ', name: 'A major asset', tags: ['major'] }]
        : recorded.response.body,
      ms: 1,
      attempts: 1,
      slot: SLOT,
      fromFixture: true,
    }
  }

  // 1 and 2, the account batch and the listing.
  const mint = (await checkMints(MINTS, { net })).get(MINT) as TradeFacts['mint']
  // 3, the quote. The caller makes it; the guard reads 3 fields off the result.
  seen.push('jupiter')
  expect(seen).toEqual(['rpc', 'jupiter', 'jupiter'])

  const before = seen.length
  const out = checkTrade(trade, facts({ mint, jev: null }))
  expect(out.verdict).toBe('pass')
  expect(seen).toHaveLength(before)
  expect(seen).not.toContain('jev')
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
