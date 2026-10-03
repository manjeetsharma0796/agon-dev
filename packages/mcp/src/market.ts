// GET /market?mint=&range=: the trade view's data, from GeckoTerminal's keyless API.
//
// The mint's busiest pool, its candles for 1 range with indicators, its recent trades and 24h
// stats. Every block is stamped with the pool it came from and the time it was fetched.
//
// Budget: GeckoTerminal's free tier allows about 30 calls a minute for the whole server, however
// many screens are open. So every upstream call goes through 1 queue that starts a call at most
// every 2.1 s (at most 29 starts in any 60 s), and every answer is cached by pool, mint and range
// (candles 60 s, trades 30 s, the pool choice 10 min), with 1 shared promise while a fetch is in
// flight, so 10 clients asking at once cost 1 call. Lessons from .opencode/tui/agon-discovery.tsx,
// where 10 sparklines asked at once got 429 on every one.
//
// The book (T-C35, depth.ts) is read from the chosen pool's own accounts on Helius, a separate
// budget; the only GeckoTerminal call it adds is the quote token's USD price, cached 60 s per
// quote mint, so a screen of SOL-paired tokens shares 1 call a minute.
//
// Outside text is data, and token names reach no agent: GeckoTerminal sends pool and token
// names, and none of them is returned here. The T-C33 row does not ask for a name, so the answer
// carries the mint and pool addresses only. Every address read from GeckoTerminal is checked as base58 before it goes
// into a URL or the answer.

import type { ServerResponse } from 'node:http'
import { Address } from '@agon/core'
import { PublicKey } from '@solana/web3.js'
import { createDepth, DepthError, liveChain, type Accounts } from './depth.js'
import { indicators } from './indicators.js'

const GT = 'https://api.geckoterminal.com/api/v2/networks/solana'
/** Prices are under /simple, outside the network path. */
const GT_PRICE = 'https://api.geckoterminal.com/api/v2/simple/networks/solana/token_price'

/** The ranges a chart can ask for, mapped to GeckoTerminal's timeframe and aggregate. */
const RANGES = {
  '1m': { timeframe: 'minute', aggregate: 1, stepS: 60 },
  '5m': { timeframe: 'minute', aggregate: 5, stepS: 300 },
  '15m': { timeframe: 'minute', aggregate: 15, stepS: 900 },
  '1h': { timeframe: 'hour', aggregate: 1, stepS: 3_600 },
  '4h': { timeframe: 'hour', aggregate: 4, stepS: 14_400 },
  '12h': { timeframe: 'hour', aggregate: 12, stepS: 43_200 },
  '1d': { timeframe: 'day', aggregate: 1, stepS: 86_400 },
} as const
type Range = keyof typeof RANGES
const RANGE_LIST = Object.keys(RANGES).join(', ')

/** 100 candles: enough for MACD's 26 + 9 and a screen of chart. */
const CANDLES = 100
const TRADES = 50
/** The book 10 s: it changes every slot, and 10 s is 2 RPC calls a pool, not 1 a slot. */
const TTL = {
  pool: 10 * 60_000,
  candles: 60_000,
  trades: 30_000,
  book: 10_000,
  usd: 60_000,
  failure: 15_000,
}
/** 60 / 2.1 = 28.6, so at most 29 starts in any 60 s window, under the 30 a minute limit. */
export const SPACING_MS = 2_100
/** 30 waiting calls is about 63 s of queue. Past that, saying so beats a request that hangs. */
const MAX_WAITING = 30
const TIMEOUT_MS = 10_000

/**
 * Fetches 1 URL and returns its parsed JSON, or throws an error carrying the HTTP `status` when
 * there was one. Swapped out in tests.
 */
export type Upstream = (url: string) => Promise<unknown>

class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message)
  }
}

