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
    `${a.closedTrades} closed trade${a.closedTrades === 1 ? '' : 's'}. A stop rule needs ` +
    `${a.needed}; ${a.shown.join(' and ')} are shown.`,
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
  text: `Could not verify this token. Not safe to proceed. Token: ${a.mint}.`,
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
  text: `Checking whether it landed. Signature ${a.signature}, currently ${a.status}.`,
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
    `Jupiter reports this order as ${a.status}. Trigger ${a.triggerPrice} ${a.unit}, current ` +
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
    `Offline ${hours(a.offlineMs)}. Jupiter orders were unaffected. ` +
    `${a.missedRules.length} event rule${a.missedRules.length === 1 ? '' : 's'} did not run: ` +
    `${a.missedRules.join(', ')}.`,
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
    `Rule revoked. ${a.amount} ${a.unit} is still inside ${a.orderCount} open Jupiter ` +
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
