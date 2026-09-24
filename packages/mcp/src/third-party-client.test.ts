import { expect, test } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { CheckTradeOutput, Report } from '@agon/core'
import { createServer, TOOLS } from './index.js'
import { textOf } from './test-support.js'

// Proves check_trade is callable by any agent (Solana Agent Kit, GMGN agents), not only by our
// own `callTool` inside this repo. The client below is the plain @modelcontextprotocol/sdk
// Client, the same package a third-party agent framework imports; it knows nothing about
// @agon/core beyond parsing the JSON text a tool call hands back, so a pass here is evidence the
// tool is reachable over the real MCP protocol and not only through our internal dispatch
// function. The in-memory transport is the SDK's own test seam, not a transport we built.

const WALLET = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
const TRADE = {
  mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  side: 'buy',
  size: '3200000000',
  wallet: WALLET,
}

const connectThirdPartyClient = async (): Promise<Client> => {
  const server = createServer()
  const client = new Client({ name: 'third-party-test-agent', version: '0.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return client
}

test('a third-party client sees exactly the stable 4 tools, in order, each with a description', async () => {
  const client = await connectThirdPartyClient()
  const { tools } = await client.listTools()
  expect(tools.map((t) => t.name)).toEqual([...TOOLS])
  for (const tool of tools) {
    expect(tool.description ?? '', tool.name).not.toBe('')
    expect(tool.inputSchema.type, tool.name).toBe('object')
  }
})

test('a plain MCP client calls check_trade and gets a contract-valid verdict back', async () => {
  const client = await connectThirdPartyClient()
  const result = await client.callTool({ name: 'check_trade', arguments: TRADE })
  expect(result.isError).not.toBe(true)
  const verdict: unknown = JSON.parse(textOf(result))
  expect(() => CheckTradeOutput.parse(verdict)).not.toThrow()
})

test('a plain MCP client calls get_report and gets a contract-valid report back', async () => {
  const client = await connectThirdPartyClient()
  const result = await client.callTool({ name: 'get_report', arguments: { wallet: WALLET } })
  expect(result.isError).not.toBe(true)
  const parsed: unknown = JSON.parse(textOf(result))
  expect(() => Report.parse(parsed)).not.toThrow()
})

test('arm_rule hands back the reason and the numbers over MCP, not a silent failure', async () => {
  const client = await connectThirdPartyClient()
  const result = await client.callTool({
    name: 'arm_rule',
    arguments: {
      mints: ['So11111111111111111111111111111111111111112'],
      cap: {
        mint: 'So11111111111111111111111111111111111111112',
        amount: '1',
        windowSeconds: 60,
      },
      triggerType: 'stop',
      expiresAt: null,
    },
  })
  // Anything that can move funds fails closed: the client sees isError, plus the cause, the
  // numbers and what turns it on, never a bare protocol error and never a fabricated role.
  expect(result.isError).toBe(true)
  const text = textOf(result)
  expect(text).toContain('F5 and F6')
  expect(text).toContain('1 mint(s)')
})

test('an unknown tool name is refused, not silently ignored', async () => {
  const client = await connectThirdPartyClient()
  const result = await client.callTool({ name: 'drop_table', arguments: {} })
  expect(result.isError).toBe(true)
  expect(textOf(result)).toContain('drop_table')
})
