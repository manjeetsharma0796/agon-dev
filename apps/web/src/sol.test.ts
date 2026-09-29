import { expect, test } from 'vitest'
import { formatSol, parseSol } from './sol.js'

test('SOL typed on the screen becomes exact lamports, never through a float', () => {
  expect(parseSol('0.5')).toBe(500_000_000n)
  expect(parseSol('1')).toBe(1_000_000_000n)
  expect(parseSol('0.000000001')).toBe(1n)
  // 0.1 + 0.2 in a float is 0.30000000000000004: a float parse would send a cap the user did not type.
  expect(parseSol('0.3')).toBe(300_000_000n)
  expect(parseSol(' 12.25 ')).toBe(12_250_000_000n)
})

test('anything that is not an exact amount is refused with the reason, not rounded', () => {
  expect(() => parseSol('0.0000000001')).toThrow(/9 decimal/)
  expect(() => parseSol('-1')).toThrow(/positive/)
  expect(() => parseSol('0')).toThrow(/positive/)
  expect(() => parseSol('1e9')).toThrow(/number/)
  expect(() => parseSol('')).toThrow(/number/)
  expect(() => parseSol('1.2.3')).toThrow(/number/)
})

test('lamports read back as the same SOL the user typed', () => {
  expect(formatSol(500_000_000n)).toBe('0.5')
  expect(formatSol(1_000_000_000n)).toBe('1')
  expect(formatSol(1n)).toBe('0.000000001')
  expect(formatSol(0n)).toBe('0')
})
