import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import { expect, test } from 'vitest'
import { APPROVAL_TTL_MS, approve, signApproved } from './sign.js'

const agent = Keypair.generate()
const to = new PublicKey('11111111111111111111111111111112')
const tx = (lamports: number): VersionedTransaction =>
  new VersionedTransaction(
    new TransactionMessage({
      payerKey: agent.publicKey,
      recentBlockhash: '11111111111111111111111111111111',
      instructions: [
        SystemProgram.transfer({ fromPubkey: agent.publicKey, toPubkey: to, lamports }),
      ],
    }).compileToV0Message(),
  )

const NOW = 1_000_000

test('a transaction that check_trade passed within 30 seconds is signed', () => {
  const t = tx(1000)
  const approvals = [approve(t.message, 'pass', NOW)].filter((a) => a !== null)
  const signed = signApproved(t, agent, approvals, NOW + APPROVAL_TTL_MS)
  expect(signed.signatures[0]?.some((b) => b !== 0)).toBe(true)
})

test('a different amount needs a new check, even 1 lamport', () => {
  const approvals = [approve(tx(1000).message, 'pass', NOW)].filter((a) => a !== null)
  expect(() => signApproved(tx(1001), agent, approvals, NOW)).toThrow(/0 of 1 approvals match/)
})

test('an approval older than 30 seconds signs nothing', () => {
  const t = tx(1000)
  const approvals = [approve(t.message, 'pass', NOW)].filter((a) => a !== null)
  expect(() => signApproved(t, agent, approvals, NOW + APPROVAL_TTL_MS + 1)).toThrow(/30001 ms old/)
})

test('only a pass is an approval: block and unsure sign nothing', () => {
  const t = tx(1000)
  expect(approve(t.message, 'block', NOW)).toBeNull()
  expect(approve(t.message, 'unsure', NOW)).toBeNull()
  expect(() => signApproved(t, agent, [], NOW)).toThrow(/0 of 0 approvals match/)
})

// From the /security-review of this slice: a durable-nonce transaction does not expire with a
// blockhash, so "dropped, nothing moved" would be a false promise for it and a re-check could land
// the trade twice. The agent never needs one, so it signs none.
test('a durable-nonce transaction is never signed, even with a matching approval', () => {
  const nonce = Keypair.generate().publicKey
  const t = new VersionedTransaction(
    new TransactionMessage({
      payerKey: agent.publicKey,
      recentBlockhash: '11111111111111111111111111111111',
      instructions: [
        SystemProgram.nonceAdvance({ noncePubkey: nonce, authorizedPubkey: agent.publicKey }),
        SystemProgram.transfer({ fromPubkey: agent.publicKey, toPubkey: to, lamports: 1000 }),
      ],
    }).compileToV0Message(),
  )
  const approvals = [approve(t.message, 'pass', NOW)].filter((a) => a !== null)
  expect(() => signApproved(t, agent, approvals, NOW)).toThrow(/durable nonce/)
})
