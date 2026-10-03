// The reads the tools need, and the only part of this package that touches the network.
//
// Everything below goes through the record and replay wrapper, so the same server answers from a
// committed recording with 0 keys set. That is what makes a demo reproducible: the agent talking to
// this server gets the same numbers whether or not anyone's key is live.

import {
  agentRulesOf,
  pocketOf,
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
  dexscreenerToken,
  jupiterPrice,
  jupiterQuote,
  jupiterSwapInstructions,
  mintCheckEmpty,
  network,
  noChainConfigured,
  agentCannotPay,
  noOutputPocket,
  noAgentHistory,
  noVault,
  syncForkOffFork,
  quoteNotRead,
  quoteUnavailable,
  Refusal,
  rpcCall,
  type NetRequest,
  type NetResult,
  type JupiterQuote,
  type PrepareSwapInput,
} from '@agon/core'
import {
  Connection,
  Keypair,
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  TransactionInstruction,
} from '@solana/web3.js'
import { fetchNullableSwig } from '@swig-wallet/classic/dist/index.js'
import {
  decodeTransaction,
  fromEnhanced,
  type Decoded,
  type EnhancedTransaction,
  type RawTransaction,
} from '@agon/decoder'
import { categoriesOf, checkMints, type MintCheck, type TokenCategory } from '@agon/guard'
import { usdToLamports } from './vault-report.js'

/** The 2 SPL token programs a vault's token accounts can belong to. Pinned, never read from input. */
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')

/**
 * Pyth's SOL/USD price account on mainnet, the program that must own it and the feed it must carry.
 * Pinned: a price account read from input could be anyone's numbers.
 */
const PYTH_SOL_USD_ACCOUNT = '7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE'
const PYTH_RECEIVER = 'rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ'
const PYTH_SOL_USD_FEED = 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d'
/** A SOL/USD price older than this is stale and not used. */
const PRICE_MAX_AGE_S = 120

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
  /** Every wallet whose vault hires this agent key, found from the payers in the key's history. */
  findHirers(agent: string): Promise<VaultRules[]>
  /** The owner's vault: its holdings, its agents' fee SOL and its trades, read from the chain. */
  loadVaultActivity(owner: string): Promise<VaultActivity>
  /**
   * SOL/USD from every source that answered, Jupiter's USD price for `mints` in the same request,
   * and why each source that did not answer did not.
   */
  loadPrices(mints: readonly string[], slot: number): Promise<Prices>
  /**
   * What selling `amount` base units of `mint` fetches now, in lamports: a Jupiter sell quote, else
   * Jupiter's USD price from `prices`, else DexScreener. Never throws: no source gives the reasons.
   */
  valueInSol(
    mint: string,
    amount: bigint,
    decimals: number,
    prices: Prices,
    slot: number,
  ): Promise<{ value: bigint; source: string } | { why: string }>
  /** Fork only: the clock to real time and the pair's route copied from mainnet again. */
  syncFork(pair: [string, string]): Promise<ForkSync>
  /** The token category of each mint, for the wallet's category mix. A mint it cannot place is left out. */
  loadCategories(mints: string[], slot?: number): Promise<ReadonlyMap<string, TokenCategory>>
  /**
   * Jupiter's answer for spending `amount` base units of `inputMint`, for 1 legacy transaction.
   * Unchecked here: the caller parses it with `JupiterQuote`, since it is outside data.
   */
  loadQuote(q: QuoteAsk): Promise<unknown>
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

type QuoteAsk = Pick<PrepareSwapInput, 'inputMint' | 'outputMint' | 'amount' | 'slippageBps'> & {
  /** Venues to route around, by Jupiter's own label. Sent back to Jupiter only, never to the agent. */
  excludeDexes?: string[]
}

/**
 * The accounts a swap reads that the fork should re-copy from mainnet before simulating: all of
 * them except the vault and its own token accounts, which hold the fork's balances and have no
 * mainnet state worth restoring. The fork copies an account the first time it is read and keeps
 * that copy, so a pool read an hour ago no longer matches the price Jupiter quoted just now.
 */
export function accountsToRefresh(
  accounts: readonly string[],
  vault: string,
  mints: readonly string[],
): string[] {
  const own = new Set([vault, ...mints.map((m) => pocketOf(new PublicKey(vault), m).toBase58())])
  return [...new Set(accounts)].filter((a) => !own.has(a))
}

