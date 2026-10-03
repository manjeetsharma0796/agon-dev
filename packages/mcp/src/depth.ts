// The order book, or the honest depth, of the pool /market already chose. Owned by T-C35.
//
// What a pool can show depends on what it is (docs/plans/agon-terminal.md section 3):
//   orderbook      Manifest: the resting orders themselves.
//   amm-liquidity  Orca Whirlpool and Raydium CLMM ticks, Meteora DLMM bins: liquidity at each
//                  price, worded "AMM liquidity, not resting orders".
//   amm-curve      Raydium AMM v4 and CPMM, PumpSwap, pump.fun curves: the cost to move the price
//                  1, 2, 5 and 10% from the reserves, never drawn as a ladder of orders.
//
// Everything is read from the pool's own accounts in 2 RPC calls (the pool, then the pool again
// with its mints and the accounts it points at, so all of it is 1 slot), plus Raydium's public
// tick line for Raydium CLMM, checked against the pool account. No vendor SDK: each layout below
// was read off the program's source and checked against a live account on 2026-10-03.
// Program ids are pinned here and only an account they own is read; the owner decides the
// parser, never a name an upstream sends. No text from any account or API reaches the answer.
//
// The arithmetic in the first half is pure and tested by hand in depth.test.ts.

import { mode } from '@agon/core'
import { rpcCall } from '@agon/core/dist/net/record.js'
import { PublicKey } from '@solana/web3.js'

type Level = { price: number; size: number; total: number }
type Move = { pct: number; side: 'buy' | 'sell'; quoteIn: number; baseOut: number }
type Kind = 'orderbook' | 'amm-liquidity' | 'amm-curve'
type Book = {
  kind: Kind
  label: string
  venue: string
  pool: string
  slot: number | null
  fetchedAt: string
  mid: number | null
  bids: Level[]
  asks: Level[]
  moves: Move[]
  basis: string
}

const LABELS: Record<Kind, string> = {
  orderbook: 'Order book',
  'amm-liquidity': 'AMM liquidity, not resting orders',
  'amm-curve': 'Cost to move the price',
}
const LEVELS = 20
const PCTS = [1, 2, 5, 10]
/** A bucket is the pool's own price step, at least 0.1% and at most 1% of mid. */
const MIN_WIDTH = 0.001
const MAX_WIDTH = 0.01

/** A failure that says what to do. `retry` false: asking again will not help, so it says so. */
export class DepthError extends Error {
  constructor(
    message: string,
    readonly retry = true,
  ) {
    super(message)
  }
}

/** 3 significant figures, for messages. */
const fmt = (n: number) => String(Number(n.toPrecision(3)))
const pct = (w: number) => `${fmt(w * 100)}%`
const clampWidth = (step: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, step))

/** Totals from mid outward, levels with nothing in them left out. */
function cumulate(levels: { price: number; size: number }[]): Level[] {
  let total = 0
  return levels
    .filter((l) => l.size > 0)
    .map((l) => ({ price: l.price, size: l.size, total: (total += l.size) }))
}

// ---- constant product ----

/**
 * The cost to move the price of a constant product pool by each pct, from its reserves in token
 * units. With x base and y quote, x * y = k and the price is y / x. Moving the price to
 * p' = p (1 + r) means x' = sqrt(k / p') and y' = sqrt(k p'), so a buy pays
 * y (sqrt(1 + r) - 1) quote for x (1 - 1 / sqrt(1 + r)) base, and a sell to p (1 - r) pays
 * x (1 / sqrt(1 - r) - 1) base for y (1 - sqrt(1 - r)) quote. Before the pool's fee.
 *
 * quoteIn is the quote leg in USD and baseOut the base leg in base units, as positive amounts:
 * a buy pays quoteIn and takes baseOut, a sell pays baseOut and takes quoteIn. A move needing more
 * than `limits` (what a bonding curve really holds) is left out and named.
 */
export function cpMoves(
  base: number,
  quote: number,
  usdPerQuote: number,
  limits: { baseOut?: number; quoteOut?: number } = {},
  pcts = PCTS,
) {
  const moves: Move[] = []
  const unreachable: string[] = []
  for (const p of pcts) {
    const r = p / 100
    const quoteIn = quote * (Math.sqrt(1 + r) - 1)
    const baseOut = base * (1 - 1 / Math.sqrt(1 + r))
    if (limits.baseOut !== undefined && baseOut > limits.baseOut)
      unreachable.push(
        `a ${p}% buy needs ${fmt(baseOut)} base out and the curve holds only ${fmt(limits.baseOut)} base`,
      )
    else moves.push({ pct: p, side: 'buy', quoteIn: quoteIn * usdPerQuote, baseOut })
  }
  for (const p of pcts) {
    const r = p / 100
    if (r >= 1) continue
    const baseIn = base * (1 / Math.sqrt(1 - r) - 1)
    const quoteOut = quote * (1 - Math.sqrt(1 - r))
    if (limits.quoteOut !== undefined && quoteOut > limits.quoteOut)
      unreachable.push(
        `a ${p}% sell needs ${fmt(quoteOut)} quote out and the curve holds only ${fmt(limits.quoteOut)} quote`,
      )
    else moves.push({ pct: p, side: 'sell', quoteIn: quoteOut * usdPerQuote, baseOut: baseIn })
  }
  return { moves, unreachable }
}

