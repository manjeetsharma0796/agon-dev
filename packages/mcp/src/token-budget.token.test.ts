import { expect, test } from 'vitest'
import { callAsTool } from './index.js'
import { SWAP, SWAP_VAULT, swapIo, textOf } from './test-support.js'

// CI budgets, enforced by the `token-budget` vitest project: get_report 2,000 tokens, check_trade
// 400, prepare_swap 700. monad shipped a 2.1M-token tool result that broke every question the agent could ask
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

// check_trade is no longer a fixture, so its budget is now measured against a real verdict over a
// real wallet: T-C09's committed recording, replayed, no key. That matters, because a real verdict
// carries every reason that fired and the stored example carried a shorter list. This is the
// number that has to stay under budget, not the convenient one.
const RECORDED = 'HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC'
const TRADE = {
  mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  side: 'buy',
  size: '2000000000',
  wallet: RECORDED,
}

test('get_report stays inside the 2,000 token budget', async () => {
  const result = await callAsTool('get_report', { wallet: WALLET })
  expect(result.isError).not.toBe(true)
  const tokens = approxTokens(textOf(result))
  expect(
    tokens,
    `get_report was ~${Math.round(tokens)} tokens against a 2,000 budget`,
  ).toBeLessThanOrEqual(2000)
})

test('check_trade stays inside the 400 token budget', async () => {
  const result = await callAsTool('check_trade', TRADE)
  expect(result.isError).not.toBe(true)
  const tokens = approxTokens(textOf(result))
  expect(
    tokens,
    `check_trade was ~${Math.round(tokens)} tokens against a 400 budget`,
  ).toBeLessThanOrEqual(400)
})

// prepare_swap's answer is mostly the transaction. A legacy transaction is at most 1,232 bytes, so the
// budget is measured at that ceiling, not at the 916 bytes the fork swap it replaced measured on
// 2026-09-29. Base64 makes that 1,644 characters, about 411 tokens, before the verdict and quote.
test('prepare_swap stays inside the 700 token budget at the largest legal transaction', async () => {
  const { io } = swapIo(500000000n, {
    buildSwap: async () => ({
      vault: SWAP_VAULT,
      transaction: Buffer.alloc(1232, 7).toString('base64'),
      lastValidBlockHeight: 430000000,
      unitsConsumed: 1400000,
      failure: null,
    }),
  })
  const result = await callAsTool('prepare_swap', SWAP, io)
  expect(result.isError).not.toBe(true)
  const tokens = approxTokens(textOf(result))
  expect(
    tokens,
    `prepare_swap was ~${Math.round(tokens)} tokens against a 700 budget`,
  ).toBeLessThanOrEqual(700)
})
