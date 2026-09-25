// Swap decoding from on-chain balance changes. Owned by T-A01.
//
// Balances, not instruction parsing. Every venue has its own instruction layout and its own idea of
// what a swap looks like, and a new one ships every week. What a swap actually is, for a wallet, is
// one mint going down and another going up in the same transaction, and that is true of Jupiter,
// Raydium, Orca, Meteora and whatever launches next month.
//
// Pure. Nothing here touches the network, so the same function serves the report, the benchmark and
// the replayed tests, and a coverage number cannot move because an RPC had a bad minute.

/** Whether the wallet ended up holding more of the non-quote asset, or less. */
export type Side = 'buy' | 'sell'

/**
 * Mints treated as the thing you price in rather than the thing you are trading. Pinned, never read
 * from user input, and passed in so a test can state its own set rather than inheriting ours.
 */
export const QUOTE_MINTS: readonly string[] = [
  'So11111111111111111111111111111111111111112', // wrapped SOL
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
]

export interface Swap {
  kind: 'swap'
  signature: string
  slot: number
  side: Side
  /** What left the wallet, exact to base units. */
  soldMint: string
  soldAmount: string
  /** What arrived, exact to base units. */
  boughtMint: string
  boughtAmount: string
}

/** A transaction that is genuinely not a swap: a transfer, a failure, a vote. Not a gap. */
export interface NotASwap {
  kind: 'not-a-swap'
  signature: string
  slot: number
  reason: string
}

/**
 * A transaction we could not classify. Carries the program that ran and why we gave up, because a
 * coverage number is only honest if the missing share can be named.
 */
export interface Undecoded {
  kind: 'undecoded'
  signature: string
  slot: number
  programId: string
  reason: string
}

export type Decoded = Swap | NotASwap | Undecoded

/** The shape of the RPC response this reads. Only the fields used, so a schema change fails loudly. */
export interface RawTokenBalance {
  mint: string
  owner?: string
  uiTokenAmount: { amount: string }
}
export interface RawTransaction {
  slot: number
  transaction: {
    signatures: string[]
    message: { instructions: { programId?: string }[] }
  }
  meta: {
    err: unknown
    preTokenBalances?: RawTokenBalance[]
    postTokenBalances?: RawTokenBalance[]
  } | null
}

const UNKNOWN_PROGRAM = '11111111111111111111111111111111'

/** The outermost program that ran, which is the one worth naming when we could not decode. */
function topProgram(tx: RawTransaction): string {
  for (const ix of tx.transaction.message.instructions) {
    if (typeof ix.programId === 'string' && ix.programId.length > 0) return ix.programId
  }
  return UNKNOWN_PROGRAM
}

/**
 * Net movement per mint for one wallet, in base units.
 *
 * BigInt because these are u64s. A token with 9 decimals and a large supply exceeds
 * Number.MAX_SAFE_INTEGER, and a rounded amount here would become a rounded cost basis later.
 */
function deltas(tx: RawTransaction, wallet: string): Map<string, bigint> {
  const out = new Map<string, bigint>()
  const apply = (rows: RawTokenBalance[] | undefined, sign: bigint): void => {
    for (const row of rows ?? []) {
      if (row.owner !== wallet) continue
      out.set(row.mint, (out.get(row.mint) ?? 0n) + sign * BigInt(row.uiTokenAmount.amount))
    }
  }
  apply(tx.meta?.preTokenBalances, -1n)
  apply(tx.meta?.postTokenBalances, 1n)
  for (const [mint, d] of [...out]) if (d === 0n) out.delete(mint)
  return out
}

/**
 * Classify one transaction for one wallet.
 *
 * Never returns null and never throws on a transaction it does not understand: the third bucket is
 * `undecoded`, carrying a reason and a program id, because a silently dropped transaction is a
 * coverage number that lies.
 */