// ---- concentrated liquidity ----

/** Liquidity L held constant between 2 square-root prices (raw token1 atoms per token0 atom). */
type Segment = { lo: number; hi: number; L: number }

/**
 * Raw token amount between sqrt prices a < b: token0 is L (1/a - 1/b), token1 is L (b - a),
 * summed over the overlap with each segment.
 */
export function clAmount(segments: readonly Segment[], a: number, b: number, token0: boolean) {
  let sum = 0
  for (const s of segments) {
    const lo = Math.max(a, s.lo)
    const hi = Math.min(b, s.hi)
    if (hi > lo) sum += token0 ? s.L * (1 / lo - 1 / hi) : s.L * (hi - lo)
  }
  return sum
}

/**
 * Bids and asks from concentrated liquidity, in buckets of `width` of mid. A level's price is its
 * bucket's far edge in USD; its size is the base the pool gives (asks) or takes (bids) moving the
 * price across that bucket.
 */
export function clLadder(o: {
  segments: readonly Segment[]
  sqrtMid: number
  baseIsToken0: boolean
  dec0: number
  dec1: number
  usdPerQuote: number
  width: number
  levels?: number
}) {
  const levels = o.levels ?? LEVELS
  const scale = 10 ** (o.dec0 - o.dec1)
  const p = o.sqrtMid ** 2
  // P is the base price in quote tokens: p scaled when the base is token0, 1 / p otherwise.
  const mid = o.baseIsToken0 ? p * scale : 1 / (p * scale)
  const sqrtAt = (P: number) => Math.sqrt(o.baseIsToken0 ? P / scale : 1 / (P * scale))
  const amount = (P1: number, P2: number) => {
    const a = sqrtAt(P1)
    const b = sqrtAt(P2)
    return (
      clAmount(o.segments, Math.min(a, b), Math.max(a, b), o.baseIsToken0) /
      10 ** (o.baseIsToken0 ? o.dec0 : o.dec1)
    )
  }
  const asks = []
  const bids = []
  for (let k = 1; k <= levels; k++) {
    const hi = mid * (1 + k * o.width)
    asks.push({ price: hi * o.usdPerQuote, size: amount(mid * (1 + (k - 1) * o.width), hi) })
    const lo = mid * (1 - k * o.width)
    if (lo > 0)
      bids.push({ price: lo * o.usdPerQuote, size: amount(lo, mid * (1 - (k - 1) * o.width)) })
  }
  return { mid: mid * o.usdPerQuote, bids: cumulate(bids), asks: cumulate(asks) }
}

const sqrtAtTick = (t: number) => 1.0001 ** (t / 2)
const MAX_TICK = 443_636

/**
 * Segments from initialized ticks. Liquidity active at the current tick includes every tick at or
 * below it: going up, crossing a tick adds its net; going down, crossing one takes it away. Only
 * [lowTick, highTick] was read, so nothing is claimed outside it. Exact in BigInt.
 */
export function walkTicks(o: {
  tick: number
  liquidity: bigint | number
  sqrtPrice: number
  ticks: readonly { index: number; net: bigint | number }[]
  lowTick: number
  highTick: number
}): Segment[] {
  const sorted = [...o.ticks].sort((a, b) => a.index - b.index)
  const segs: Segment[] = []
  const check = (L: bigint, at: number) => {
    if (L < 0n)
      throw new DepthError(
        `liquidity fell below 0 at tick ${at} walking the pool's ticks, so the read is inconsistent; this server asks again shortly`,
      )
  }
  let L = BigInt(o.liquidity)
  let from = o.sqrtPrice
  for (const t of sorted) {
    if (t.index <= o.tick || t.index > o.highTick) continue
    const to = sqrtAtTick(t.index)
    if (to > from) segs.push({ lo: from, hi: to, L: Number(L) })
    L += BigInt(t.net)
    check(L, t.index)
    from = Math.max(from, to)
  }
  if (sqrtAtTick(o.highTick) > from)
    segs.push({ lo: from, hi: sqrtAtTick(o.highTick), L: Number(L) })
  L = BigInt(o.liquidity)
  let upper = o.sqrtPrice
  for (const t of sorted.reverse()) {
    if (t.index > o.tick || t.index < o.lowTick) continue
    const at = sqrtAtTick(t.index)
    if (at < upper) segs.push({ lo: at, hi: upper, L: Number(L) })
    L -= BigInt(t.net)
    check(L, t.index)
    upper = Math.min(upper, at)
  }
  if (sqrtAtTick(o.lowTick) < upper)
    segs.push({ lo: sqrtAtTick(o.lowTick), hi: upper, L: Number(L) })
  return segs.filter((s) => s.L > 0).sort((a, b) => a.lo - b.lo)
}

type Json = Record<string, unknown>
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {})

/**
 * Raydium's position line: each point is a tick and the liquidity active from it to the next.
 * Its liquidity at the current tick must equal the pool account's, or the line is stale.
 */
