// Swig role creation and removal. Owned by T-D01.
//
// This is the layer that assumes every layer above it failed. If the guard is bypassed, if the
// agent is talked into skipping the check, if our whole machine is compromised, the cap still
// holds, because it is enforced by the Swig program and not by us.
//
// So the role is built to be boring and small: one program, one recurring token limit, and
// nothing else. Every assertion below reads the role's own action list rather than the spec we
// meant to send, because what matters is what the chain will enforce, not what we intended.

// The package's ESM build by its declared `module` path, not the bare specifier.
//
// @swig-wallet/classic@2.1.0 sets `"type": "module"` with `"main": "dist/index.cjs"` and no
// `exports` map. Node therefore loads the CommonJS build and runs named-export detection on it,
// which finds 34 of the 187 exports; `Actions` is not one of them, so `import { Actions }` throws
// at run time with "does not provide an export named 'Actions'". Bundlers pick up `"module":
// "dist/index.js"` instead and see all 187, which is why this typechecks and why every test passes
// under vitest while the built CLI dies on its first import. chain.import.test.ts imports the built
// package through a real node process so that gap cannot reopen quietly.
import { Actions, SWIG_PROGRAM_ADDRESS } from '@swig-wallet/classic/dist/index.js'

/**
 * Pinned program ids. Never read from user input, per the PRD, and never taken from a quote, a
 * token list or anything else that arrives over the wire.
 *
 * Both were checked against mainnet at slot 450045410: each exists, is executable, and is owned by
 * the BPF upgradeable loader.
 */
export const SWIG_PROGRAM_ID = 'swigypWHEksbC64pWKwah1WTeh9JXwx8H1rJHLdbQMB'
export const JUPITER_PROGRAM_ID = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'

// The SDK ships its own copy of the Swig address. If an upgrade ever moves it, this throws at
// import rather than letting us build a role against a program we did not mean to trust.
if (String(SWIG_PROGRAM_ADDRESS) !== SWIG_PROGRAM_ID) {
  throw new Error(
    `The Swig SDK now points at ${String(SWIG_PROGRAM_ADDRESS)}, not the pinned ` +
      `${SWIG_PROGRAM_ID}. Check the change before trusting it with a spending cap.`,
  )
}

/**
 * The public surface a role has to expose for the checks below.
 *
 * Deliberately only the SDK's own predicates. The raw action list is private on `Actions`, and
 * reaching past that to read it would mean asserting against our own decoding of the bytes rather
 * than against the SDK's reading of them, which is the reading the program shares.
 */
export interface RoleActions {
  count: number
  isRoot(): boolean
  canManageAuthority(): boolean
  canCloseSwigAuthority(): boolean
  canUseProgram(programId: string): boolean
  canSpendTokenMax(mint: string): boolean
  tokenSpendLimit(mint: string): bigint | null
}

/** What the agent is allowed to do. Deliberately the smallest thing that can trade. */
export interface AgentRoleSpec {
  /** The one mint the agent may spend. */
  mint: string
  /** The most it may spend per window, in base units. */
  recurringAmount: bigint
  /** Window length in slots. */
  window: bigint
}

/**
 * How many actions a correct agent role has: `Program` and `TokenRecurringLimit`, and nothing else.
 * Anything more is a role we did not ask for.
 *
 * Written as the number rather than derived from the SDK's `Permission` enum. `Permission` reaches
 * @swig-wallet/classic only through `export * from '@swig-wallet/lib'`, and node cannot see it
 * across that chain, so importing it made the whole package unloadable outside a bundler. The count
 * is asserted against the role's own `count` below, which is the chain's answer and the one that
 * matters; the enum only ever documented it.
 */
export const AGENT_ROLE_ACTION_COUNT = 2

/**
 * Build the agent's actions: trade through Jupiter, spend at most this much of this mint per
 * window. Nothing else, and in particular no `manageAuthority`, which would let the agent grant
 * itself more.
 */
export function agentRoleActions(spec: AgentRoleSpec): RoleActions {
  if (spec.recurringAmount <= 0n) {
    throw new Error(
      `A recurring limit of ${spec.recurringAmount} would let the agent spend nothing or everything. Set a positive amount in base units.`,
    )
  }
  if (spec.window <= 0n) {
    throw new Error(
      `A window of ${spec.window} slots is not a window. Set the number of slots the limit resets over.`,
    )
  }
  return Actions.set()
    .programLimit({ programId: JUPITER_PROGRAM_ID })
    .tokenRecurringLimit({
      mint: spec.mint,
      recurringAmount: spec.recurringAmount,
      window: spec.window,
    })
    .get()
}

/**
 * Assert a role is exactly the agent role and nothing more.
 *
 * Reads the role's own action list, which is what the on-chain account holds, rather than the spec
 * we built it from. Those are the same thing right up until they are not, and the whole point of
 * the cap is that it is checked against the chain.
 */
export function assertAgentRoleShape(role: RoleActions, mint: string): void {
  if (role.isRoot()) {
    throw new Error('This role is root. The agent key must never hold the root authority.')
  }
  if (role.canManageAuthority()) {
    throw new Error(
      'This role holds manageAuthority, so it could grant itself more. The agent key must never hold it.',
    )
  }
  if (role.canCloseSwigAuthority()) {
    throw new Error(
      'This role can close the Swig authority, which would take the cap away with it. The agent key must never hold that.',
    )
  }
  if (!role.canUseProgram(JUPITER_PROGRAM_ID)) {
    throw new Error(
      `This role cannot use Jupiter (${JUPITER_PROGRAM_ID}), so it could not trade even if it were armed.`,
    )
  }
  if (role.canSpendTokenMax(mint)) {
    throw new Error(
      `This role can spend an unlimited amount of ${mint}. A cap that is not a number is not a cap.`,
    )
  }
  const limit = role.tokenSpendLimit(mint)
  if (limit === null || limit <= 0n) {
    throw new Error(
      `This role carries no spending limit for ${mint}, so nothing would stop it. Arm a recurring limit first.`,
    )
  }
  if (role.count !== AGENT_ROLE_ACTION_COUNT) {
    throw new Error(
      `This role carries ${role.count} actions, expected ${AGENT_ROLE_ACTION_COUNT}. A role that ` +
        'can do more than trade one mint through Jupiter is not the role we asked for.',
    )
  }
}

/**
 * Read a role back from the chain and check it.
 *
 * `fetchRole` is injected so this stays pure and testable, and so the caller owns the RPC, its
 * timing and its replay. The check is the same one used at build time, on purpose: if the two ever
 * disagree, the chain wins.
 */
export async function verifyRoleOnChain(
  fetchRole: (swigAddress: string, roleId: number) => Promise<RoleActions | null>,
  swigAddress: string,
  roleId: number,
  mint: string,
): Promise<RoleActions> {
  const role = await fetchRole(swigAddress, roleId)
  if (role === null) {
    throw new Error(
      `No role ${roleId} exists on Swig account ${swigAddress}. Nothing was verified, so nothing is armed.`,
    )
  }
  assertAgentRoleShape(role, mint)
  return role
}
