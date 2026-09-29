// The 1 transaction an agent signs to trade. Owned by T-C21.
//
// Pure: a Swig account and Jupiter's swap instruction in, an unsigned legacy transaction out, 0
// network calls. The shape was measured on the mainnet fork on 2026-09-26: Jupiter's
// `swapInstruction` alone (no setup, no cleanup, `wrapAndUnwrapSol` false), wrapped by Swig's sign
// instruction for the agent's role, with the agent paying. The vault signs nothing itself: Swig
// signs for it, and only inside what the role allows.

import {
  ComputeBudgetProgram,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js'
import { getSignInstructions, type Swig } from '@swig-wallet/classic/dist/index.js'
import { JUPITER_PROGRAM_ID } from './swig/index.js'

// ponytail: the most a transaction may use, measured swaps used about 100k to 300k. With no
// priority fee set the limit costs nothing, so there is no second simulation to tighten it.
const COMPUTE_UNITS = 1_400_000

export interface SwapTransactionInput {
  swig: Swig
  /** The agent's role in `swig`. */
  roleId: number
  /** The fee payer and the only signer. A public key: this module never sees a private one. */
  agent: PublicKey
  /** Jupiter's `swapInstruction`, with the vault as its user. */
  swap: TransactionInstruction
  recentBlockhash: string
}

export async function swapTransaction(a: SwapTransactionInput): Promise<Transaction> {
  // The role only lets Jupiter through, so anything else would fail on chain anyway. Refusing here
  // means a wrong instruction is never handed to an agent to sign.
  if (a.swap.programId.toBase58() !== JUPITER_PROGRAM_ID) {
    throw new Error(
      `The swap instruction calls ${a.swap.programId.toBase58()}, not Jupiter ` +
        `(${JUPITER_PROGRAM_ID}), so no transaction was built.`,
    )
  }
  const signed = await getSignInstructions(a.swig, a.roleId, [a.swap])
  const tx = new Transaction({ feePayer: a.agent, recentBlockhash: a.recentBlockhash }).add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNITS }),
    ...signed,
  )
  const signers = tx.compileMessage().header.numRequiredSignatures
  if (signers !== 1) {
    throw new Error(`The swap transaction needs ${signers} signers, not 1, so it was not built.`)
  }
  return tx
}