export function lineSegments(raw: unknown, tick: number, poolLiquidity: bigint): Segment[] {
  const list = obj(obj(raw)['data'])['line']
  const rows = Array.isArray(list) ? list : []
  const points: { tick: number; L: bigint }[] = []
  for (const r of rows) {
    const t = obj(r)['tick']
    const l = obj(r)['liquidity']
    if (
      Number.isInteger(t) &&
      Math.abs(t as number) <= MAX_TICK &&
      typeof l === 'string' &&
      /^\d{1,40}$/.test(l)
    )
      points.push({ tick: t as number, L: BigInt(l) })
  }
  if (rows.length === 0)
    throw new DepthError(
      "Raydium's position line came back with 0 points, so its depth is not drawn; this server asks again shortly",
    )
  if (points.length !== rows.length)
    throw new DepthError(
      `${rows.length - points.length} of ${rows.length} points in Raydium's position line were unreadable, so its depth is not drawn; this server asks again shortly`,
    )
  points.sort((a, b) => a.tick - b.tick)
  const atTick = points.filter((p) => p.tick <= tick).at(-1)?.L ?? 0n
  if (atTick !== poolLiquidity)
    throw new DepthError(
      `Raydium's position line reads L ${atTick} at tick ${tick} where the pool account reads ${poolLiquidity}; the line lags the chain, so this server asks again shortly`,
    )
  const segs: Segment[] = []
  for (let i = 0; i + 1 < points.length; i++) {
    const p = points[i]!
    if (p.L > 0n)
      segs.push({ lo: sqrtAtTick(p.tick), hi: sqrtAtTick(points[i + 1]!.tick), L: Number(p.L) })
  }
  return segs
}

// ---- orders and bins ----

type Order = { price: number; size: number; side: 'bid' | 'ask' }

/** The same orders seen from the other token: price 1/P, size in the other token, sides swapped. */
export const flip = (orders: readonly Order[]): Order[] =>
  orders.map((o) => ({
    price: 1 / o.price,
    size: o.size * o.price,
    side: o.side === 'bid' ? 'ask' : 'bid',
  }))

/**
 * Levels from orders priced in quote tokens. With no width (a real book) they group by exact
 * price, best first, and mid is halfway between the best bid and ask. With a width (bins) each
 * order goes in the bucket of mid its price falls in, priced at the bucket's far edge.
 */
export function ordersLadder(
  orders: readonly Order[],
  mid: number | null,
  usdPerQuote: number,
  width?: number,
) {
  if (width === undefined) {
    const by = (side: Order['side']) => {
      const m = new Map<number, number>()
      for (const o of orders) if (o.side === side) m.set(o.price, (m.get(o.price) ?? 0) + o.size)
      return [...m].sort((a, b) => (side === 'ask' ? a[0] - b[0] : b[0] - a[0])).slice(0, LEVELS)
    }
    const asks = by('ask')
    const bids = by('bid')
    const best = asks[0] && bids[0] ? (asks[0][0] + bids[0][0]) / 2 : null
    const level = ([price, size]: [number, number]) => ({ price: price * usdPerQuote, size })
    return {
      mid: best === null ? null : best * usdPerQuote,
      bids: cumulate(bids.map(level)),
      asks: cumulate(asks.map(level)),
    }
  }
  if (mid === null) throw new Error('a bucketed ladder needs a mid')
  const asks = Array.from({ length: LEVELS }, (_, i) => ({
    price: mid * (1 + (i + 1) * width) * usdPerQuote,
    size: 0,
  }))
  const bids = Array.from({ length: LEVELS }, (_, i) => ({
    price: mid * (1 - (i + 1) * width) * usdPerQuote,
    size: 0,
  }))
  for (const o of orders) {
    // 1e-9 so a price on a bucket edge lands in the inner bucket, not the next one out.
    const away = o.side === 'ask' ? o.price / mid - 1 : 1 - o.price / mid
    const k = Math.max(1, Math.ceil(away / width - 1e-9))
    const level = (o.side === 'ask' ? asks : bids)[k - 1]
    if (level && level.price > 0) level.size += o.size
  }
  return { mid: mid * usdPerQuote, bids: cumulate(bids), asks: cumulate(asks) }
}

const MANIFEST_DISCRIMINANT = 4859840929024028656n
const MANIFEST_HEADER = 256
const MANIFEST_NODE = 80
const NIL = 0xffffffff

/**
 * A Manifest market account (CKS-Systems/manifest, client/ts/src/market.ts): a 256-byte header,
 * then 80-byte red-black tree nodes, 16 bytes of header and a 64-byte RestingOrder. The price is
 * quote atoms per base atom times 10^18. An order is expired once the slot is past its last valid
 * slot (resting_order.rs is_expired: last_valid_slot < current_slot) and left out; 0 means it never
 * expires. Every node offset is checked, and a node reached twice
 * stops the read, since account bytes are outside data.
 */