export function decodeTransaction(
  tx: RawTransaction,
  wallet: string,
  quoteMints: readonly string[] = QUOTE_MINTS,
): Decoded {
  const signature = tx.transaction.signatures[0] ?? ''
  const slot = tx.slot
  const at = { signature, slot }

  if (tx.meta === null) {
    return {
      kind: 'undecoded',
      ...at,
      programId: topProgram(tx),
      reason: 'the transaction carries no meta, so balances cannot be compared',
    }
  }
  if (tx.meta.err !== null && tx.meta.err !== undefined) {
    return {
      kind: 'not-a-swap',
      ...at,
      reason: 'the transaction failed on chain, so no balance moved',
    }
  }

  const moved = deltas(tx, wallet)
  if (moved.size === 0) {
    return { kind: 'not-a-swap', ...at, reason: 'no token balance of this wallet changed' }
  }

  const out = [...moved].filter(([, d]) => d < 0n)
  const into = [...moved].filter(([, d]) => d > 0n)

  if (out.length === 0 || into.length === 0) {
    const dir = into.length === 0 ? 'only left' : 'only arrived'
    return {
      kind: 'not-a-swap',
      ...at,
      reason: `value ${dir} the wallet, which is a transfer and not a swap`,
    }
  }
  if (out.length > 1 || into.length > 1) {
    return {
      kind: 'undecoded',
      ...at,
      programId: topProgram(tx),
      reason: `${out.length} mints left and ${into.length} arrived, so the pairing is ambiguous`,
    }
  }

  const [soldMint, soldDelta] = out[0] as [string, bigint]
  const [boughtMint, boughtDelta] = into[0] as [string, bigint]

  // Direction is named from the non-quote asset's point of view: spending the quote is a buy.
  // When both sides are quote assets it is a stable swap, and calling it either way would be a
  // coin flip that the miner would later read as conviction.
  const soldIsQuote = quoteMints.includes(soldMint)
  const boughtIsQuote = quoteMints.includes(boughtMint)
  if (soldIsQuote && boughtIsQuote) {
    // A SOL to USDC rotation is a real swap with no position in it, and it is the most common
    // shape on the chain. Calling it undecoded would put it in the unsupported list and deflate
    // coverage on a transaction we understand perfectly well.
    return {
      kind: 'not-a-swap',
      ...at,
      reason: 'both sides are quote assets, so no position was opened or closed',
    }
  }
  if (!soldIsQuote && !boughtIsQuote) {
    return {
      kind: 'undecoded',
      ...at,
      programId: topProgram(tx),
      reason: 'neither side is a quote asset, so there is no direction to name',
    }
  }

  return {
    kind: 'swap',
    ...at,
    side: soldIsQuote ? 'buy' : 'sell',
    soldMint,
    soldAmount: (-soldDelta).toString(),
    boughtMint,
    boughtAmount: boughtDelta.toString(),
  }
}

/** Decoded swaps, plus the two buckets that account for everything else. */
export interface DecodeSummary {
  swaps: Swap[]
  notSwaps: NotASwap[]
  /** Grouped by program and counted, the shape the frozen `Unsupported` contract expects. */
  unsupported: { programId: string; count: number; reason: string }[]
  coverage: { decodedSwaps: number; totalSwaps: number; share: number }
}

/**
 * Decode a batch.
 *
 * `totalSwaps` counts decoded swaps plus undecoded transactions, not every transaction seen: a
 * plain transfer was never a swap, so counting it would quietly deflate coverage and make the
 * decoder look worse than it is. Undecoded ones do count, because each is a swap we probably missed.
 */
export function decodeAll(
  txs: RawTransaction[],
  wallet: string,
  quoteMints: readonly string[] = QUOTE_MINTS,
): DecodeSummary {
  const swaps: Swap[] = []
  const notSwaps: NotASwap[] = []
  const undecoded: Undecoded[] = []

  for (const tx of txs) {
    const d = decodeTransaction(tx, wallet, quoteMints)
    if (d.kind === 'swap') swaps.push(d)
    else if (d.kind === 'not-a-swap') notSwaps.push(d)
    else undecoded.push(d)
  }

  const byProgram = new Map<string, { programId: string; count: number; reason: string }>()
  for (const u of undecoded) {
    const seen = byProgram.get(u.programId)
    if (seen) seen.count += 1
    else byProgram.set(u.programId, { programId: u.programId, count: 1, reason: u.reason })
  }

  // Everything the wallet was a party to, not just swaps plus undecoded. Leaving not-a-swap out of
  // the denominator meant a wallet of transfers scored 100%: the decoder dropped from the count
  // exactly what it had chosen not to explain, so the share could never fall below the 95% the PRD
  // treats as a finding. The name stays `totalSwaps` because it is a frozen contract field.
  const totalSwaps = swaps.length + notSwaps.length + undecoded.length
  return {
    swaps,
    notSwaps,
    unsupported: [...byProgram.values()],
    coverage: {
      decodedSwaps: swaps.length,
      totalSwaps,
      // 0 when nothing was seen. It read 1, which claimed we understood everything about a wallet
      // we had read nothing of, and that number goes in front of a user.
      share: totalSwaps === 0 ? 0 : swaps.length / totalSwaps,
    },
  }
}

// Realised P&L over decoded swaps, FIFO. T-A02.
export * from './pnl.js'

// Helius's enhanced shape, translated at the edge into the one shape above.
export { fromEnhanced, type EnhancedTransaction } from './enhanced.js'
