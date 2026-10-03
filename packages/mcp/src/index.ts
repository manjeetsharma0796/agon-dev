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
  historyTimedOut,
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
  type CheckTradeOutput,
  type FailureMessage,
  type PrepareSwapInput,
  type ToolName,
  toolContracts,
  zeroSizeTrade,
} from '@agon/core'
import { JUPITER_PROGRAM_ID, SWIG_PROGRAM_ID, USDC_MINT, WSOL_MINT } from '@agon/chain'
import { assessTrade, DEFAULT_QUOTE, tradedMints, type Quote } from '@agon/guard'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { liveIo, valueTrades, type ToolIo } from './io.js'
import { checkTradeRow, journalFor, readActivity, type Journal } from './journal.js'

export { TOOLS, type ToolName }

/** What a tool call returns when the tool exists but refuses. Never a fabricated success. */
export interface ToolRefusal {
  refused: true
  tool: ToolName
  message: string
}

type Handler = (input: unknown, io: ToolIo, journal: Journal) => unknown | Promise<unknown>

/**
 * The journal a caller gets when it names none: no database, so every write is a named failure and
 * every read is refused. Only serve.ts opens the real one, so no test or library caller can write
 * to Neon by accident.
 */
const NO_JOURNAL = journalFor(undefined)

/** The widest slippage prepare_swap builds with, in bps. */
const MAX_SLIPPAGE_BPS = 100

/**
 * Seconds an agent key's history scan may take. Under opencode's 5 s MCP client timeout, so the
 * agent reads our reason rather than a bare "Request timed out". The scan is not cancelled, only
 * no longer waited for.
 */
const HISTORY_DEADLINE_S = 4

const withinHistoryDeadline = <T>(scan: Promise<T>, agent: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Refusal(historyTimedOut({ agent, seconds: HISTORY_DEADLINE_S }))),
      HISTORY_DEADLINE_S * 1000,
    )
  })
  return Promise.race([scan, late]).finally(() => clearTimeout(timer))
}