export function readManifest(d: Buffer, slot: number) {
  need(d, MANIFEST_HEADER, 'Manifest market')
  if (d.readBigUInt64LE(0) !== MANIFEST_DISCRIMINANT)
    throw new DepthError(
      'the account is not a Manifest market: its first 8 bytes are not the market discriminant',
      false,
    )
  const baseDec = d[9]!
  const quoteDec = d[10]!
  const area = d.subarray(MANIFEST_HEADER)
  const seen = new Set<number>()
  const orders: Order[] = []
  let expired = 0
  for (const root of [d.readUInt32LE(156), d.readUInt32LE(164)]) {
    const stack = root === NIL ? [] : [root]
    while (stack.length) {
      const at = stack.pop()!
      if (at % 8 !== 0 || at + MANIFEST_NODE > area.length)
        throw new DepthError(
          `a Manifest order node points at byte ${at}, outside the ${area.length} bytes of its order area`,
        )
      if (seen.has(at))
        throw new DepthError(
          `the Manifest node at byte ${at} is reached twice, so the account is not a well-formed book`,
        )
      seen.add(at)
      for (const child of [area.readUInt32LE(at + 4), area.readUInt32LE(at)])
        if (child !== NIL) stack.push(child)
      const lastValid = area.readUInt32LE(at + 52)
      if (lastValid !== 0 && lastValid < slot) {
        expired++
        continue
      }
      const raw = area.readBigUInt64LE(at + 16) + (area.readBigUInt64LE(at + 24) << 64n)
      orders.push({
        price: Number(raw) / 10 ** (18 - (baseDec - quoteDec)),
        size: Number(area.readBigUInt64LE(at + 32)) / 10 ** baseDec,
        side: area[at + 56] === 1 ? 'bid' : 'ask',
      })
    }
  }
  return { baseMint: key(d, 16), quoteMint: key(d, 48), orders, expired }
}

// ---- reading accounts ----

type Account = { owner: string; data: Buffer }
/** getMultipleAccounts: the accounts, null where none exists, and the slot they were read at. */
export type Accounts = (addresses: string[]) => Promise<{ slot: number; list: (Account | null)[] }>
type DepthDeps = {
  accounts: Accounts
  getJson: (url: string) => Promise<unknown>
  /** The quote token's USD price and when it was fetched. */
  usd: (mint: string) => Promise<{ usd: number; at: string }>
}

function need(d: Buffer, len: number, what: string) {
  if (d.length < len)
    throw new DepthError(
      `the ${what} account is ${d.length} bytes where its layout needs ${len}, so it is not read`,
      false,
    )
}
const key = (d: Buffer, at: number) => new PublicKey(d.subarray(at, at + 32)).toBase58()
const u64 = (d: Buffer, at: number) => d.readBigUInt64LE(at)
const u128 = (d: Buffer, at: number) => d.readBigUInt64LE(at) + (d.readBigUInt64LE(at + 8) << 64n)
const i128 = (d: Buffer, at: number) => BigInt.asIntN(128, u128(d, at))
const disc = (d: Buffer, hex: string, what: string) => {
  if (d.subarray(0, 8).toString('hex') !== hex)
    throw new DepthError(
      `the account is not a ${what}: its 8-byte discriminator does not match`,
      false,
    )
}

const SPL = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const SPL_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
const WSOL = 'So11111111111111111111111111111111111111112'

const PROGRAM = {
  manifest: 'MNFSTqtC93rEfYHB6hF82sKdZpUDFWkViLByLd1k1Ms',
  whirlpool: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
  raydiumClmm: 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
  dlmm: 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo',
  raydiumV4: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
  raydiumCpmm: 'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C',
  pumpswap: 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
  pumpfun: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
} as const
const RAYDIUM_LINE = 'https://api-v3.raydium.io/pools/line/position?id='

function decimalsOf(a: Account | null | undefined, mint: string) {
  if (!a || (a.owner !== SPL && a.owner !== SPL_2022) || a.data.length < 82 || a.data[45] !== 1)
    throw new DepthError(
      `mint ${mint} is not an initialized token mint on chain, so its decimals are unknown`,
      false,
    )
  return a.data[44]!
}
/** A token account's amount, after checking it holds the mint it should. */
function amountOf(a: Account | null | undefined, mint: string, what: string) {
  if (
    !a ||
    (a.owner !== SPL && a.owner !== SPL_2022) ||
    a.data.length < 72 ||
    key(a.data, 0) !== mint
  )
    throw new DepthError(
      `the pool's ${what} vault is missing or does not hold ${mint}, so its reserves are not read`,
      false,
    )
  return u64(a.data, 64)
}

type Built = Omit<Book, 'kind' | 'label' | 'venue' | 'pool' | 'slot' | 'fetchedAt' | 'basis'> & {
  basis: string
}
type Ctx = {
  data: Buffer
  pool: string
  mint: string
  mints: [string, string]
  /** The asked mint is the pool's first token (token0, X, base). */
  first: boolean
  dec: [number, number]
  extra: (Account | null)[]
  /** What the plan derived the extra accounts from: tick array starts or bin array indexes. */
  meta: number[]
  slot: number
  usd: number
  getJson: DepthDeps['getJson']
}
type Venue = {
  name: string
  kind: Kind
  /** From the first read: the pool's 2 mints and the other accounts to read with them. */
  plan: (
    d: Buffer,
    pool: string,
    mint: string,
  ) => { mints: [string, string]; extra: string[]; meta?: number[] }
  build: (c: Ctx) => Built | Promise<Built>
}