const httpGet: Upstream = async (url) => {
  let res: Response
  try {
    res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (e) {
    const timedOut = e instanceof Error && e.name === 'TimeoutError'
    throw new UpstreamError(
      timedOut
        ? `GeckoTerminal did not answer within ${TIMEOUT_MS / 1000} s`
        : `GeckoTerminal could not be reached (${e instanceof Error ? e.message : String(e)})`,
    )
  }
  if (!res.ok) throw new UpstreamError(`GeckoTerminal answered ${res.status}`, res.status)
  return res.json()
}

/** A failure with its cause, its number and what to do next, never a bare "failed". */
const statusOf = (e: unknown) =>
  e && typeof e === 'object' && 'status' in e && typeof e.status === 'number' ? e.status : null

const failure = (what: string, e: unknown): string => {
  const retry = `This server asks again after ${TTL.failure / 1000} s, so retry then.`
  if (statusOf(e) === 429)
    return `${what}: GeckoTerminal answered 429, its free limit of about 30 calls a minute was hit. ${retry}`
  return `${what}: ${e instanceof Error ? e.message : String(e)}. ${retry}`
}

// Shapes read from GeckoTerminal. Everything is unknown until checked.
type Json = Record<string, unknown>
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {})
const finite = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/
const DECIMAL = /^\d+(\.\d+)?$/

/** A Solana address that decodes to 32 bytes and back to the same text, or null. */
function solanaAddress(v: unknown): string | null {
  if (!Address.safeParse(v).success) return null
  try {
    return new PublicKey(v as string).toBase58() === v ? (v as string) : null
  } catch {
    return null
  }
}

type Candle = {
  t: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}
type Gap = { from: number | null; to: number | null; missing: number; reason: string }

/**
 * Candles oldest first, and every hole named. GeckoTerminal sends no candle for a bucket with no
 * trade, and a chart that joins across it draws a move that never happened, so a hole is a gap
 * with its size and reason, never filled. Pure.
 */
export function readCandles(raw: unknown, stepS: number, nowS: number) {
  const list = obj(obj(obj(raw)['data'])['attributes'])['ohlcv_list']
  const rows = Array.isArray(list) ? list : []
  const byTime = new Map<number, Candle>()
  const bad: number[] = []
  let unreadable = 0
  for (const r of rows) {
    const v = Array.isArray(r) ? r.map(finite) : []
    const [t, open, high, low, close, volume] = v
    if (t == null) unreadable++
    else if (open == null || high == null || low == null || close == null || volume == null)
      bad.push(t)
    else byTime.set(t, { t, open, high, low, close, volume })
  }
  const candles = [...byTime.values()].sort((a, b) => a.t - b.t)

  const gaps: Gap[] = []
  const hole = (from: number, to: number) => {
    const missing = Math.round((to - from) / stepS) - 1
    if (missing <= 0) return
    const broken = bad.filter((t) => t > from && t < to).length
    gaps.push({
      from: from + stepS,
      to: to - stepS,
      missing,
      reason:
        (broken
          ? `${broken} of these ${missing} candles arrived with a missing or non-finite value and were left out; `
          : '') +
        `GeckoTerminal sent no usable candle for ${missing} bucket${missing === 1 ? '' : 's'} of ${stepS} s, ` +
        'usually no trade in the pool then; not filled',
    })
  }
  for (let i = 1; i < candles.length; i++) hole(candles[i - 1]!.t, candles[i]!.t)
  // Buckets missing between the last candle and the one now forming.
  const forming = Math.floor(nowS / stepS) * stepS
  const last = candles.at(-1)
  if (last) hole(last.t, forming)
  if (unreadable)
    gaps.push({
      from: null,
      to: null,
      missing: unreadable,
      reason: `${unreadable} candle${unreadable === 1 ? '' : 's'} had no readable time and were left out`,
    })
  // A broken candle outside every hole (before the first good one, or the one forming) is still
  // named, once.
  const outside = bad.filter((t) => !last || t < candles[0]!.t || t >= forming).length
  if (outside)
    gaps.push({
      from: null,
      to: null,
      missing: outside,
      reason: `${outside} candle${outside === 1 ? '' : 's'} at the edge of the range arrived with a missing or non-finite value and were left out`,
    })
  return { candles, gaps }
}

