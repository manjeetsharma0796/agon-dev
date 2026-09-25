import { expect, test } from 'vitest'
import { TOOLS } from '@agon/core'
import { reportRoute } from '@agon/web'
import { callAsTool, callTool, isTool } from './index.js'
import { textOf } from './test-support.js'

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

test('a replayed check_trade says it was replayed, which is what nobody could see before', async () => {
  // The finding this test exists for. An outside agent called the deployed server, read USDC's
  // real freeze and mint authorities out of a check_trade verdict, confirmed those facts against
  // mainnet, and reported that the tool was reading chain state. It was replaying a recording.
  // Every number was true and the conclusion was wrong, and nothing in the payload disagreed.
  const result = await callAsTool('check_trade', {
    wallet: RECORDED,
    mint: USDC,
    side: 'buy',
    size: '2000000000',
  })
  const payload = JSON.parse(textOf(result)) as { note?: string; verdict?: string }

  expect(payload.verdict).toBe('block')
  expect(payload.note, 'a replayed verdict went out with no marker on it').toBeDefined()
  expect(payload.note).toContain('recorded fixture')
})

test('the marker is per call, so one replayed answer does not brand the next', async () => {
  // A single flag shared across a server's lifetime would mark every later answer once any early
  // read hit a recording. arm_rule touches no network at all and must stay unmarked.
  const armed = await callAsTool('arm_rule', SPEC)
  expect(armed.isError).toBe(true)
  expect(textOf(armed)).not.toContain('recorded fixture')

  const rules = await callAsTool('list_rules', { wallet: WALLET })
  expect(textOf(rules)).not.toContain('recorded fixture')
})
