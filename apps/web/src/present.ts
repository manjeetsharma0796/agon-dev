// Turning a report into sentences. Pure, so the rule that the page never shows a blank field is a
// test and not a habit.
//
// The honesty rules this enforces, from CLAUDE.md: every field says something, no "N/A", no
// "something went wrong", and any number that is based on a partial read says what it is based on.
// An unfound rule is a first-class answer with its own sentence, never an empty slot.

import type { Metrics, MinedRule, Report } from '@agon/core'

/**
 * Report numbers are base units with no unit attached: the frozen contract carries `medianSize` and
 * `realisedPnl` but not the mint they are denominated in. Every quote we support is SOL for now and
 * the contract's own example reads "your median size of 0.8 SOL", so SOL is what is rendered. When
 * Report grows a quote mint this reads it instead of assuming it.
 */
export const QUOTE_SYMBOL = 'SOL'
export const QUOTE_DECIMALS = 9

/** Base units to a human number, exact: BigInt for the integer part, string maths for the rest. */
export function amount(baseUnits: string, decimals = QUOTE_DECIMALS): string {
  const negative = baseUnits.startsWith('-')
  const digits = (negative ? baseUnits.slice(1) : baseUnits).padStart(decimals + 1, '0')
  const whole = digits.slice(0, digits.length - decimals)
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, '')
  const sign = negative ? '-' : ''
  return fraction === '' ? `${sign}${whole}` : `${sign}${whole}.${fraction}`
}

export const inQuote = (baseUnits: string): string => `${amount(baseUnits)} ${QUOTE_SYMBOL}`

/** "2 hours 37 minutes", never "9420" and never a bare number of seconds. */
export function duration(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`
  const parts: string[] = []
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) parts.push(`${days} day${days === 1 ? '' : 's'}`)
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`)
  if (minutes > 0 && days === 0) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`)
  return parts.join(' ')
}

export interface Line {
  label: string
  /** Always non-empty. A rule we did not find says why, which is an answer and not a blank. */
  value: string
}

const RULE_LABEL: Record<MinedRule['kind'], string> = {
  stop: 'Stop discipline',
  size: 'Usual size',
  hold: 'Usual hold',
}

/**
 * One line per rule, found or not. An unfound rule shows its reason, so no slot is ever empty.
 *
 * The frozen contract already refuses a found rule with no value and an unfound rule with no
 * reason, but the checks below are real rather than casts: this function is what stands between a
 * malformed rule and a blank on the page, and a rule that reached here without being parsed is
 * exactly the case where it matters.
 */
export function ruleLine(rule: MinedRule): Line {
  const label = RULE_LABEL[rule.kind]
  if (!rule.found) {
    return {
      label,
      value:
        rule.reason ?? 'No rule was found, and no reason was given, which its contract forbids.',
    }
  }
  if (rule.value === null) {
    return {
      label,
      value: 'This rule was reported as found with no value, which its contract forbids.',
    }
  }
  if (rule.kind === 'stop') {
    return { label, value: `You cut losers at about ${Math.abs(rule.value).toFixed(1)}%` }
  }
  if (rule.kind === 'size') return { label, value: inQuote(String(Math.round(rule.value))) }
  return { label, value: duration(Math.round(rule.value)) }
}

export function metricLines(metrics: Metrics): Line[] {
  return [
    { label: 'Closed trades', value: String(metrics.closedTrades) },
    { label: 'Median size', value: inQuote(metrics.medianSize) },
    { label: 'Median hold', value: duration(metrics.medianHoldSeconds) },
    { label: 'Realised P&L', value: inQuote(metrics.realisedPnl) },
  ]
}

/** "Based on 83% of your swaps", with the counts, because a share with no denominator is a claim. */
export function coverageLine(report: Report): string {
  const { decodedSwaps, totalSwaps, share } = report.coverage
  if (totalSwaps === 0)
    return 'No swaps were found for this wallet, so there is nothing to base a report on.'
  return `Based on ${Math.round(share * 100)}% of your swaps, ${decodedSwaps} of ${totalSwaps}.`
}

/** What a partial read means, said next to the numbers rather than in a footnote. */
export function rangeLine(report: Report): string {
  const { readTransactions, estimatedTotal, complete, stoppedBecause, throughSlot } = report.range
  if (complete) return `Read all ${readTransactions} transactions, through slot ${throughSlot}.`
  const of = estimatedTotal === null ? 'an unknown total' : `about ${estimatedTotal}`
  return `Read ${readTransactions} transactions of ${of} and stopped: ${stoppedBecause}. Everything below is based on that much.`
}

/** The decoder's own gaps, counted and named. Silence here would read as "nothing was missed". */
export function unsupportedLines(report: Report): Line[] {
  if (report.unsupported.length === 0) return []
  return report.unsupported.map((u) => ({
    label: `${u.count} transaction${u.count === 1 ? '' : 's'} from ${u.programId}`,
    value: u.reason,
  }))
}

export function unsupportedSummary(report: Report): string {
  const total = report.unsupported.reduce((sum, u) => sum + u.count, 0)
  if (total === 0)
    return 'Every transaction read was either decoded or counted as not a swap. Nothing was dropped.'
  return `${total} transaction${total === 1 ? '' : 's'} from ${report.unsupported.length} program${report.unsupported.length === 1 ? '' : 's'} could not be decoded and are not in the numbers above.`
}

/** What breaking your own rule cost, in words, including when it cost nothing. */
export function exceptionsLine(report: Report): string {
  const { count, cost } = report.exceptions
  if (count === 0) return 'You did not break your own rules in this period.'
  const magnitude = inQuote(cost.startsWith('-') ? cost.slice(1) : cost)
  const direction = cost.startsWith('-') ? 'cost you' : 'made you'
  return `${count} time${count === 1 ? '' : 's'} you broke your own rules, and it ${direction} ${magnitude}.`
}

/** The 3 answers, fixed. The question is asked on every report, so the wording lives in one place. */
export const RULE_QUESTION = 'Is this rule right about you?'
export const RULE_ANSWERS = ['yes', 'no', 'partly'] as const
export type RuleAnswer = (typeof RULE_ANSWERS)[number]
