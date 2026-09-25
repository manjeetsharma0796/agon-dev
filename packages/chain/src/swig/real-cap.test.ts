// T-D06. Three ways the cap reads as holding when it does not.
//
// Every role here is a real `Actions` from the SDK, not a stub, because the whole point of the row
// is that our reading of the SDK's predicates was wrong. A stub would have agreed with the bug.

import { expect, test } from 'vitest'
import { Actions } from '@swig-wallet/classic'
import { isAgentRole, planRevokeAll, revokedMessage, type OnChainRole } from '../kill-switch.js'
import {
  agentRoleActions,
  assertAgentRoleShape,
  JUPITER_PROGRAM_ID,
  verifyRoleOnChain,
  type RoleActions,
} from './index.js'

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const spec = { mint: USDC, recurringAmount: 25_000_000n, window: 216_000n }
const asRole = (a: unknown): RoleActions => a as RoleActions

/** A little-endian u64, the way the Swig coder writes an amount. */
const leU64 = (v: bigint): Uint8Array => {
  const b = new Uint8Array(8)
  let x = v
  for (let i = 0; i < 8; i++) {
    b[i] = Number(x & 0xffn)
    x >>= 8n
  }
  return b
}

const indexOfBytes = (haystack: Uint8Array, needle: Uint8Array, from = 0): number => {
  outer: for (let i = from; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer
    return i
  }
  return -1
}

/**
 * A role whose window is fully spent, built by zeroing `currentAmount` in the real encoded bytes.
 *
 * The payload holds `recurringAmount` then `currentAmount`, both the same value at arm time, so the
 * SECOND occurrence is the one that decays as the agent trades. Verified by probing both offsets:
 * zeroing the first leaves `tokenSpendLimit` untouched and zeroes `recurringLimit`, zeroing the
 * second does the reverse, which is the real thing a spent window looks like.
 */
const spentWindowRole = (): RoleActions => {
  const role = agentRoleActions(spec)
  const bytes = (role as unknown as { bytes(): Uint8Array }).bytes()
  const amount = leU64(spec.recurringAmount)
  const first = indexOfBytes(bytes, amount)
  const current = indexOfBytes(bytes, amount, first + 1)
  expect(current).toBeGreaterThan(-1)
  const spent = new Uint8Array(bytes)
  spent.set(new Uint8Array(8), current)
  return asRole(Actions.from(spent, role.count))
}

test('a role whose window is spent is still our role, and the kill switch still removes it', () => {
  // The failure this prevents: tokenSpendLimit returns the REMAINING allowance, so a role that has
  // traded its whole window reads 0, assertAgentRoleShape called it "no spending limit",
  // isAgentRole swallowed the throw, and the user was told "No Agon roles were found" about the
  // role that had been trading hardest. Then Swig reset the window and the agent carried on.
  const spentRole = spentWindowRole()
  expect(spentRole.tokenSpendLimit(USDC)).toBe(0n)

  expect(() => assertAgentRoleShape(spentRole, USDC)).not.toThrow()
  expect(isAgentRole(spentRole, USDC)).toBe(true)

  const roles: OnChainRole[] = [{ id: 3, actions: spentRole }]
  const plan = planRevokeAll(roles, () => USDC)
  expect(plan.revoke).toEqual([3])
  expect(plan.kept).toEqual([])
  expect(revokedMessage(plan)).toMatch(/1 Agon role removed/)
})

test('a role carrying programAll is rejected, however much it looks like ours', () => {
  // canUseProgram returns true for ProgramAll whatever id you ask about, and the SDK appends
  // programAll to any action set with no program action. So this role has count 2 and answered yes
  // to "can you use Jupiter", and was accepted as Jupiter-scoped while being able to call anything.
  const anyProgram = asRole(Actions.set().programAll().tokenRecurringLimit(spec).get())
  expect(anyProgram.count).toBe(2)
  expect(anyProgram.canUseProgram(JUPITER_PROGRAM_ID)).toBe(true)

  expect(() => assertAgentRoleShape(anyProgram, USDC)).toThrow(/any program|programAll|not scoped/i)
  expect(isAgentRole(anyProgram, USDC)).toBe(false)
})

test('a role armed at 25,000,000 is rejected when the user approved 25', () => {
  // The cap the user signed for was never compared to the cap that reached the chain. Only that
  // some limit existed. A wrong-by-1000x role passed every check.
  const role = agentRoleActions(spec)
  const approved = { amount: 25n, window: spec.window }
  expect(() => assertAgentRoleShape(role, USDC, approved)).toThrow(/25/)

  // The matching approval still passes, or the check is just a way to reject everything.
  expect(() =>
    assertAgentRoleShape(role, USDC, { amount: spec.recurringAmount, window: spec.window }),
  ).not.toThrow()
})

test('reading the role back from the chain compares the cap the user approved', () => {
  // The arm-time path. verifyRoleOnChain is where the approved numbers enter, so a role that is the
  // right shape at the wrong amount has to fail HERE and not be discovered later by a user.
  const onChain = agentRoleActions(spec)
  const fetch = () => Promise.resolve(onChain)

  return Promise.all([
    expect(
      verifyRoleOnChain(fetch, 'SwigAcct', 1, USDC, { amount: 25n, window: spec.window }),
    ).rejects.toThrow(/approved 25\b/),
    expect(
      verifyRoleOnChain(fetch, 'SwigAcct', 1, USDC, {
        amount: spec.recurringAmount,
        window: spec.window,
      }),
    ).resolves.toBe(onChain),
  ])
})