/** 24h price, change, high, low and volume, by arithmetic over the hourly candles. Pure. */
export function stats24h(hourly: readonly Candle[], nowS: number) {
  const from = Math.floor(nowS / 3_600) * 3_600 - 23 * 3_600
  const day = hourly.filter((c) => c.t >= from)
  const first = day[0]
  const last = day.at(-1)
  if (!first || !last) return null
  const missing = 24 - day.length
  return {
    price: last.close,
    priceAt: new Date(last.t * 1000).toISOString(),
    changePct: ((last.close - first.open) / first.open) * 100,
    high: Math.max(...day.map((c) => c.high)),
    low: Math.min(...day.map((c) => c.low)),
    volumeUsd: day.reduce((s, c) => s + c.volume, 0),
    unit: 'USD',
    method:
      `Arithmetic over ${day.length} hourly GeckoTerminal candles from ${new Date(from * 1000).toISOString()} to now. ` +
      `Price is the latest close, change is that close against the open at ${new Date(first.t * 1000).toISOString()}, ` +
      `high, low and volume cover the same candles.` +
      (missing
        ? ` ${missing} of 24 hours had no candle, usually no trade, and are not filled.`
        : ''),
  }
}

/** Recent trades, newest first, from the mint's side: buy means the mint was received. Pure. */
export function readTrades(raw: unknown, mint: string) {
  const data = obj(raw)['data']
  const rows = Array.isArray(data) ? data : []
  const trades = []
  let skipped = 0
  for (const r of rows) {
    const a = obj(obj(r)['attributes'])
    const buy = a['to_token_address'] === mint
    const sell = a['from_token_address'] === mint
    const amount = buy ? a['to_token_amount'] : a['from_token_amount']
    const priceUsd = finite(buy ? a['price_to_in_usd'] : a['price_from_in_usd'])
    const volumeUsd = finite(a['volume_in_usd'])
    const slot = finite(a['block_number'])
    const time = Date.parse(String(a['block_timestamp']))
    const wallet = solanaAddress(a['tx_from_address'])
    const signature =
      typeof a['tx_hash'] === 'string' && SIGNATURE.test(a['tx_hash']) ? a['tx_hash'] : null
    if (
      buy === sell ||
      typeof amount !== 'string' ||
      !DECIMAL.test(amount) ||
      priceUsd == null ||
      volumeUsd == null ||
      slot == null ||
      !Number.isFinite(time) ||
      !wallet ||
      !signature
    ) {
      skipped++
      continue
    }
    trades.push({
      time: new Date(time).toISOString(),
      slot,
      side: buy ? 'buy' : 'sell',
      amount,
      priceUsd,
      volumeUsd,
      wallet,
      signature,
    })
  }
  trades.sort((x, y) => y.slot - x.slot)
  return {
    list: trades.slice(0, TRADES),
    leftOut:
      skipped === 0
        ? null
        : `${skipped} of ${rows.length} trades from GeckoTerminal were left out: not this mint on exactly 1 side, or a field missing or malformed`,
  }
}

type Entry = { at: number; ttl: number; settled: boolean; promise: Promise<unknown> }
/** Entries kept. 4 per mint, so about 250 mints on screen at once before the oldest go. */
const MAX_ENTRIES = 1_000

