import { Keypair } from '@solana/web3.js'
import { findSwigPda } from '@swig-wallet/classic/dist/index.js'
import { expect, test } from 'vitest'
import { fundVault, pocketOf, USDC_MINT, vaultAddress, WSOL_MINT } from './arm.js'

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
