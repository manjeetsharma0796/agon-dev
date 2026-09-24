// The kill switch. T-D03.
//
// One wallet signature removes every Agon role. This is the last layer, so it is written to be
// wrong in only one direction: it would rather leave a role behind and say so than remove a role
// that is not ours.
//
// That asymmetry is the whole design. Removing one role too few leaves a capped agent running for
// another minute. Removing one role too many can take the user's own root authority off their own
// Swig account, and there is no support desk to undo it. So a role is only ever removed when it
// matches the agent shape exactly, read off the chain rather than off anything we stored.

import { assertAgentRoleShape, type RoleActions } from './swig/index.js'

/** A role as it exists on the Swig account, paired with the id needed to remove it. */
export interface OnChainRole {
  id: number
  actions: RoleActions
}

/**
 * Is this one of ours?
 *
 * Deliberately the same check that arms a role, run in reverse: if `assertAgentRoleShape` would
 * accept it, it is an agent role. Sharing the definition means the two can never drift into the
 * state where we arm a shape we will not later revoke.
 *
 * The mint is not known here, because a kill switch runs when the user has stopped caring which
 * mint it was. `assertAgentRoleShape` needs one to check the limit, so the role's own limited mint
 * is used: the shape check still proves the role is Jupiter plus exactly one capped token limit and
 * nothing else, which is what identifies it as ours.
 */
export function isAgentRole(role: RoleActions, mint: string): boolean {
  try {
    assertAgentRoleShape(role, mint)
    return true
  } catch {
    return false
  }
}

/** Why a role was left alone. Every role on the account gets one of these or is revoked. */
export interface SkippedRole {
  id: number
  reason: string
}

export interface RevokePlan {
  /** Role ids to remove, in ascending order so two runs produce the same transaction. */
  revoke: number[]
  /** Everything not being touched, and why. A kill switch that is silent about what it left is not one. */
  kept: SkippedRole[]
  /** True when every removal fits in 1 transaction, which is what "1 wallet signature" means. */
  oneSignature: boolean
}

/**
 * The most removals that fit in one transaction.
 *
 * A Solana transaction is capped at 1232 bytes. A remove-authority instruction carries a handful of
 * account metas and a small payload, and the transaction also has to hold the signature, the
 * header, the blockhash and the account table. 12 is a deliberately pessimistic bound rather than a
 * measured one, because being wrong here means a revoke that fails to land rather than one that
 * needs two signatures, and the failure would arrive at the worst possible moment.
 */
export const MAX_REMOVALS_PER_TRANSACTION = 12

/**
 * Work out what to remove.
 *
 * `mintOf` maps a role to the mint it caps, because the shape check needs one and only the caller
 * knows how to read it. A role whose mint cannot be determined is kept, not guessed at.
 */
export function planRevokeAll(
  roles: readonly OnChainRole[],
  mintOf: (role: OnChainRole) => string | null,
): RevokePlan {
  const revoke: number[] = []
  const kept: SkippedRole[] = []

  for (const role of roles) {
    if (role.actions.isRoot()) {
      kept.push({
        id: role.id,
        reason:
          'the root authority, which is yours. Removing it would lock you out of your own Swig account.',
      })
      continue
    }
    const mint = mintOf(role)
    if (mint === null) {
      kept.push({
        id: role.id,
        reason: 'no capped mint could be read from it, so it cannot be confirmed as an Agon role.',
      })
      continue
    }
    if (!isAgentRole(role.actions, mint)) {
      kept.push({
        id: role.id,
        reason: `it does not match the Agon agent shape, so it was granted by something other than Agon and is not ours to remove.`,
      })
      continue
    }
    revoke.push(role.id)
  }

  revoke.sort((a, b) => a - b)
  return { revoke, kept, oneSignature: revoke.length <= MAX_REMOVALS_PER_TRANSACTION }
}

/** What the user reads when the revoke lands. Says what happened, and only what happened. */
export function revokedMessage(plan: RevokePlan): string {
  if (plan.revoke.length === 0)
    return 'No Agon roles were found on this wallet. Nothing was changed.'
  const n = plan.revoke.length
  return `Rule revoked. ${n} Agon role${n === 1 ? '' : 's'} removed. Your agent can no longer trade.`
}

/**
 * The open-order notice, fixed word for word by T-D03's acceptance.
 *
 * `amountText` is already formatted, for example "2.0 SOL", because this package has no business
 * knowing a mint's decimals and the caller already renders amounts everywhere else.
 *
 * The wording matters more than it looks. Revoking a Swig role stops the agent placing new orders.
 * It does not touch an order Jupiter is already holding, and it does not return the funds inside
 * one. A message that said "revoked, your funds are safe" would be false in exactly the case the
 * user most needs the truth, so this says where the money still is and offers the one action that
 * moves it.
 */
export function openOrderNotice(amountText: string): string {
  return `Rule revoked. ${amountText} is still inside an open Jupiter order. Cancel it?`
}
