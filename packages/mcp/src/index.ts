// The MCP server and its 5 tools. Owned by T-C07; prepare_swap by T-C21.
//
// T-E03 puts the dispatch here and nothing else: name in, contract-validated result out, over the
// same functions the API routes serve. The transport, the budgets and the tool descriptions are
// T-C07's. What this buys on day 2 is that the agent side and the web side cannot answer
// differently, because there is only one answer to give.

import { FIXTURE_NOTE, armRule, formatUnits, report } from '@agon/web'
import {
  innermostFailure,
  noAgentRole,
  noHistory,
  noVault,
  outputNotToVault,
  overRemaining,
  quoteMismatch,
  Refusal,
  simulationFailed,
  slippageTooHigh,
  swapNotAgainstSol,
  TOOLS,
  tradeNotPassed,
  mode,
  network,
  JupiterQuote,
  type CheckTradeInput,
  type ToolName,
  toolContracts,
  zeroSizeTrade,
} from '@agon/core'
import { JUPITER_PROGRAM_ID, SWIG_PROGRAM_ID, USDC_MINT, WSOL_MINT } from '@agon/chain'
import { assessTrade, DEFAULT_QUOTE, tradedMints, type Quote } from '@agon/guard'
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

/** The widest slippage prepare_swap builds with, in bps. */
const MAX_SLIPPAGE_BPS = 100

/** The mints an agent role can spend, with what a refusal calls them. */
const ARMED: Record<string, { unit: string; decimals: number }> = {
  [WSOL_MINT]: { unit: 'wSOL', decimals: 9 },
  [USDC_MINT]: { unit: 'USDC', decimals: 6 },
}

/**
 * check_trade's whole read path, for both tools that answer it. The category lookup is enrichment:
 * if it fails the mix is absent and style fit answers unsure, which still keeps the trade in.
 *
 * Decided 2026-09-30: on the practice fork, a wallet with 0 closed trades is judged, not refused.
 * The verdict's first reason, no-trading-history, says so and names `bound`, the only thing that
 * limits the trade there, and `unchecked` tells the caller that the verdict gates nothing. Off the
 * fork an empty history fails closed, because anything that can move funds does. Both tools call
 * this, so an agent that checks before it builds is told the same thing twice (T-C24).
 */
async function judge(io: ToolIo, trade: CheckTradeInput, quote: Quote | null, bound: string) {
  // A size of 0 parses, because the contract's BaseUnits is a non-negative integer, and then
  // sails through every check: 0 is under any median, so the size rule does not fire and the
  // answer reads like a trade that was examined. Nothing is being traded, so there is nothing to
  // approve, and an approval-shaped answer about a non-trade is the wrong thing to hand an agent.
  if (/^0+$/.test(trade.size)) {
    throw new Refusal(zeroSizeTrade())
  }
  const fork = network(process.env['AGON_NETWORK']).id === 'fork'
  const [txs, mintCheck] = await Promise.all([
    io.loadTransactions(trade.wallet),
    io.loadMintCheck(trade.mint),
  ])
  if (txs.length === 0 && !fork) {
    // Anything that can move funds fails closed, and an empty history is not a clean bill.
    throw new Refusal(noHistory({ wallet: trade.wallet }))
  }
  const categories = await io
    .loadCategories(tradedMints(txs, trade.wallet), mintCheck.dataSlot ?? undefined)
    .catch(() => undefined)
  const judged = assessTrade(txs, trade, mintCheck, DEFAULT_QUOTE, categories, quote)
  const unchecked = fork && judged.closedTrades === 0
  if (!unchecked) return { verdict: judged.verdict, unchecked }
  return {
    unchecked,
    verdict: {
      ...judged.verdict,
      reasons: [
        {
          rule: 'no-trading-history',
          message:
            `0 closed trades on mainnet for ${trade.wallet}, so this trade was not checked against ` +
            `a history. On the practice fork prepare_swap still builds it, bounded only by ${bound}. ` +
            `The reasons after this one are what the check found, and none of them stopped the trade.`,
        },
        ...judged.verdict.reasons,
      ],
    },
  }
}

