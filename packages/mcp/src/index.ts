// The MCP server and its 4 tools. Owned by T-C07.
//
// T-E03 puts the dispatch here and nothing else: name in, contract-validated result out, over the
// same functions the API routes serve. The transport, the budgets and the tool descriptions are
// T-C07's. What this buys on day 2 is that the agent side and the web side cannot answer
// differently, because there is only one answer to give.

import { armRule, checkTrade, report } from '@agon/web'
import { TOOLS, type ToolName, toolContracts } from '@agon/core'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

export { TOOLS, type ToolName }

/** What a tool call returns when the tool exists but refuses. Never a fabricated success. */
export interface ToolRefusal {
  refused: true
  tool: ToolName
  message: string
}

const handlers = {
  get_report: (input: unknown) => report(input),
  check_trade: (input: unknown) => checkTrade(input),
  arm_rule: (input: unknown) => armRule(input),
  // list_rules returns what is armed. Nothing can be armed yet, so the honest answer is the empty
  // list, and it is empty because arming is off and not because this wallet has no rules.
  list_rules: (_input: unknown) => [],
} satisfies Record<ToolName, (input: unknown) => unknown>

/**
 * Calls one tool. The input is parsed against the frozen contract before the handler sees it and
 * the result is parsed against it before the caller does, so a drifted shape fails here rather
 * than inside an agent's reasoning.
 */
export const callTool = (name: ToolName, input: unknown): unknown => {
  const contract = toolContracts[name]
  const parsed = contract.input.parse(input)
  return contract.output.parse(handlers[name](parsed))
}

export const isTool = (name: string): name is ToolName =>
  (TOOLS as readonly string[]).includes(name)

/**
 * What each tool does, shown to any agent that lists our tools before it decides whether to call
 * one. Says plainly what is real today, so arm_rule's refusal is not a surprise discovered by
 * calling it: arming turns on only once F5 and F6 pass.
 */
const DESCRIPTIONS: Record<ToolName, string> = {
  get_report:
    "Read a wallet's mined trading habits: stop discipline, sizing, hold time, coverage and the " +
    'cost of breaking its own rules. Read only, 0 chain writes.',
  check_trade:
    "Check a proposed trade against the wallet's own mined rules before it goes out. Returns " +
    'pass, block or unsure; a non-pass verdict always names the rule and the number. Anything ' +
    'that can move funds fails closed: unsure is not a soft pass.',
  arm_rule:
    'Arm a capped, revocable spending rule as a Swig role plus a Jupiter trigger order. Every ' +
    'call refuses today: arming turns on only once F5 and F6 pass and the pre-mainnet checklist ' +
    'is ticked.',
  list_rules: 'List the rules armed for a wallet. Empty until arm_rule turns on.',
}

/**
 * Runs one tool call and shapes it as an MCP result. Exactly one call to `callTool`, no retry: a
 * refusal or an unsure verdict comes back through `isError` with the same reason and numbers a
 * caller gets over HTTP, never a silent second attempt at a different answer.
 *
 * Exported so the token-budget test measures the actual wire payload, `content[0].text`, and not
 * a smaller stand-in for it.
 */
export const callAsTool = (name: ToolName, input: unknown): CallToolResult => {
  try {
    const result = callTool(name, input ?? {})
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  } catch (error) {
    return {
      isError: true,
      content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
    }
  }
}

/**
 * Builds the real MCP server: the transport half of T-C07. Every tool's input schema is
 * `toolContracts[name].input` straight from the frozen contract in `packages/core`, the same
 * zod object `callTool` validates against, so a third-party agent (Solana Agent Kit, GMGN, or
 * anything else that speaks MCP) is shown the exact shape it will be held to and never a
 * hand-written copy that can drift from it.
 */
export const createServer = (): McpServer => {
  const server = new McpServer({ name: 'agon', version: '0.0.0' }, { capabilities: { tools: {} } })

  server.registerTool(
    'get_report',
    {
      title: 'get_report',
      description: DESCRIPTIONS.get_report,
      inputSchema: toolContracts.get_report.input,
    },
    (args) => callAsTool('get_report', args),
  )
  server.registerTool(
    'check_trade',
    {
      title: 'check_trade',
      description: DESCRIPTIONS.check_trade,
      inputSchema: toolContracts.check_trade.input,
    },
    (args) => callAsTool('check_trade', args),
  )
  server.registerTool(
    'arm_rule',
    {
      title: 'arm_rule',
      description: DESCRIPTIONS.arm_rule,
      inputSchema: toolContracts.arm_rule.input,
    },
    (args) => callAsTool('arm_rule', args),
  )
  server.registerTool(
    'list_rules',
    {
      title: 'list_rules',
      description: DESCRIPTIONS.list_rules,
      inputSchema: toolContracts.list_rules.input,
    },
    (args) => callAsTool('list_rules', args),
  )

  return server
}
