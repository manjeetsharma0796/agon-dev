// Rule expiry, without ever giving the agent admin rights. T-D02.
//
// The problem: a rule should end on its own, and the thing that ends it must not be the agent. If
// the agent could remove its own role it would hold `manageAuthority`, and a key that can change
// its own permissions is not a capped key, it is an unlimited one with a polite habit.
//
// The answer is to make expiry something the user already authorised. At arm time the user signs a
// transaction that removes the role, and the daemon holds it until the rule is due. The daemon
// never gains a permission: it holds a piece of paper the user already signed.
//
// A normal Solana transaction cannot be held. Its blockhash dies in about 2 minutes, so a
// transaction signed on Monday is refused on Tuesday. A durable nonce replaces the blockhash with
// an on-chain value that only changes when a transaction using it lands, so the signature stays
// valid until it is used. That single property is what makes this scheme work, and it is also
// where all of its sharp edges come from, which is what the rest of this file is about.

import { assertAgentRoleShape, type RoleActions } from './swig/index.js'

/** What the user signs at arm time, and the daemon holds until the rule is due. */
export interface ExpiryAuthorisation {
  /** The Swig account the role lives on. */
  swigAddress: string
  /** The one role this removes. Never a list: one authorisation ends one rule. */
  roleId: number
  /** The durable nonce account the transaction is anchored to, in place of a blockhash. */
  nonceAccount: string
  /**
   * The nonce value at signing. The transaction is only valid while the account still holds it, so
   * it is single use: landing it advances the nonce and the same bytes can never be replayed.
   */
  nonce: string
  /** Slot the rule is due to end at. */
  expiresAtSlot: number
  /** Every key that signed. The agent key must not be among them, which is the point. */
  signers: readonly string[]
  /** The user's own key, which is the only one that may authorise removing their own role. */
  owner: string
}

/**
 * Everything wrong with an authorisation, as sentences. Empty means it is safe to hold.
 *
 * Returned rather than thrown because arm time should show the user every problem at once, and
 * because the daemon checks the same list again before submitting.
 */
export function faultsInAuthorisation(auth: ExpiryAuthorisation, agentKey: string): string[] {
  const faults: string[] = []

  if (auth.signers.includes(agentKey)) {
    faults.push(
      `The agent key ${agentKey} signed this expiry. The whole point is that only you can authorise ` +
        `removing your own role, so an expiry the agent signed is an expiry the agent controls.`,
    )
  }
  if (!auth.signers.includes(auth.owner)) {
    faults.push(
      `Your key ${auth.owner} did not sign this expiry, so nothing here was authorised by you and ` +
        `the chain would refuse it.`,
    )
  }
  if (auth.signers.length !== 1) {
    faults.push(
      `This expiry carries ${auth.signers.length} signatures and needs exactly 1, yours. Every ` +
        `extra signer is somebody else who has to co-operate for your rule to end.`,
    )
  }
  if (auth.nonceAccount === '' || auth.nonce === '') {
    faults.push(
      'This expiry is not anchored to a durable nonce, so it is anchored to a blockhash and expires ' +
        'in about 2 minutes. It would be refused long before the rule is due.',
    )
  }
  if (auth.nonceAccount === auth.swigAddress) {
    faults.push(
      'The nonce account is the Swig account. A nonce account is owned by the system program and ' +
        'holds nothing else, so this is not one.',
    )
  }
  if (auth.expiresAtSlot <= 0) {
    faults.push(
      `An expiry slot of ${auth.expiresAtSlot} is not a slot. Set when the rule should end.`,
    )
  }
  return faults
}

/**
 * Check the role this expiry removes is the agent role and nothing more.
 *
 * The same assertion that arms a role, on purpose. If the two ever disagreed we would be arming a
 * shape we would not later remove, or holding an authorisation that removes something else.
 */
export function faultsInRole(role: RoleActions, mint: string): string[] {
  try {
    assertAgentRoleShape(role, mint)
  } catch (error) {
    return [
      `The role this expiry would remove is not an Agon agent role: ${
        error instanceof Error ? error.message : String(error)
      }`,
    ]
  }
  return []
}

export type SubmitDecision = { submit: true } | { submit: false; reason: string }

/**
 * Should the daemon submit now?
 *
 * This is a policy and not an enforcement, and the difference matters enough to say plainly: a
 * nonce-anchored signed transaction is a bearer instrument. Anyone holding the bytes can land them
 * whenever they like, and nothing in the transaction says "not before slot N". Solana has no such
 * field. So what this function buys is that *our* daemon will not end a rule early, and what it
 * cannot buy is that nobody else will.
 *
 * The failure is in the safe direction, which is why the scheme is still worth it. Somebody who
 * steals the authorisation can only stop the agent trading. They cannot extend the rule, raise the
 * cap, move funds, or keep the rule alive against the user's wishes.
 */
export function shouldSubmit(
  auth: ExpiryAuthorisation,
  currentSlot: number,
  agentKey: string,
): SubmitDecision {
  const faults = faultsInAuthorisation(auth, agentKey)
  if (faults.length > 0) return { submit: false, reason: faults[0] as string }
  if (currentSlot < auth.expiresAtSlot) {
    return {
      submit: false,
      reason: `Slot ${currentSlot} is before the rule's end at ${auth.expiresAtSlot}, ${
        auth.expiresAtSlot - currentSlot
      } slots early.`,
    }
  }
  return { submit: true }
}

/**
 * The authorisation is spent once the nonce moves, whoever moved it.
 *
 * A user who revokes by hand first, with the kill switch, advances nothing, but the role is gone
 * and submitting the expiry then fails. That is not a failed expiry: the rule ended the way the
 * user asked. The daemon has to be able to tell those apart, so it asks this rather than reading a
 * submit error.
 */
export function isSpent(auth: ExpiryAuthorisation, nonceNow: string | null): boolean {
  return nonceNow === null || nonceNow !== auth.nonce
}

/** What the user is told at arm time, so the limits are visible before they sign, not after. */
export function expiryExplanation(auth: ExpiryAuthorisation): string {
  return [
    `You are signing one thing: the removal of role ${auth.roleId}, at slot ${auth.expiresAtSlot}.`,
    'Agon holds that signature and sends it when the rule is due. It gains no permission by holding',
    'it, and it cannot change what you signed.',
    'Two limits worth knowing. Anyone holding that signature could send it early, which would end',
    'your rule sooner than you asked but can do nothing else. And if Agon is not running when the',
    'rule is due, nothing sends it, so you can always end the rule yourself from your wallet.',
  ].join(' ')
}