const handlers = {
  // Still the recorded example, because a real Report needs the cost of breaking your own rule and
  // nothing computes that yet. It is labelled rather than quietly served: see `callAsTool`, which
  // puts FIXTURE_NOTE on this tool's result so an agent is told before it repeats a number.
  get_report: (input: unknown) => report(input),

  // Real. Reads this wallet's own history and this mint's own authorities, then runs the same
  // `assessTrade` the CLI runs, so the agent and the terminal cannot answer differently.
  check_trade: async (input: unknown, io: ToolIo) =>
    (
      await judge(
        io,
        toolContracts.check_trade.input.parse(input),
        null,
        // check_trade has read no vault, so it promises no cap: prepare_swap names the amount left.
        'whatever cap the owner has armed on chain for this agent, so arm 1 first, then call ' +
          'prepare_swap, which names the amount left',
      )
    ).verdict,

  arm_rule: (input: unknown) =>
    armRule(input, {
      publicUrl: process.env['AGON_PUBLIC_URL'],
      network: process.env['AGON_NETWORK'],
    }),
  // list_rules reads the wallet's vault from chain (T-C17). The chain stores the role, not
  // the spec, the order id or a window in seconds, so those are null or slots rather than guesses.
  // An empty list now means the chain holds no agent role for this wallet.
  list_rules: async (input: unknown, io: ToolIo) => {
    const { wallet } = input as { wallet: string }
    const { vault, rules } = await io.loadVaultRules(wallet)
    if (vault === null) return []
    return rules.map((r) => ({
      spec: null,
      swigRole: {
        roleId: String(r.roleId),
        authority: r.authority,
        // agentRulesOf lists only roles that passed assertAgentRoleShape, which requires Jupiter.
        program: JUPITER_PROGRAM_ID,
        tokenRecurringLimit: {
          mint: r.mint,
          amount: String(r.amount),
          windowSlots: Number(r.windowSlots),
        },
      },
      jupiterOrderId: null,
      vault,
      effectiveRemaining: String(r.effectiveRemaining),
      rollingWorstCase: String(r.rollingWorstCase),
    }))
  },

  // Builds the trade, never signs it. Every refusal comes before anything is built, in the order
  // that costs least: the arithmetic, then the chain's cap, then check_trade with the real quote,
  // then a simulation on the configured chain. A transaction is returned only past all 4.
  prepare_swap: async (input: unknown, io: ToolIo) => {
    const a = toolContracts.prepare_swap.input.parse(input)
    if (a.slippageBps > MAX_SLIPPAGE_BPS) {
      throw new Refusal(slippageTooHigh({ asked: a.slippageBps, max: MAX_SLIPPAGE_BPS }))
    }
    if (/^0+$/.test(a.amount)) throw new Refusal(zeroSizeTrade())
    // check_trade measures sizes in SOL, so 1 side must be SOL for its rules to mean anything.
    const side = a.inputMint === WSOL_MINT ? 'buy' : a.outputMint === WSOL_MINT ? 'sell' : null
    if (side === null) throw new Refusal(swapNotAgainstSol(a))

    const { vault, rules } = await io.loadVaultRules(a.owner)
    if (vault === null) throw new Refusal(noVault({ owner: a.owner }))
    const rule = rules.find((r) => r.authority === a.agent && r.mint === a.inputMint)
    const armed = ARMED[a.inputMint]
    if (rule === undefined || armed === undefined) {
      throw new Refusal(noAgentRole({ agent: a.agent, vault, mint: a.inputMint }))
    }
    if (BigInt(a.amount) > rule.effectiveRemaining) {
      throw new Refusal(
        overRemaining({
          amount: formatUnits(BigInt(a.amount), armed.decimals),
          remaining: formatUnits(rule.effectiveRemaining, armed.decimals),
          unit: armed.unit,
        }),
      )
    }

    const fork = network(process.env['AGON_NETWORK']).id === 'fork'
    // Venues to route around, filled at most once, on the fork, by a failed simulation below.
    const excludeDexes: string[] = []
    for (;;) {
      // The quote is outside data. It must parse, and be the trade that was asked for, or the check
      // below would judge one trade and the transaction would carry another.
      const parsed = JupiterQuote.safeParse(
        await io.loadQuote(excludeDexes.length > 0 ? { ...a, excludeDexes } : a),
      )
      if (!parsed.success) {
        throw new Refusal(
          quoteMismatch({ field: String(parsed.error.issues[0]?.path[0] ?? 'shape') }),
        )
      }
      const quote = parsed.data
      // The floor the output check holds the swap to is recomputed from what was asked, never taken
      // on Jupiter's word, so a floor of 0 cannot wave through a swap that pays the vault nothing.
      const floor = (BigInt(quote.outAmount) * BigInt(10000 - a.slippageBps)) / 10000n
      const drift = (
        [
          ['inAmount', quote.inAmount === a.amount],
          ['inputMint', quote.inputMint === a.inputMint],
          ['outputMint', quote.outputMint === a.outputMint],
          ['slippageBps', quote.slippageBps === a.slippageBps],
          ['otherAmountThreshold', floor > 0n && BigInt(quote.otherAmountThreshold) >= floor],
        ] as const
      ).find(([, ok]) => !ok)
      if (drift !== undefined) throw new Refusal(quoteMismatch({ field: drift[0] }))
      const route = quote.routePlan.map((leg) => leg.swapInfo.ammKey)
      // `judge` decides the fork's no-history case; here the bound it names is the signed cap.
      const { verdict, unchecked } = await judge(
        io,
        {
          wallet: a.historyWallet,
          mint: side === 'buy' ? a.outputMint : a.inputMint,
          side,
          size: a.amount,
        },
        {
          priceImpactPct: quote.priceImpactPct,
          slippageBps: quote.slippageBps,
          contextSlot: quote.contextSlot ?? null,
        },
        `the cap the owner signed: ${formatUnits(rule.effectiveRemaining, armed.decimals)} ` +
          `${armed.unit} left in this window`,
      )
      if (verdict.verdict !== 'pass' && !unchecked) {
        throw new Refusal(
          tradeNotPassed({
            verdict: verdict.verdict,
            reasons: verdict.reasons.length,
            first: verdict.reasons[0]?.message ?? 'none was given.',
          }),
        )
      }

      const built = await io.buildSwap({
        owner: a.owner,
        agent: a.agent,
        roleId: rule.roleId,
        quote,
      })
      if (built.failure !== null) {
        const program = innermostFailure(built.failure.logs) ?? 'unknown'
        // Fork only: a venue that cannot run on the fork's copy, whose clock lags real time, is routed
        // around once, and every check above runs again on the new route. The spending limit is never
        // routed around, and off the fork a failed simulation is the answer.
        const venues = quote.routePlan.flatMap((leg) => {
          const label = (leg.swapInfo as { label?: unknown }).label
          return typeof label === 'string' ? [label] : []
        })
        if (fork && excludeDexes.length === 0 && program !== SWIG_PROGRAM_ID && venues.length > 0) {
          excludeDexes.push(...venues)
          continue
        }
        const line = built.failure.logs.find((l) => l.startsWith(`Program ${program} failed`))
        throw new Refusal(
          simulationFailed({
            program,
            detail:
              line?.replace(/^Program \S+ failed: /, '') ?? 'the logs named no failing program',
          }),
        )
      }
      if (built.outputGained < BigInt(quote.otherAmountThreshold)) {
        throw new Refusal(
          outputNotToVault({
            gained: String(built.outputGained),
            promised: quote.otherAmountThreshold,
          }),
        )
      }
      return {
        transaction: built.transaction,
        vault: built.vault,
        verdict,
        quote: {
          inAmount: quote.inAmount,
          outAmount: quote.outAmount,
          minOutAmount: quote.otherAmountThreshold,
          slippageBps: quote.slippageBps,
          route,
        },
        effectiveRemaining: String(rule.effectiveRemaining),
        lastValidBlockHeight: built.lastValidBlockHeight,
        unitsConsumed: built.unitsConsumed,
      }
    }
  },
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
const dataSource = (): string =>
  mode() === 'replay'
    ? `This deployment is running in REPLAY MODE. It reads committed recordings and cannot reach the
network at all, so every wallet figure it gives you was recorded earlier, not read just now. Each
such result carries a "note" field saying so, and you should repeat that note alongside any number
you quote. Only 1 wallet and a small set of mints have recordings; anything else is refused rather
than guessed at. The arithmetic over those recorded inputs is real and recomputes per request.`
    : `This deployment reads live mainnet, so wallet figures are read at request time and carry the
slot they were read at in "dataSlot".`

const INSTRUCTIONS = `Agon turns a trader's own on-chain history into a spending limit their agent has to trade inside.

Network: ${network(process.env['AGON_NETWORK']).short}. Every result starts with this as "network"
(an error starts with "Network:"). Tell the user which network before quoting any number from it.

${dataSource()}

What works right now, with nothing to set up:

- check_trade is real, meaning the rule engine is real. Give it a wallet, a mint, a side and a size
  in base units, and it decodes that wallet's swaps from balance changes, builds a FIFO ledger,
  mines what that trader normally does, checks the mint's authorities, and answers pass, block or
  unsure. A non-pass always names the rule and the number, for example "12.4x your median size of
  0.162 SOL, past your 2x limit". Those numbers are arithmetic over that wallet's history, never a
  model's opinion. Where that history came from is the paragraph above.
- The size rule is checked on a BUY only. A sell is not sized against the median, because the
  median is a cost basis counted in the quote asset and a sell's size is counted in the mint. So a
  large sell returns no size reason. That is a gap, not a pass.
- list_rules reads the wallet's vault from the chain this deployment names. Each rule gives the
  vault, the agent key, the cap per window in slots, effectiveRemaining (what can be spent now) and
  rollingWorstCase (up to 2 windows across a window edge). Quote effectiveRemaining, never a raw
  figure, and give rollingWorstCase beside it. spec is null because the chain does not store it. An
  empty list means no agent role is armed; an error means no chain was read, which is different.
- prepare_swap builds 1 trade for an armed vault and never signs it. Give it the vault owner, the
  wallet whose history judges the trade, the agent's public key, the 2 mints (1 must be wrapped SOL, So11111111111111111111111111111111111111112),
  the amount in base units and a slippage of at most 100 bps. It runs check_trade itself with a
  real quote and returns an unsigned base64 transaction only on a pass, after it passed simulation.
  The agent signs it with its own key, locally, and sends it before lastValidBlockHeight. A refusal
  means no transaction exists: never build one another way.
- The history wallet is only read, never signed for. On mainnet it is the owner. On the practice
  fork, pass the owner too: if it has never traded on mainnet (fork activity never counts), the
  trade still goes out, unchecked against a history and bounded only by the cap the owner signed,
  and the verdict's first reason, no-trading-history, says so; tell the user that before you sign.
  Never suggest a real mainnet trade to create history: that spends real funds.

What is not real yet, so do not present it as a measurement:

- get_report answers from a recorded example, not from the wallet you asked about, and returns the
  same figures whatever wallet you pass. Its result carries a "note" field saying so. Repeat that
  note if you quote any of its numbers. It does not agree with check_trade about the same wallet,
  because the two read different recordings.
- arm_rule arms nothing itself. It returns a link to the arming screen, where the user connects
  their own wallet and sets the spending limit from what their history suggests; you never name the
  limit, and a request that carries one is refused. It works on the practice fork only, and refuses
  elsewhere with the reason: that refusal is the correct answer, not an error to retry.

Setup: none. No wallet connection and no private key: this server never takes, returns or logs
one, and signs nothing. Every call but prepare_swap is a read, and prepare_swap only returns a
transaction for the agent to sign. You need a mainnet wallet address to ask about. On mainnet a
wallet with no trading history is refused rather than approved, because there is nothing to judge a
trade against. On the practice fork a wallet with 0 closed trades is judged unchecked instead, and
both check_trade and prepare_swap put no-trading-history first, as the history wallet paragraph
above says.

Two things worth knowing before you interpret an answer. check_trade on its own takes no price
quote, so its slippage and price impact answers are "not read" and it answers unsure; prepare_swap
runs the same check with the quote it routes, and only that can reach pass. Unsure is not a soft
pass, it means the trade does not go out. Token names and descriptions never appear in any answer.
And sizes are base units, never decimals: 1 SOL is 1000000000.`

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
    'Get a link to the arming screen for a wallet. The user opens it, connects their own wallet ' +
    'and sets the spending limit there; this tool never takes a limit and refuses a request that ' +
    'carries one. Practice fork only until the pre-mainnet checklist is ticked.',
  list_rules:
    "List the agent rules armed on a wallet's vault, read from chain: the cap per window in slots, " +
    'what the agent can spend now, and the most it can spend across a window edge.',
  prepare_swap:
    'Build 1 unsigned swap from an armed vault for the agent to sign locally. Runs check_trade ' +
    'with a real quote and simulates first; returns a transaction only on a pass, and refuses ' +
    'with the cause and number otherwise. Never takes or returns a private key.',
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
  const net = network(process.env['AGON_NETWORK'])
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
    //
    // `network` goes first, because an agent's client shows no banner of ours: the first thing it
    // reads is the only place to say whether these are real funds. A list (list_rules) cannot carry
    // a first key, and spreading one into an object turns [r0, r1] into {"0": r0, "1": r1}, so a
    // list goes out under "rules" instead.
    const fromFixture = ALWAYS_FIXTURE.includes(name) || io.usedFixture()
    const labelled = Array.isArray(result)
      ? { network: net.short, rules: result }
      : { network: net.short, ...(result as object) }
    const text = JSON.stringify(fromFixture ? { ...labelled, note: FIXTURE_NOTE } : labelled)
    return { content: [{ type: 'text', text }] }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      isError: true,
      content: [{ type: 'text', text: `Network: ${net.short}. ${message}` }],
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
