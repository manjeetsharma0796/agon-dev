import { describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs on purpose, so the browser and the server share one implementation
import { checkAddress, checkEmail, checkSignup, decodeBase58 } from './validate.mjs'

// Real mainnet addresses, not invented ones. An address has no checksum, so the only thing worth
// testing is the shape, and the shape is easy to get subtly wrong in the direction of rejecting
// real people.
const REAL = [
  ['System Program, 32 leading zero bytes', '11111111111111111111111111111111'],
  ['Token Program', 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'],
  ['USDC mint', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'],
  ['Wrapped SOL', 'So11111111111111111111111111111111111111112'],
  ['Jupiter v6', 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'],
  ['Rent sysvar', 'SysvarRent111111111111111111111111111111111'],
]

describe('a real address is accepted', () => {
  for (const [name, address] of REAL) {
    test(name, () => {
      expect(decodeBase58(address).bytes).toHaveLength(32)
      expect(checkAddress(address)).toEqual({ ok: true, value: address })
    })
  }
})

test('leading 1s are zero bytes, counted once', () => {
  // The bug this pins: decoding the leading '1's as digits AND then adding a zero byte for each of
  // them counts every one twice, so the System Program address came out as 33 bytes and a real
  // trader pasting a real address would have been told it was malformed.
  expect(decodeBase58('11111111111111111111111111111111').bytes).toHaveLength(32)
  expect(decodeBase58('1' + 'So11111111111111111111111111111111111111112').bytes).toHaveLength(33)
})

test('a character outside base58 is named, not just refused', () => {
  const result = checkAddress('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt10')
  expect(result.ok).toBe(false)
  expect(result.reason).toContain('"0"')
  expect(result.reason).toContain('0, O, I')
})

test('the wrong length names both numbers', () => {
  const result = checkAddress('abc')
  expect(result.ok).toBe(false)
  expect(result.reason).toContain('3 bytes')
  expect(result.reason).toContain('32')
})

test('an empty field says what to do, not that it is invalid', () => {
  expect(checkAddress('  ').reason).toContain('your wallet shows you')
  expect(checkEmail('').reason).toContain('send you your report')
})

test('surrounding whitespace is forgiven, because pasting picks it up', () => {
  expect(checkAddress('  So11111111111111111111111111111111111111112 ').ok).toBe(true)
  expect(checkEmail(' Trader@Example.COM ')).toEqual({ ok: true, value: 'trader@example.com' })
})

describe('an email that cannot possibly work is refused', () => {
  const cases: [string, string, string][] = [
    ['no at sign', 'trader.example.com', 'exactly 1 "@"'],
    ['two at signs', 'a@b@example.com', 'exactly 1 "@"'],
    ['nothing before the at', '@example.com', 'nothing before'],
    ['domain with no dot', 'trader@localhost', 'not a domain'],
    ['domain ending in a dot', 'trader@example.', 'not a domain'],
    ['a space in the middle', 'tra der@example.com', 'contains a space'],
  ]
  for (const [name, input, expected] of cases) {
    test(name, () => {
      const result = checkEmail(input)
      expect(result.ok).toBe(false)
      expect(result.reason).toContain(expected)
    })
  }
})

test('an over-long email names its own length and the limit', () => {
  const result = checkEmail(`${'a'.repeat(250)}@example.com`)
  expect(result.ok).toBe(false)
  expect(result.reason).toContain('262 characters')
  expect(result.reason).toContain('254')
})

test('both fields are reported at once, so nobody fixes one per submit', () => {
  const result = checkSignup({ email: 'not-an-email', address: 'nope' })
  expect(result.ok).toBe(false)
  expect(Object.keys(result.errors).sort()).toEqual(['address', 'email'])
})

test('a good signup comes back normalised and ready to store', () => {
  expect(
    checkSignup({
      email: ' Trader@Example.com ',
      address: ' So11111111111111111111111111111111111111112 ',
    }),
  ).toEqual({
    ok: true,
    value: { email: 'trader@example.com', address: 'So11111111111111111111111111111111111111112' },
  })
})

test('an absurdly long paste is refused on length, before it is decoded', () => {
  // Decoding is quadratic in the input length and this runs on whatever a stranger pastes into a
  // public form, so the bound comes first.
  const result = checkAddress('1'.repeat(50_000))
  expect(result.ok).toBe(false)
  expect(result.reason).toContain('50000 characters')
})