export function createMarket(
  upstream: Upstream = httpGet,
  spacingMs = SPACING_MS,
  chain: { accounts: Accounts; getJson: (url: string) => Promise<unknown> } = liveChain,
) {
  // 1 queue: calls start 1 at a time, at least `spacingMs` apart.
  let tail: Promise<unknown> = Promise.resolve()
  let nextAt = 0
  let waiting = 0
  const queued = (url: string): Promise<unknown> => {
    if (waiting >= MAX_WAITING)
      return Promise.reject(
        new UpstreamError(
          `${waiting} GeckoTerminal calls are already waiting, about ${Math.ceil((waiting * spacingMs) / 1000)} s at 1 call every ${spacingMs / 1000} s`,
        ),
      )
    waiting++
    const run = tail.then(async () => {
      const wait = nextAt - Date.now()
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      nextAt = Date.now() + spacingMs
      waiting--
      return upstream(url)
    })
    tail = run.catch(() => undefined)
    return run
  }

  // 1 cache, with the in-flight promise shared, so concurrent askers wait on 1 call.
  const cache = new Map<string, Entry>()
  const cached = <T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> => {
    const now = Date.now()
    const hit = cache.get(key)
    if (hit && (!hit.settled || now - hit.at < hit.ttl)) return hit.promise as Promise<T>
    // Bounded, so a loop asking for random mints cannot grow it: expired entries go first, then
    // the oldest. Map keeps insertion order, so the first keys are the oldest.
    if (cache.size >= MAX_ENTRIES) {
      for (const [k, e] of cache) if (e.settled && now - e.at >= e.ttl) cache.delete(k)
      for (const k of cache.keys()) if (cache.size >= MAX_ENTRIES) cache.delete(k)
    }
    const entry: Entry = { at: now, ttl, settled: false, promise: load() }
    entry.promise.then(
      () => Object.assign(entry, { at: Date.now(), settled: true }),
      () => Object.assign(entry, { at: Date.now(), settled: true, ttl: TTL.failure }),
    )
    cache.set(key, entry)
    return entry.promise as Promise<T>
  }
  const fetchedAt = () => new Date().toISOString()

  const pool = (mint: string) =>
    cached(`pool:${mint}`, TTL.pool, async () => {
      // GeckoTerminal answers 404 for a mint it does not list, which is "no pool", not an outage.
      const body = await queued(`${GT}/tokens/${mint}/pools?page=1`).catch((e: unknown) => {
        throw statusOf(e) === 404 ? new NoPool(mint) : e
      })
      const data = obj(body)['data']
      // Ranked by 24h volume, not reserve. Measured 2026-10-03: SOL's largest reserve was a pumpswap
      // pool reporting $217.9M against $0.72M of volume, whose 1m candles were 21 h old. A pool
      // paired with a mispriced token reports a reserve it does not have; volume costs fees to fake.
      const best = (Array.isArray(data) ? data : [])
        .map((p) => obj(obj(p)['attributes']))
        .map((a) => ({
          address: solanaAddress(a['address']),
          volume: finite(obj(a['volume_usd'])['h24']) ?? 0,
        }))
        .filter((p): p is { address: string; volume: number } => p.address !== null)
        .sort((x, y) => y.volume - x.volume)[0]
      if (!best) throw new NoPool(mint)
      return { address: best.address, volume24hUsd: best.volume, fetchedAt: fetchedAt() }
    })

  // Keyed by pool, mint and range: 2 mints can share a top pool and are priced from their own side.
  const series = (poolAddress: string, mint: string, range: Range) =>
    cached(`candles:${poolAddress}:${mint}:${range}`, TTL.candles, async () => {
      const r = RANGES[range]
      const body = await queued(
        `${GT}/pools/${poolAddress}/ohlcv/${r.timeframe}?aggregate=${r.aggregate}&limit=${CANDLES}&token=${mint}&currency=usd`,
      )
      return { fetchedAt: fetchedAt(), ...readCandles(body, r.stepS, Date.now() / 1000) }
    })

  const trades = (poolAddress: string, mint: string) =>
    cached(`trades:${poolAddress}:${mint}`, TTL.trades, async () => {
      const body = await queued(`${GT}/pools/${poolAddress}/trades`)
      return { fetchedAt: fetchedAt(), ...readTrades(body, mint) }
    })

  // The quote token's USD price, which turns a pool's price into the USD the rest of /market uses.
  const usd = (mint: string) =>
    cached(`usd:${mint}`, TTL.usd, async () => {
      const body = await queued(`${GT_PRICE}/${mint}`)
      const v = finite(obj(obj(obj(obj(body)['data'])['attributes'])['token_prices'])[mint])
      if (v === null || v <= 0)
        throw new DepthError(
          `GeckoTerminal has no USD price for the quote token ${mint}, so the book cannot be priced in USD`,
        )
      return { usd: v, at: fetchedAt() }
    })
  const depth = createDepth({ ...chain, usd })
  const book = (poolAddress: string, mint: string) =>
    cached(`book:${poolAddress}:${mint}`, TTL.book, () => depth.book(poolAddress, mint))

  /** The whole answer for 1 mint and range. Each block fails on its own and says why. */
  const get = async (mint: string, range: Range) => {
    const p = await pool(mint)
    const at = { pool: p.address }
    // Candles first in the queue: they are what the screen is waiting for.
    const [chart, hourly, recent, depthRead] = await Promise.allSettled([
      series(p.address, mint, range),
      series(p.address, mint, '1h'),
      trades(p.address, mint),
      book(p.address, mint),
    ])
    const r = RANGES[range]
    return {
      mint,
      range,
      source: 'GeckoTerminal, Solana mainnet',
      pool: {
        address: p.address,
        volume24hUsd: p.volume24hUsd,
        fetchedAt: p.fetchedAt,
        choice: 'the pool with the most 24h volume in USD among the first 20 GeckoTerminal lists',
      },
      candles:
        chart.status === 'fulfilled'
          ? {
              ...at,
              fetchedAt: chart.value.fetchedAt,
              stepSeconds: r.stepS,
              unit: 'USD per token; t is the bucket start in Unix seconds',
              list: chart.value.candles,
              gaps: chart.value.gaps,
            }
          : { ...at, error: failure(`Candles for ${range}`, chart.reason) },
      indicators:
        chart.status === 'fulfilled'
          ? {
              ...at,
              fetchedAt: chart.value.fetchedAt,
              basis: `${chart.value.candles.length} candles above, index for index; ${chart.value.gaps.length} gaps not filled, so a window across a gap spans more time than its length`,
              ...indicators(
                chart.value.candles.map((c) => c.close),
                chart.value.candles.map((c) => c.volume),
              ),
            }
          : { ...at, error: 'Indicators need the candles, which failed above.' },
      stats24h: (() => {
        if (hourly.status === 'rejected')
          return { ...at, error: failure('24h stats', hourly.reason) }
        const s = stats24h(hourly.value.candles, Date.now() / 1000)
        return s
          ? { ...at, fetchedAt: hourly.value.fetchedAt, ...s }
          : {
              ...at,
              fetchedAt: hourly.value.fetchedAt,
              error: `24h stats: pool ${p.address} has 0 hourly candles in the last 24 hours, usually no trade. Pick a mint that trades, or try again later.`,
            }
      })(),
      trades:
        recent.status === 'fulfilled'
          ? { ...at, ...recent.value }
          : { ...at, error: failure('Recent trades', recent.reason) },
      book:
        depthRead.status === 'fulfilled'
          ? { ...depthRead.value, ttlSeconds: TTL.book / 1000 }
          : {
              error:
                depthRead.reason instanceof DepthError && !depthRead.reason.retry
                  ? `Order book: ${depthRead.reason.message}.`
                  : failure('Order book', depthRead.reason),
            },
    }
  }

  return { get }
}

