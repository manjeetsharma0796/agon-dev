import { expect, test } from 'vitest'
import { TOOLS } from '@agon/core'
import { reportRoute } from '@agon/web'
import { callTool, isTool } from './index.js'

const WALLET = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'

/** The wallet T-C09 recorded a real page of history for. Replayed, so this needs no key. */
const RECORDED = 'HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC'
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

const SPEC = {
  mints: ['So11111111111111111111111111111111111111112'],
  cap: { mint: 'So11111111111111111111111111111111111111112', amount: '1', windowSeconds: 60 },
  triggerType: 'stop',
  expiresAt: null,
}

// This lives here and not beside the routes because mcp depends on web, so a test on the web side
// that imports mcp closes the loop and tsc -b refuses the cycle on a clean build. It only showed
// up on the stripped tree, which is the kind of thing T-E03 exists to find on day 2.

test('get_report gives the agent and the web app the same answer, because it is one function', async () => {
  const overHttp = await (
    await reportRoute(new Request(`https://x/api/report?wallet=${WALLET}`))
  ).json()
  expect(await callTool('get_report', { wallet: WALLET })).toEqual(overHttp)
})

test('check_trade is the real guard now, and answers from the wallet own history', async () => {
  // No io passed, so this is the shipped path: the record and replay wrapper serves T-C09's
  // committed recording and no key is read.
  const out = (await callTool('check_trade', {
    wallet: RECORDED,
    mint: USDC,
    side: 'buy',
    size: '2000000000',
  })) as { verdict: string; reasons: { rule: string; message: string }[] }

  expect(out.verdict).toBe('block')

  // The point of wiring the real guard: a refusal that names the rule and carries the number,
  // computed from this wallet's own trades rather than read out of a stored example.
  const size = out.reasons.find((r) => r.rule === 'size-vs-median')
  expect(size?.message).toMatch(/[\d.]+x your median size of [\d.]+ SOL/)
  expect(size?.message).toMatch(/Send [\d.]+ SOL or less/)
})

test('the HTTP route has not caught up, and the test says so rather than hiding it', async () => {
  // Tracked, not silent. `apps/web`'s leg still answers check_trade from fixtures/contracts, so the
  // agent and the browser now disagree on this one tool. That is a real divergence and the
  // invariant this file used to assert, "there is one answer", no longer holds for check_trade.
  // It holds for get_report above. Pointing the route at `assessTrade` is the fix and it belongs to
  // whoever owns the route, because the leg is documented as pure with 0 network calls and the real
  // path needs two reads.
  const { checkTrade: legCheckTrade } = await import('@agon/web')
  const fromLeg = legCheckTrade({ wallet: RECORDED, mint: USDC, side: 'buy', size: '2000000000' })
  const fromTool = (await callTool('check_trade', {
    wallet: RECORDED,
    mint: USDC,
    side: 'buy',
    size: '2000000000',
  })) as { reasons: unknown[] }

  expect(fromLeg.reasons).not.toEqual(fromTool.reasons)
})

test('all 4 tools are reachable, and arm_rule refuses rather than answering', async () => {
  expect(TOOLS).toHaveLength(4)
  for (const name of TOOLS) expect(isTool(name)).toBe(true)
  expect(isTool('drop_table')).toBe(false)
  await expect(callTool('arm_rule', SPEC)).rejects.toThrow(/F5 and F6/)
  expect(await callTool('list_rules', { wallet: WALLET })).toEqual([])
})
