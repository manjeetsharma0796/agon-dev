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

test('leg 3: arm_rule hands back a link to the arming screen, and claims nothing is armed', () => {
  // Nothing exists on chain until the user's wallet signs on the screen, so the answer is a
  // place. It must not carry a Swig role id or a Jupiter order id, which would be claims about a
  // chain nothing has touched.
  const spec = ArmedRule.parse(input('armed-rule')).spec
  const link = armRule(spec, { publicUrl: 'https://agon.example', network: 'fork' })
  expect(link.url).toBe(`https://agon.example/arm#wallet=${spec?.wallet}`)
  expect(link.wallet).toBe(spec?.wallet)
  expect(JSON.stringify(link)).not.toMatch(/roleId|jupiterOrderId/)
  // The wallet rides in the fragment, which a browser never sends to a server.
  expect(new URL(link.url).search).toBe('')
})

test('leg 3 fails closed off the fork, and with no screen to send anyone to', () => {
  const spec = ArmedRule.parse(input('armed-rule')).spec
  expect(() => armRule(spec, { publicUrl: 'https://agon.example', network: 'mainnet' })).toThrow(
    /practice fork only/,
  )
  expect(() => armRule(spec, { publicUrl: undefined, network: 'fork' })).toThrow(
    /no public address/,
  )
  expect(() => armRule(spec, { publicUrl: 'https://agon.example', network: 'mainnet' })).toThrow(
    NotArmable,
  )
})

test('leg 3 refuses a cap an agent sends, rather than dropping it and letting the agent believe it set one', () => {
  const spec = ArmedRule.parse(input('armed-rule')).spec
  const withCap = { ...spec, cap: { mint: spec?.mints[0], amount: '1', windowSeconds: 60 } }
  expect(() => armRule(withCap, { publicUrl: 'https://agon.example', network: 'fork' })).toThrow(
    /cap/,
  )
})

test('every leg validates its input, so a bad one never reaches the fixture', () => {
  expect(() => report({ wallet: 'not-an-address' })).toThrow()
  expect(() => report({})).toThrow()
  expect(() => checkTrade({ ...input('check-trade-input'), side: 'sideways' })).toThrow()
  expect(() => checkTrade({ ...input('check-trade-input'), size: -1 })).toThrow()
  // A malformed spec fails validation rather than reaching the refusal, so the 2 are not confused.
  expect(() =>
    armRule({ mints: [] }, { publicUrl: 'https://agon.example', network: 'fork' }),
  ).not.toThrow(NotArmable)
})

test('the armed-rule example is contract valid, so the shape is right when arming turns on', () => {
  expect(() => ArmedRule.parse(armedRuleExample())).not.toThrow()
})
