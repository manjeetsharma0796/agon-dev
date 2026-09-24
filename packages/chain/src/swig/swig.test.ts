import { expect, test } from 'vitest'
import { Actions, SWIG_PROGRAM_ADDRESS } from '@swig-wallet/classic'
import {
  agentRoleActions,
  assertAgentRoleShape,
  verifyRoleOnChain,
  AGENT_ROLE_ACTION_COUNT,
  JUPITER_PROGRAM_ID,
  SWIG_PROGRAM_ID,
  type RoleActions,
} from './index.js'

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const spec = { mint: USDC, recurringAmount: 25_000_000n, window: 216_000n }
const asRole = (a: unknown): RoleActions => a as RoleActions

test('the pinned program ids are the ones on mainnet, and the SDK agrees about Swig', () => {
  // Checked against mainnet at slot 450045410: both exist, both are executable, both owned by the
  // BPF upgradeable loader. Pinned here so no quote, token list or user input can supply one.
  expect(SWIG_PROGRAM_ID).toBe('swigypWHEksbC64pWKwah1WTeh9JXwx8H1rJHLdbQMB')
  expect(JUPITER_PROGRAM_ID).toBe('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4')
  expect(String(SWIG_PROGRAM_ADDRESS)).toBe(SWIG_PROGRAM_ID)
})

test('the agent role is exactly Jupiter plus a capped recurring token limit', () => {
  const role = agentRoleActions(spec)
  expect(role.count).toBe(AGENT_ROLE_ACTION_COUNT)
  expect(role.canUseProgram(JUPITER_PROGRAM_ID)).toBe(true)
  expect(role.tokenSpendLimit(USDC)).toBe(spec.recurringAmount)
  expect(role.canSpendTokenMax(USDC)).toBe(false)
})

test('the agent key holds no manageAuthority and is not root', () => {
  // The one property the entire non-custodial claim rests on, read off the role with the SDK's own
  // predicate rather than off the spec we meant to send.
  const role = agentRoleActions(spec)
  expect(role.canManageAuthority()).toBe(false)
  expect(role.isRoot()).toBe(false)
  expect(role.canCloseSwigAuthority()).toBe(false)
  expect(() => assertAgentRoleShape(role, USDC)).not.toThrow()
})

test('a role that grants manageAuthority is rejected, and says why', () => {
  // The control. If this stops throwing, the assertion above is decoration.
  const overreaching = asRole(
    Actions.set()
      .programLimit({ programId: JUPITER_PROGRAM_ID })
      .tokenRecurringLimit(spec)
      .manageAuthority()
      .get(),
  )
  expect(overreaching.canManageAuthority()).toBe(true)
  expect(() => assertAgentRoleShape(overreaching, USDC)).toThrow(/manageAuthority/)
})

test('a role with every permission is rejected', () => {
  const root = asRole(Actions.set().all().get())
  expect(() => assertAgentRoleShape(root, USDC)).toThrow()
})

test('a role that cannot reach Jupiter is rejected rather than armed', () => {
  const noProgram = asRole(Actions.set().tokenRecurringLimit(spec).get())
  expect(() => assertAgentRoleShape(noProgram, USDC)).toThrow(/Jupiter/)
})

test('a role with no limit on the mint is rejected', () => {
  // A role that can trade through Jupiter with no cap is the failure this package exists to
  // prevent, and it is one method call away from the correct one.
  const uncapped = asRole(Actions.set().programLimit({ programId: JUPITER_PROGRAM_ID }).get())
  expect(() => assertAgentRoleShape(uncapped, USDC)).toThrow(/no spending limit/)
})

test('an amount or window of zero is refused before anything is signed', () => {
  expect(() => agentRoleActions({ ...spec, recurringAmount: 0n })).toThrow(/positive amount/)
  expect(() => agentRoleActions({ ...spec, window: 0n })).toThrow(/not a window/)
})

test('verification reads the chain, and a missing role arms nothing', async () => {
  const onChain = agentRoleActions(spec)
  await expect(
    verifyRoleOnChain(() => Promise.resolve(onChain), 'SwigAcct', 1, USDC),
  ).resolves.toBe(onChain)

  // The chain wins. A role that is not there is not a role that passed.
  await expect(verifyRoleOnChain(() => Promise.resolve(null), 'SwigAcct', 1, USDC)).rejects.toThrow(
    /No role 1 exists/,
  )

  // And a role the chain reports as over-privileged fails, even though the one we built was fine.
  const tampered = asRole(
    Actions.set()
      .programLimit({ programId: JUPITER_PROGRAM_ID })
      .tokenRecurringLimit(spec)
      .manageAuthority()
      .get(),
  )
  await expect(
    verifyRoleOnChain(() => Promise.resolve(tampered), 'SwigAcct', 1, USDC),
  ).rejects.toThrow(/manageAuthority/)
})
