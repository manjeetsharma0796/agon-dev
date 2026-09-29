import { ComputeBudgetProgram, PublicKey, TransactionInstruction } from '@solana/web3.js'
import { fetchSwig, type Swig } from '@swig-wallet/classic/dist/index.js'
import { describe, expect, test } from 'vitest'
import { JUPITER_PROGRAM_ID, SWIG_PROGRAM_ID } from './swig/index.js'
import { swapTransaction } from './swap.js'

// A real Swig account, recorded from the local mainnet fork on 2026-09-29: a root role and 1 agent
// role made by agentRoleActions (Jupiter only, 0.5 wSOL per 150 slots). Throwaway keys, public only.
const SWIG = new PublicKey('99X2HL9gTfV6naFZ1VAW3mBpZ8jmyk4FEhfYPkMJfGQ3')
const VAULT = new PublicKey('5wLUez6exk7owNcQbVDGoVn22NDkDro42HAvZyEZfQBN')
const AGENT = new PublicKey('DNDYmqxubRKmMtnq88AW4aUHreu88XrrGijAKpUojw1A')
const AGENT_ROLE = 1
const DATA =
  'Af+knbtAWg6ekP2/mfYnR5wqngGc6IFsb45VAhDt8IQ+GAIAAgAAAP8AAAAAAAAAAQAgAAEAAAAAAAAAOAAAAAj5WbdTCtCNhPZKI3W7QH0PDik38rme46E7+g4bP4DLBwAAAAgAAAABACAAAgAAAAEAAADYAAAAt7ugwkofPqITicWIuwZMpVcGV5fu4JRjF4adFZ6wjLEGAEAASAAAAAabiFf+q4GE+2h/Y0YYwDXaxDncGus7VZig8AAAAAABlgAAAAAAAAAAZc0dAAAAAABlzR0AAAAAAAAAAAAAAAADACAAcAAAAAR51VvyMcBu7nTFbs5oFQf9sbLeo/SOUQKxzaJWvBOP'

const recorded = (): Promise<Swig> =>
  fetchSwig(
    {
      getAccountInfo: async () => ({
        data: Buffer.from(DATA, 'base64'),
        owner: new PublicKey(SWIG_PROGRAM_ID),
        lamports: 2728320,
        executable: false,
        rentEpoch: 0,
      }),
    } as never,
    SWIG,
  )

/** The shape Jupiter's swapInstruction takes: the vault is the user and signs for its funds. */
const jupiterSwap = (programId = JUPITER_PROGRAM_ID) =>
  new TransactionInstruction({
    programId: new PublicKey(programId),
    data: Buffer.from([229, 23, 203, 151, 122, 227, 173, 42]),
    keys: [
      { pubkey: VAULT, isSigner: true, isWritable: false },
      { pubkey: PublicKey.unique(), isSigner: false, isWritable: true },
    ],
  })

const BLOCKHASH = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N'

describe('the swap transaction the agent signs', () => {
  test('is a compute limit and Swig signing for Jupiter alone, nothing else', async () => {
    const tx = await swapTransaction({
      swig: await recorded(),
      roleId: AGENT_ROLE,
      agent: AGENT,
      swap: jupiterSwap(),
      recentBlockhash: BLOCKHASH,
    })
    const programs = tx.instructions.map((ix) => ix.programId.toBase58())
    expect(programs[0]).toBe(ComputeBudgetProgram.programId.toBase58())
    expect(programs.slice(1).every((p) => p === SWIG_PROGRAM_ID)).toBe(true)
    expect(programs.length).toBeGreaterThan(1)
  })

  test('has the agent as fee payer and only signer, so the vault never signs', async () => {
    const tx = await swapTransaction({
      swig: await recorded(),
      roleId: AGENT_ROLE,
      agent: AGENT,
      swap: jupiterSwap(),
      recentBlockhash: BLOCKHASH,
    })
    const message = tx.compileMessage()
    expect(message.header.numRequiredSignatures).toBe(1)
    expect(message.accountKeys[0]?.toBase58()).toBe(AGENT.toBase58())
    expect(tx.feePayer?.toBase58()).toBe(AGENT.toBase58())
  })

  test('refuses to wrap any program but the pinned Jupiter id, before building', async () => {
    const splProgram = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
    await expect(
      swapTransaction({
        swig: await recorded(),
        roleId: AGENT_ROLE,
        agent: AGENT,
        swap: jupiterSwap(splProgram),
        recentBlockhash: BLOCKHASH,
      }),
    ).rejects.toThrow(splProgram)
  })
})
