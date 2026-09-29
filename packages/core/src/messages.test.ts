import { expect, test } from 'vitest'
import {
  AGENT_SURFACE_MESSAGES,
  ALL_FAILURE_MESSAGES,
  explainRefusal,
  innermostFailure,
  mintCheckUnreachable,
  overCap,
  Refusal,
  tooLittleHistory,
  zeroSizeTrade,
} from './messages.js'

test('all 11 rows from the PRD failure table are implemented', () => {
  expect(ALL_FAILURE_MESSAGES).toHaveLength(11)
  expect(new Set(ALL_FAILURE_MESSAGES.map((m) => m.id)).size).toBe(11)
})

test('no message is blank, vague, or missing its number', () => {
  const banned = [/N\/A/i, /something went wrong/i, /unknown error/i, /undefined/, /\bnull\b/]
  for (const m of ALL_FAILURE_MESSAGES) {
    // No empty field. A blank in the middle of a sentence is how "N/A" gets reinvented.
    expect(m.id.length, `${m.id} has an empty id`).toBeGreaterThan(0)
    expect(m.text.length, `${m.id} has an empty text`).toBeGreaterThan(20)
    expect(m.systemDoes.length, `${m.id} does not say what the system does`).toBeGreaterThan(20)

    for (const b of banned) {
      expect(b.test(m.text), `${m.id} says "${m.text}"`).toBe(false)
    }

    // Names the number involved. Every row in the PRD table carries one, and a message without a
    // number is the vague message this catalogue replaces.
    expect(/\d/.test(m.text), `${m.id} names no number: "${m.text}"`).toBe(true)

    // The repo's dash rule, which is easiest to break in prose written for a user.
    expect(
      new RegExp('[\u2013\u2014]').test(m.text + m.systemDoes),
      `${m.id} contains a dash`,
    ).toBe(false)
  }
})

test('anything that can move funds fails closed, and the rest fail open by saying what they are based on', () => {
  const closed = ALL_FAILURE_MESSAGES.filter((m) => m.mode === 'closed')
    .map((m) => m.id)
    .sort()
  // These 4 are the ones where proceeding could move funds the user did not authorise, or move
  // them twice. Adding a fifth is a product decision, not a refactor, so it fails here first.
  expect(closed).toEqual([
    'may-not-have-landed',
    'mint-check-unreachable',
    'over-cap',
    'price-moved-past-band',
  ])

  for (const m of ALL_FAILURE_MESSAGES) {
    if (m.mode === 'open') {
      // Failing open is only acceptable when the message states its basis, so the reader knows
      // what the answer was computed from.
      expect(
        m.systemDoes.length,
        `${m.id} fails open without saying what it is based on`,
      ).toBeGreaterThan(20)
    }
  }
})

test('the numbers in a message are the ones passed in, not a rounded retelling', () => {
  expect(
    overCap({ needed: '3.2', remaining: '1.1', unit: 'SOL', resetsInMs: 15_000_000 }).text,
  ).toContain('3.2 SOL; 1.1 SOL left')
  expect(tooLittleHistory({ closedTrades: 12, needed: 20, shown: ['sizing'] }).text).toContain(
    '12 closed trades, and a stop rule needs 20',
  )
  // The one message with no user-facing quantity still names the token, so "could not verify" is
  // never printed without saying which token.
  expect(
    mintCheckUnreachable({ mint: 'So11111111111111111111111111111111111111112' }).text,
  ).toContain('So11111111111111111111111111111111111111112')
})

test('singulars and plurals both read as English', () => {
  expect(tooLittleHistory({ closedTrades: 1, needed: 20, shown: ['sizing'] }).text).toContain(
    '1 closed trade,',
  )
  expect(overCap({ needed: '1', remaining: '0', unit: 'SOL', resetsInMs: 60_000 }).text).toContain(
    'resets in about 1m',
  )
  expect(tooLittleHistory({ closedTrades: 1, needed: 20, shown: ['sizing'] }).text).toContain(
    'sizing is shown',
  )
})

/** Up to the first full stop or question mark that ends a sentence, or all of it. */
const firstSentence = (text: string): string => /^.*?[.?](?=\s|$)/.exec(text)?.[0] ?? text

