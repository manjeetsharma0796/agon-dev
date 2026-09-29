// The daemon's one signing rule: it signs a transaction only when check_trade passed that exact
// transaction in the last 30 seconds.
//
// "That exact transaction" is the hash of its message, which is every byte that gets signed:
// amount, route, accounts and blockhash. So a different amount, a re-routed swap or a rebuilt
// transaction is a different hash and needs its own check. Nothing here can widen what was
// approved, because the only input that produces an approval is a `pass` for those bytes.

import { createHash } from 'node:crypto'
import type { Keypair, VersionedMessage, VersionedTransaction } from '@solana/web3.js'

/** How long a pass stays good for. Past it the price the check read may no longer be the price. */
export const APPROVAL_TTL_MS = 30_000

interface Approval {
  /** sha256 of the serialized message, hex. */
  messageHash: string
  /** When check_trade answered, in ms since the epoch. */
  at: number
}

const hashOf = (message: VersionedMessage): string =>
  createHash('sha256').update(message.serialize()).digest('hex')

/** Record a check_trade answer for these bytes. Only a `pass` is an approval. */
export function approve(
  message: VersionedMessage,
  verdict: 'pass' | 'block' | 'unsure',
  now: number,
): Approval | null {
  return verdict === 'pass' ? { messageHash: hashOf(message), at: now } : null
}

/**
 * Sign with the agent key, or refuse and say why. Fails closed: no matching approval, or only a
 * stale one, is a refusal naming the count and the age, never a signature.
 */
export function signApproved(
  tx: VersionedTransaction,
  agent: Keypair,
  approvals: readonly Approval[],
  now: number,
): VersionedTransaction {
  const hash = hashOf(tx.message)
  const matching = approvals.filter((a) => a.messageHash === hash)
  if (matching.length === 0) {
    throw new Error(
      `0 of ${approvals.length} approvals match this transaction, so it was not signed. ` +
        `A different amount, route or blockhash is a different transaction: run check_trade on it.`,
    )
  }
  const age = now - Math.max(...matching.map((a) => a.at))
  if (age > APPROVAL_TTL_MS) {
    throw new Error(
      `The check that passed this transaction is ${age} ms old, past the ${APPROVAL_TTL_MS} ms an ` +
        `approval lasts, so it was not signed. Run check_trade again.`,
    )
  }
  tx.sign([agent])
  return tx
}
