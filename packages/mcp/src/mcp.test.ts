import { expect, test } from 'vitest'
import { TOOLS } from '@agon/core'
import { checkTradeRoute, reportRoute } from '@agon/web'
import { callTool, isTool } from './index.js'

const WALLET = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
const TRADE = {
  mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  side: 'buy',
  size: '3200000000',
  wallet: WALLET,
}
const SPEC = {
  mints: ['So11111111111111111111111111111111111111112'],
  cap: { mint: 'So11111111111111111111111111111111111111112', amount: '1', windowSeconds: 60 },
  triggerType: 'stop',
  expiresAt: null,
}

// This lives here and not beside the routes because mcp depends on web, so a test on the web side
// that imports mcp closes the loop and tsc -b refuses the cycle on a clean build. It only showed
// up on the stripped tree, which is the kind of thing T-E03 exists to find on day 2.

test('the agent and the web app cannot answer differently, because there is one answer', async () => {
  const overHttp = await (
    await reportRoute(new Request(`https://x/api/report?wallet=${WALLET}`))
  ).json()
  expect(callTool('get_report', { wallet: WALLET })).toEqual(overHttp)

  const tradeHttp = await (
    await checkTradeRoute(
      new Request('https://x/api/check-trade', { method: 'POST', body: JSON.stringify(TRADE) }),
    )
  ).json()
  expect(callTool('check_trade', TRADE)).toEqual(tradeHttp)
})

test('all 4 tools are reachable, and arm_rule refuses rather than answering', () => {
  expect(TOOLS).toHaveLength(4)
  for (const name of TOOLS) expect(isTool(name)).toBe(true)
  expect(isTool('drop_table')).toBe(false)
  expect(() => callTool('arm_rule', SPEC)).toThrow(/F5 and F6/)
  expect(callTool('list_rules', { wallet: WALLET })).toEqual([])
})