test('every message says its cause and its number in its first sentence', () => {
  // Measured on the fork: an agent client kept the first line of an error and dropped the rest, then
  // retried about 11 times on "Simulation failed." with no reason. Our server did not truncate; the
  // client did. So the first sentence alone has to carry the answer, whatever a client keeps.
  const weak = ALL_FAILURE_MESSAGES.map((m) => ({ id: m.id, first: firstSentence(m.text) }))
    .filter(({ first }) => !/\d/.test(first) || first.length <= 24)
    .map(({ id, first }) => `${id}: "${first}"`)
  expect(weak, 'these first sentences do not carry the cause and the number on their own').toEqual(
    [],
  )
})

// The rows added for the agent surface are held to the same rules as the PRD's 11.
test('the agent-surface rows are never blank or vague, and say their cause first', () => {
  const banned = [/N\/A/i, /something went wrong/i, /unknown error/i, /undefined/, /\bnull\b/]
  const weak: string[] = []
  for (const m of AGENT_SURFACE_MESSAGES) {
    expect(m.systemDoes.length, `${m.id} does not say what the system does`).toBeGreaterThan(20)
    for (const b of banned) expect(b.test(m.text), `${m.id} says "${m.text}"`).toBe(false)
    expect(new RegExp('[–—]').test(m.text + m.systemDoes), `${m.id} has a dash`).toBe(false)
    const first = firstSentence(m.text)
    if (!/\d/.test(first) || first.length <= 24) weak.push(`${m.id}: "${first}"`)
  }
  expect(weak).toEqual([])
})

const SWIG = 'swigypWHEksbC64pWKwah1WTeh9JXwx8H1rJHLdbQMB'
const CAP = { needed: '0.45', remaining: '0.4', unit: 'wSOL', resetSlot: '451434750' }

test('a refusal by the spending limit is named as the limit, not as a lack of funds', () => {
  // Verbatim, F5 case (b) on the fork on 2026-09-29, spikes/F5/result.json: 0.45 wSOL with 0.4 left.
  // Raydium and Jupiter both succeed; the only failed line is Swig's, and Swig says only
  // "insufficient funds for instruction", which is not what happened.
  const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
  const JUP = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'
  const RAY = 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK'
  const logs = [
    'Program ComputeBudget111111111111111111111111111111 invoke [1]',
    'Program ComputeBudget111111111111111111111111111111 success',
    `Program ${SWIG} invoke [1]`,
    `Program ${JUP} invoke [2]`,
    `Program ${RAY} invoke [3]`,
    `Program ${TOKEN} invoke [4]`,
    `Program ${TOKEN} success`,
    `Program ${TOKEN} invoke [4]`,
    `Program ${TOKEN} success`,
    `Program ${RAY} success`,
    `Program ${JUP} invoke [3]`,
    `Program ${JUP} success`,
    `Program ${JUP} success`,
    `Program ${SWIG} failed: insufficient funds for instruction`,
  ]
  expect(innermostFailure(logs)).toBe(SWIG)
  const m = explainRefusal({ logs, swigProgram: SWIG, cap: CAP })
  expect(m.id).toBe('swig-cap-refused')
  expect(firstSentence(m.text)).toContain('0.45 wSOL')
  expect(firstSentence(m.text)).toContain('0.4 wSOL is left')
  expect(m.text).not.toContain('insufficient funds')
})

test('a refusal by Jupiter is never reported as the limit holding', () => {
  // Built by hand, not captured: on a fork that had served swaps for over an hour, only Jupiter's
  // code, 0x1788, was recorded, not the full log. Solana logs an inner program's failure before its
  // caller's, which is the shape here. Reporting this as the cap would be the wrong-reason trap.
  const logs = [
    `Program ${SWIG} invoke [1]`,
    'Program JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 invoke [2]',
    'Program JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 failed: custom program error: 0x1788',
    `Program ${SWIG} failed: custom program error: 0x1788`,
  ]
  expect(innermostFailure(logs)).toBe('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4')
  const m = explainRefusal({ logs, swigProgram: SWIG, cap: CAP })
  expect(m.id).toBe('trade-refused-elsewhere')
  expect(firstSentence(m.text)).toContain('not the spending limit')
  expect(m.text).toContain('0x1788')
})

test('Refusal carries its row, so the text an agent sees is the catalogue text exactly', () => {
  const row = zeroSizeTrade()
  const e = new Refusal(row)
  expect(e.message).toBe(row.text)
  expect(e.failure.id).toBe('zero-size-trade')
})
