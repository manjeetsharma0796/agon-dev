import { Connection, Keypair, type VersionedTransaction } from '@solana/web3.js'
import { expect, test } from 'vitest'
import { arm, hire, loadVault, revoke, type Sign } from './arm-flow.js'

// Against a real fork only, and only when one is named. CI has no chain, and a flow test that
// fakes the chain would measure the fake. Locally: docker compose up, then
// AGON_FORK_RPC_URL=http://127.0.0.1:8899 pnpm test.
const RPC = process.env['AGON_FORK_RPC_URL']
const isLocal = RPC !== undefined && /^http:\/\/(127\.0\.0\.1|localhost):/.test(RPC)

/** A keypair standing in for the wallet. The page passes the real wallet's signTransaction. */
const walletFor =
  (kp: Keypair): Sign =>
  async (tx: VersionedTransaction) => {
    tx.sign([kp])
    return tx
  }

test.skipIf(!isLocal)(
  'arm, read, revoke and re-hire on the fork, in the order the screen runs them',
  async () => {
    const c = new Connection(RPC as string, 'confirmed')
    const owner = Keypair.generate()
    await c.confirmTransaction(await c.requestAirdrop(owner.publicKey, 3e9), 'confirmed')
    const sign = walletFor(owner)

    // What the user typed: 1 SOL in, 0.5 per 150 slots, for this agent.
    const typed = { cap: 500_000_000n, window: 150n }
    const agent = Keypair.generate().publicKey

    expect((await loadVault(c, owner.publicKey)).kind).toBe('none')
    await arm(c, { owner: owner.publicKey, agent, depositLamports: 1_000_000_000n, ...typed }, sign)

    const armed = await loadVault(c, owner.publicKey)
    if (armed.kind !== 'vault') throw new Error('no vault after arming')
    expect(armed.wsol).toBe(1_000_000_000n)
    expect(armed.agents).toHaveLength(1)
    // The cap as the CHAIN holds it equals the number typed. Read back, not compared with the spec
    // it was built from, which would always pass.
    expect(armed.agents[0]?.cap, 'the cap on chain is not the cap the user typed').toBe(typed.cap)
    expect(armed.agents[0]?.window).toBe(typed.window)
    expect(armed.agents[0]?.rollingWorstCase).toBe(2n * typed.cap)

    // A second arm on the same wallet is refused, not turned into a vault no screen would find.
    await expect(
      arm(c, { owner: owner.publicKey, agent, depositLamports: 1n, ...typed }, sign),
    ).rejects.toThrow(/already has a vault/)

    const revoked = await revoke(c, owner.publicKey, sign)
    expect(revoked.removed).toHaveLength(1)
    const after = await loadVault(c, owner.publicKey)
    if (after.kind !== 'vault') throw new Error('the vault went missing on revoke')
    expect(after.agents, 'revoke left an agent role behind').toHaveLength(0)
    expect(after.wsol, 'revoke must not move funds').toBe(1_000_000_000n)

    await hire(c, { owner: owner.publicKey, agent, ...typed }, sign)
    const rehired = await loadVault(c, owner.publicKey)
    expect(rehired.kind === 'vault' && rehired.agents.length).toBe(1)
  },
  120_000,
)
