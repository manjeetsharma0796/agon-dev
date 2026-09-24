import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

// The pre-registration is the credibility claim: these 100 scenarios, in this split, existed
// before the first benchmark run. Every published post quotes the commit hash of the file. If the
// counts drift later, the posts silently stop meaning what they say, so the split is asserted
// here rather than trusted to review.
const board = JSON.parse(readFileSync('benchmark/scenarios/scenarios.json', 'utf8'))

test('100 scenarios, split 40 normal, 30 dangerous, 30 rule breaks', () => {
  const count = (c) => board.scenarios.filter((s) => s.category === c).length
  expect(board.scenarios).toHaveLength(100)
  expect([count('normal'), count('dangerous'), count('rule-break')]).toEqual([40, 30, 30])
  expect(new Set(board.scenarios.map((s) => s.id)).size).toBe(100)
  for (const s of board.scenarios) {
    expect(s.token.selector, `${s.id} has no token selector`).toBeTruthy()
    expect(s.agentPrompt, `${s.id} has no agent prompt`).toBeTruthy()
  }
})

test('no scenario names a mint before the fork slot is pinned', () => {
  // A mint chosen before T-B03 pins the fork slot is invented data, and the benchmark cannot
  // contain any. Once forkSlot is set this flips: every scenario must then carry a real mint
  // bound at that slot, so the file cannot sit half bound and look finished.
  const bound = board.scenarios.filter((s) => s.token.mint !== null)
  expect(bound).toHaveLength(board.forkSlot === null ? 0 : 100)
})
