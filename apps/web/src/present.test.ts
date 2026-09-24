import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { Report, type MinedRule } from '@agon/core'
import {
  RULE_ANSWERS,
  RULE_QUESTION,
  amount,
  coverageLine,
  duration,
  exceptionsLine,
  metricLines,
  rangeLine,
  ruleLine,
  unsupportedLines,
  unsupportedSummary,
} from './present.js'

const fixture = (): Report => {
  const { synthetic: _s, ...rest } = JSON.parse(
    readFileSync(new URL('../../../fixtures/contracts/report.json', import.meta.url), 'utf8'),
  ) as Record<string, unknown>
  return Report.parse(rest)
}

/** The three strings CLAUDE.md forbids, plus the blank this task counts as a failure. */
const BANNED = ['N/A', 'n/a', 'something went wrong', 'undefined', 'null', 'NaN']
const assertSpeaks = (value: string, where: string) => {
  expect(value.trim(), `${where} is blank`).not.toBe('')
  for (const banned of BANNED) {
    expect(value, `${where} says "${banned}"`).not.toContain(banned)
  }
}

/** Every line the page can render, for one report. */
const allLines = (report: Report): [string, string][] => [
  ...metricLines(report.metrics).map((l): [string, string] => [l.label, l.value]),
  ...report.rules.map(ruleLine).map((l): [string, string] => [l.label, l.value]),
  ...unsupportedLines(report).map((l): [string, string] => [l.label, l.value]),
  ['coverage', coverageLine(report)],
  ['range', rangeLine(report)],
  ['unsupported summary', unsupportedSummary(report)],
  ['exceptions', exceptionsLine(report)],
]

test('the fixture report renders with no blank field and no N/A', () => {
  for (const [where, value] of allLines(fixture())) assertSpeaks(value, where)
})

test('an empty wallet renders too, and says why rather than showing nothing', () => {
  // The report a wallet with no history produces. This is where blanks and "N/A" come from.
  const empty = Report.parse({
    ...fixture(),
    metrics: { closedTrades: 0, medianSize: '0', medianHoldSeconds: 0, realisedPnl: '0' },
    rules: (['stop', 'size', 'hold'] as const).map(
      (kind): MinedRule => ({
        kind,
        found: false,
        value: null,
        sampleSize: 0,
        requiredSampleSize: 20,
        reason: 'no closed trades to read',
      }),
    ),
    exceptions: { count: 0, cost: '0' },
    coverage: { decodedSwaps: 0, totalSwaps: 0, share: 0 },
    unsupported: [],
  })
  for (const [where, value] of allLines(empty)) assertSpeaks(value, where)
  expect(coverageLine(empty)).toContain('No swaps were found')
  expect(exceptionsLine(empty)).toContain('did not break your own rules')
  expect(unsupportedSummary(empty)).toContain('Nothing was dropped')
})

test('an unfound rule shows its reason, because a blank slot is the failure', () => {
  const line = ruleLine({
    kind: 'stop',
    found: false,
    value: null,
    sampleSize: 12,
    requiredSampleSize: 20,
    reason: '12 closed trades. A stop rule needs 20; sizing and hold time are shown',
  })
  expect(line.label).toBe('Stop discipline')
  expect(line.value).toBe('12 closed trades. A stop rule needs 20; sizing and hold time are shown')
})

test('coverage is stated as a share with its counts, so it is checkable', () => {
  const report = Report.parse({
    ...fixture(),
    coverage: { decodedSwaps: 83, totalSwaps: 100, share: 0.83 },
  })
  expect(coverageLine(report)).toBe('Based on 83% of your swaps, 83 of 100.')
})

test('unsupported transactions are counted and their program ids named', () => {
  const report = fixture()
  if (report.unsupported.length === 0) return
  const lines = unsupportedLines(report)
  expect(lines).toHaveLength(report.unsupported.length)
  for (const [i, u] of report.unsupported.entries()) {
    expect(lines[i]?.label).toContain(u.programId)
    expect(lines[i]?.label).toContain(String(u.count))
  }
  expect(unsupportedSummary(report)).toContain('not in the numbers above')
})

test('an incomplete read says so, and says what stopped it', () => {
  const report = fixture()
  if (!report.range.complete) {
    expect(rangeLine(report)).toContain(report.range.stoppedBecause ?? 'impossible')
    expect(rangeLine(report)).toContain('based on that much')
  }
})

test('base units convert exactly, including past 2^53 and negatives', () => {
  expect(amount('800000000')).toBe('0.8')
  expect(amount('-1420000000')).toBe('-1.42')
  expect(amount('0')).toBe('0')
  expect(amount('1')).toBe('0.000000001')
  expect(amount('9007199254740993000000000')).toBe('9007199254740993')
})

test('a duration is words, never a bare count of seconds', () => {
  expect(duration(9420)).toBe('2 hours 37 minutes')
  expect(duration(45)).toBe('45 seconds')
  expect(duration(1)).toBe('1 second')
  expect(duration(90000)).toBe('1 day 1 hour')
})

test('the question and its 3 answers are fixed in one place', () => {
  expect(RULE_QUESTION).toBe('Is this rule right about you?')
  expect(RULE_ANSWERS).toEqual(['yes', 'no', 'partly'])
})