/** Reserves as token units, the asked mint as base. */
function curve(
  c: Ctx,
  raw0: bigint,
  raw1: bigint,
  limits: { baseOut?: number; quoteOut?: number } = {},
): Built {
  if (raw0 <= 0n || raw1 <= 0n)
    throw new DepthError(
      `the pool holds ${raw0} and ${raw1} raw units after fees, so it has no price to move`,
      false,
    )
  const r0 = Number(raw0) / 10 ** c.dec[0]
  const r1 = Number(raw1) / 10 ** c.dec[1]
  const [base, quote] = c.first ? [r0, r1] : [r1, r0]
  const { moves, unreachable } = cpMoves(base, quote, c.usd, limits)
  return {
    mid: (quote / base) * c.usd,
    bids: [],
    asks: [],
    moves,
    basis:
      `Reserves ${fmt(base)} base and ${fmt(quote)} quote. Each move is exact x times y equals k arithmetic on them, ` +
      'before the pool fee: a buy pays quoteIn (USD) and takes baseOut (base units), a sell pays baseOut and takes quoteIn. ' +
      'A curve has no resting orders, so no ladder is drawn.' +
      (unreachable.length ? ` Left out: ${unreachable.join('; ')}.` : ''),
  }
}

/** How far the ladder reaches from mid as a price factor, so the read covers all of it. */
const reach = (width: number) => 1 / (1 - LEVELS * width)
const liquidityBasis = (w: number) =>
  `Each level is a bucket of ${pct(w)} of mid, priced at its far edge; its size is the base the pool gives or takes ` +
  'across it, before the fee. AMM liquidity, not resting orders: a trade walks along it.'

/**
 * The read covers every bucket of the ladder, or the price moved past what was read. Positions
 * are ticks (step 1.0001) or bins (step 1 + binStep / 10,000).
 */
function covered(low: number, high: number, at: number, width: number, step: number) {
  const span = Math.log(reach(width)) / Math.log(step)
  if (at - span < low || at + span > high)
    throw new DepthError(
      `the price moved to ${at}, past the ${low} to ${high} read between the 2 reads; this server asks again shortly`,
    )
}
function clmmBuilt(
  c: Ctx,
  segments: Segment[],
  sqrtMid: number,
  width: number,
  basis: string,
): Built {
  const l = clLadder({
    segments,
    sqrtMid,
    baseIsToken0: c.first,
    dec0: c.dec[0],
    dec1: c.dec[1],
    usdPerQuote: c.usd,
    width,
  })
  return { ...l, moves: [], basis: `${basis} ${liquidityBasis(width)}` }
}

const TICKS_PER_ARRAY = 88
const FIXED_TICK_ARRAY = '4561bdbe6e0742bb'
const DYNAMIC_TICK_ARRAY = '11d8f68ee1c7da38'
const whirlpoolStarts = (tick: number, spacing: number) => {
  const span = TICKS_PER_ARRAY * spacing
  const reachTicks = Math.log(reach(clampWidth(1.0001 ** spacing - 1))) / Math.log(1.0001)
  const first = Math.floor((tick - reachTicks) / span) - 1
  const last = Math.floor((tick + reachTicks) / span) + 1
  const starts = []
  for (let i = first; i <= last; i++)
    if (Math.abs(i * span) <= MAX_TICK + span) starts.push(i * span)
  return starts
}
const whirlpoolState = (d: Buffer) => {
  need(d, 213, 'Orca Whirlpool')
  disc(d, '3f95d10ce1806309', 'Orca Whirlpool')
  return {
    spacing: d.readUInt16LE(41),
    liquidity: u128(d, 49),
    sqrtPrice: Number(u128(d, 65)) / 2 ** 64,
    tick: d.readInt32LE(81),
  }
}
/** Fixed arrays: 88 ticks of 113 bytes from byte 12. Dynamic: a 1-byte tag, then 112 bytes if set. */
function readTickArray(a: Account, pool: string, start: number, spacing: number) {
  const d = a.data
  const ticks: { index: number; net: bigint }[] = []
  const tag = d.subarray(0, 8).toString('hex')
  if (a.owner !== PROGRAM.whirlpool || d.length < 12 || d.readInt32LE(8) !== start)
    throw new DepthError(`the Orca tick array for tick ${start} is not this pool's`, false)
  if (tag === FIXED_TICK_ARRAY) {
    need(d, 9988, 'Orca tick array')
    if (key(d, 9956) !== pool)
      throw new DepthError(`the Orca tick array for tick ${start} belongs to another pool`, false)
    for (let k = 0; k < TICKS_PER_ARRAY; k++)
      if (d[12 + k * 113] === 1)
        ticks.push({ index: start + k * spacing, net: i128(d, 13 + k * 113) })
  } else if (tag === DYNAMIC_TICK_ARRAY) {
    need(d, 60 + TICKS_PER_ARRAY, 'Orca dynamic tick array')
    if (key(d, 12) !== pool)
      throw new DepthError(`the Orca tick array for tick ${start} belongs to another pool`, false)
    let at = 60
    for (let k = 0; k < TICKS_PER_ARRAY; k++) {
      if (d[at] === 1) {
        need(d, at + 113, 'Orca dynamic tick array')
        ticks.push({ index: start + k * spacing, net: i128(d, at + 1) })
        at += 113
      } else at += 1
    }
  } else throw new DepthError(`the Orca account for tick ${start} is not a tick array`, false)
  return ticks
}

