// The MCP server and its 4 tools. Owned by T-C07.
//
// T-E03 puts the dispatch here and nothing else: name in, contract-validated result out, over the
// same functions the API routes serve. The transport, the budgets and the tool descriptions are
// T-C07's. What this buys on day 2 is that the agent side and the web side cannot answer
// differently, because there is only one answer to give.

import { armRule, checkTrade, report } from '@agon/web'
import { TOOLS, type ToolName, toolContracts } from '@agon/core'

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
