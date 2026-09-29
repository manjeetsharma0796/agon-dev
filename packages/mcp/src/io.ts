// The reads the tools need, and the only part of this package that touches the network.
//
// Everything below goes through the record and replay wrapper, so the same server answers from a
// committed recording with 0 keys set. That is what makes a demo reproducible: the agent talking to
// this server gets the same numbers whether or not anyone's key is live.

import {
  agentRulesOf,
  resolveVault,
  vaultAddress,
  USDC_MINT,
  WSOL_MINT,
  type ChainAgentRule,
  type ChainRole,
} from '@agon/chain'
import { call, heliusTransactions, network } from '@agon/core'
import { Connection, PublicKey } from '@solana/web3.js'
import { fetchNullableSwig } from '@swig-wallet/classic/dist/index.js'
import { fromEnhanced, type EnhancedTransaction, type RawTransaction } from '@agon/decoder'
import { checkMints, type MintCheck } from '@agon/guard'

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
}

export interface VaultRules {
  vault: string | null
  rules: ChainAgentRule[]
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

export const liveIo = (): ToolIo => {
  // Per instance, and `callAsTool` builds one per call, so two concurrent requests cannot see each
  // other's flag. A single flag shared across a server's lifetime would mark every later answer
  // the moment one early read hit a recording.
  let fromFixture = false

  return {
    usedFixture: () => fromFixture,

    async loadVaultRules(wallet: string): Promise<VaultRules> {
      const url = process.env['AGON_RPC_URL']
      if (!url) {
        throw new Error(
          `No chain is configured on this deployment, so no vault was read for ${wallet} and no rules ` +
            `are listed. This is not the same as having none: ask the operator to point it at a chain.`,
        )
      }
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getVersion' }),
      })
      const version = ((await res.json()) as { result?: Record<string, unknown> }).result ?? {}
      const mismatch = chainMismatch(network(process.env['AGON_NETWORK']).id, version)
      if (mismatch) {
        throw new Error(`No rules are listed for ${wallet}: ${mismatch}. Nothing was read from it.`)
      }
      const connection = new Connection(url, 'confirmed')
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
        throw new Error(
          replay
            ? `No history is available for ${wallet} on this deployment. It answers from recorded ` +
              `data and there is no recording for this wallet, so nothing was read and no verdict ` +
              `is given. Ask about a wallet this deployment has, or run against live mainnet.`
            : `Could not read the history for ${wallet}, so no verdict is given rather than one ` +
              `based on a partial read.`,
        )
      }
      if (res.fromFixture) fromFixture = true
      if (res.status !== 200) {
        throw new Error(
          `Helius answered ${res.status} for ${wallet}. Nothing was read, so this returns no ` +
            `answer rather than one based on part of the history without saying so.`,
        )
      }
      // Anything other than an array is a response shape change, and guessing at it is how a
      // decoder silently reports 0 swaps for a wallet that has hundreds.
      if (!Array.isArray(res.body)) {
        throw new Error(
          `Helius returned ${typeof res.body} where an array of transactions was expected, so the ` +
            `history could not be read. This is a response shape change, not an empty wallet.`,
        )
      }
      return (res.body as EnhancedTransaction[]).map(fromEnhanced)
    },

    async loadMintCheck(mint: string): Promise<MintCheck> {
      // checkMints makes its own net call, so the wrapper is handed in rather than guessed at.
      // Inferring it from the verdict instead would be a second rule about what counts as
      // recorded, and the two would drift.
      const check = (
        await checkMints([mint], {
          net: async (req) => {
            const res = await call(req)
            if (res.fromFixture) fromFixture = true
            return res
          },
        })
      ).get(mint)
      if (check === undefined) {
        throw new Error(
          `The mint check returned 0 verdicts for ${mint}, where 1 was asked for. Nothing was read ` +
            `about this token, so it is not a token we can say anything about.`,
        )
      }
      return check
    },
  }
}