const BINS_PER_ARRAY = 70
const BIN = 144
const binArrayIndexes = (active: number, binStep: number) => {
  const step = binStep / 10_000
  const reachBins = Math.log(reach(clampWidth(step))) / Math.log(1 + step)
  const out = []
  for (
    let i = Math.floor((active - reachBins) / BINS_PER_ARRAY) - 1;
    i <= Math.floor((active + reachBins) / BINS_PER_ARRAY) + 1;
    i++
  )
    out.push(i)
  return out
}
const dlmmState = (d: Buffer) => {
  need(d, 216, 'Meteora DLMM pair')
  disc(d, '210b3162b565b10d', 'Meteora DLMM pair')
  return { active: d.readInt32LE(76), binStep: d.readUInt16LE(80) }
}

const pda = (seeds: Buffer[], program: string) =>
  PublicKey.findProgramAddressSync(seeds, new PublicKey(program))[0].toBase58()

const VENUES: Record<string, Venue> = {
  [PROGRAM.manifest]: {
    name: 'Manifest',
    kind: 'orderbook',
    plan: (d) => {
      const m = readManifest(d, 0)
      return { mints: [m.baseMint, m.quoteMint], extra: [] }
    },
    build: (c) => {
      const m = readManifest(c.data, c.slot)
      const l = ordersLadder(c.first ? m.orders : flip(m.orders), null, c.usd)
      return {
        ...l,
        moves: [],
        basis:
          `${m.orders.length} resting orders from the Manifest market account, grouped by exact price, best ${LEVELS} a side; ` +
          `${m.expired} expired orders left out.` +
          (l.mid === null ? ' 1 side is empty, so there is no mid.' : ''),
      }
    },
  },
  [PROGRAM.whirlpool]: {
    name: 'Orca Whirlpool',
    kind: 'amm-liquidity',
    plan: (d, pool) => {
      const w = whirlpoolState(d)
      const pk = new PublicKey(pool).toBuffer()
      const starts = whirlpoolStarts(w.tick, w.spacing)
      return {
        mints: [key(d, 101), key(d, 181)],
        extra: starts.map((s) =>
          pda([Buffer.from('tick_array'), pk, Buffer.from(String(s))], PROGRAM.whirlpool),
        ),
        meta: starts,
      }
    },
    build: (c) => {
      // Starts planned from the first read; the pool itself from the second, the one used.
      const w = whirlpoolState(c.data)
      const planned = c.meta
      const ticks = c.extra.flatMap((a, i) =>
        a ? readTickArray(a, c.pool, planned[i]!, w.spacing) : [],
      )
      const lowTick = planned[0]!
      const highTick = planned.at(-1)! + TICKS_PER_ARRAY * w.spacing
      const width = clampWidth(1.0001 ** w.spacing - 1)
      covered(lowTick, highTick, w.tick, width, 1.0001)
      return clmmBuilt(
        c,
        walkTicks({
          tick: w.tick,
          liquidity: w.liquidity,
          sqrtPrice: w.sqrtPrice,
          ticks,
          lowTick,
          highTick,
        }),
        w.sqrtPrice,
        width,
        `${ticks.length} initialized ticks from ${c.extra.length} tick arrays of the pool, ticks ${lowTick} to ${highTick}, ` +
          'turned into token amounts with concentrated liquidity math.',
      )
    },
  },
  [PROGRAM.raydiumClmm]: {
    name: 'Raydium CLMM',
    kind: 'amm-liquidity',
    plan: (d) => {
      need(d, 273, 'Raydium CLMM pool')
      disc(d, 'f7ede3f5d7c3de46', 'Raydium CLMM pool')
      return { mints: [key(d, 73), key(d, 105)], extra: [] }
    },
    build: async (c) => {
      const tick = c.data.readInt32LE(269)
      const width = clampWidth(1.0001 ** c.data.readUInt16LE(235) - 1)
      const segments = lineSegments(await c.getJson(RAYDIUM_LINE + c.pool), tick, u128(c.data, 237))
      return clmmBuilt(
        c,
        segments,
        Number(u128(c.data, 253)) / 2 ** 64,
        width,
        `${segments.length} liquidity steps from Raydium's position line (api-v3.raydium.io), which matched the pool account's liquidity at tick ${tick}, ` +
          'turned into token amounts with concentrated liquidity math.',
      )
    },
  },
  [PROGRAM.dlmm]: {
    name: 'Meteora DLMM',
    kind: 'amm-liquidity',
    plan: (d, pool) => {
      const s = dlmmState(d)
      const pk = new PublicKey(pool).toBuffer()
      const indexes = binArrayIndexes(s.active, s.binStep)
      return {
        mints: [key(d, 88), key(d, 120)],
        extra: indexes.map((i) => {
          const le = Buffer.alloc(8)
          le.writeBigInt64LE(BigInt(i))
          return pda([Buffer.from('bin_array'), pk, le], PROGRAM.dlmm)
        }),
        meta: indexes,
      }
    },
    build: (c) => {
      const s = dlmmState(c.data)
      const indexes = c.meta
      const step = 1 + s.binStep / 10_000
      const scale = 10 ** (c.dec[0] - c.dec[1])
      const orders: Order[] = []
      let bins = 0
      c.extra.forEach((a, n) => {
        if (!a) return
        const i = indexes[n]!
        const d = a.data
        need(d, 56 + BINS_PER_ARRAY * BIN, 'Meteora bin array')
        if (
          a.owner !== PROGRAM.dlmm ||
          d.subarray(0, 8).toString('hex') !== '5c8e5cdc059446b5' ||
          key(d, 24) !== c.pool ||
          d.readBigInt64LE(8) !== BigInt(i)
        )
          throw new DepthError(`the Meteora bin array ${i} is not this pool's`, false)
        for (let j = 0; j < BINS_PER_ARRAY; j++) {
          const x = Number(u64(d, 56 + j * BIN)) / 10 ** c.dec[0]
          const y = Number(u64(d, 64 + j * BIN)) / 10 ** c.dec[1]
          if (x <= 0 && y <= 0) continue
          bins++
          // Price of X in Y tokens, from the bin id: (1 + binStep / 10,000) ^ id, scaled.
          const price = step ** (i * BINS_PER_ARRAY + j) * scale
          if (x > 0) orders.push({ price, size: x, side: 'ask' })
          if (y > 0) orders.push({ price, size: y / price, side: 'bid' })
        }
      })
      const width = clampWidth(s.binStep / 10_000)
      const activePrice = step ** s.active * scale
      covered(
        indexes[0]! * BINS_PER_ARRAY,
        (indexes.at(-1)! + 1) * BINS_PER_ARRAY,
        s.active,
        width,
        step,
      )
      const l = c.first
        ? ordersLadder(orders, activePrice, c.usd, width)
        : ordersLadder(flip(orders), 1 / activePrice, c.usd, width)
      return {
        ...l,
        moves: [],
        basis:
          `${bins} bins with liquidity from ${c.extra.filter(Boolean).length} bin arrays of the pair, bin step ${s.binStep} bps, mid at the active bin ${s.active}. ` +
          `A bin sits in the bucket of its own price. ${liquidityBasis(width)}`,
      }
    },
  },
  [PROGRAM.raydiumV4]: {
    name: 'Raydium AMM v4',
    kind: 'amm-curve',
    plan: (d) => {
      need(d, 752, 'Raydium AMM v4 pool')
      return { mints: [key(d, 400), key(d, 432)], extra: [key(d, 336), key(d, 368)] }
    },
    // Reserves are the vaults less the profit the pool owes out (need_take_pnl).
    build: (c) =>
      curve(
        c,
        amountOf(c.extra[0], c.mints[0], 'base') - u64(c.data, 192),
        amountOf(c.extra[1], c.mints[1], 'quote') - u64(c.data, 200),
      ),
  },
  [PROGRAM.raydiumCpmm]: {
    name: 'Raydium CPMM',
    kind: 'amm-curve',
    plan: (d) => {
      need(d, 413, 'Raydium CPMM pool')
      disc(d, 'f7ede3f5d7c3de46', 'Raydium CPMM pool')
      return { mints: [key(d, 168), key(d, 200)], extra: [key(d, 72), key(d, 104)] }
    },
    // Reserves are the vaults less protocol, fund and creator fees (vault_amount_without_fee).
    build: (c) =>
      curve(
        c,
        amountOf(c.extra[0], c.mints[0], 'token0') -
          u64(c.data, 341) -
          u64(c.data, 357) -
          u64(c.data, 397),
        amountOf(c.extra[1], c.mints[1], 'token1') -
          u64(c.data, 349) -
          u64(c.data, 365) -
          u64(c.data, 405),
      ),
  },
  [PROGRAM.pumpswap]: {
    name: 'PumpSwap',
    kind: 'amm-curve',
    plan: (d) => {
      need(d, 203, 'PumpSwap pool')
      disc(d, 'f19a6d0411b16dbc', 'PumpSwap pool')
      return { mints: [key(d, 43), key(d, 75)], extra: [key(d, 139), key(d, 171)] }
    },
    build: (c) =>
      curve(c, amountOf(c.extra[0], c.mints[0], 'base'), amountOf(c.extra[1], c.mints[1], 'quote')),
  },
  [PROGRAM.pumpfun]: {
    name: 'pump.fun bonding curve',
    kind: 'amm-curve',
    plan: (d, pool, mint) => {
      need(d, 49, 'pump.fun bonding curve')
      disc(d, '17b7f83760d8ac60', 'pump.fun bonding curve')
      // The curve does not name its mint; it is the PDA of it, so the asked mint must derive it.
      if (
        pda([Buffer.from('bonding-curve'), new PublicKey(mint).toBuffer()], PROGRAM.pumpfun) !==
        pool
      )
        throw new DepthError(
          `pool ${pool} is not the pump.fun bonding curve of mint ${mint}`,
          false,
        )
      return { mints: [mint, WSOL], extra: [] }
    },
    build: (c) => {
      if (c.data[48] === 1)
        throw new DepthError(
          `the pump.fun curve ${c.pool} is complete: the token graduated and trades in its AMM pool now`,
          false,
        )
      // Priced on virtual reserves; what a trade can take is capped by the real ones.
      const b = curve(c, u64(c.data, 8), u64(c.data, 16), {
        baseOut: Number(u64(c.data, 24)) / 10 ** c.dec[0],
        quoteOut: Number(u64(c.data, 32)) / 10 ** c.dec[1],
      })
      return {
        ...b,
        basis: `Virtual reserves of the curve; a trade is capped by its real reserves. ${b.basis}`,
      }
    },
  },
}
const READ = [...new Set(Object.values(VENUES).map((v) => v.name))].join(', ')