export interface BuiltSwap {
  vault: string
  /** Base64, unsigned. */
  transaction: string
  lastValidBlockHeight: number
  unitsConsumed: number
  /** Null when the simulation succeeded. `err` is the chain's own error, for when no program ran. */
  failure: { logs: string[]; err?: string } | null
  /** Base units the vault's output account gains in the simulation. */
  outputGained: bigint
}

/** An SPL token account's amount: a little-endian u64 at byte 64. */
const tokenAmount = (data: Buffer): bigint => data.readBigUInt64LE(64)

export interface VaultRules {
  /** The wallet that owns the vault: the one asked about, or the one that hired the agent key asked about. */
  owner: string | null
  vault: string | null
  rules: ChainAgentRule[]
}

/** Just the parts of a parsed transaction `payersTo` reads, so a test can hand in plain objects. */
interface ParsedTx {
  meta?: { err: unknown } | null
  transaction: { message: { instructions: ReadonlyArray<object> } }
}

/**
 * The wallets that sent `agent` a plain SOL transfer, most recent first, each once. The arming page
 * pays the agent's key its fees from the owner's wallet in the hire approval, so the owner is among
 * them. Only a candidate: anyone can send a key SOL, and the chain's role decides who hired it.
 */
export function payersTo(txs: ReadonlyArray<ParsedTx | null>, agent: string): string[] {
  const payers: string[] = []
  for (const tx of txs) {
    // A failed transaction moved nothing, so its transfer names nobody, whatever it claims.
    if (tx?.meta?.err != null) continue
    for (const ix of tx?.transaction.message.instructions ?? []) {
      const { program, parsed: raw } = ix as { program?: string; parsed?: unknown }
      const parsed = raw as
        | { type?: string; info?: { source?: string; destination?: string } }
        | undefined
      const source = parsed?.info?.source
      if (
        program === 'system' &&
        parsed?.type === 'transfer' &&
        parsed.info?.destination === agent &&
        source !== undefined &&
        !payers.includes(source)
      ) {
        payers.push(source)
      }
    }
  }
  return payers
}

interface JupiterInstruction {
  programId: string
  data: string
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[]
}

// ---- vault_status and sync_fork (T-C25): the arithmetic, kept pure so a test can hand it data. ----

/** The parts of a DexScreener pair read for a price. Outside data: every field may be missing. */
interface DexPair {
  chainId?: string
  baseToken?: { address?: string }
  quoteToken?: { address?: string }
  priceNative?: string
  priceUsd?: string
  liquidity?: { usd?: number }
}

/** What sync_fork did, in plain strings; the tool's contract checks it on the way out. */
interface ForkSync {
  clockLagBeforeMs: number
  clockLagAfterMs: number
  clockMoved: boolean
  refreshedAccounts: number
  pair: [string, string]
  note: string
}

export interface VaultActivity {
  vault: string
  nativeSol: bigint
  balances: Array<{ mint: string; amount: bigint }>
  agents: Array<{ address: string; feeSol: bigint }>
  /** Every successful transaction read, decoded for the vault with SOL as the only quote, newest first. */
  decoded: Array<{ d: Decoded; time: number | null }>
  /** The decimals of every mint in `balances` and `decoded`, from the chain's own balance rows. */
  decimals: ReadonlyMap<string, number>
  signaturesRead: number
  /** Why older transactions were not read, or null when the read reached the vault's first one. */
  incomplete: string | null
  slot: number
}

export interface Prices {
  sol: Array<{ name: string; usd: number }>
  /** Jupiter's USD price per whole token, for the mints asked. */
  usd: ReadonlyMap<string, number>
  errors: string[]
}

/**
 * A token account as `getParsedTokenAccountsByOwner` returns it: `tokenAmount`, unlike a
 * transaction's balances, which call it `uiTokenAmount`. Mixing the two crashed on the fork.
 */
export function balancesFrom(
  accounts: ReadonlyArray<unknown>,
): Array<{ mint: string; amount: bigint; decimals: number }> {
  return accounts
    .map((data) => {
      const info = (
        data as {
          parsed: { info: { mint: string; tokenAmount: { amount: string; decimals: number } } }
        }
      ).parsed.info
      return {
        mint: info.mint,
        amount: BigInt(info.tokenAmount.amount),
        decimals: info.tokenAmount.decimals,
      }
    })
    .filter((b) => b.amount > 0n)
}

