import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { ArmedRule, CheckTradeOutput, Report } from '@agon/core'
import { armRule, armedRuleExample, checkTrade, FIXTURE_NOTE, NotArmable, report } from './legs.js'

const MINE = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
const input = (name: string): Record<string, unknown> => {
  const { synthetic: _s, ...rest } = JSON.parse(
    readFileSync(new URL(`../../../fixtures/contracts/${name}.json`, import.meta.url), 'utf8'),
  ) as Record<string, unknown>
  return rest
}

test('leg 1: pasting an address returns a report that satisfies the frozen contract', () => {
  const out = report({ wallet: MINE })
  expect(() => Report.parse(out)).not.toThrow()
  expect(out.wallet, 'the report came back about a different wallet than the one pasted').toBe(MINE)
  expect(out.dataSlot).toBeGreaterThan(0)
  expect(out.ruleVersion.length).toBeGreaterThan(0)
})

test('leg 1 says what it is based on, because it is not based on your wallet', () => {
  // Analytics may fail open. They may not imply they read a chain they never touched.
  expect(FIXTURE_NOTE).toContain('not from this wallet')
  expect(FIXTURE_NOTE).toContain('No chain data has been read')
})

test('leg 2: check_trade returns a verdict that satisfies the frozen contract', () => {
  const out = checkTrade(input('check-trade-input'))
  expect(() => CheckTradeOutput.parse(out)).not.toThrow()
  expect(['pass', 'block', 'unsure']).toContain(out.verdict)
  if (out.verdict !== 'pass') expect(out.reasons.length).toBeGreaterThan(0)
})

test('leg 3: arming refuses, and refuses without inventing a role', () => {
  // arm_rule's contract returns a Swig role id and a Jupiter order id. Both are claims that
  // something exists on chain, and nothing does. Answering with the fixture would be a fabricated
  // verification on the one path that grants spend authority.
  const valid = ArmedRule.parse(input('armed-rule'))
  let thrown: unknown
  try {
    armRule(valid.spec)
  } catch (error) {
    thrown = error
  }
  expect(thrown, 'a valid spec was armed instead of refused').toBeInstanceOf(NotArmable)
  const message = (thrown as Error).message
  expect(message).toContain('F5 and F6')
  expect(message).toContain('no Swig role and no Jupiter order exist')
  // The refusal must not hand back the Jupiter order it is refusing to claim exists.
  expect(message).not.toContain(valid.jupiterOrderId ?? 'no-order')
})

test('every leg validates its input, so a bad one never reaches the fixture', () => {
  expect(() => report({ wallet: 'not-an-address' })).toThrow()
  expect(() => report({})).toThrow()
  expect(() => checkTrade({ ...input('check-trade-input'), side: 'sideways' })).toThrow()
  expect(() => checkTrade({ ...input('check-trade-input'), size: -1 })).toThrow()
  // A malformed spec fails validation rather than reaching the refusal, so the 2 are not confused.
  expect(() => armRule({ mints: [] })).not.toThrow(NotArmable)
})

test('the armed-rule example is contract valid, so the shape is right when arming turns on', () => {
  expect(() => ArmedRule.parse(armedRuleExample())).not.toThrow()
})
