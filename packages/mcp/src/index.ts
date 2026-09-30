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
 */
async function judge(
  io: ToolIo,
  trade: CheckTradeInput,
  quote: Quote | null,
  // Only prepare_swap on the practice fork: an empty history is judged (so the answer still says
  // what the check found) rather than refused, and the caller decides what that verdict gates.
  emptyHistoryAllowed = false,
) {
  // A size of 0 parses, because the contract's BaseUnits is a non-negative integer, and then
  // sails through every check: 0 is under any median, so the size rule does not fire and the
  // answer reads like a trade that was examined. Nothing is being traded, so there is nothing to
  // approve, and an approval-shaped answer about a non-trade is the wrong thing to hand an agent.
  if (/^0+$/.test(trade.size)) {
    throw new Refusal(zeroSizeTrade())
  }
  const [txs, mintCheck] = await Promise.all([
    io.loadTransactions(trade.wallet),
    io.loadMintCheck(trade.mint),
  ])
  if (txs.length === 0 && !emptyHistoryAllowed) {
    // Anything that can move funds fails closed, and an empty history is not a clean bill.
    throw new Refusal(noHistory({ wallet: trade.wallet }))
  }
  const categories = await io
    .loadCategories(tradedMints(txs, trade.wallet), mintCheck.dataSlot ?? undefined)
    .catch(() => undefined)
  return assessTrade(txs, trade, mintCheck, DEFAULT_QUOTE, categories, quote)
}