/** The mints an agent role can spend, with what a refusal calls them. */
export const ARMED: Record<string, { unit: string; decimals: number }> = {
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

/**
 * A Solana Explorer link on the network this deployment names. On the practice fork it points the
 * explorer at the fork's RPC as the user's browser reaches it (127.0.0.1:8899 in the local Docker).
 */
export const explorer = (kind: 'address' | 'tx', id: string): string => {
  const base = `https://explorer.solana.com/${kind}/${id}`
  const net = network(process.env['AGON_NETWORK']).id
  if (net === 'mainnet') return base
  if (net === 'devnet') return `${base}?cluster=devnet`
  const rpc = process.env['AGON_PUBLIC_RPC_URL'] ?? 'http://127.0.0.1:8899'
  return `${base}?cluster=custom&customUrl=${encodeURIComponent(rpc)}`
}

/** What prepare_swap's quote and check need: the pair, the amount, the slippage, whose history. */
type SwapAsk = Pick<
  PrepareSwapInput,
  'inputMint' | 'outputMint' | 'amount' | 'slippageBps' | 'historyWallet'
>

/**
 * 1 Jupiter quote, checked to be the trade asked for, then check_trade on it. Shared by prepare_swap
 * and the action layer (T-C32), so the owner's link and the agent's transaction are judged alike.
 */
export async function quoteAndJudge(
  io: ToolIo,
  a: SwapAsk,
  side: 'buy' | 'sell',
  emptyHistoryAllowed: boolean,
  excludeDexes: readonly string[] = [],
) {
  // The quote is outside data. It must parse, and be the trade that was asked for, or the check
  // below would judge one trade and the transaction would carry another.
  const ask = {
    inputMint: a.inputMint,
    outputMint: a.outputMint,
    amount: a.amount,
    slippageBps: a.slippageBps,
  }
  const parsed = JupiterQuote.safeParse(
    await io.loadQuote(excludeDexes.length > 0 ? { ...ask, excludeDexes: [...excludeDexes] } : ask),
  )
  if (!parsed.success) {
    throw new Refusal(quoteMismatch({ field: String(parsed.error.issues[0]?.path[0] ?? 'shape') }))
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
    emptyHistoryAllowed,
  )
  return { quote, judged }
}

/**
 * How the action layer (T-C32) gates a build, where prepare_swap's own rule would not: `block` always
 * stops, and `unsure` stops unless the person confirmed it. `onVerdict` sees the verdict before
 * anything is built or refused, so a stopped trade is journaled with its reasons.
 */
export interface SwapGate {
  confirmedUnsure: boolean
  onVerdict: (verdict: CheckTradeOutput) => void
}

/**
 * Builds the trade, never signs it. Every refusal comes before anything is built, in the order that
 * costs least: the arithmetic, then the chain's cap, then check_trade with the real quote, then a
 * simulation on the configured chain. A transaction is returned only past all 4.
 */
export async function prepareSwap(a: PrepareSwapInput, io: ToolIo, gate?: SwapGate) {
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
  // Nothing is checked against a history it does not have, the trade is bounded only by the cap the
  // owner signed on chain, and the answer says so first. Off the fork this still fails closed.
  const fork = network(process.env['AGON_NETWORK']).id === 'fork'
  // Venues to route around, filled at most once, on the fork, by a failed simulation below.
  const excludeDexes: string[] = []
  for (;;) {
    const { quote, judged } = await quoteAndJudge(io, a, side, fork, excludeDexes)
    const route = quote.routePlan.map((leg) => leg.swapInfo.ammKey)
    const unchecked = fork && judged.closedTrades === 0
    const verdict = unchecked
      ? {
          ...judged.verdict,
          // The action layer never reads an unchecked trade as a pass: the owner confirms it.
          verdict:
            gate !== undefined && judged.verdict.verdict === 'pass'
              ? ('unsure' as const)
              : judged.verdict.verdict,
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
    gate?.onVerdict(verdict)
    const stopped =
      gate === undefined
        ? verdict.verdict !== 'pass' && !unchecked
        : verdict.verdict === 'block' || (verdict.verdict === 'unsure' && !gate.confirmedUnsure)
    if (stopped) {
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
}

/**
 * Owners who paused their agent's new buys (T-C32), and since when. In this process's memory only,
 * so a restart resumes the agent, and the pause answer says so and points at revoke for a hard stop.
 */
const PAUSED = new Map<string, string>()

export const pausedSince = (owner: string): string | undefined => PAUSED.get(owner)

export const setPaused = (owner: string, since: string | null): void => {
  if (since === null) PAUSED.delete(owner)
  else PAUSED.set(owner, since)
}

const agentPaused = (a: { owner: string; since: string }): FailureMessage => ({
  id: 'agent-paused',
  text:
    `The owner of ${a.owner} paused new buys by the agent at ${a.since}, so no transaction was ` +
    'built. Sells still work. Ask the owner to resume, or to make this buy themselves.',
  mode: 'closed',
  systemDoes:
    'Refuses every agent buy for this owner until the owner resumes or the server restarts.',
})

const handlers = {
  // Still the recorded example, because a real Report needs the cost of breaking your own rule and
  // nothing computes that yet. It is labelled rather than quietly served: see `callAsTool`, which
  // puts FIXTURE_NOTE on this tool's result so an agent is told before it repeats a number.
  get_report: (input: unknown) => report(input),

  // Real. Reads this wallet's own history and this mint's own authorities, then runs the same
  // `assessTrade` the CLI runs, so the agent and the terminal cannot answer differently.
  // Every call writes 1 journal row, verdict or refusal (T-C30). `record` never throws and the verdict
  // is returned as judged, so a database that is down changes nothing the caller reads.
  check_trade: async (input: unknown, io: ToolIo, journal: Journal) => {
    const trade = toolContracts.check_trade.input.parse(input)
    let verdict
    try {
      verdict = (await judge(io, trade, null)).verdict
    } catch (error) {
      await journal.record(checkTradeRow(trade, { error }))
      throw error
    }
    await journal.record(checkTradeRow(trade, { verdict }))
    return verdict
  },

  arm_rule: (input: unknown) =>
    armRule(input, {
      publicUrl: process.env['AGON_PUBLIC_URL'],
      network: process.env['AGON_NETWORK'],
    }),
  // list_rules reads the wallet's vault from chain (T-C17). The chain stores the role, not
  // the spec, the order id or a window in seconds, so those are null or slots rather than guesses.
  // An empty list now means the chain holds no agent role for this wallet.
  // An agent key's scan has a deadline (T-C29): the agent gets our reason, not a client timeout.
  list_rules: async (input: unknown, io: ToolIo) => {
    const { wallet } = input as { wallet: string }
    // The owner's own vault, or else every wallet that hired this key when it is an agent's (T-C24).
    const own = await io.loadVaultRules(wallet)
    const found =
      own.vault !== null ? [own] : await withinHistoryDeadline(io.findHirers(wallet), wallet)
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

  // Builds the trade, never signs it (prepareSwap above). A paused agent opens no new position
  // (T-C32): the action layer refuses its buys, and so does this tool, its direct path.
  prepare_swap: async (input: unknown, io: ToolIo) => {
    const a = toolContracts.prepare_swap.input.parse(input)
    const since = PAUSED.get(a.owner)
    if (since !== undefined && a.inputMint === WSOL_MINT) {
      throw new Refusal(agentPaused({ owner: a.owner, since }))
    }
    return prepareSwap(a, io)
  },

  // What an armed vault holds and how its trades are doing (T-C25). The P&L is arithmetic over
  // chain numbers and 1 live quote per received mint; with no quote it is null and says why.
  vault_status: async (input: unknown, io: ToolIo) => {
    const { wallet } = toolContracts.vault_status.input.parse(input)
    const a = await io.loadVaultActivity(wallet)
    const received = new Map<string, bigint>()
    for (const t of a.trades) {
      if (t.received.mint !== WSOL_MINT) {
        received.set(t.received.mint, (received.get(t.received.mint) ?? 0n) + t.received.amount)
      }
    }
    const worth = new Map<string, { amount: bigint; worth: bigint }>()
    let noQuote: string | null = null
    for (const [mint, amount] of received) {
      try {
        worth.set(mint, { amount, worth: await io.loadWorth(mint, String(amount)) })
      } catch (error) {
        noQuote = error instanceof Error ? error.message : String(error)
      }
    }
    const valued = valueTrades(a.trades, worth)
    const complete = valued.length > 0 && valued.every((v) => v.pnl !== null)
    const total = complete ? valued.reduce((sum, v) => sum + (v.pnl ?? 0n), 0n) : null
    return {
      vault: a.vault,
      owner: wallet,
      nativeSol: String(a.nativeSol),
      balances: a.balances.map((b) => ({ mint: b.mint, amount: String(b.amount) })),
      agents: a.agents.map((g) => ({ address: g.address, feeSol: String(g.feeSol) })),
      trades: valued.map((v) => ({
        signature: v.signature,
        slot: v.slot,
        spent: { mint: v.spent.mint, amount: String(v.spent.amount) },
        received: { mint: v.received.mint, amount: String(v.received.amount) },
        worthNow: v.worthNow === null ? null : String(v.worthNow),
        pnl: v.pnl === null ? null : String(v.pnl),
        explorer: explorer('tx', v.signature),
      })),
      pnl: total === null ? null : String(total),
      pnlNote:
        valued.length === 0
          ? '0 trades from this vault yet, so there is no P&L.'
          : total !== null
            ? "In wSOL base units: each trade's received tokens valued at a live Jupiter quote now, " +
              'less the wSOL it spent. Arithmetic only.'
            : `No total: ${noQuote ?? 'a trade was not paid in wSOL, so it has no P&L in wSOL.'}`,
      explorer: explorer('address', a.vault),
      dataSlot: a.slot,
    }
  },

  // Fork only, never a restart or a reset of a vault (T-C25).
  sync_fork: async (input: unknown, io: ToolIo) => {
    const { inputMint, outputMint } = toolContracts.sync_fork.input.parse(input)
    return io.syncFork([inputMint ?? WSOL_MINT, outputMint ?? USDC_MINT])
  },

  // The journal, read only with a signature by the wallet or a key its vault hires (T-C30).
  get_activity: (input: unknown, io: ToolIo, journal: Journal) =>
    readActivity(toolContracts.get_activity.input.parse(input), io, journal),
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
  journal: Journal = NO_JOURNAL,
): Promise<unknown> => {
  const contract = toolContracts[name]
  const parsed = contract.input.parse(input)
  return contract.output.parse(await handlers[name](parsed, io, journal))
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

const instructions = (
  kit: string,
): string => `Agon: a spending limit mined from a trader's own history, which their agent trades inside.
Network: ${network(process.env['AGON_NETWORK']).short}. Every result starts with "network"; say it before quoting a number. ${dataSource()}

"Onboard me": do these in order. Build nothing, read no source: it all exists. Do not ask for their address.
1. Your key: run curl -fsS --create-dirs -o ~/.agon/agon-kit.mjs ${kit} && node ~/.agon/agon-kit.mjs key. It prints your public key (made once, chmod 600). Write no key or signing code; never show the secret.
2. Phantom: Settings, Developer Settings, Testnet Mode, Solana Localnet (the fork, RPC http://127.0.0.1:8899).
3. arm_rule with agent your public key, mints ["So11111111111111111111111111111111111111112"], triggerType "stop", expiresAt null. Give them the link: they connect Phantom (your key is prefilled), take free practice SOL if short, pick a deposit and cap, and approve 2 transactions (also funding your fees). The link resumes if they stop.
4. When they say done, list_rules with your own public key: it lists each wallet that hired you (owner), vault, cap and effectiveRemaining. Ask them to confirm the owner matches Phantom (if several, which), then remember it.

Trade: prepare_swap with owner and historyWallet both the owner list_rules gave, agent your public key, inputMint wrapped SOL, amount in base units (1 SOL = 1000000000), slippageBps up to 100. A returned transaction is cleared, whatever the verdict word: tell them its first reason, then at once run node ~/.agon/agon-kit.mjs send <transaction> (signs, sends, prints the signature). "failed simulation": a price moved, so call prepare_swap again. They revoke from the arm_rule link.

Rules: never name a limit; from check_trade, unsure or block means no trade; read a refusal's first sentence to the user, and do not retry it; never suggest a real mainnet trade. Details: each tool's description.`

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
    '["So11111111111111111111111111111111111111112"], triggerType "stop", expiresAt null (JSON null, not the string "null"). You never name the limit, and a request that carries one is refused. Practice ' +
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
    'fee payer and only signer. Sign and send it at once with the kit from the instructions: node ' +
    '~/.agon/agon-kit.mjs send <transaction>; it prints the signature. On the practice fork a wallet with no mainnet ' +
    'trades still trades, bounded only by the cap the owner signed: its verdict stays unsure, the ' +
    'first reason, no-trading-history, says so, and the transaction is cleared to sign; tell the ' +
    'user before signing. A refusal means no transaction ' +
    'exists: never build one another way, and never suggest a real mainnet trade to create history.',
  vault_status:
    'What an armed vault holds and how its trades are doing, read from the chain. Pass the ' +
    "owner's wallet (list_rules gives it as owner). Returns balances by mint in base units (wSOL " +
    "is what trades), each agent key's SOL for its fees, the vault's trades newest first (spent and " +
    'received by mint), P&L per trade and in total in wSOL base units, valued at a live Jupiter ' +
    'quote, and explorer links for the vault and each trade. Mints only, never token names. With ' +
    'no live quote the P&L is null and pnlNote says why; repeat pnlNote with any P&L you quote.',
  sync_fork:
    'Practice fork only. Use it when swaps keep failing simulation or prices look stale: it moves ' +
    "the fork's clock to real time (it lags by tens of seconds) and copies from mainnet again the " +
    "accounts a pair's route reads (wSOL to USDC unless you pass inputMint and outputMint). It never " +
    'restarts the fork or resets a vault, so nothing armed is lost. Returns the clock lag before and ' +
    'after, the accounts refreshed, and a note to read to the user.',
  get_activity:
    "The vault's journal: every check_trade verdict and every action, newest first, with who did " +
    'it (owner-web, owner-terminal or agent) and its key, by mint, amounts in base units. Call it ' +
    'with wallet alone: it refuses with a nonce and the exact text to sign. Sign that text with the ' +
    "owner's key or an agent key the vault hires, then call again with signer, nonce and signature " +
    '(base58) within 60 s; limit is 1 to 10, default 10. writeFailures lists writes that did not ' +
    'land, so a missing row is never silent. check_trade calls carry no proven key, so their rows ' +
    'are unattributed and hidden unless you pass unattributed true; unattributedHidden counts them. ' +
    'Never present an unattributed row as something the user or you did. Mints only, never token names.',
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
  journal: Journal = NO_JOURNAL,
): Promise<CallToolResult> => {
  const net = network(process.env['AGON_NETWORK'])
  try {
    const result = await callTool(name, input ?? {}, io, journal)
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
export const createServer = (
  makeIo: () => ToolIo = liveIo,
  kit = 'http://127.0.0.1:8787/kit.mjs',
  journal: Journal = NO_JOURNAL,
): McpServer => {
  const server = new McpServer(
    { name: 'agon', version: '0.0.0' },
    { capabilities: { tools: {} }, instructions: instructions(kit) },
  )

  for (const name of TOOLS) {
    server.registerTool(
      name,
      { title: name, description: DESCRIPTIONS[name], inputSchema: toolContracts[name].input },
      // A fresh io per call, not per server: the fixture flag is per request, and a server that
      // outlives one request would otherwise carry the first answer's flag onto every later one.
      (args: unknown) => callAsTool(name, args, makeIo(), journal),
    )
  }

  return server
}
