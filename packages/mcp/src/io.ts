// The reads the tools need, and the only part of this package that touches the network.
//
// Everything below goes through the record and replay wrapper, so the same server answers from a
// committed recording with 0 keys set. That is what makes a demo reproducible: the agent talking to
// this server gets the same numbers whether or not anyone's key is live.

import {
  agentRulesOf,
  resolveVault,
  swapTransaction,
  vaultAddress,
  USDC_MINT,
  WSOL_MINT,
  type ChainAgentRule,
  type ChainRole,
} from '@agon/chain'
import {
  call,
  chainMismatch as chainMismatchRow,
  heliusTransactions,
  historyProviderShape,
  historyProviderStatus,
  historyUnavailable,
  jupiterQuote,
  jupiterSwapInstructions,
  mintCheckEmpty,
  network,
  noChainConfigured,
  noVault,
  quoteUnavailable,
  Refusal,
} from '@agon/core'
import { Connection, PublicKey, TransactionInstruction } from '@solana/web3.js'
import { fetchNullableSwig } from '@swig-wallet/classic/dist/index.js'
import { fromEnhanced, type EnhancedTransaction, type RawTransaction } from '@agon/decoder'
import { categoriesOf, checkMints, type MintCheck, type TokenCategory } from '@agon/guard'

/** Helius returns newest first and one page is 100, which is enough to mine a habit from. */
const PAGE = 100

export interface ToolIo {
  loadTransactions(wallet: string): Promise<RawTransaction[]>
  loadMintCheck(mint: string): Promise<MintCheck>
  /**
   * True once any read behind this call came out of a recording rather than the network.
   *
   * It exists because an outside agent tested the deployed server, saw `check_trade` name USDC's
   * real freeze and mint authorities, checked that those facts are true of mainnet, and concluded
   * the tool was reading chain state. It was not: the deployment runs in replay and the facts were
   * recorded. The inference was reasonable and the payload gave it nothing to correct itself with.
   *
   * `NetResult` has carried `fromFixture` since the record wrapper was written and nothing outside
   * the tests ever read it. This is the first consumer.
   */
  usedFixture(): boolean
  /**
   * The wallet's vault and the agent rules on it, read from the chain `AGON_RPC_URL` names. `vault`
   * is null when the wallet has none yet. Throws when no chain is configured or the chain is not the
   * network this deployment names, rather than answering with an empty list.
   */
  loadVaultRules(wallet: string): Promise<VaultRules>
  /** The token category of each mint, for the wallet's category mix. A mint it cannot place is left out. */
  loadCategories(mints: string[], slot?: number): Promise<ReadonlyMap<string, TokenCategory>>
  /** Jupiter's quote for spending `amount` base units of `inputMint`, for 1 legacy transaction. */
  loadQuote(q: QuoteAsk): Promise<JupiterQuote>
  /**
   * The quote as 1 unsigned transaction from the owner's vault, signed only by the agent, and what
   * simulating it on the configured chain said. Throws on no chain, a mismatched chain or no vault.
   */
  buildSwap(b: {
    owner: string
    agent: string
    roleId: number
    quote: JupiterQuote
  }): Promise<BuiltSwap>
}

interface QuoteAsk {
  inputMint: string
  outputMint: string
  amount: string
  slippageBps: number
}

/** The fields of Jupiter's quote this server reads. The rest rides along to /swap-instructions. */
export interface JupiterQuote {
  inAmount: string
  outAmount: string
  otherAmountThreshold: string
  slippageBps: number
  priceImpactPct: string
  contextSlot?: number
  routePlan: { swapInfo: { label?: string } }[]
}

export interface BuiltSwap {
  vault: string
  /** Base64, unsigned. */
  transaction: string
  lastValidBlockHeight: number
  unitsConsumed: number
  /** Null when the simulation succeeded. */
  failure: { logs: string[] } | null
}

export interface VaultRules {
  vault: string | null
  rules: ChainAgentRule[]
}

interface JupiterInstruction {
  programId: string
  data: string
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[]
}

/** The mints Agon arms, so these are the ones a vault is read for. */
const ARMED_MINTS = [WSOL_MINT, USDC_MINT] as const

/**
 * Whether an RPC endpoint is the network this deployment names. A Surfpool fork says so in
 * `getVersion` (`surfnet-version`) and mainnet does not, so the check holds for a hosted fork at
 * any hostname, which a check on the URL could not. Returns the reason it does not match, or null.
 */
export function chainMismatch(networkId: string, version: Record<string, unknown>): string | null {
  const isFork = typeof version['surfnet-version'] === 'string'
  if (networkId === 'unset') return 'this deployment names no network, so no chain is read'
  if (networkId === 'fork' && !isFork)
    return 'this deployment says fork, but the chain is not a fork'
  if (networkId !== 'fork' && isFork)
    return `this deployment says ${networkId}, but the chain is a fork`
  return null
}

