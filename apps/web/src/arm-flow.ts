// The vault screen's behaviour, without the screen. Owned by T-E06.
//
// Every step a user takes on /arm is a function here that takes a Connection and a `sign`
// callback. In the browser `sign` is the wallet; in the fork test it is a keypair standing in for
// one. So the flow that is measured on the fork is the flow the page runs, and the page itself is
// only the wallet plumbing and the markup.

import {
  fetchSwig,
  findSwigPda,
  fundVault,
  hireAgent,
  pocketOf,
  resolveVault,
  revokeAgents,
  USDC_MINT,
  vaultAddress,
  WSOL_MINT,
  type SwigReader,
} from '@agon/chain'
import {
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type Connection,
  type TransactionInstruction,
} from '@solana/web3.js'

/** Hands a transaction to the wallet and gets it back signed. The wallet decides; we never sign. */
export type Sign = (tx: VersionedTransaction) => Promise<VersionedTransaction>

/**
 * Read a Swig, telling "there is no account here" apart from "the read failed".
 *
 * The difference is load-bearing. `resolveVault` treats null as "this id is free, arm here", so a
 * transient RPC error read as null would propose creating a vault on top of one that exists. That
 * fails on chain rather than losing funds, but it would show the user a form instead of their vault.
 */
const swigReader =
  (connection: Connection): SwigReader =>
  async (address) => {
    const info = await connection.getAccountInfo(address)
    return info === null ? null : fetchSwig(connection, address)
  }

/** Build, sign through the wallet, send and wait. The owner pays and is the only signer. */
async function send(
  connection: Connection,
  owner: PublicKey,
  instructions: TransactionInstruction[],
  sign: Sign,
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()
  const message = new TransactionMessage({
    payerKey: owner,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message()
  const signed = await sign(new VersionedTransaction(message))
  const signature = await connection.sendRawTransaction(signed.serialize())
  const result = await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    'confirmed',
  )
  if (result.value.err !== null) {
    throw new Error(
      `Transaction ${signature} landed and failed: ${JSON.stringify(result.value.err)}.`,
    )
  }
  return signature
}

/** One agent role as the screen shows it. Amounts in base units. */
interface AgentView {
  roleId: number
  mint: string
  /** The configured cap per window. This is the number the user typed. */
  cap: bigint
  /** Window length in slots. */
  window: bigint
  /**
   * The allowance field as the chain stores it. It is only rewritten when a spend lands, so after a
   * window passes it reads stale. The screen labels it that way until T-C17's `effectiveRemaining`
   * replaces it.
   */
  storedRemaining: bigint | null
  /** The most the agent can spend in a short burst across a window edge. */
  rollingWorstCase: bigint
}

export type VaultView =
  | {
      kind: 'none'
      /** Earlier derived ids that held a Swig this wallet is not root on. Said out loud if > 0. */
      squatted: number
    }
  | {
      kind: 'vault'
      vault: string
      /** Token balances in base units, read here because Phantom's own screens cannot on a fork. */
      wsol: bigint
      usdc: bigint
      agents: AgentView[]
      squatted: number
    }

const balance = async (connection: Connection, account: PublicKey): Promise<bigint> => {
  const info = await connection.getTokenAccountBalance(account).catch(() => null)
  return info === null ? 0n : BigInt(info.value.amount)
}

/** Everything the screen shows about a wallet's vault. Reads only. */
export async function loadVault(connection: Connection, owner: PublicKey): Promise<VaultView> {
  const found = await resolveVault(swigReader(connection), owner)
  if (found.existing === null) return { kind: 'none', squatted: found.squatted }

  const vault = vaultAddress(found.swigId)
  const agents: AgentView[] = []
  for (const role of found.existing.roles) {
    if (role.actions.isRoot()) continue
    for (const mint of [WSOL_MINT, USDC_MINT]) {
      if (!role.actions.canSpendToken(mint)) continue
      const spend = role.actions.tokenSpend(mint)
      const cap = spend.recurringLimit ?? 0n
      agents.push({
        roleId: role.id,
        mint,
        cap,
        window: spend.window ?? 0n,
        storedRemaining: spend.spendLimit,
        rollingWorstCase: 2n * cap,
      })
    }
  }
  return {
    kind: 'vault',
    vault: vault.toBase58(),
    wsol: await balance(connection, pocketOf(vault, WSOL_MINT)),
    usdc: await balance(connection, pocketOf(vault, USDC_MINT)),
    agents,
    squatted: found.squatted,
  }
}

interface ArmRequest {
  owner: PublicKey
  /** The agent's public key. Its secret stays wherever the agent runs; this code never sees it. */
  agent: PublicKey
  depositLamports: bigint
  /** Exactly what the user typed, per window, in base units of wSOL. */
  cap: bigint
  window: bigint
}

/**
 * Create the vault, fund it, and let the agent trade: 2 wallet approvals.
 *
 * Refuses when the wallet already has a vault, rather than creating a second one: the lookup finds
 * 1 vault per wallet, so a second would be invisible to every screen and to the MCP server.
 */
export async function arm(
  connection: Connection,
  request: ArmRequest,
  sign: Sign,
): Promise<{ fundSignature: string; hireSignature: string }> {
  const found = await resolveVault(swigReader(connection), request.owner)
  if (found.existing !== null) {
    throw new Error(
      'This wallet already has a vault. Revoke its agent and reuse it, rather than creating a second one no screen would find.',
    )
  }
  const fundSignature = await send(
    connection,
    request.owner,
    await fundVault({
      owner: request.owner,
      swigId: found.swigId,
      depositLamports: request.depositLamports,
    }),
    sign,
  )
  const created = await swigReader(connection)(findSwigPda(found.swigId))
  if (created === null) {
    throw new Error(
      `The vault was funded in ${fundSignature} but cannot be read back yet. Reload and try adding the agent again.`,
    )
  }
  const hireSignature = await send(
    connection,
    request.owner,
    await hireAgent({
      swig: created,
      owner: request.owner,
      agent: request.agent,
      mint: WSOL_MINT,
      approved: { amount: request.cap, window: request.window },
    }),
    sign,
  )
  return { fundSignature, hireSignature }
}

/** Add an agent to a vault that already exists, for instance after revoking the last one. */
export async function hire(
  connection: Connection,
  request: Omit<ArmRequest, 'depositLamports'>,
  sign: Sign,
): Promise<string> {
  const found = await resolveVault(swigReader(connection), request.owner)
  if (found.existing === null) throw new Error('This wallet has no vault yet. Create one first.')
  return send(
    connection,
    request.owner,
    await hireAgent({
      swig: found.existing,
      owner: request.owner,
      agent: request.agent,
      mint: WSOL_MINT,
      approved: { amount: request.cap, window: request.window },
    }),
    sign,
  )
}

/** Remove every agent Agon armed on this wallet's vault. 1 wallet approval, 0 help from us. */
export async function revoke(
  connection: Connection,
  owner: PublicKey,
  sign: Sign,
): Promise<{
  signature: string | null
  removed: number[]
  kept: { id: number; reason: string }[]
}> {
  const found = await resolveVault(swigReader(connection), owner)
  if (found.existing === null) return { signature: null, removed: [], kept: [] }
  const { instructions, plan } = await revokeAgents({ swig: found.existing, owner })
  if (instructions.length === 0) return { signature: null, removed: [], kept: plan.kept }
  const signature = await send(connection, owner, instructions, sign)
  return { signature, removed: plan.revoke, kept: plan.kept }
}
