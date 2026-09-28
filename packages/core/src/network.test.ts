import { expect, test } from 'vitest'
import { network } from './network.js'

test('each configured network names itself and says whether funds are real', () => {
  expect(network('fork')).toMatchObject({ id: 'fork', tone: 'test' })
  expect(network('fork').short).toMatch(/no real funds/)
  expect(network('devnet')).toMatchObject({ id: 'devnet', tone: 'test' })
  expect(network('devnet').short).toMatch(/no real value/)
  expect(network('mainnet')).toMatchObject({ id: 'mainnet', tone: 'real' })
  expect(network('mainnet').short).toMatch(/real funds/)
})

test('a missing or mistyped setting never reads as mainnet, and never as blank', () => {
  // Fail closed: "Mainnet " with a stray space is a typo, not a decision to use real money.
  for (const value of [undefined, '', 'Mainnet ', 'main', 'localnet']) {
    const n = network(value)
    expect(n.id, `${String(value)} was accepted`).toBe('unset')
    expect(n.tone).toBe('warn')
    expect(n.text.length).toBeGreaterThan(20)
    expect(n.short.length).toBeGreaterThan(10)
  }
})

test('no label uses a dash the repo bans', () => {
  for (const value of ['fork', 'devnet', 'mainnet', undefined]) {
    const n = network(value)
    expect(/[\u2013\u2014]/.test(n.text + n.short)).toBe(false)
  }
})