export function createDepth(deps: DepthDeps) {
  /** The book of 1 pool, with the asked mint as base. Throws a DepthError that says why. */
  const book = async (pool: string, mint: string): Promise<Book> => {
    const first = await deps.accounts([pool])
    const acc = first.list[0]
    if (!acc)
      throw new DepthError(
        `pool ${pool} has no account on chain at slot ${first.slot}; it may have closed since GeckoTerminal listed it`,
      )
    const venue = VENUES[acc.owner]
    if (!venue)
      throw new DepthError(
        `pool ${pool} is owned by program ${acc.owner}, which this server does not read; it reads ${READ}. The rest of /market still answers`,
        false,
      )
    const plan = venue.plan(acc.data, pool, mint)
    if (!plan.mints.includes(mint))
      throw new DepthError(
        `pool ${pool} holds ${plan.mints[0]} and ${plan.mints[1]}, not the mint ${mint} asked for`,
        false,
      )
    const second = await deps.accounts([pool, ...plan.mints, ...plan.extra])
    const [again, m0, m1, ...extra] = second.list
    if (!again || again.owner !== acc.owner)
      throw new DepthError(`pool ${pool} changed owner or closed between 2 reads`)
    const isFirst = plan.mints[0] === mint
    const quote = await deps.usd(isFirst ? plan.mints[1] : plan.mints[0])
    const built = await venue.build({
      data: again.data,
      pool,
      mint,
      mints: plan.mints,
      first: isFirst,
      dec: [decimalsOf(m0, plan.mints[0]), decimalsOf(m1, plan.mints[1])],
      extra,
      meta: plan.meta ?? [],
      slot: second.slot,
      usd: quote.usd,
      getJson: deps.getJson,
    })
    return {
      kind: venue.kind,
      label: LABELS[venue.kind],
      venue: venue.name,
      pool,
      slot: second.slot,
      fetchedAt: new Date().toISOString(),
      mid: built.mid,
      bids: built.bids,
      asks: built.asks,
      moves: built.moves,
      basis:
        `Read from the ${venue.name} accounts at slot ${second.slot}. ${built.basis} ` +
        `Prices in USD: the quote token at $${quote.usd} from GeckoTerminal at ${quote.at}. Size in base token units.`,
    }
  }
  return { book }
}

