import { Keypair, type PublicKey } from '@solana/web3.js'
import { findSwigPda, type Swig } from '@swig-wallet/classic/dist/index.js'
import { describe, expect, test } from 'vitest'
import {
  fundVault,
  isOwnedBy,
  MAX_ATTEMPTS,
  pocketOf,
  resolveVault,
  swigIdFor,
  USDC_MINT,
  vaultAddress,
  WSOL_MINT,
} from './arm.js'

const id = new Uint8Array(32).fill(7)
const owner = Keypair.generate().publicKey

test('the vault is not the Swig account, which is the false pass F5 case (c) once recorded', () => {
  // The Swig account holds the roles and the vault holds the funds. A transfer built from the wrong
  // one was refused for a missing signature and counted as the cap holding. Deriving both from the
  // same id and asserting they differ is what stops that coming back.
  expect(vaultAddress(id).equals(findSwigPda(id))).toBe(false)
  expect(vaultAddress(id).equals(vaultAddress(new Uint8Array(32).fill(7)))).toBe(true)
})

test('funding is 1 transaction in which the vault signs nothing', async () => {
  const ixs = await fundVault({ owner, swigId: id, depositLamports: 1_000_000_000n })
  const vault = vaultAddress(id)

  // create Swig, 2 token accounts, the deposit, SyncNative
  expect(ixs).toHaveLength(5)
  for (const ix of ixs) {
    const vaultKey = ix.keys.find((k) => k.pubkey.equals(vault))
    expect(
      vaultKey?.isSigner ?? false,
      'the vault has no key and must never be asked to sign',
    ).toBe(false)
  }
  // The token accounts are the vault's own, for the 2 mints a swap moves between.
  const created = ixs.slice(1, 3).map((ix) => ix.keys[1]?.pubkey.toBase58())
  expect(created).toEqual([
    pocketOf(vault, WSOL_MINT).toBase58(),
    pocketOf(vault, USDC_MINT).toBase58(),
  ])
})

test('funding refuses what cannot work, naming the number', async () => {
  await expect(
    fundVault({ owner, swigId: new Uint8Array(31), depositLamports: 1n }),
  ).rejects.toThrow(/31/)
  await expect(fundVault({ owner, swigId: id, depositLamports: 0n })).rejects.toThrow(/0 lamports/)
})

describe('finding a wallet vault', () => {
  const wallet = Keypair.generate().publicKey
  const attacker = Keypair.generate().publicKey
  /** A stand-in Swig whose only root role is signed by `root`. Enough for the lookup to answer. */
  const swigRootedTo = (root: PublicKey) =>
    ({
      findRolesByEd25519SignerPk: (pk: string) =>
        pk === root.toBase58() ? [{ actions: { isRoot: () => true } }] : [],
    }) as unknown as Swig

  test('the id is derived from the wallet, so the vault can be found again from the wallet alone', async () => {
    expect(await swigIdFor(wallet, 0)).toEqual(await swigIdFor(wallet, 0))
    expect(await swigIdFor(wallet, 0)).not.toEqual(await swigIdFor(wallet, 1))
    expect(await swigIdFor(wallet, 0)).not.toEqual(await swigIdFor(attacker, 0))
  })

  test('a Swig squatted at the derived id is skipped, never returned as the wallet vault', async () => {
    // The attack a derived id invites: compute the victim's id, create a Swig there first with
    // yourself as root, and wait for the victim's lookup to report it as theirs.
    const squatAt = findSwigPda(await swigIdFor(wallet, 0)).toBase58()
    const read = async (at: PublicKey) =>
      at.toBase58() === squatAt ? swigRootedTo(attacker) : null

    const found = await resolveVault(read, wallet)
    expect(found.attempt).toBe(1)
    expect(found.existing).toBeNull()
    expect(found.squatted).toBe(1)
  })

  test('the wallet own Swig is found where it was made', async () => {
    const mine = swigRootedTo(wallet)
    const found = await resolveVault(async () => mine, wallet)
    expect(found.attempt).toBe(0)
    expect(found.existing).toBe(mine)
    expect(isOwnedBy(mine, attacker)).toBe(false)
  })

  test('every id squatted is a refusal naming the count, not a guess', async () => {
    await expect(resolveVault(async () => swigRootedTo(attacker), wallet)).rejects.toThrow(
      new RegExp(`All ${MAX_ATTEMPTS} vault ids`),
    )
  })
})