/** Time travel only goes forward, and under 2 s of lag is not worth a jump. */
export const clockNeedsMove = (lagMs: number): boolean => lagMs > 2000

/**
 * Pyth's price update account (PriceUpdateV2) read for SOL/USD, or the reason it was not used:
 * wrong owner, wrong feed or stale all fail closed, since a wrong price is worse than none.
 */
export function pythSolUsd(owner: string, data: Buffer, nowS: number): number | string {
  if (owner !== PYTH_RECEIVER) return `Pyth's price account is owned by ${owner}, not Pyth`
  // 8 discriminator, 32 write authority, then the verification level: Partial carries 1 more byte.
  let at = 8 + 32
  at += data[at] === 0 ? 2 : 1
  const feed = data.subarray(at, at + 32).toString('hex')
  if (feed !== PYTH_SOL_USD_FEED) return `Pyth's price account carries feed ${feed}, not SOL/USD`
  const exponent = data.readInt32LE(at + 48)
  const price = Number(data.readBigInt64LE(at + 32)) * 10 ** exponent
  const confidence = Number(data.readBigUInt64LE(at + 40)) * 10 ** exponent
  const age = Math.round(nowS - Number(data.readBigInt64LE(at + 52)))
  if (age > PRICE_MAX_AGE_S) return `Pyth's SOL/USD is ${age} s old, over ${PRICE_MAX_AGE_S}`
  if (!Number.isFinite(price) || price <= 0) return `Pyth's SOL/USD reads ${price}, not a price`
  if (confidence > price / 100) {
    return `Pyth's SOL/USD is ${price} plus or minus ${confidence}, wider than 1%`
  }
  return price
}

/**
 * A finalized transaction never changes, so each is fetched and decoded once: what is kept is the
 * decoded result and its mints' decimals, about 200 bytes, not the transaction.
 */
const decodedOnce = new Map<string, { d: Decoded; decimals: Array<[string, number]> }>()
// ponytail: the oldest entries go past 50,000 (about 10 MB); an LRU if a host serves many vaults.
const DECODED_CAP = 50_000
// ponytail: 2,000 signatures and 20 s per read, each said in `incomplete`; page on when vaults outgrow it.
const VAULT_SIGNATURE_CAP = 2000
const VAULT_READ_BUDGET_MS = 20_000
/** Price reads retry a 429 once, not 3 times, so a slow source cannot hold the answer past a minute. */
const PRICE_RETRIES = 1

/**
 * Runs 1 outside price request, built inside the guard so a missing key is caught too, and turns any
 * failure into a short reason that names the source and its status: never a fixture path, an env
 * var or a stack, which an agent must not be handed.
 */
async function priceRead(
  name: string,
  build: () => NetRequest,
  slot: number,
): Promise<NetResult | string> {
  try {
    const res = await call(build(), { retries: PRICE_RETRIES, slotHint: slot })
    return res.status === 200 ? res : `${name} answered ${res.status}`
  } catch (error) {
    const m = error instanceof Error ? error.message : String(error)
    if (/replay mode|No recorded response/i.test(m)) {
      return `${name} not read: this server replays recordings and has none for it`
    }
    if (/is not set/.test(m)) return `${name} not read: its API key is not set on this server`
    return `${name} unreachable`
  }
}

