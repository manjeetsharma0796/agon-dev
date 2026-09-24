import { expect, test } from 'vitest'
import { callAsTool } from './index.js'
import { textOf } from './test-support.js'

// CI budgets, enforced by the `token-budget` vitest project: get_report 2,000 tokens, check_trade
// 400. monad shipped a 2.1M-token tool result that broke every question the agent could ask
// (T6.8); this is the test that stops that from happening here.
//
// There is no tokenizer dependency in this package, so tokens are approximated as
// characters / 4, a standard rule of thumb for English and JSON text. This measures the actual
// MCP wire payload, `content[0].text` from `callAsTool`, not a smaller stand-in for it, because
// that text is what actually lands in the agent's context.
const approxTokens = (text: string): number => text.length / 4

// Same wallet and trade the rest of the mcp and web test suites use (mcp.test.ts, routes.test.ts,
// legs.test.ts). Real per-wallet golden fixtures are an operator-blocked item tracked elsewhere;
// until they land this is what get_report and check_trade are actually wired to serve, over MCP
// and over HTTP alike, so it is what has to stay inside budget.
const WALLET = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
const TRADE = {
  mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  side: 'buy',
  size: '3200000000',
  wallet: WALLET,
}

test('get_report stays inside the 2,000 token budget', () => {
  const result = callAsTool('get_report', { wallet: WALLET })
  expect(result.isError).not.toBe(true)
  const tokens = approxTokens(textOf(result))
  expect(
    tokens,
    `get_report was ~${Math.round(tokens)} tokens against a 2,000 budget`,
  ).toBeLessThanOrEqual(2000)
})

test('check_trade stays inside the 400 token budget', () => {
  const result = callAsTool('check_trade', TRADE)
  expect(result.isError).not.toBe(true)
  const tokens = approxTokens(textOf(result))
  expect(
    tokens,
    `check_trade was ~${Math.round(tokens)} tokens against a 400 budget`,
  ).toBeLessThanOrEqual(400)
})
