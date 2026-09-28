// The arming transactions, built once. Owned by T-D07.
//
// Two transactions a wallet signs, measured end to end on a mainnet fork with a real Phantom on
// 2026-09-26: the first creates the vault and funds it, the second lets the agent trade. That is
// also the split a user understands, and revoke only undoes the second.
//
// Pure: instructions in, instructions out, 0 network calls. The caller fetches a blockhash and the
// wallet signs. So the same code serves the web app, the CLI and the fork tests, and a transaction
// that is wrong here is wrong in a test first rather than in a browser.

import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js'
import {
  Actions,
  createEd25519AuthorityInfo,
  findSwigPda,
  getAddAuthorityInstructions,
  getCreateSwigInstruction,
  SWIG_PROGRAM_ADDRESS,
  type Swig,
} from '@swig-wallet/classic/dist/index.js'
import { agentRoleActions, assertAgentRoleShape, type ApprovedCap } from './swig/index.js'

const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
export const WSOL_MINT = 'So11111111111111111111111111111111111111112'
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

/**
 * Where the vault's funds live, derived from the Swig id before the Swig exists.
 *
 * This is what lets creation and funding share one transaction: the token accounts need the
 * vault's address, and it is a PDA of the Swig address under the Swig program with the seed
 * "swig-wallet-address", which is how the SDK's own `getSwigWalletAddress` derives it for every
 * Swig that is not a v1 account. A new Swig is never v1. The Swig ACCOUNT holds the roles and is a
 * different address: sending funds there was the false pass in F5 case (c).
 */
export function vaultAddress(swigId: Uint8Array): PublicKey {
  const swig = findSwigPda(swigId)
  return PublicKey.findProgramAddressSync(
    [Buffer.from('swig-wallet-address'), swig.toBuffer()],
    SWIG_PROGRAM_ADDRESS,
  )[0]
}

/** The vault's token account for one mint. A PDA owner is fine: the derivation needs no key. */
export function pocketOf(owner: PublicKey, mint: string): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), new PublicKey(mint).toBuffer()],
    ATA_PROGRAM,
  )[0]
}

/**
 * Associated-token `CreateIdempotent`, instruction 1. Only the PAYER signs; the owner is a
 * read-only account. That is the whole reason a vault with no key can be given token accounts at
 * all, and why the agent's role never has to touch the token programs.
 */
function createPocket(payer: PublicKey, owner: PublicKey, mint: string): TransactionInstruction {
  return new TransactionInstruction({
    programId: ATA_PROGRAM,
    data: Buffer.from([1]),
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: pocketOf(owner, mint), isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: new PublicKey(mint), isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
    ],
  })
}

/** Token `SyncNative`, instruction 17: count the lamports sitting in a wSOL account as wSOL. */
function syncNative(pocket: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM,
    data: Buffer.from([17]),
    keys: [{ pubkey: pocket, isSigner: false, isWritable: true }],
  })
}

export interface FundVault {
  /** The user's wallet. It becomes root, and it pays. */
  owner: PublicKey
  /** 32 random bytes. The caller keeps it: the Swig and the vault are both derived from it. */
  swigId: Uint8Array
  /** Lamports to move into the vault as wSOL. What the agent can ever trade is at most this. */
  depositLamports: bigint
}

/**
 * Transaction 1: create the Swig with the owner as root, give the vault its wSOL and USDC
 * accounts, and move the deposit in as wSOL. The vault signs nothing.
 */
export async function fundVault(spec: FundVault): Promise<TransactionInstruction[]> {
  if (spec.swigId.length !== 32) {
    throw new Error(
      `A Swig id is 32 bytes and this one is ${spec.swigId.length}. Generate 32 random bytes.`,
    )
  }
  if (spec.depositLamports <= 0n) {
    throw new Error(
      `A deposit of ${spec.depositLamports} lamports gives the agent nothing to trade. Deposit a positive amount.`,
    )
  }
  const vault = vaultAddress(spec.swigId)
  const wsol = pocketOf(vault, WSOL_MINT)
  return [
    await getCreateSwigInstruction({
      payer: spec.owner,
      id: spec.swigId,
      actions: Actions.set().all().get(),
      authorityInfo: createEd25519AuthorityInfo(spec.owner),
    }),
    createPocket(spec.owner, vault, WSOL_MINT),
    createPocket(spec.owner, vault, USDC_MINT),
    SystemProgram.transfer({
      fromPubkey: spec.owner,
      toPubkey: wsol,
      lamports: spec.depositLamports,
    }),
    syncNative(wsol),
  ]
}

export interface HireAgent {
  /** The Swig as read back after transaction 1 landed. */
  swig: Swig
  /** The agent's PUBLIC key. Its private key never reaches this code, or any code we host. */
  agent: PublicKey
  /** The mint the agent may spend. */
  mint: string
  /**
   * The numbers the USER confirmed on the screen, never numbers derived from a spec. Comparing a
   * role against the spec it was built from is a tautology that always passes and looks like
   * verification, which is what `assertAgentRoleShape`'s own note warns about.
   */
  approved: ApprovedCap
}

/**
 * Transaction 2: add the agent's role. Jupiter only, and at most `approved.amount` of `mint` per
 * `approved.window` slots.
 *
 * The SHAPE is checked here, before anything is signed: no root, no `manageAuthority`, Jupiter and
 * nothing wider. The AMOUNT is not, and cannot be: these actions are built from `approved`, so
 * comparing them against `approved` always passes. The amount is checked after the transaction
 * lands, against the role as the chain holds it, with `verifyRoleOnChain`. That is the check that
 * catches a cap our code sent higher than the user typed.
 */
export async function hireAgent(spec: HireAgent): Promise<TransactionInstruction[]> {
  const actions = agentRoleActions({
    mint: spec.mint,
    recurringAmount: spec.approved.amount,
    window: spec.approved.window,
  })
  assertAgentRoleShape(actions, spec.mint, spec.approved)
  const root = spec.swig.roles[0]
  if (!root) {
    throw new Error(
      'This Swig has no roles, so there is no root to add the agent from. Read it again after it lands.',
    )
  }
  // `agentRoleActions` declares the narrow `RoleActions` it is read through, but the object it
  // returns is the SDK's own `Actions`, built by `Actions.set()...get()`. So this is the same value
  // with its full type, not a conversion. Widening the declared return type instead would touch
  // swig/index.ts, which T-C17 owns.
  return getAddAuthorityInstructions(
    spec.swig,
    root.id,
    createEd25519AuthorityInfo(spec.agent),
    actions as unknown as Actions,
  )
}