/** The most liquid DexScreener pair for `mint`, its numbers checked: outside data, so never trusted. */
export function dexPairFor(
  pairs: unknown,
  mint: string,
): { quoteIsSol: boolean; priceNative: number; priceUsd: number } | null {
  const usable = (Array.isArray(pairs) ? (pairs as DexPair[]) : [])
    .filter((p) => p.chainId === 'solana' && p.baseToken?.address === mint)
    .map((p) => ({
      quoteIsSol: p.quoteToken?.address === WSOL_MINT,
      priceNative: Number(p.priceNative),
      priceUsd: Number(p.priceUsd),
      liquidity: Number(p.liquidity?.usd),
    }))
    .filter((p) => Number.isFinite(p.liquidity) && p.liquidity > 0)
    .sort((a, b) => b.liquidity - a.liquidity)
  return usable[0] ?? null
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
  // The wrapper's own errors name fixture paths and env vars, which an agent must not be handed.
  const jupiter: typeof call = async (req, opts) => {
    try {
      return await recorded(req, opts)
    } catch (error) {
      const replay = /replay mode|No recorded response/i.test(
        error instanceof Error ? error.message : String(error),
      )
      throw new Refusal(quoteNotRead({ recorded: replay }))
    }
  }

  return {
    usedFixture: () => fromFixture,

    async loadVaultRules(wallet: string): Promise<VaultRules> {
      const connection = await chainFor(wallet)
      const slot = BigInt(await connection.getSlot())
      const read = async (owner: string) => {
        const resolved = await resolveVault(
          (address) => fetchNullableSwig(connection, address),
          new PublicKey(owner),
        )
        if (resolved.existing === null) return null
        return {
          vault: vaultAddress(resolved.swigId).toBase58(),
          rules: agentRulesOf(resolved.existing.roles as unknown as ChainRole[], ARMED_MINTS, slot),
        }
      }
      const own = await read(wallet)
      return own === null ? { owner: null, vault: null, rules: [] } : { owner: wallet, ...own }
    },

    async findHirers(agent: string): Promise<VaultRules[]> {
      const connection = await chainFor(agent)
      const slot = BigInt(await connection.getSlot())
      // The wallet that hired this key paid it its fees from the arming page, so it is among the
      // payers in the key's history. Every payer whose vault holds a role for this key is returned,
      // never just the first: anyone can hire a key, and the user says which wallet is theirs.
      // ponytail: 400 signatures back, enough for the fee transfer to survive 399 trades; the agent
      // is told to remember the owner once confirmed, so this runs once per onboarding.
      const txs: Array<ParsedTx | null> = []
      let before: string | undefined
      for (let page = 0; page < 4; page++) {
        const signatures = await connection.getSignaturesForAddress(new PublicKey(agent), {
          limit: 100,
          before,
        })
        if (page === 0 && signatures.length === 0) throw new Refusal(noAgentHistory({ agent }))
        txs.push(
          ...((await Promise.all(
            signatures.map((s) =>
              connection.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0 }),
            ),
          )) as Array<ParsedTx | null>),
        )
        if (signatures.length < 100) break
        before = signatures[signatures.length - 1]?.signature
      }
      const hirers: VaultRules[] = []
      for (const owner of payersTo(txs, agent)) {
        const resolved = await resolveVault(
          (address) => fetchNullableSwig(connection, address),
          new PublicKey(owner),
        )
        if (resolved.existing === null) continue
        const rules = agentRulesOf(
          resolved.existing.roles as unknown as ChainRole[],
          ARMED_MINTS,
          slot,
        ).filter((r) => r.authority === agent)
        if (rules.length > 0) {
          hirers.push({ owner, vault: vaultAddress(resolved.swigId).toBase58(), rules })
        }
      }
      return hirers
    },

    async loadVaultActivity(owner: string): Promise<VaultActivity> {
      const connection = await chainFor(owner)
      const resolved = await resolveVault(
        (address) => fetchNullableSwig(connection, address),
        new PublicKey(owner),
      )
      if (resolved.existing === null) throw new Refusal(noVault({ owner }))
      const vault = vaultAddress(resolved.swigId)
      const slot = await connection.getSlot()
      const tokens = (
        await Promise.all(
          [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].map((programId) =>
            connection.getParsedTokenAccountsByOwner(vault, { programId }),
          ),
        )
      ).flatMap((r) => r.value)
      const balances = balancesFrom(tokens.map((t) => t.account.data))
      const keys = [
        ...new Set(
          agentRulesOf(
            resolved.existing.roles as unknown as ChainRole[],
            ARMED_MINTS,
            BigInt(slot),
          ).map((r) => r.authority),
        ),
      ]
      const agents = await Promise.all(
        keys.map(async (key) => ({
          address: key,
          feeSol: BigInt(await connection.getBalance(new PublicKey(key))),
        })),
      )
      const vaultId = vault.toBase58()
      const started = Date.now()
      const signatures: Array<{
        signature: string
        err: unknown
        blockTime?: number | null
        confirmationStatus?: string | null
      }> = []
      let incomplete: string | null = null
      for (let before: string | undefined; ; ) {
        const page = await connection.getSignaturesForAddress(vault, { limit: 1000, before })
        signatures.push(...page)
        before = page.at(-1)?.signature
        if (page.length < 1000) break
        if (signatures.length >= VAULT_SIGNATURE_CAP) {
          // Exactly at the cap is complete if nothing older exists.
          const older = await connection.getSignaturesForAddress(vault, { limit: 1, before })
          if (older.length > 0) {
            incomplete = `only the newest ${signatures.length} transactions were read; older trades are not counted`
          }
          break
        }
      }
      // A failed transaction moved nothing, so it is never fetched.
      const landed = signatures.filter((s) => s.err === null)
      const decoded: VaultActivity['decoded'] = []
      const decimals = new Map<string, number>(balances.map((b) => [b.mint, b.decimals]))
      let missing = 0
      for (let i = 0; i < landed.length; i += 20) {
        if (Date.now() - started > VAULT_READ_BUDGET_MS) {
          incomplete = `the read stopped after ${VAULT_READ_BUDGET_MS / 1000} s at ${i} of ${landed.length} transactions; ask again to continue from what was read`
          break
        }
        const read = await Promise.all(
          landed.slice(i, i + 20).map(async (s) => {
            const key = `${vaultId}:${s.signature}`
            const hit = decodedOnce.get(key)
            if (hit) return { ...hit, time: s.blockTime ?? null }
            const res = await fetch(connection.rpcEndpoint, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'getTransaction',
                params: [s.signature, { encoding: 'json', maxSupportedTransactionVersion: 0 }],
              }),
            })
            const tx = ((await res.json()) as { result?: RawTransaction | null }).result ?? null
            if (tx === null) return null
            const rows = [
              ...(tx.meta?.preTokenBalances ?? []),
              ...(tx.meta?.postTokenBalances ?? []),
            ]
            const entry = {
              d: decodeTransaction(tx, vaultId, [WSOL_MINT]),
              decimals: rows.map(
                (r) =>
                  [r.mint, (r.uiTokenAmount as { decimals?: number }).decimals ?? -1] as [
                    string,
                    number,
                  ],
              ),
            }
            if (s.confirmationStatus === 'finalized') {
              if (decodedOnce.size >= DECODED_CAP) {
                decodedOnce.delete(decodedOnce.keys().next().value as string)
              }
              decodedOnce.set(key, entry)
            }
            return { ...entry, time: s.blockTime ?? null }
          }),
        )
        for (const r of read) {
          if (r === null) {
            missing += 1
            continue
          }
          decoded.push({ d: r.d, time: r.time })
          for (const [mint, d] of r.decimals) if (d >= 0) decimals.set(mint, d)
        }
      }
      if (missing > 0 && incomplete === null) {
        incomplete = `${missing} transaction(s) were not returned by the chain yet; ask again in a minute`
      }
      return {
        vault: vaultId,
        nativeSol: BigInt(await connection.getBalance(vault)),
        balances: balances.map(({ mint, amount }) => ({ mint, amount })),
        agents,
        decoded,
        decimals,
        signaturesRead: signatures.length,
        incomplete,
        slot,
      }
    },

    async loadPrices(mints, slot) {
      const sol: Prices['sol'] = []
      const usd = new Map<string, number>()
      const errors: string[] = []
      const pyth = await priceRead(
        'Pyth',
        () => rpcCall('getAccountInfo', [PYTH_SOL_USD_ACCOUNT, { encoding: 'base64' }]),
        slot,
      )
      if (typeof pyth === 'string') errors.push(pyth)
      else {
        const v = (pyth.body as { result?: { value?: { owner: string; data: [string] } | null } })
          .result?.value
        const read = v
          ? pythSolUsd(v.owner, Buffer.from(v.data[0], 'base64'), Date.now() / 1000)
          : "Pyth's SOL/USD account was not in the answer"
        if (typeof read === 'number')
          sol.push({ name: pyth.fromFixture ? 'Pyth (recorded)' : 'Pyth', usd: read })
        else errors.push(read)
      }
      // 1 request for SOL and every mint asked, so valuing many positions costs 1 price call.
      const jup = await priceRead(
        'Jupiter price',
        () => jupiterPrice([WSOL_MINT, ...mints].slice(0, 50)),
        slot,
      )
      if (typeof jup === 'string') errors.push(jup)
      else {
        for (const [mint, row] of Object.entries(
          jup.body as Record<string, { usdPrice?: unknown }>,
        )) {
          const p = row?.usdPrice
          if (typeof p === 'number' && Number.isFinite(p) && p > 0) usd.set(mint, p)
        }
        const s = usd.get(WSOL_MINT)
        if (s !== undefined)
          sol.push({ name: jup.fromFixture ? 'Jupiter (recorded)' : 'Jupiter', usd: s })
        else errors.push('Jupiter price has no SOL price in its answer')
      }
      return { sol, usd, errors }
    },

    async valueInSol(mint, amount, decimals, prices, slot) {
      if (mint === WSOL_MINT) return { value: amount, source: 'wSOL is SOL' }
      const whys: string[] = []
      const solUsd = prices.sol[0]?.usd ?? null
      const quote = await priceRead(
        'Jupiter quote',
        () => jupiterQuote(mint, WSOL_MINT, String(amount), 50),
        slot,
      )
      const out =
        typeof quote === 'string' ? null : (quote.body as { outAmount?: unknown }).outAmount
      if (typeof out === 'string' && /^[0-9]+$/.test(out)) {
        return { value: BigInt(out), source: 'Jupiter sell quote' }
      }
      whys.push(typeof quote === 'string' ? quote : 'Jupiter quote has no route to SOL')
      const usd = prices.usd.get(mint)
      const fromUsd =
        usd !== undefined && solUsd !== null ? usdToLamports(amount, decimals, usd, solUsd) : null
      if (fromUsd !== null) return { value: fromUsd, source: "Jupiter's USD price" }
      whys.push(
        usd === undefined ? 'Jupiter price has none' : 'no SOL/USD to convert its USD price',
      )
      const dex = await priceRead('DexScreener', () => dexscreenerToken(mint), slot)
      if (typeof dex === 'string') whys.push(dex)
      else {
        const pair = dexPairFor(dex.body, mint)
        const value = !pair
          ? null
          : pair.quoteIsSol
            ? usdToLamports(amount, decimals, pair.priceNative, 1)
            : solUsd !== null
              ? usdToLamports(amount, decimals, pair.priceUsd, solUsd)
              : null
        if (value !== null) return { value, source: 'DexScreener' }
        whys.push(
          pair
            ? 'DexScreener has no usable price for it'
            : 'DexScreener lists no Solana pair for it',
        )
      }
      return { why: whys.join('; ') }
    },

    async syncFork([inputMint, outputMint]: [string, string]): Promise<ForkSync> {
      const net = network(process.env['AGON_NETWORK'])
      if (net.id !== 'fork') throw new Refusal(syncForkOffFork({ network: net.short }))
      // chainFor proves the chain is a Surfpool fork before any cheatcode is sent to it.
      const connection = await chainFor('the practice fork')
      const cheat = (method: string, params: unknown[]) =>
        fetch(connection.rpcEndpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        })
      const clock = async () => {
        const info = (await connection.getParsedAccountInfo(SYSVAR_CLOCK_PUBKEY)).value
        const parsed = (info?.data as { parsed: { info: { slot: number; unixTimestamp: number } } })
          .parsed.info
        return { slot: parsed.slot, lagMs: Date.now() - parsed.unixTimestamp * 1000 }
      }
      const before = await clock()
      let moved = false
      let settled = true
      if (clockNeedsMove(before.lagMs)) {
        await cheat('surfnet_timeTravel', [{ absoluteTimestamp: Date.now() }])
        moved = true
        // Surfpool 1.6.0 leaves the Clock sysvar's slot at the slot within the epoch for about a
        // block after a jump (solana-foundation/surfpool#843). Return only once it is absolute
        // again, so no program this tool hands back to reads the wrong slot.
        settled = false
        for (let i = 0; i < 20 && !settled; i++) {
          await new Promise((r) => setTimeout(r, 500))
          const epoch = await connection.getEpochInfo()
          settled = (await clock()).slot >= epoch.absoluteSlot - epoch.slotIndex
        }
      }
      const after = await clock()
      // The pair's route, for a throwaway user: only the pools and their accounts matter here, and
      // no vault is in it, so nothing holding practice funds is reset.
      let refreshed = 0
      let routeNote = ''
      try {
        const quote = (await this.loadQuote({
          inputMint,
          outputMint,
          amount: '10000000',
          slippageBps: 100,
        } as QuoteAsk)) as Record<string, unknown> | undefined
        const res = await jupiter(
          jupiterSwapInstructions(quote, Keypair.generate().publicKey.toBase58()),
        )
        const accounts =
          (res.body as { swapInstruction?: JupiterInstruction }).swapInstruction?.accounts ?? []
        const unique = [...new Set(accounts.map((a) => a.pubkey))]
        const results = await Promise.allSettled(
          unique.map((k) => cheat('surfnet_resetAccount', [k])),
        )
        refreshed = results.filter((r) => r.status === 'fulfilled').length
      } catch (error) {
        routeNote = ` The route was not refreshed: ${error instanceof Error ? error.message : String(error)}`
      }
      const s = (ms: number) => `${Math.round(ms / 100) / 10} s`
      const clockNote = moved
        ? `The fork's clock was ${s(before.lagMs)} behind real time and is now ${s(after.lagMs)} behind` +
          (settled
            ? '.'
            : ', and its slot had not settled after 10 s: wait a moment before trading.')
        : before.lagMs < 0
          ? `The fork's clock is ${s(-before.lagMs)} ahead of real time; it only moves forward, so it was left alone.`
          : `The fork's clock is ${s(before.lagMs)} behind real time, close enough to leave alone.`
      return {
        clockLagBeforeMs: Math.round(before.lagMs),
        clockLagAfterMs: Math.round(after.lagMs),
        clockMoved: moved,
        refreshedAccounts: refreshed,
        pair: [inputMint, outputMint],
        note: `${clockNote} ${refreshed} accounts the route reads were copied from mainnet again. No vault was touched.${routeNote}`,
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

    async loadQuote(q: QuoteAsk): Promise<unknown> {
      const res = await jupiter(
        jupiterQuote(q.inputMint, q.outputMint, q.amount, q.slippageBps, true, q.excludeDexes),
      )
      if (res.status !== 200) throw new Refusal(quoteUnavailable({ status: res.status }))
      return res.body
    },

    async buildSwap({ owner, agent, roleId, quote }): Promise<BuiltSwap> {
      const connection = await chainFor(owner)
      const resolved = await resolveVault(
        (address) => fetchNullableSwig(connection, address),
        new PublicKey(owner),
      )
      if (resolved.existing === null) throw new Refusal(noVault({ owner }))
      // The agent pays the fee, and a fee payer must stay rent exempt afterwards, so below that
      // the chain refuses before any program runs and names none. Said here, with the number.
      const needed = (await connection.getMinimumBalanceForRentExemption(0)) + 5000
      const held = await connection.getBalance(new PublicKey(agent))
      if (held < needed) throw new Refusal(agentCannotPay({ agent, held, needed }))
      const vault = vaultAddress(resolved.swigId).toBase58()
      // The proceeds must land in the vault's own account for the output mint. Missing, the swap
      // cannot land; present, the simulation below proves the proceeds arrive there.
      const pocket = pocketOf(new PublicKey(vault), quote.outputMint)
      const before = await connection.getAccountInfo(pocket)
      if (before === null) throw new Refusal(noOutputPocket({ vault, mint: quote.outputMint }))
      const res = await jupiter(jupiterSwapInstructions(quote, vault))
      if (res.status !== 200) throw new Refusal(quoteUnavailable({ status: res.status }))
      const raw = (res.body as { swapInstruction: JupiterInstruction }).swapInstruction
      // Fork only, and chainFor has already proved the chain is one: Surfpool's own cheatcode drops
      // the fork's copy, so the simulation reads today's pool rather than the first one it saw. A
      // failed refresh changes nothing but freshness; the simulation below still decides.
      if (network(process.env['AGON_NETWORK']).id === 'fork') {
        const stale = accountsToRefresh(
          raw.accounts.map((k) => k.pubkey),
          vault,
          [quote.inputMint, quote.outputMint],
        )
        await Promise.allSettled(
          stale.map((pubkey) =>
            fetch(connection.rpcEndpoint, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'surfnet_resetAccount',
                params: [pubkey],
              }),
            }),
          ),
        )
      }
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
      const sim = (await connection.simulateTransaction(tx, undefined, [pocket])).value
      const after = sim.accounts?.[0]?.data[0]
      return {
        vault,
        transaction: tx.serialize({ requireAllSignatures: false }).toString('base64'),
        lastValidBlockHeight,
        unitsConsumed: sim.unitsConsumed ?? 0,
        failure: sim.err === null ? null : { logs: sim.logs ?? [], err: JSON.stringify(sim.err) },
        // No post state reads as 0 gained, which refuses: never assumed to have arrived.
        outputGained:
          after === undefined
            ? 0n
            : tokenAmount(Buffer.from(after, 'base64')) - tokenAmount(before.data),
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
