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

/**
 * A program the agent role must NEVER be able to use, asked about only to prove a negative.
 *
 * `canUseProgram` answers true for `ProgramAll`, `ProgramCurated` and `All` whatever id it is
 * handed, so asking it about Jupiter cannot tell a Jupiter-scoped role from one that can call
 * anything. Asking about a program the role has no business calling separates them: a role holding
 * `Program(Jupiter)` answers false, and every wider role answers true. The system program is the
 * right one to ask about because a bare transfer is exactly the escape this scoping exists to stop.
 *
 * This is a question, never a grant. Nothing here permits the system program.
 */
export const NON_JUPITER_PROBE_ID = '11111111111111111111111111111111'

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
  /**
   * Is there a token control for this mint at all, whatever is left in the window.
   *
   * The SDK's version takes an optional amount, and this one deliberately does not. Passing an
   * amount makes the answer depend on the REMAINING allowance, which is the exact confusion that
   * made the kill switch refuse to revoke a role that had spent its window. Narrowing it here means
   * a caller cannot reintroduce that by adding an argument.
   */
  canSpendToken(mint: string): boolean
  tokenSpend(mint: string): TokenSpend
}

/**
 * One mint's spend control, as the SDK reads it. The two amounts are not interchangeable and
 * confusing them is what this row exists to fix.
 */
export interface TokenSpend {
  /** What is LEFT in the current window. Decays as the agent trades, so it is never the cap. */
  readonly spendLimit: bigint | null
  /** Window length in slots. */
  readonly window: bigint | null
  /** The CONFIGURED amount per window. This is the cap, and it does not move as funds are spent. */
  readonly recurringLimit: bigint | undefined
  /**
   * The slot the current window started at, always a multiple of `window` (0 on a fresh role).
   * Swig rewrites `spendLimit` only on the next spend, so this is what tells a stale reading apart.
   */
  readonly lastReset?: bigint | undefined
}

/**
 * What the agent can really spend at `slot`. Swig refills the allowance once more than `window`
 * slots have passed since `lastReset` (measured on a fork: refused at `lastReset + 150`, allowed
 * from `+151`), but leaves `spendLimit` stale until the next spend, so the raw field under-reports.
 *
 * Money logic, so it never reports more than it can prove: a field it cannot read falls back to
 * the raw remaining figure, and an uncapped role has no figure at all.
 */
export function effectiveRemaining(spend: TokenSpend, slot: bigint): bigint {
  if (spend.spendLimit === null) {
    throw new Error(
      'This role has no cap on the mint, so there is no remaining figure to report. Arm a recurring limit first.',
    )
  }
  const { window, lastReset, recurringLimit } = spend
  if (window === null || lastReset === undefined || recurringLimit === undefined)
    return spend.spendLimit
  return slot - lastReset > window ? recurringLimit : spend.spendLimit
}

/** Exactly what the user signed for, to compare against what reached the chain. */
export interface ApprovedCap {
  /** The amount per window, in base units. */
  amount: bigint
  /** The window length, in slots. */
  window: bigint
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
  // The token limit is added BEFORE the program limit, and the order is load-bearing.
  //
  // `Actions.tokenSpend(mint)` picks an action with `find(a => a.tokenControl(mint).spendLimit !=
  // null)`, but `spendLimit` returns `0n` rather than `null` for an action that has no token
  // control at all. So the program action always matches first and its empty controller is
  // returned, which reports `recurringLimit: undefined` and `window: null` for a perfectly good
  // role. Measured both ways on 2.1.0: with the program action first `recurringLimit` is
  // `undefined`, with the token action first it is the configured amount. Putting the token action
  // first is what makes the configured cap readable at all, and it is also correct if the SDK ever
  // fixes that `find`. The permissions are identical either way: only the buffer order changes.
  return Actions.set()
    .tokenRecurringLimit({
      mint: spec.mint,
      recurringAmount: spec.recurringAmount,
      window: spec.window,
    })
    .programLimit({ programId: JUPITER_PROGRAM_ID })
    .get()
}

/**
 * Assert a role is exactly the agent role and nothing more.
 *
 * Reads the role's own action list, which is what the on-chain account holds, rather than the spec
 * we built it from. Those are the same thing right up until they are not, and the whole point of
 * the cap is that it is checked against the chain.
 *
 * `approved` must be the numbers the USER confirmed, never the `AgentRoleSpec` this role was built
 * from. Comparing a spec against a role built from that same spec is a tautology that always passes
 * and looks like verification.
 *
 * `approved` is optional on purpose, and the reason is the kill switch. Revocation has to identify
 * our roles long after the arming session is over, when nobody remembers the numbers the user
 * signed for, so it calls this to ask "is this shape ours" with no cap to compare. Arming does know
 * the numbers and must pass them, because a role of the right SHAPE at the wrong AMOUNT is the
 * failure this row was opened for. Requiring it would have made the kill switch unable to run;
 * omitting it at arm time is the caller's bug, which is why `verifyRoleOnChain` takes it too.
 */
