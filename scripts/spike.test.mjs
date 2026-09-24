import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { expect, test } from 'vitest'

// This is what keeps the dashboard honest. A spike with no implementation has to report "not run"
// and leave no result.json behind, because feasibility.mjs reads a result.json as a measurement
// that actually happened. If this ever starts writing one, FEASIBILITY.md goes green on nothing.
test('a spike with no implementation is "not run", and writes no result', () => {
  const out = execFileSync('node', ['scripts/spike.mjs', 'F99'], { encoding: 'utf8' })
  expect(out).toContain('not run')
  expect(existsSync('spikes/F99/result.json')).toBe(false)
})
