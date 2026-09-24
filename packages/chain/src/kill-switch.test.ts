import { expect, test } from 'vitest'
import { Actions, Permission } from '@swig-wallet/classic'
import { agentRoleActions, type RoleActions } from './swig/index.js'
import {
  MAX_REMOVALS_PER_TRANSACTION,
  isAgentRole,
  openOrderNotice,
  planRevokeAll,
  revokedMessage,
  type OnChainRole,
} from './kill-switch.js'

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const SOL = 'So11111111111111111111111111111111111111112'
const spec = (mint: string) => ({ mint, recurringAmount: 25_000_000n, window: 216_000n })

/** The user's own authority over their own Swig. The one role that must never be touched. */
const rootRole = (): RoleActions => Actions.set().all().get()
/** Something another product granted. Not ours, so not ours to remove. */
const foreignRole = (): RoleActions => Actions.set().manageAuthority().get()

const at = (id: number, actions: RoleActions): OnChainRole => ({ id, actions })
/** Real callers read this off the role; the tests state it, which is the same information. */
const mintOf = (mints: Record<number, string | null>) => (r: OnChainRole) => mints[r.id] ?? null

test('every Agon role is removed', () => {
  const plan = planRevokeAll(
    [at(1, agentRoleActions(spec(USDC))), at(2, agentRoleActions(spec(SOL)))],
    mintOf({ 1: USDC, 2: SOL }),
  )
  expect(plan.revoke).toEqual([1, 2])
  expect(plan.kept).toEqual([])
  expect(plan.oneSignature).toBe(true)
})

test('and nothing else is, which is the half that cannot be got wrong', () => {
  // Removing one role too few leaves a capped agent running for another minute. Removing one too
  // many can take the user's own root authority off their own Swig, and nobody can undo that.
  const plan = planRevokeAll(
    [
      at(0, rootRole()),
      at(1, agentRoleActions(spec(USDC))),
      at(2, foreignRole()),
      at(3, agentRoleActions(spec(SOL))),
    ],
    mintOf({ 0: USDC, 1: USDC, 2: USDC, 3: SOL }),
  )
  expect(plan.revoke).toEqual([1, 3])
  expect(plan.kept.map((k) => k.id)).toEqual([0, 2])
})

test('the root authority is named as yours, not just skipped silently', () => {
  const plan = planRevokeAll([at(0, rootRole())], mintOf({ 0: USDC }))
  expect(plan.revoke).toEqual([])
  expect(plan.kept[0]?.reason).toContain('root authority, which is yours')
  expect(plan.kept[0]?.reason).toContain('lock you out')
})

test('a role whose mint cannot be read is kept, not guessed at', () => {
  const plan = planRevokeAll([at(1, agentRoleActions(spec(USDC)))], mintOf({}))
  expect(plan.revoke).toEqual([])
  expect(plan.kept[0]?.reason).toContain('cannot be confirmed as an Agon role')
})

test('a role that only looks like ours is not ours', () => {
  // Jupiter access with no cap. Close enough to pass a careless check, and it is not an Agon role,
  // because Agon never grants uncapped spending.
  const uncapped = Actions.set()
    .programLimit({ programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4' })
    .get()
  expect(isAgentRole(uncapped, USDC)).toBe(false)
  expect(planRevokeAll([at(1, uncapped)], mintOf({ 1: USDC })).revoke).toEqual([])
})

test('the plan is ordered, so 2 runs build the same transaction', () => {
  const roles = [at(5, agentRoleActions(spec(USDC))), at(2, agentRoleActions(spec(SOL)))]
  expect(planRevokeAll(roles, mintOf({ 5: USDC, 2: SOL })).revoke).toEqual([2, 5])
  expect(planRevokeAll([...roles].reverse(), mintOf({ 5: USDC, 2: SOL })).revoke).toEqual([2, 5])
})

test('one signature is a claim about size, so it is checked rather than assumed', () => {
  const many = Array.from({ length: MAX_REMOVALS_PER_TRANSACTION + 1 }, (_, i) =>
    at(i, agentRoleActions(spec(USDC))),
  )
  const mints = Object.fromEntries(many.map((r) => [r.id, USDC]))
  const plan = planRevokeAll(many, mintOf(mints))
  expect(plan.revoke).toHaveLength(MAX_REMOVALS_PER_TRANSACTION + 1)
  expect(plan.oneSignature, 'more removals than fit in a transaction were called 1 signature').toBe(
    false,
  )
})

test('nothing to revoke says so, rather than claiming a revoke happened', () => {
  expect(revokedMessage(planRevokeAll([], mintOf({})))).toBe(
    'No Agon roles were found on this wallet. Nothing was changed.',
  )
})

test('the revoked message counts what was removed and says what it means', () => {
  const plan = planRevokeAll([at(1, agentRoleActions(spec(USDC)))], mintOf({ 1: USDC }))
  expect(revokedMessage(plan)).toBe(
    'Rule revoked. 1 Agon role removed. Your agent can no longer trade.',
  )
})

test('the open order notice is the sentence T-D03 fixes, to the character', () => {
  expect(openOrderNotice('2.0 SOL')).toBe(
    'Rule revoked. 2.0 SOL is still inside an open Jupiter order. Cancel it?',
  )
})

test('the notice never implies the revoke returned the funds', () => {
  // Revoking a Swig role stops the agent placing new orders. It does not touch an order Jupiter is
  // already holding, and it does not return what is inside one. "Your funds are safe" would be
  // false in exactly the case where the user most needs the truth.
  const notice = openOrderNotice('2.0 SOL')
  for (const lie of ['returned', 'refunded', 'back in your wallet', 'safe', 'recovered']) {
    expect(notice.toLowerCase(), `the notice says "${lie}"`).not.toContain(lie)
  }
  expect(notice).toContain('is still inside an open Jupiter order')
})