export function assertAgentRoleShape(
  role: RoleActions,
  mint: string,
  approved?: ApprovedCap,
): void {
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
  // Answering yes about Jupiter is not the same as being scoped to Jupiter. A role holding
  // programAll answers yes about every id, and the SDK appends programAll to any action set with no
  // program action of its own, so such a role has 2 actions and used to pass every check here while
  // being able to call anything on the chain.
  if (role.canUseProgram(NON_JUPITER_PROBE_ID)) {
    throw new Error(
      `This role can also use ${NON_JUPITER_PROBE_ID}, so it is not scoped to Jupiter: it carries ` +
        'programAll or wider. A role that can call any program can move funds without swapping.',
    )
  }
  if (role.canSpendTokenMax(mint)) {
    throw new Error(
      `This role can spend an unlimited amount of ${mint}. A cap that is not a number is not a cap.`,
    )
  }
  // Whether a limit EXISTS, asked in a way that does not depend on how much of it is left.
  // `tokenSpendLimit` returns the remaining allowance, so a role that has traded its whole window
  // reads 0 and used to be reported here as carrying no limit. The kill switch swallowed that and
  // told the user "No Agon roles were found" about the role trading hardest, then Swig reset the
  // window and the agent carried on.
  if (!role.canSpendToken(mint)) {
    throw new Error(
      `This role carries no spending limit for ${mint}, so nothing would stop it. Arm a recurring limit first.`,
    )
  }
  // Everything above is the identity check, and it stops here on purpose.
  //
  // Reading the CONFIGURED cap needs the token action to sit before the program action in the
  // buffer, for the SDK reason described in `agentRoleActions`. Requiring it here would make this
  // check stricter than the one that armed the role, and every role armed program-first, which is
  // every role the previous version of this file produced, would stop being recognised as ours:
  // `isAgentRole` swallows the throw, `planRevokeAll` files the role as "not ours to remove", and
  // the kill switch reports nothing found. That is the same fail-open this function was changed to
  // close, reached through a different door.
  //
  // So the rule is: the revoke path is never stricter than the arm path, or it cannot clean up what
  // arming produced. The cap is verified where there is something to verify it against.
  if (approved !== undefined) {
    if (approved.amount <= 0n || approved.window <= 0n) {
      throw new Error(
        `An approved cap of ${approved.amount} base units over ${approved.window} slots is not a ` +
          'cap. Both have to be positive, or the comparison below would pass on an unset object.',
      )
    }
    const spend = role.tokenSpend(mint)
    const configured = spend.recurringLimit
    if (configured === undefined || configured <= 0n) {
      throw new Error(
        `This role's configured cap for ${mint} could not be read, so there is no number to check ` +
          `against the ${approved.amount} the user approved. Nothing is armed on a cap we cannot read.`,
      )
    }
    // The number that reached the chain against the number the user signed for. Never compared
    // before, so a role armed at 25,000,000 when the user approved 25 passed every check.
    if (configured !== approved.amount) {
      throw new Error(
        `This role is armed at ${configured} base units of ${mint} per window, but the user ` +
          `approved ${approved.amount}. Nothing is armed at a cap the user did not sign for.`,
      )
    }
    if (spend.window !== approved.window) {
      throw new Error(
        `This role resets every ${String(spend.window)} slots, but the user approved ` +
          `${approved.window}. A window that is not the approved one is a different cap.`,
      )
    }
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
  approved?: ApprovedCap,
): Promise<RoleActions> {
  const role = await fetchRole(swigAddress, roleId)
  if (role === null) {
    throw new Error(
      `No role ${roleId} exists on Swig account ${swigAddress}. Nothing was verified, so nothing is armed.`,
    )
  }
  assertAgentRoleShape(role, mint, approved)
  return role
}

/** A role as the SDK reads it off a Swig account: only the parts listing a vault needs. */
export interface ChainRole {
  readonly id: number
  readonly authority: { readonly addressString: string }
  readonly actions: RoleActions
}

/** One agent rule as the chain proves it: what `list_rules` reports, before any formatting. */
export interface ChainAgentRule {
  roleId: number
  /** The agent key the role is granted to. */
  authority: string
  mint: string
  /** The configured cap per window, in base units. */
  amount: bigint
  /** Window length in slots, exactly as Swig enforces it, never converted to seconds. */
  windowSlots: bigint
  /** What the agent can spend at the slot asked about, from `effectiveRemaining`. */
  effectiveRemaining: bigint
  /** 2 full windows across an edge, because windows follow the slot clock (OP-32). */
  rollingWorstCase: bigint
}

/**
 * The agent rules on a vault at `slot`. Pure: the caller reads the roles and the slot.
 *
 * A role is listed only if it has the production agent shape for the mint, so the owner's root role
 * and anything hand-made are never reported as an agent's rule. A role whose configured cap cannot
 * be read is an error rather than a smaller number, because a missing rule reads as "nothing armed".
 */
export function agentRulesOf(
  roles: readonly ChainRole[],
  mints: readonly string[],
  slot: bigint,
): ChainAgentRule[] {
  const rules: ChainAgentRule[] = []
  for (const role of roles) {
    for (const mint of mints) {
      try {
        assertAgentRoleShape(role.actions, mint)
      } catch {
        continue
      }
      const spend = role.actions.tokenSpend(mint)
      if (spend.recurringLimit === undefined || spend.window === null) {
        throw new Error(
          `Role ${role.id} limits ${mint} but its configured cap or window could not be read, so its ` +
            `remaining allowance is not reported rather than reported wrong.`,
        )
      }
      rules.push({
        roleId: role.id,
        authority: role.authority.addressString,
        mint,
        amount: spend.recurringLimit,
        windowSlots: spend.window,
        effectiveRemaining: effectiveRemaining(spend, slot),
        rollingWorstCase: spend.recurringLimit * 2n,
      })
    }
  }
  return rules
}