const handlers = {
  // Still the recorded example, because a real Report needs the cost of breaking your own rule and
  // nothing computes that yet. It is labelled rather than quietly served: see `callAsTool`, which
  // puts FIXTURE_NOTE on this tool's result so an agent is told before it repeats a number.
  get_report: (input: unknown) => report(input),

  // Real. Reads this wallet's own history and this mint's own authorities, then runs the same
  // `assessTrade` the CLI runs, so the agent and the terminal cannot answer differently.
  check_trade: async (input: unknown, io: ToolIo) =>
    (await judge(io, toolContracts.check_trade.input.parse(input), null)).verdict,

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
    // The owner's own vault, or else every wallet that hired this key when it is an agent's (T-C24).
    const own = await io.loadVaultRules(wallet)
    const found = own.vault !== null ? [own] : await io.findHirers(wallet)
    return found.flatMap(({ owner, vault, rules }) =>
      owner === null || vault === null
        ? []
        : rules.map((r) => ({
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
            owner,
            effectiveRemaining: String(r.effectiveRemaining),
            rollingWorstCase: String(r.rollingWorstCase),
          })),
    )
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

    // Decided 2026-09-30: on the practice fork, a history wallet with 0 closed trades is not refused.
    // Nothing is checked against a history it does not have, the trade is bounded only by the cap
    // the owner signed on chain, and the answer says so first. Off the fork this still fails closed.
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
      const judged = await judge(
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
        fork,
      )
      const unchecked = fork && judged.closedTrades === 0
      const verdict = unchecked
        ? {
            ...judged.verdict,
            reasons: [
              {
                rule: 'no-trading-history',
                message:
                  `0 closed trades on mainnet for ${a.historyWallet}, so this trade was not checked ` +
                  `against a history. On the practice fork it goes out bounded only by the cap the ` +
                  `owner signed: ${formatUnits(rule.effectiveRemaining, armed.decimals)} ` +
                  `${armed.unit} left in this window. The reasons after this one are what the check ` +
                  `found, and none of them stopped the trade.`,
              },
              ...judged.verdict.reasons,
            ],
          }
        : judged.verdict
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
        const failed = innermostFailure(built.failure.logs)
        const program = failed ?? 'unknown'
        // Fork only: a venue that cannot run on the fork's copy, whose clock lags real time, is routed
        // around once, and every check above runs again on the new route. The spending limit is never
        // routed around, and off the fork a failed simulation is the answer.
        const venues = quote.routePlan.flatMap((leg) => {
          const label = (leg.swapInfo as { label?: unknown }).label
          return typeof label === 'string' ? [label] : []
        })
        if (
          fork &&
          excludeDexes.length === 0 &&
          failed !== null &&
          failed !== SWIG_PROGRAM_ID &&
          venues.length > 0
        ) {
          excludeDexes.push(...venues)
          continue
        }
        const line = built.failure.logs.find((l) => l.startsWith(`Program ${program} failed`))
        throw new Refusal(
          simulationFailed({
            program,
            detail:
              line?.replace(/^Program \S+ failed: /, '') ??
              `no program ran; the chain answered ${built.failure.err ?? 'with no error'}`,
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
    ? 'Data: REPLAY MODE. Wallet figures are recordings, not read now; repeat any "note" a result carries.'
    : 'Data: live mainnet reads, each stamped with its dataSlot.'

const INSTRUCTIONS = `Agon: a spending limit mined from a trader's own history, which their agent trades inside.
Network: ${network(process.env['AGON_NETWORK']).short}. Every result starts with "network"; say it before quoting a number. ${dataSource()}

"Onboard me": do these in order. Build nothing, read no source: it all exists. Do not ask for their address.
1. Make (or reuse) your own keypair here, in a chmod 600 file; never show its secret. Practice only, never mainnet.
2. They set Phantom to Settings, Developer Settings, Testnet Mode, Solana Localnet: the practice fork, RPC http://127.0.0.1:8899.
3. arm_rule with agent your public key, mints ["So11111111111111111111111111111111111111112"], triggerType "stop", expiresAt null. Give them the link: they connect Phantom (your key is prefilled), take free practice SOL if short, pick a deposit and cap, and approve 2 transactions (which also pay your fees). The link resumes if they stop.
4. When they say done, list_rules with your own public key: it lists every wallet that hired you (owner), each with its vault, cap and effectiveRemaining. Show them the owner and ask them to confirm it is the wallet in Phantom (if several, which one); then remember it.

Trade: prepare_swap with owner and historyWallet both the owner list_rules gave, agent your public key, inputMint wrapped SOL, amount in base units (1 SOL = 1000000000), slippageBps up to 100. A returned transaction is cleared to go out, whatever the verdict word: tell them the verdict and its first reason, then sign it with your key and send it to the same RPC before lastValidBlockHeight. "failed simulation": a price moved, so call prepare_swap again. They revoke from the arm_rule link.

Rules: never name a limit; from check_trade, unsure or block means no trade; read a refusal's first sentence to the user, and do not retry it; never suggest a real mainnet trade; this server never holds or signs with a key. Details: each tool's description.`

/**
 * What each tool does, shown to any agent that lists our tools before it decides whether to call
 * one. Says plainly what is real today, so arm_rule's refusal is not a surprise discovered by
 * calling it: arming turns on only once F5 and F6 pass.
 */
const DESCRIPTIONS: Record<ToolName, string> = {
  get_report:
    "A wallet's mined trading habits: stop discipline, sizing, hold time, coverage and the cost of " +
    'breaking its own rules. Not real yet: it answers from 1 recorded example, the same figures for ' +
    'any wallet, with a "note" saying so; repeat the note if you quote a number. Read only.',
  check_trade:
    "Judge 1 proposed trade against the wallet's own mined rules: wallet, mint, side, size in base " +
    "units. Real: it decodes the wallet's swaps, builds a FIFO ledger, mines its habits and checks " +
    "the mint's authorities. Answers pass, block or unsure; a non-pass names the rule and the " +
    'number. Unsure is not a soft pass: the trade does not go out. On its own it takes no price ' +
    'quote, so it answers unsure at best; only prepare_swap can reach pass. The size rule checks ' +
    'buys only, so a large sell gets no size reason, a gap and not a pass. A wallet with no trading ' +
    'history is refused here, since there is nothing to judge against.',
  arm_rule:
    'Onboarding step 3. Returns a link to the arming screen, a web page that already exists: the ' +
    'user connects their own wallet (Phantom on Solana Localnet), your key is filled in from the ' +
    'link, they can take free practice SOL, pick a deposit and a cap, and approve 2 transactions ' +
    'that also send your key 0.01 SOL for fees; the same link resumes if they stop halfway. Pass ' +
    'agent (your public key), and wallet only if they gave it; mints ' +
    '["So11111111111111111111111111111111111111112"], triggerType "stop", expiresAt null. You never name the limit, and a request that carries one is refused. Practice ' +
    'fork only; elsewhere it refuses with the reason, which is the answer, not an error to retry.',
  list_rules:
    "The agent rules armed on a wallet's vault, read from the chain. Pass the owner's wallet, or " +
    'your own public key to find the wallet that hired you: each rule carries owner, which is ' +
    'what prepare_swap takes. Each also gives vault, agent key, cap per ' +
    'window in slots, effectiveRemaining (what can be spent now) and rollingWorstCase (up to 2 ' +
    'windows across a window edge). Quote effectiveRemaining, never a raw figure, with ' +
    'rollingWorstCase beside it. An empty list means no agent is armed; an error means no chain ' +
    'was read, which is different.',
  prepare_swap:
    'Build 1 unsigned swap from an armed vault for you to sign locally. Pass owner and ' +
    "historyWallet as the user's wallet, agent as your public key, inputMint and outputMint (1 must " +
    'be wrapped SOL, So11111111111111111111111111111111111111112), amount in base units of the ' +
    'input, slippageBps up to 100. It checks the amount against the chain cap, runs check_trade ' +
    'with a real quote, and simulates; it returns a base64 transaction only past all 3, with you as ' +
    'fee payer and only signer. Sign it with your key and send it before lastValidBlockHeight, e.g. ' +
    'with @solana/web3.js: Transaction.from(Buffer.from(transaction, "base64")), tx.sign(keypair), ' +
    'connection.sendRawTransaction(tx.serialize()). On the practice fork a wallet with no mainnet ' +
    'trades still trades, bounded only by the cap the owner signed: its verdict stays unsure, the ' +
    'first reason, no-trading-history, says so, and the transaction is cleared to sign; tell the ' +
    'user before signing. A refusal means no transaction ' +
    'exists: never build one another way, and never suggest a real mainnet trade to create history.',
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
