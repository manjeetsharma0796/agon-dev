// The failure-message catalogue. Owned by T-E10.
//
// The 11 rows from the PRD's failure table, one function each. Every message names the cause, the
// number involved, and what the user can do next, because a message that says "something went
// wrong" tells a trader nothing and tells a judge less.
//
// The numbers are parameters rather than prose. A message that cannot be written without its
// numbers cannot be shipped with the numbers missing, which is the failure mode this catalogue
// exists to prevent.

/**
 * `closed`: this touches something that can move funds, so nothing goes out until it is resolved.
 * `open`: analytics continue, and the message always states what the answer is based on.
 */
export type FailureMode = 'closed' | 'open'

export interface FailureMessage {
  /** Stable id, used by the guard's reasons and by the report. */
  id: string
  /** What the user reads. */
  text: string
  mode: FailureMode
  /** What the system does, so the UI and the daemon agree on the behaviour behind the words. */
  systemDoes: string
}

const hours = (ms: number): string => {
  const total = Math.max(0, Math.round(ms / 60000))
  const h = Math.floor(total / 60)
  const m = total % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

/** History read stopped early. Analytics fail open, on the range actually read. */
export const historyTruncated = (a: {
  read: number
  approxTotal: number
  upTo: string
  status: number
}): FailureMessage => ({
  id: 'history-truncated',
  text:
    `Read ${a.read.toLocaleString()} of about ${a.approxTotal.toLocaleString()} transactions, up to ` +
    `${a.upTo}. Helius returned ${a.status}. Resume continues from there.`,
  mode: 'open',
  systemDoes:
    'Saves a cursor and resumes from it. The report is computed only on the stated range, never presented as if the history were complete.',
})

/** Transactions we could not read. Counted and named, never dropped and never guessed. */
export const undecodedTransactions = (a: {
  count: number
  programIds: string[]
}): FailureMessage => ({
  id: 'undecoded-transactions',
  text:
    `Excluded ${a.count} transaction${a.count === 1 ? '' : 's'} from ${a.programIds.length} ` +
    `program${a.programIds.length === 1 ? '' : 's'} we do not read yet: ${a.programIds.join(', ')}.`,
  mode: 'open',
  systemDoes: 'Counts and lists them. They never enter P&L.',
})

/** Not enough closed trades to mine a rule. Show what does have enough data. */
export const tooLittleHistory = (a: {
  closedTrades: number
  needed: number
  shown: string[]
}): FailureMessage => ({
  id: 'too-little-history',
  text:
    `${a.closedTrades} closed trade${a.closedTrades === 1 ? '' : 's'}, and a stop rule needs ` +
    `${a.needed}, so no stop rule is mined. ${a.shown.join(' and ')} ` +
    `${a.shown.length === 1 ? 'is' : 'are'} shown.`,
  mode: 'open',
  systemDoes:
    'Shows the metrics that have enough data behind them, and mines no rule that does not.',
})

/**
 * RugCheck is enrichment. Its silence never decides a trade.
 *
 * The timeout is in the message because it is the number involved. The PRD's own draft of this row
 * carries no number, and a test here caught that: "did not answer in time" leaves the reader unable
 * to tell a 200 ms blip from a 30 s outage, which changes whether they wait and retry.
 */
export const rugcheckUnavailable = (a: {
  timeoutMs: number
  passedChecks: string[]
}): FailureMessage => ({
  id: 'rugcheck-unavailable',
  text:
    `RugCheck did not answer within ${(a.timeoutMs / 1000).toFixed(1)}s. ` +
    `${a.passedChecks.length} on-chain check${a.passedChecks.length === 1 ? '' : 's'} passed: ` +
    `${a.passedChecks.join(', ')}.`,
  mode: 'open',
  systemDoes:
    'Our own mint check decides. A timeout is never treated as a pass, and the checks that did run are named.',
})

/** The one that can lose money if it fails open. It does not. */
export const mintCheckUnreachable = (a: { mint: string }): FailureMessage => ({
  id: 'mint-check-unreachable',
  text: `Could not verify token ${a.mint}, so it is not safe to proceed.`,
  mode: 'closed',
  systemDoes:
    'check_trade returns block and the agent hands back to the user. The trade never goes out unverified.',
})

/** The quote moved between the check and the submit. */
export const priceMovedPastBand = (a: { movedPct: number; bandPct: number }): FailureMessage => ({
  id: 'price-moved-past-band',
  text:
    `Quote moved ${a.movedPct.toFixed(1)}% since the check, beyond your ${a.bandPct.toFixed(1)}% ` +
    `band. Stopped.`,
  mode: 'closed',
  systemDoes: 'Re-quotes once and stops if it is still outside. Never submits on the stale check.',
})

/** The on-chain cap said no. Show what is left and when it returns. */
export const overCap = (a: {
  needed: string
  remaining: string
  unit: string
  resetsInMs: number
}): FailureMessage => ({
  id: 'over-cap',
  text:
    `This needs ${a.needed} ${a.unit}; ${a.remaining} ${a.unit} left in this window, resets in ` +
    `about ${hours(a.resetsInMs)}.`,
  mode: 'closed',
  systemDoes:
    'Nothing is sent, and the remaining allowance and reset time are shown. Never retried automatically with a smaller amount.',
})

/** Uncertain landing is the one place a retry can cost twice. */
export const mayNotHaveLanded = (a: { signature: string; status: string }): FailureMessage => ({
  id: 'may-not-have-landed',
  text: `Transaction ${a.signature} is ${a.status}, so it is being checked before anything is resent.`,
  mode: 'closed',
  systemDoes:
    'Checks the signature status before any resubmit, and resubmits only once it is confirmed dropped. Never sends twice.',
})

/** A resting order is not an executed one, and the wording never blurs that. */
export const triggerNotFilled = (a: {
  status: string
  triggerPrice: string
  currentPrice: string
  unit: string
}): FailureMessage => ({
  id: 'trigger-not-filled',
  text:
    `Jupiter reports this order as ${a.status}: trigger ${a.triggerPrice} ${a.unit}, current ` +
    `${a.currentPrice} ${a.unit}.`,
  mode: 'open',
  systemDoes: 'Reads the status from Jupiter. Never says executed before it is.',
})

/** The daemon missed time. Say exactly what did and did not keep running. */
export const daemonWasOffline = (a: {
  offlineMs: number
  missedRules: string[]
}): FailureMessage => ({
  id: 'daemon-was-offline',
  text:
    `Offline ${hours(a.offlineMs)}, and ${a.missedRules.length} event ` +
    `rule${a.missedRules.length === 1 ? '' : 's'} did not run: ${a.missedRules.join(', ')}. ` +
    `Jupiter orders were unaffected.`,
  mode: 'open',
  systemDoes:
    'Jupiter orders keep running because they are on chain. Missed event triggers are listed, never fired late at the prices of the day they are noticed.',
})

/** Revoking a role does not reach into an open order, and the message must not imply it did. */
export const revokedWithOpenOrder = (a: {
  amount: string
  unit: string
  orderCount: number
}): FailureMessage => ({
  id: 'revoked-with-open-order',
  text:
    `Rule revoked, but ${a.amount} ${a.unit} is still inside ${a.orderCount} open Jupiter ` +
    `order${a.orderCount === 1 ? '' : 's'}. Cancel ${a.orderCount === 1 ? 'it' : 'them'}?`,
  mode: 'open',
  systemDoes:
    'Offers the cancel in the same screen. Never implies the revoke also returned those funds.',
})

/** Every row in the PRD's failure table, so a test can walk all of them. */
export const ALL_FAILURE_MESSAGES = [
  historyTruncated({ read: 1240, approxTotal: 2000, upTo: 'Jun 3', status: 429 }),
  undecodedTransactions({ count: 37, programIds: ['PROGa', 'PROGb'] }),
  tooLittleHistory({ closedTrades: 12, needed: 20, shown: ['sizing', 'hold time'] }),
  rugcheckUnavailable({
    timeoutMs: 2000,
    passedChecks: ['no freeze authority', 'no permanent delegate'],
  }),
  mintCheckUnreachable({ mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' }),
  priceMovedPastBand({ movedPct: 2.3, bandPct: 1 }),
  overCap({ needed: '3.2', remaining: '1.1', unit: 'SOL', resetsInMs: 15_000_000 }),
  mayNotHaveLanded({ signature: '5jYeUs2K', status: 'not yet confirmed' }),
  triggerNotFilled({
    status: 'open',
    triggerPrice: '112.00',
    currentPrice: '113.28',
    unit: 'USDC',
  }),
  daemonWasOffline({ offlineMs: 11_520_000, missedRules: ['stop-8pct', 'trim-at-target'] }),
  revokedWithOpenOrder({ amount: '2.0', unit: 'SOL', orderCount: 1 }),
] as const

// ---- The agent surface. T-C19. ----
//
// Rows for the failures an agent meets through the MCP server and the arming screen, which the PRD
// table predates. Same contract as the 11 above: cause, number, what to do next, and the cause and
// number in the FIRST sentence, because an agent client measured on the fork kept only its first
// line and retried about 11 times on a truncated "Simulation failed.".

/** Thrown with a catalogue row, so a tool path never answers with an ad hoc string. */
export class Refusal extends Error {
  constructor(readonly failure: FailureMessage) {
    super(failure.text)
    this.name = 'Refusal'
  }
}

export const zeroSizeTrade = (): FailureMessage => ({
  id: 'zero-size-trade',
  text:
    'A size of 0 is not a trade, so there is nothing to check. Send the amount in base units of ' +
    'the asset being spent: the quote asset on a buy, the mint on a sell.',
  mode: 'closed',
  systemDoes:
    'Returns no verdict. An approval-shaped answer about a non-trade would read as checked.',
})

export const noHistory = (a: { wallet: string }): FailureMessage => ({
  id: 'no-history',
  text:
    `0 transactions were read for ${a.wallet}, so there are no rules of its own to check this ` +
    `trade against. Nothing is approved on the basis of no history.`,
  mode: 'closed',
  systemDoes: 'Returns no verdict. An empty history is not a clean bill.',
})

export const historyUnavailable = (a: { wallet: string; recorded: boolean }): FailureMessage => ({
  id: 'history-unavailable',
  text: a.recorded
    ? `No recording exists for ${a.wallet} on this deployment, so 0 transactions were read and no ` +
      `verdict is given. Ask about a wallet this deployment has, or run against live mainnet.`
    : `0 transactions could be read for ${a.wallet}, so no verdict is given rather than one based ` +
      `on a partial read. Try again, and if it persists the history provider is down.`,
  mode: 'closed',
  systemDoes: 'Returns no verdict, and never names the internal path or setting that failed.',
})

export const historyProviderStatus = (a: { wallet: string; status: number }): FailureMessage => ({
  id: 'history-provider-status',
  text:
    `Helius answered ${a.status} for ${a.wallet}, so 0 transactions were read and no verdict is ` +
    `given. Try again; a 429 means the rate limit, and it clears within a minute.`,
  mode: 'closed',
  systemDoes: 'Returns no verdict rather than one based on part of the history without saying so.',
})

export const historyProviderShape = (a: { wallet: string; got: string }): FailureMessage => ({
  id: 'history-provider-shape',
  text:
    `Helius returned ${a.got} where a list of transactions was expected for ${a.wallet}, so 0 were ` +
    `read. This is a change in its response, not an empty wallet, and it needs a code fix.`,
  mode: 'closed',
  systemDoes: 'Returns no verdict. Guessing at a changed shape is how a wallet reads as 0 swaps.',
})

export const mintCheckEmpty = (a: { mint: string }): FailureMessage => ({
  id: 'mint-check-empty',
  text:
    `The mint check returned 0 verdicts for ${a.mint} where 1 was asked for, so nothing is known ` +
    `about this token. The trade does not go out.`,
  mode: 'closed',
  systemDoes: 'check_trade returns no verdict, and the agent hands back to the user.',
})

export const noChainConfigured = (a: { wallet: string }): FailureMessage => ({
  id: 'no-chain-configured',
  text:
    `No chain is configured on this deployment, so 0 vaults were read for ${a.wallet} and no rules ` +
    `are listed. That is not the same as having none: ask the operator to set a chain.`,
  mode: 'open',
  systemDoes: 'Lists nothing and says why, rather than an empty list that reads as none armed.',
})

export const chainMismatch = (a: { wallet: string; mismatch: string }): FailureMessage => ({
  id: 'chain-mismatch',
  text: `0 rules are listed for ${a.wallet}, because ${a.mismatch}. Nothing was read from that chain.`,
  mode: 'open',
  systemDoes: 'Reads nothing, so an agent is never told one network while reading another.',
})

export const armingOffFork = (a: { wallet: string; network: string }): FailureMessage => ({
  id: 'arming-off-fork',
  text:
    `0 arming links were made for ${a.wallet}, because this deployment is on ${a.network} and ` +
    `arming runs on the practice fork only until the mainnet checklist is complete.`,
  mode: 'closed',
  systemDoes: 'Refuses rather than linking to a screen that would refuse anyway.',
})

export const noPublicAddress = (a: { wallet: string }): FailureMessage => ({
  id: 'no-public-address',
  text:
    `0 arming links were made for ${a.wallet}, because this deployment has no public address, so ` +
    `there is no arming screen to send it to. The operator sets AGON_PUBLIC_URL.`,
  mode: 'closed',
  systemDoes: 'Refuses rather than inventing an address.',
})

/** The Swig cap refused a trade. Swig itself says only "insufficient funds for instruction". */
export const swigCapRefused = (a: {
  needed: string
  remaining: string
  unit: string
  resetSlot: string
}): FailureMessage => ({
  id: 'swig-cap-refused',
  text:
    `This needs ${a.needed} ${a.unit} and ${a.remaining} ${a.unit} is left in this window, so the ` +
    `spending limit refused it; the window resets after slot ${a.resetSlot}. Nothing moved.`,
  mode: 'closed',
  systemDoes:
    'Nothing is sent again. Never retried automatically with a smaller amount, and never reported as a lack of funds.',
})

/** A trade refused by something other than the spending limit. */
export const tradeRefusedElsewhere = (a: { program: string; detail: string }): FailureMessage => ({
  id: 'trade-refused-elsewhere',
  text:
    `Program ${a.program} refused this trade, not the spending limit: ${a.detail}. Nothing moved; ` +
    `if it is Jupiter, the price moved past the slippage allowed, so quote again.`,
  mode: 'closed',
  systemDoes:
    'Reports the program that refused, so a slippage failure is never read as the cap holding.',
})

// ---- prepare_swap. T-C21. ----
//
// Every one of these is a transaction that was not built. Each says so with its number, because the
// agent reading it must not go looking for a transaction to sign.

export const slippageTooHigh = (a: { asked: number; max: number }): FailureMessage => ({
  id: 'slippage-too-high',
  text:
    `A slippage of ${a.asked} bps is over the ${a.max} bps this tool builds with, so 0 ` +
    `transactions were built. Ask again with ${a.max} or less.`,
  mode: 'closed',
  systemDoes: 'Builds nothing. A wide slippage is how a swap loses its value to a moved price.',
})

export const swapNotAgainstSol = (a: {
  inputMint: string
  outputMint: string
}): FailureMessage => ({
  id: 'swap-not-against-sol',
  text:
    `0 transactions were built for ${a.inputMint} to ${a.outputMint}, because neither side is ` +
    `wrapped SOL and the rules this trade is checked against are measured in SOL. Swap through SOL.`,
  mode: 'closed',
  systemDoes: 'Builds nothing rather than checking a size in one asset against rules in another.',
})

export const noVault = (a: { owner: string }): FailureMessage => ({
  id: 'no-vault',
  text:
    `0 vaults were found for ${a.owner} on this chain, so there is nothing to trade from and no ` +
    `transaction was built. Arm one first: arm_rule returns the link.`,
  mode: 'closed',
  systemDoes: 'Builds nothing. A swap from the wallet itself would spend with no limit at all.',
})

export const noAgentRole = (a: { agent: string; vault: string; mint: string }): FailureMessage => ({
  id: 'no-agent-role',
  text:
    `Agent ${a.agent} holds 0 roles that spend ${a.mint} from vault ${a.vault}, so no transaction ` +
    `was built. The owner hires this agent for that token on the arming screen.`,
  mode: 'closed',
  systemDoes: 'Builds nothing that the chain would refuse, and never builds one outside a limit.',
})

export const overRemaining = (a: {
  amount: string
  remaining: string
  unit: string
}): FailureMessage => ({
  id: 'over-remaining',
  text:
    `This swap spends ${a.amount} ${a.unit} and ${a.remaining} ${a.unit} is left in this window, ` +
    `so no transaction was built. Ask for ${a.remaining} ${a.unit} or less, or wait for the window.`,
  mode: 'closed',
  systemDoes: 'Refuses before building, citing what the chain says is left, never a guess.',
})

export const tradeNotPassed = (a: {
  verdict: string
  reasons: number
  first: string
}): FailureMessage => ({
  id: 'trade-not-passed',
  text:
    `check_trade answered ${a.verdict} for this swap with ${a.reasons} ` +
    `${a.reasons === 1 ? 'reason' : 'reasons'}, so no transaction was built. The first: ${a.first}`,
  mode: 'closed',
  systemDoes: 'Builds only on a pass. Unsure is not a soft pass.',
})

export const quoteUnavailable = (a: { status: number }): FailureMessage => ({
  id: 'quote-unavailable',
  text:
    `Jupiter answered ${a.status} for this swap, so no transaction was built. Nothing moved; ask ` +
    `again in a minute.`,
  mode: 'closed',
  systemDoes: 'Builds nothing without a route, and never builds from an older quote.',
})

export const simulationFailed = (a: { program: string; detail: string }): FailureMessage => ({
  id: 'simulation-failed',
  text:
    `The swap failed simulation at program ${a.program}: ${a.detail}. It was not returned to ` +
    `sign and nothing moved; if that program is Jupiter, a price or pool moved, so prepare again.`,
  mode: 'closed',
  systemDoes:
    'Returns no transaction that the chain has already refused, so an agent never retries one.',
})

/**
 * Which program refused, from a transaction's logs. The first `failed` line is the innermost one, and
 * it is the one that decides. Measured on the fork: when the cap refuses, the only `failed` line is
 * Swig's at depth 1; when a drifted pool refuses, Jupiter's `failed` line comes first, at depth 2.
 */
export const innermostFailure = (logs: readonly string[]): string | null => {
  for (const line of logs) {
    const m = /^Program (\S+) failed/.exec(line)
    if (m) return m[1] ?? null
  }
  return null
}

/**
 * Turn a refused trade's logs into the message that names who refused. `swigProgram` is passed in
 * from chain config rather than written here, because program ids are pinned in 1 place.
 */
export const explainRefusal = (a: {
  logs: readonly string[]
  swigProgram: string
  cap: { needed: string; remaining: string; unit: string; resetSlot: string }
}): FailureMessage => {
  const program = innermostFailure(a.logs)
  if (program === a.swigProgram) return swigCapRefused(a.cap)
  const line = a.logs.find((l) => program !== null && l.startsWith(`Program ${program} failed`))
  return tradeRefusedElsewhere({
    program: program ?? 'unknown',
    detail: line?.replace(/^Program \S+ failed: /, '') ?? 'the logs named no failing program',
  })
}

const SAMPLE_WALLET = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'

/** Every agent-surface row, so the same tests walk them as walk the PRD's 11. */
export const AGENT_SURFACE_MESSAGES = [
  zeroSizeTrade(),
  noHistory({ wallet: SAMPLE_WALLET }),
  historyUnavailable({ wallet: SAMPLE_WALLET, recorded: true }),
  historyUnavailable({ wallet: SAMPLE_WALLET, recorded: false }),
  historyProviderStatus({ wallet: SAMPLE_WALLET, status: 429 }),
  historyProviderShape({ wallet: SAMPLE_WALLET, got: 'object' }),
  mintCheckEmpty({ mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' }),
  noChainConfigured({ wallet: SAMPLE_WALLET }),
  chainMismatch({
    wallet: SAMPLE_WALLET,
    mismatch: 'this deployment says fork, but the chain is not a fork',
  }),
  armingOffFork({ wallet: SAMPLE_WALLET, network: 'mainnet, real funds' }),
  noPublicAddress({ wallet: SAMPLE_WALLET }),
  swigCapRefused({ needed: '0.45', remaining: '0.4', unit: 'wSOL', resetSlot: '451431300' }),
  tradeRefusedElsewhere({
    program: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
    detail: 'custom program error: 0x1788',
  }),
  slippageTooHigh({ asked: 500, max: 100 }),
  swapNotAgainstSol({
    inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    outputMint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  }),
  noVault({ owner: SAMPLE_WALLET }),
  noAgentRole({
    agent: SAMPLE_WALLET,
    vault: 'C7Bz4nps2z1NDftJUBzXQyeR2iDE5j5ztad5q1k4iA8R',
    mint: 'So11111111111111111111111111111111111111112',
  }),
  overRemaining({ amount: '0.45', remaining: '0.4', unit: 'wSOL' }),
  tradeNotPassed({ verdict: 'unsure', reasons: 1, first: 'No price quote was read.' }),
  quoteUnavailable({ status: 429 }),
  simulationFailed({
    program: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
    detail: 'custom program error: 0x1771',
  }),
] as const