// ---- the live chain ----

const TIMEOUT_MS = 10_000

/** GET JSON. A failure names the host and status, never the URL's query. */
async function getJson(url: string): Promise<unknown> {
  const host = new URL(url).host
  let res: Response
  try {
    res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (e) {
    throw new DepthError(
      `${host} did not answer within ${TIMEOUT_MS / 1000} s (${e instanceof Error ? e.name : 'error'})`,
    )
  }
  if (!res.ok) throw new DepthError(`${host} answered ${res.status}`)
  return res.json()
}

/** getMultipleAccounts on Helius. The URL carries the key, so no message ever includes it. */
async function heliusAccounts(addresses: string[]) {
  if (mode() === 'replay')
    throw new DepthError(
      'AGON_NET_MODE is replay, so this server reads no pool accounts. Set AGON_NET_MODE=live and HELIUS_API_KEY on the server and restart it',
      false,
    )
  if (!process.env['HELIUS_API_KEY'])
    throw new DepthError(
      'HELIUS_API_KEY is not set on the server, so no pool account can be read. Set it and restart the server',
      false,
    )
  const req = rpcCall('getMultipleAccounts', [
    addresses,
    { encoding: 'base64', commitment: 'confirmed' },
  ])
  let res: Response
  try {
    res = await fetch(req.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (e) {
    throw new DepthError(
      `the RPC did not answer within ${TIMEOUT_MS / 1000} s (${e instanceof Error ? e.name : 'error'})`,
    )
  }
  if (!res.ok) throw new DepthError(`the RPC answered ${res.status}`)
  const body = obj(await res.json())
  const result = obj(body['result'])
  const slot = obj(result['context'])['slot']
  const value = result['value']
  if (typeof slot !== 'number' || !Array.isArray(value) || value.length !== addresses.length)
    throw new DepthError(
      `the RPC answered getMultipleAccounts without ${addresses.length} accounts and a slot${body['error'] ? `: error ${obj(body['error'])['code']}` : ''}`,
    )
  const list = value.map((v) => {
    if (v === null) return null
    const owner = obj(v)['owner']
    const data = obj(v)['data']
    if (typeof owner !== 'string' || !Array.isArray(data) || typeof data[0] !== 'string')
      throw new DepthError('the RPC answered an account with no owner or base64 data')
    return { owner, data: Buffer.from(data[0], 'base64') }
  })
  return { slot, list }
}

/** The live reader: Helius for accounts, plain fetch for Raydium's line. */
export const liveChain = { accounts: heliusAccounts as Accounts, getJson }