class NoPool extends Error {
  constructor(mint: string) {
    super(
      `GeckoTerminal lists no pool with a readable address for mint ${mint}. A new token usually gets its first pool minutes after launch; try again in ${TTL.failure / 1000} s.`,
    )
  }
}

/** 1 market for the process, so every client shares the cache and the queue. */
const shared = createMarket()

const send = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

/** The HTTP handler for GET /market. The mint is checked here, the trust boundary. */
export async function serveMarket(url: URL, res: ServerResponse, market = shared): Promise<void> {
  const raw = url.searchParams.get('mint') ?? ''
  const mint = solanaAddress(raw)
  if (!mint) {
    // The input is not echoed: it is outside text. Its length is the number that helps.
    send(res, 400, {
      error: `mint must be a Solana mint address: base58, 32 to 44 characters, decoding to 32 bytes; got ${raw.length} characters that are not one. Pass /market?mint=<address>&range=<${RANGE_LIST}>.`,
    })
    return
  }
  const range = url.searchParams.get('range') ?? '1h'
  if (!Object.hasOwn(RANGES, range)) {
    send(res, 400, {
      error: `range must be 1 of ${Object.keys(RANGES).length}: ${RANGE_LIST}; got ${range.length} characters that are not one.`,
    })
    return
  }
  try {
    send(res, 200, await market.get(mint, range as Range))
  } catch (e) {
    if (e instanceof NoPool) send(res, 404, { mint, error: e.message })
    else send(res, 502, { mint, error: failure(`Pool lookup for mint ${mint}`, e) })
  }
}
