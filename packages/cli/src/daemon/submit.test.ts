import {
  Connection,
  Keypair,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import { expect, test } from 'vitest'
import { submitOnce } from './submit.js'

// Against a real fork only, and only when one is named, like the vault screen's flow test. CI has no
// chain. Locally: docker compose up, then AGON_FORK_RPC_URL=http://127.0.0.1:8899 pnpm test.
const RPC = process.env['AGON_FORK_RPC_URL']
const isLocal = RPC !== undefined && /^http:\/\/(127\.0\.0\.1|localhost):/.test(RPC)
const AMOUNT = 1_234_567

async function transfer(c: Connection) {
  const from = Keypair.generate()
  const to = Keypair.generate()
  await c.confirmTransaction(await c.requestAirdrop(from.publicKey, 1e9), 'confirmed')
  const { blockhash, lastValidBlockHeight } = await c.getLatestBlockhash('confirmed')
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: from.publicKey,
      recentBlockhash: blockhash,
      instructions: [
        SystemProgram.transfer({
          fromPubkey: from.publicKey,
          toPubkey: to.publicKey,
          lamports: AMOUNT,
        }),
      ],
    }).compileToV0Message(),
  )
  tx.sign([from])
  return { tx, to, lastValidBlockHeight }
}

test.skipIf(!isLocal)(
  'a transaction the network swallows is reported dropped once its blockhash expires, and nothing moves',
  async () => {
    const c = new Connection(RPC as string, 'confirmed')
    const { tx, to, lastValidBlockHeight } = await transfer(c)
    // Every send goes nowhere, as if the RPC accepted it and never forwarded it.
    const blackHole = {
      sendRawTransaction: async () => 'swallowed',
      getSignatureStatuses: c.getSignatureStatuses.bind(c),
      getBlockHeight: c.getBlockHeight.bind(c),
    } as unknown as Connection
    const out = await submitOnce(blackHole, tx, lastValidBlockHeight)
    expect(out.status).toBe('dropped')
    expect(out.sends).toBeGreaterThan(1)
    expect(await c.getBalance(to.publicKey)).toBe(0)
  },
  240_000,
)

test.skipIf(!isLocal)(
  'a transaction whose answer was lost is resent as the same bytes and lands exactly once',
  async () => {
    const c = new Connection(RPC as string, 'confirmed')
    const { tx, to, lastValidBlockHeight } = await transfer(c)
    // The send goes through, but the first round of status reads comes back empty, as if the
    // answer was lost. That forces a resend, which is the moment a double send would happen.
    let hidden = 5
    const lossy = {
      sendRawTransaction: c.sendRawTransaction.bind(c),
      getSignatureStatuses: async (sigs: string[], o?: object) =>
        hidden-- > 0 ? { context: { slot: 0 }, value: [null] } : c.getSignatureStatuses(sigs, o),
      getBlockHeight: c.getBlockHeight.bind(c),
    } as unknown as Connection
    const out = await submitOnce(lossy, tx, lastValidBlockHeight)
    expect(out.status).toBe('landed')
    expect(out.sends).toBeGreaterThan(1)
    expect(await c.getBalance(to.publicKey), 'the receiver was paid more than once').toBe(AMOUNT)
  },
  120_000,
)
