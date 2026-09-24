import { expect, test } from 'vitest'
import type { OnChainRole, RoleActions } from '@agon/chain'
import { renderRevoke, revoke, type RevokeIo } from './revoke.js'

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

// Plain objects rather than the Swig SDK. The CLI does not depend on it and should not start to:
// its cold start is a gate. packages/chain tests the shape logic against the real SDK, which is
// where that belongs; this file tests what the command does with the answer.
const role = (over: Partial<RoleActions> = {}): RoleActions => ({
  count: 2,
  isRoot: () => false,
  canManageAuthority: () => false,
  canCloseSwigAuthority: () => false,
  canUseProgram: () => true,
  canSpendTokenMax: () => false,
  tokenSpendLimit: () => 25_000_000n,
  ...over,
})
const agent = (): RoleActions => role()
const root = (): RoleActions => role({ isRoot: () => true, count: 1 })
const W = ['wallet-a', 'wallet-b', 'wallet-c']

const io = (over: Partial<RevokeIo> & { roles?: Record<string, OnChainRole[]> } = {}): RevokeIo => {
  const roles = over.roles ?? Object.fromEntries(W.map((w) => [w, [{ id: 1, actions: agent() }]]))
  return {
    loadRoles: over.loadRoles ?? (async (w) => roles[w] ?? []),
    mintOf: over.mintOf ?? (() => USDC),
    openOrder: over.openOrder ?? (async () => null),
    submit: over.submit ?? (async (w, ids) => `sig-${w}-${ids.join('-')}`),
  }
}

test('one command clears every Agon role from every wallet it is given', async () => {
  // The acceptance measures exactly this over 3 wallets: 0 roles left afterwards.
  const submitted: [string, readonly number[]][] = []
  const report = await revoke(
    W,
    io({
      submit: async (w, ids) => {
        submitted.push([w, ids])
        return `sig-${w}`
      },
    }),
  )
  expect(report.allClear).toBe(true)
  expect(report.results).toHaveLength(3)
  expect(submitted.map(([w]) => w)).toEqual(W)
  for (const r of report.results) expect(r.revoked).toEqual([1])
})

test('it is 1 transaction per wallet, which is what 1 signature means', async () => {
  const calls: number[] = []
  await revoke(
    ['wallet-a'],
    io({
      roles: { 'wallet-a': [1, 2, 3].map((id) => ({ id, actions: agent() })) },
      submit: async (_w, ids) => {
        calls.push(ids.length)
        return 'sig'
      },
    }),
  )
  expect(calls, '3 roles should be removed by 1 submit, not 3').toEqual([3])
})

test('the root authority survives a kill switch', async () => {
  const report = await revoke(
    ['wallet-a'],
    io({
      roles: {
        'wallet-a': [
          { id: 0, actions: root() },
          { id: 1, actions: agent() },
        ],
      },
    }),
  )
  expect(report.results[0]?.revoked).toEqual([1])
  expect(report.results[0]?.kept.map((k) => k.id)).toEqual([0])
  expect(renderRevoke(report)).toContain('lock you out')
})

test('a wallet that could not be read is not reported as clear', async () => {
  const report = await revoke(
    W,
    io({
      loadRoles: async (w) => {
        if (w === 'wallet-b') throw new Error('RPC timeout')
        return [{ id: 1, actions: agent() }]
      },
    }),
  )
  expect(report.allClear).toBe(false)
  expect(report.results[1]?.failure).toContain('assume the agent is still armed')
  // The other 2 still get done. A kill switch that gives up on the first error is worse than none.
  expect(report.results[0]?.revoked).toEqual([1])
  expect(report.results[2]?.revoked).toEqual([1])
})

test('a transaction that did not land is not reported as a revoke', async () => {
  const report = await revoke(
    ['wallet-a'],
    io({
      submit: async () => {
        throw new Error('blockhash expired')
      },
    }),
  )
  expect(report.allClear).toBe(false)
  expect(report.results[0]?.revoked).toEqual([])
  expect(report.results[0]?.failure).toContain('The roles are still there')
})

test('too many roles to sign at once is refused, not quietly split', async () => {
  const many = Array.from({ length: 20 }, (_, id) => ({ id, actions: agent() }))
  const submits: number[] = []
  const report = await revoke(
    ['wallet-a'],
    io({
      roles: { 'wallet-a': many },
      submit: async (_w, ids) => {
        submits.push(ids.length)
        return 'sig'
      },
    }),
  )
  expect(submits, 'nothing should have been submitted').toEqual([])
  expect(report.results[0]?.tooManyForOneSignature).toBe(true)
  expect(report.allClear).toBe(false)
})

test('funds in an open order are reported, and the revoke never claims to have returned them', async () => {
  const report = await revoke(['wallet-a'], io({ openOrder: async () => '2.0 SOL' }))
  const text = renderRevoke(report)
  expect(text).toContain('Rule revoked. 2.0 SOL is still inside an open Jupiter order. Cancel it?')
  for (const lie of ['returned', 'refunded', 'safe', 'recovered']) {
    expect(text.toLowerCase(), `the output says "${lie}"`).not.toContain(lie)
  }
})

test('a wallet with nothing on it says so rather than claiming a revoke', async () => {
  const report = await revoke(['wallet-a'], io({ roles: { 'wallet-a': [] } }))
  expect(report.allClear).toBe(true)
  expect(renderRevoke(report)).toContain(
    'No Agon roles were found on this wallet. Nothing was changed.',
  )
})

test('the output names every wallet and ends with the count that matters', async () => {
  const text = renderRevoke(await revoke(W, io()))
  for (const w of W) expect(text).toContain(w)
  expect(text.trimEnd().endsWith('3 wallet(s) checked, 0 Agon roles left.')).toBe(true)
})
