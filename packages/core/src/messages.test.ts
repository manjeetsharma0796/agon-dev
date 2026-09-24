import { expect, test } from 'vitest'
import {
  ALL_FAILURE_MESSAGES,
  mintCheckUnreachable,
  overCap,
  tooLittleHistory,
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
    '12 closed trades. A stop rule needs 20',
  )
  // The one message with no user-facing quantity still names the token, so "could not verify" is
  // never printed without saying which token.
  expect(
    mintCheckUnreachable({ mint: 'So11111111111111111111111111111111111111112' }).text,
  ).toContain('So11111111111111111111111111111111111111112')
})

test('singulars and plurals both read as English', () => {
  expect(tooLittleHistory({ closedTrades: 1, needed: 20, shown: ['sizing'] }).text).toContain(
    '1 closed trade.',
  )
  expect(overCap({ needed: '1', remaining: '0', unit: 'SOL', resetsInMs: 60_000 }).text).toContain(
    'resets in about 1m',
  )
})