/** The configured chain, checked to be the network this deployment names before anything is read. */
async function chainFor(wallet: string): Promise<Connection> {
  const url = process.env['AGON_RPC_URL']
  if (!url) {
    throw new Refusal(noChainConfigured({ wallet }))
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getVersion' }),
  })
  const version = ((await res.json()) as { result?: Record<string, unknown> }).result ?? {}
  const mismatch = chainMismatch(network(process.env['AGON_NETWORK']).id, version)
  if (mismatch) {
    throw new Refusal(chainMismatchRow({ wallet, mismatch }))
  }
  return new Connection(url, 'confirmed')
}

export const liveIo = (): ToolIo => {
  // Per instance, and `callAsTool` builds one per call, so two concurrent requests cannot see each
  // other's flag. A single flag shared across a server's lifetime would mark every later answer
  // the moment one early read hit a recording.
  let fromFixture = false
  const recorded: typeof call = async (req, opts) => {
    const res = await call(req, opts)
    if (res.fromFixture) fromFixture = true
    return res
  }

  return {
    usedFixture: () => fromFixture,

    async loadVaultRules(wallet: string): Promise<VaultRules> {
      const connection = await chainFor(wallet)
      const owner = new PublicKey(wallet)
      const resolved = await resolveVault(
        (address) => fetchNullableSwig(connection, address),
        owner,
      )
      if (resolved.existing === null) return { vault: null, rules: [] }
      const slot = BigInt(await connection.getSlot())
      return {
        vault: vaultAddress(resolved.swigId).toBase58(),
        rules: agentRulesOf(resolved.existing.roles as unknown as ChainRole[], ARMED_MINTS, slot),
      }
    },

    async loadTransactions(wallet: string): Promise<RawTransaction[]> {
      let res
      try {
        res = await call(heliusTransactions(wallet, PAGE))
      } catch (error) {
        // The wrapper's own message is written for whoever is adding a fixture: it names the file
        // path it wanted and the env var that records it. That is the right message in a terminal
        // and the wrong one on a public endpoint, where it hands a stranger internal paths and
        // configuration names and tells a caller nothing it can act on. An outside agent hit this
        // and reported it as a path leak, correctly. The cause is stated without the internals.
        const replay = /replay mode|No recorded response/i.test(
          error instanceof Error ? error.message : String(error),
        )
        throw new Refusal(historyUnavailable({ wallet, recorded: replay }))
      }
      if (res.fromFixture) fromFixture = true
      if (res.status !== 200) {
        throw new Refusal(historyProviderStatus({ wallet, status: res.status }))
      }
      // Anything other than an array is a response shape change, and guessing at it is how a
      // decoder silently reports 0 swaps for a wallet that has hundreds.
      if (!Array.isArray(res.body)) {
        throw new Refusal(historyProviderShape({ wallet, got: typeof res.body }))
      }
      return (res.body as EnhancedTransaction[]).map(fromEnhanced)
    },

    loadCategories: (mints, slot) => categoriesOf(mints, { net: recorded }, slot),

    async loadQuote(q: QuoteAsk): Promise<JupiterQuote> {
      const res = await recorded(
        jupiterQuote(q.inputMint, q.outputMint, q.amount, q.slippageBps, true),
      )
      if (res.status !== 200) throw new Refusal(quoteUnavailable({ status: res.status }))
      return res.body as JupiterQuote
    },

    async buildSwap({ owner, agent, roleId, quote }): Promise<BuiltSwap> {
      const connection = await chainFor(owner)
      const resolved = await resolveVault(
        (address) => fetchNullableSwig(connection, address),
        new PublicKey(owner),
      )
      if (resolved.existing === null) throw new Refusal(noVault({ owner }))
      const vault = vaultAddress(resolved.swigId).toBase58()
      const res = await recorded(jupiterSwapInstructions(quote, vault))
      if (res.status !== 200) throw new Refusal(quoteUnavailable({ status: res.status }))
      const raw = (res.body as { swapInstruction: JupiterInstruction }).swapInstruction
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()
      const tx = await swapTransaction({
        swig: resolved.existing,
        roleId,
        agent: new PublicKey(agent),
        swap: new TransactionInstruction({
          programId: new PublicKey(raw.programId),
          data: Buffer.from(raw.data, 'base64'),
          keys: raw.accounts.map((k) => ({
            pubkey: new PublicKey(k.pubkey),
            isSigner: k.isSigner,
            isWritable: k.isWritable,
          })),
        }),
        recentBlockhash: blockhash,
      })
      // Unsigned, so the simulation skips signature checks; it still runs every program.
      const sim = (await connection.simulateTransaction(tx)).value
      return {
        vault,
        transaction: tx.serialize({ requireAllSignatures: false }).toString('base64'),
        lastValidBlockHeight,
        unitsConsumed: sim.unitsConsumed ?? 0,
        failure: sim.err === null ? null : { logs: sim.logs ?? [] },
      }
    },

    async loadMintCheck(mint: string): Promise<MintCheck> {
      // checkMints makes its own net call, so the wrapper is handed in rather than guessed at.
      // Inferring it from the verdict instead would be a second rule about what counts as
      // recorded, and the two would drift.
      const check = (await checkMints([mint], { net: recorded })).get(mint)
      if (check === undefined) {
        throw new Refusal(mintCheckEmpty({ mint }))
      }
      return check
    },
  }
}
