// The MCP server and its 4 tools. Owned by T-C07.
//
// T-E03 puts the dispatch here and nothing else: name in, contract-validated result out, over the
// same functions the API routes serve. The transport, the budgets and the tool descriptions are
// T-C07's. What this buys on day 2 is that the agent side and the web side cannot answer
// differently, because there is only one answer to give.

import { FIXTURE_NOTE, armRule, report } from '@agon/web'
import { TOOLS, type ToolName, toolContracts } from '@agon/core'
import { assessTrade } from '@agon/guard'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { liveIo, type ToolIo } from './io.js'

export { TOOLS, type ToolName }

/** What a tool call returns when the tool exists but refuses. Never a fabricated success. */
export interface ToolRefusal {
  refused: true
  tool: ToolName
  message: string
}

type Handler = (input: unknown, io: ToolIo) => unknown | Promise<unknown>

const handlers = {
  // Still the recorded example, because a real Report needs the cost of breaking your own rule and
  // nothing computes that yet. It is labelled rather than quietly served: see `callAsTool`, which
  // puts FIXTURE_NOTE on this tool's result so an agent is told before it repeats a number.
  get_report: (input: unknown) => report(input),

  // Real. Reads this wallet's own history and this mint's own authorities, then runs the same
  // `assessTrade` the CLI runs, so the agent and the terminal cannot answer differently.
  check_trade: async (input: unknown, io: ToolIo) => {
    const { wallet, mint, side, size } = toolContracts.check_trade.input.parse(input)
    const [txs, mintCheck] = await Promise.all([
      io.loadTransactions(wallet),
      io.loadMintCheck(mint),
    ])
    if (txs.length === 0) {
      // Anything that can move funds fails closed, and an empty history is not a clean bill.
      throw new Error(
        `0 transactions read for ${wallet}, so there are no rules of its own to check this trade ` +
          `against. Nothing is approved on the basis of no history.`,
      )
    }
    return assessTrade(txs, { wallet, mint, side, size }, mintCheck).verdict
  },

  arm_rule: (input: unknown) => armRule(input),
  // list_rules returns what is armed. Nothing can be armed yet, so the honest answer is the empty
  // list, and it is empty because arming is off and not because this wallet has no rules.
  list_rules: (_input: unknown) => [],
} satisfies Record<ToolName, Handler>

/**
 * Tools that answer from a recorded example no matter what the network is doing. `get_report`
 * reads `fixtures/contracts` off disk, so no runtime flag can tell you: it is always an example.
 *
 * `check_trade` is not on this list and must not be. It is fixture-backed in the deployment and
 * live when a key is set, which is a runtime fact, so it is marked from `io.usedFixture()` below.
 */
const ALWAYS_FIXTURE: readonly ToolName[] = ['get_report']

/**
 * Calls one tool. The input is parsed against the frozen contract before the handler sees it and
 * the result is parsed against it before the caller does, so a drifted shape fails here rather
 * than inside an agent's reasoning.
 */
export const callTool = async (
  name: ToolName,
  input: unknown,
  io: ToolIo = liveIo(),
): Promise<unknown> => {
  const contract = toolContracts[name]
  const parsed = contract.input.parse(input)
  return contract.output.parse(await handlers[name](parsed, io))
}

export const isTool = (name: string): name is ToolName =>
  (TOOLS as readonly string[]).includes(name)

/**
 * Handed to the client at initialize, which is what an assistant reads when someone asks it what
 * this server can do. The protocol has a field for exactly this, so there is no "what can you do"
 * tool: a tool would have to be called before it could answer, and half of answering is saying
 * which tools are worth calling at all.
 *
 * It states what is not real as plainly as what is. An agent that is told arming refuses will say
 * so up front instead of discovering it by trying to spend someone's money.
 */
const INSTRUCTIONS = `Agon turns a trader's own on-chain history into a spending limit their agent has to trade inside.

What works right now, with nothing to set up:

- check_trade is real. Give it a wallet, a mint, a side and a size in base units, and it reads that
  wallet's last 100 transactions, decodes its swaps from balance changes, builds a FIFO ledger,
  mines what that trader normally does, reads the mint's authorities off the chain, and answers
  pass, block or unsure. A non-pass always names the rule and the number, for example "12.4x your
  median size of 0.162 SOL, past your 2x limit". Those numbers are arithmetic over that wallet's
  own history, never a model's opinion.
- list_rules is real and currently returns an empty list for every wallet, because arming is off.
  Empty means nothing is armed, not that the wallet has no history.

What is not real yet, so do not present it as a measurement:

- get_report answers from a recorded example, not from the wallet you asked about. Its result
  carries a "note" field saying so. Repeat that note if you quote any of its numbers.
- arm_rule refuses every call. It validates the rule and then declines, because no Swig role and no
  Jupiter order are ever created: arming turns on only once the on-chain feasibility tests pass and
  the pre-mainnet checklist is signed off. The refusal is the correct answer, not an error to retry.

Setup: none. No wallet connection, no private key, no signing, and nothing here can move funds or
write to a chain. Every call is a read. You need a mainnet wallet address to ask about, and that is
all; a wallet with no trading history is refused rather than approved, because there is nothing to
judge a trade against.

Two things worth knowing before you interpret an answer. check_trade cannot currently return pass:
it takes no price quote and runs no text screen, so 2 of its answers are always "not read", and
unscreened text is unsure. Unsure is not a soft pass, it means the trade does not go out. And sizes
are base units, never decimals: 1 SOL is 1000000000.`

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
export const callAsTool = async (
  name: ToolName,
  input: unknown,
  io: ToolIo = liveIo(),
): Promise<CallToolResult> => {
  try {
    const result = await callTool(name, input ?? {}, io)
    // A fixture-backed number goes out wearing the label. An agent repeating a figure it was given
    // cannot know it was an example unless the payload says so.
    //
    // This used to be a static list holding `get_report` alone, and that was too narrow. An outside
    // agent tested the deployment, saw `check_trade` name USDC's real freeze and mint authorities,
    // verified those facts against mainnet and concluded the tool was reading the chain. It was
    // replaying a recording. The facts were true, the inference was reasonable, and nothing in the
    // payload could correct it, because the only tool carrying a marker was the one it had already
    // been careful about. A marker on the protected tool does not protect the unprotected one.
    const fromFixture = ALWAYS_FIXTURE.includes(name) || io.usedFixture()
    const text = fromFixture
      ? JSON.stringify({ ...(result as object), note: FIXTURE_NOTE })
      : JSON.stringify(result)
    return { content: [{ type: 'text', text }] }
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
 *
 * Registers by iterating `TOOLS` itself, in its own order, rather than 4 separate calls: a hand
 * written list is a second copy of the stable order the whole feature exists to preserve, and a
 * second copy is exactly what drifts silently when a tool is added or reordered in
 * `packages/core`.
 */
export const createServer = (makeIo: () => ToolIo = liveIo): McpServer => {
  const server = new McpServer(
    { name: 'agon', version: '0.0.0' },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  )

  for (const name of TOOLS) {
    server.registerTool(
      name,
      { title: name, description: DESCRIPTIONS[name], inputSchema: toolContracts[name].input },
      // A fresh io per call, not per server: the fixture flag is per request, and a server that
      // outlives one request would otherwise carry the first answer's flag onto every later one.
      (args: unknown) => callAsTool(name, args, makeIo()),
    )
  }

  return server
}
