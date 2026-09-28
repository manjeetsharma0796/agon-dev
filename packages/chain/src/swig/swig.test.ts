import { expect, test } from 'vitest'
import { Actions, SWIG_PROGRAM_ADDRESS } from '@swig-wallet/classic'
import {
  agentRoleActions,
  effectiveRemaining,
  agentRulesOf,
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

// T-C17. The real allowance, measured on a Surfpool mainnet fork on 2026-09-26 with the production
// role: lastReset read 450717150 with 0.05 wSOL left, a swap needing a reset was refused at slot
// 450717300 and allowed from 450717301. Swig only rewrites spendLimit on the next spend, so reading
// it raw after the window shows 0.05 while 0.5 is spendable.
const measured = {
  spendLimit: 50_000_000n,
  window: 150n,
  lastReset: 450_717_150n,
  recurringLimit: 500_000_000n,
}

test('inside the window the remaining allowance is what the role reads, measured at the edge', () => {
  expect(effectiveRemaining(measured, 450_717_300n)).toBe(50_000_000n)
})

test('once the window has passed the whole cap is spendable, though the raw field still reads 0.05', () => {
  expect(effectiveRemaining(measured, 450_717_301n)).toBe(500_000_000n)
})

test('a role that cannot be read in full is never reported above what it reads', () => {
  // Under-reporting a budget is safe and over-reporting is not, so a missing field falls back to the
  // raw remaining figure rather than to the cap.
  expect(effectiveRemaining({ ...measured, lastReset: undefined }, 450_717_301n)).toBe(50_000_000n)
  expect(effectiveRemaining({ ...measured, window: null }, 450_717_301n)).toBe(50_000_000n)
  expect(effectiveRemaining({ ...measured, recurringLimit: undefined }, 450_717_301n)).toBe(
    50_000_000n,
  )
})

test('an uncapped role has no remaining figure to report, and says so instead of a number', () => {
  expect(() => effectiveRemaining({ ...measured, spendLimit: null }, 450_717_301n)).toThrow(
    /no cap/,
  )
})

// T-C17: what list_rules reports for a vault, from its roles and the slot. Pure, so the MCP only
// does the reading.
test('a vault lists its agent role with the real allowance, and never the owner root role', () => {
  const agent = agentRoleActions({ mint: USDC, recurringAmount: 500_000_000n, window: 150n })
  const roles = [
    { id: 0, authority: { addressString: 'Owner1111111111111111111111111111111111111' }, actions: asRole(Actions.set().all().get()) },
    { id: 1, authority: { addressString: 'Agent1111111111111111111111111111111111111' }, actions: agent },
  ]
  const rules = agentRulesOf(roles, [USDC], 1_000_000n)
  expect(rules).toHaveLength(1)
  expect(rules[0]).toMatchObject({
    roleId: 1,
    authority: 'Agent1111111111111111111111111111111111111',
    mint: USDC,
    amount: 500_000_000n,
    windowSlots: 150n,
    // A fresh role reads lastReset 0, so at any real slot the whole cap is spendable.
    effectiveRemaining: 500_000_000n,
    // OP-32: 2 full windows across an edge.
    rollingWorstCase: 1_000_000_000n,
  })
})

test('a vault with no agent role lists nothing, which means nothing is armed', () => {
  const roles = [{ id: 0, authority: { addressString: 'Owner1111111111111111111111111111111111111' }, actions: asRole(Actions.set().all().get()) }]
  expect(agentRulesOf(roles, [USDC], 1_000_000n)).toEqual([])
})
