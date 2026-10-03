/** @jsxImportSource @opentui/solid */
// Agon discovery inside opencode.
//
// - A live sidebar panel for your watchlist.
// - A full-screen page (`/discover`, or "Agon discovery" in the command palette) with Jupiter's
//   trending, most traded, top organic or newest tokens, sortable and searchable, with a detail pane,
//   a large logo and a braille price chart for the selected token. The sidebar has 24h sparklines.
// - Quick actions that hand an instruction to the opencode agent: b buy, x sell, c check. They
//   only ever fill the chat box. You read it and press Enter; the agent then runs Agon's check_trade
//   before anything is built, and your wallet signs. This plugin never signs, sends or reads keys,
//   and the only token field it hands the agent is the mint, never a token's own name or symbol.
//
// - Mouse: click a row to select it, the wheel scrolls the list, column titles sort, and the chips
//   and buttons do what their keys do. Clicking a sidebar token opens the page on it.
//
// - A trade view (`/trade`, Enter on a token, or "Agon trade") drawn from the Agon server's
//   /market, /status and /stream: candles, MA and EMA, the book or depth, recent trades and a
//   status line. It lives in agon-trade.tsx.
//
// - A setup page (`/agon-setup`, or "Agon setup") that shows where onboarding stands: whether the
//   Agon server answers, and what the wallet's vault holds through `list_rules`. It reads only
//   public data. Arming, funding and revoking stay on the web screen, where the wallet signs; the
//   page opens it and can start "onboard me" in the chat.
//
// Keep the .tsx extension. opencode runs babel-preset-solid only over .tsx and .jsx plugin files;
// a .ts file still renders once and then silently never updates.
//
// Logos are drawn as half-block characters, 2 pixels per cell, because the OpenTUI build inside
// opencode 1.18.33 has no image element for plugins. Each is fetched once as a small PNG through an
// image proxy, decoded here and cached for the life of the process.

import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  For,
  on,
  onCleanup,
  Show,
} from 'solid-js'
import { useKeyboard, useTerminalDimensions } from '@opentui/solid'
import { inflateSync } from 'node:zlib'
import { spawn } from 'node:child_process'
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from '@opencode-ai/plugin/tui'

const ID = 'agon-discovery'
const ROUTE = 'agon.discovery'
const JUP = 'https://lite-api.jup.ag/tokens/v2'
const WATCH_KEY = 'agon.discovery.watchlist'
const VIEW_KEY = 'agon.discovery.view'
export const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

const DEFAULT_WATCHLIST = [
  'So11111111111111111111111111111111111111112',
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',
]

type Options = { refreshMs: number; limit: number; mcpUrl: string; armUrl: string }
// Only http and https, and only from the user's own tui.json: the setup page fetches the first and
// opens the second in a browser.
const httpUrl = (v: unknown, fallback: string) => {
  try {
    const u = new URL(String(v))
    return u.protocol === 'http:' || u.protocol === 'https:'
      ? u.toString().replace(/\/$/, '')
      : fallback
  } catch {
    return fallback
  }
}
const toOptions = (raw: unknown): Options => {
  const o = (raw ?? {}) as Partial<Options>
  return {
    refreshMs: typeof o.refreshMs === 'number' && o.refreshMs >= 5_000 ? o.refreshMs : 15_000,
    limit: typeof o.limit === 'number' && o.limit > 0 ? Math.min(o.limit, 100) : 50,
    mcpUrl: httpUrl(o.mcpUrl, 'http://127.0.0.1:8787'),
    armUrl: httpUrl(o.armUrl, 'http://localhost:3111/arm'),
  }
}

/* ---------------------------------------------------------------------------------------------- */
/* data                                                                                            */
/* ---------------------------------------------------------------------------------------------- */

type Token = {
  mint: string
  symbol: string
  name: string
  icon: string | null
  price: number | null
  change5m: number | null
  change1h: number | null
  change24h: number | null
  volume24h: number | null
  liquidity: number | null
  mcap: number | null
  holders: number | null
  holderChange1h: number | null
  buys1h: number | null
  sells1h: number | null
  traders1h: number | null
  organic: number | null
  organicLabel: string | null
  verified: boolean
  mintAuthorityOff: boolean | null
  freezeAuthorityOff: boolean | null
  topHoldersPct: number | null
  devPct: number | null
  tags: string[]
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null)

const toToken = (t: Record<string, any>): Token => {
  const buy = num(t.stats24h?.buyVolume)
  const sell = num(t.stats24h?.sellVolume)
  return {
    mint: String(t.id),
    symbol: typeof t.symbol === 'string' ? t.symbol : String(t.id).slice(0, 4),
    name: typeof t.name === 'string' ? t.name : '',
    icon: typeof t.icon === 'string' ? t.icon : null,
    price: num(t.usdPrice),
    change5m: num(t.stats5m?.priceChange),
    change1h: num(t.stats1h?.priceChange),
    change24h: num(t.stats24h?.priceChange),
    volume24h: buy !== null && sell !== null ? buy + sell : null,
    liquidity: num(t.liquidity),
    mcap: num(t.mcap),
    holders: num(t.holderCount),
    holderChange1h: num(t.stats1h?.holderChange),
    buys1h: num(t.stats1h?.numBuys),
    sells1h: num(t.stats1h?.numSells),
    traders1h: num(t.stats1h?.numTraders),
    organic: num(t.organicScore),
    organicLabel: typeof t.organicScoreLabel === 'string' ? t.organicScoreLabel : null,
    verified: t.isVerified === true,
    mintAuthorityOff: bool(t.audit?.mintAuthorityDisabled),
    freezeAuthorityOff: bool(t.audit?.freezeAuthorityDisabled),
    topHoldersPct: num(t.audit?.topHoldersPercentage),
    devPct: num(t.audit?.devBalancePercentage),
    tags: Array.isArray(t.tags) ? t.tags.filter((x: unknown) => typeof x === 'string') : [],
  }
}

async function getTokens(url: string): Promise<Token[]> {
  let res: Response
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  } catch (e) {
    throw new Error(`Jupiter unreachable (${e instanceof Error ? e.message : String(e)})`)
  }
  if (!res.ok) throw new Error(`Jupiter answered ${res.status}`)
  const body = (await res.json()) as unknown
  if (!Array.isArray(body)) throw new Error('Jupiter answered something that is not a token list')
  // The mint is the only token field that reaches the agent, so a row whose mint is not a Solana
  // address is dropped rather than carried.
  return body.map((t) => toToken(t as Record<string, any>)).filter((t) => BASE58.test(t.mint))
}

type Source = { label: string; path: string; interval: boolean }
const SOURCES: Source[] = [
  { label: 'trending', path: 'toptrending', interval: true },
  { label: 'most traded', path: 'toptraded', interval: true },
  { label: 'top organic', path: 'toporganicscore', interval: true },
  { label: 'new', path: 'recent', interval: false },
]
const INTERVALS = ['5m', '1h', '6h', '24h']

/* ---------------------------------------------------------------------------------------------- */
/* logos, as half-block pixels                                                                     */
/* ---------------------------------------------------------------------------------------------- */

type Pixels = { w: number; h: number; rgba: Uint8Array }

// Minimal PNG decoder: 8-bit, non-interlaced, colour types 0, 2, 3, 4 and 6. The proxy returns
// exactly that, so anything else is treated as "no logo" rather than guessed at.
function decodePng(buf: Uint8Array): Pixels {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let p = 8
  let w = 0
  let h = 0
  let depth = 0
  let type = 0
  let interlace = 0
  const idat: Uint8Array[] = []
  let pal: Uint8Array | null = null
  let trns: Uint8Array | null = null
  while (p + 8 <= buf.length) {
    const len = dv.getUint32(p)
    const kind = String.fromCharCode(buf[p + 4]!, buf[p + 5]!, buf[p + 6]!, buf[p + 7]!)
    const d = buf.subarray(p + 8, p + 8 + len)
    if (kind === 'IHDR') {
      w = dv.getUint32(p + 8)
      h = dv.getUint32(p + 12)
      depth = d[8]!
      type = d[9]!
      interlace = d[12]!
    } else if (kind === 'PLTE') pal = d
    else if (kind === 'tRNS') trns = d
    else if (kind === 'IDAT') idat.push(d)
    else if (kind === 'IEND') break
    p += 12 + len
  }
  const ch = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[type]
  if (depth !== 8 || interlace !== 0 || !ch || (type === 3 && !pal))
    throw new Error('unsupported png')
  const raw = inflateSync(Buffer.concat(idat))
  const stride = w * ch
  const out = new Uint8Array(w * h * 4)
  const prev = new Uint8Array(stride)
  const cur = new Uint8Array(stride)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]!
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch]! : 0
      const b = prev[i]!
      const c = i >= ch ? prev[i - ch]! : 0
      const pa = Math.abs(b - c)
      const pb = Math.abs(a - c)
      const pc = Math.abs(a + b - 2 * c)
      const pred =
        f === 1
          ? a
          : f === 2
            ? b
            : f === 3
              ? (a + b) >> 1
              : f === 4
                ? pa <= pb && pa <= pc
                  ? a
                  : pb <= pc
                    ? b
                    : c
                : 0
      cur[i] = (line[i]! + pred) & 255
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      const s = x * ch
      if (type === 6) out.set(cur.subarray(s, s + 4), o)
      else if (type === 2) {
        out.set(cur.subarray(s, s + 3), o)
        out[o + 3] = 255
      } else if (type === 0 || type === 4) {
        out[o] = out[o + 1] = out[o + 2] = cur[s]!
        out[o + 3] = type === 4 ? cur[s + 1]! : 255
      } else {
        const k = cur[s]!
        out[o] = pal![k * 3]!
        out[o + 1] = pal![k * 3 + 1]!
        out[o + 2] = pal![k * 3 + 2]!
        out[o + 3] = trns && k < trns.length ? trns[k]! : 255
      }
    }
    prev.set(cur)
  }
  return { w, h, rgba: out }
}

const hex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')

// 1 cell = 1 pixel wide and 2 pixels tall, which is square on a typical terminal.
type Cell = { ch: string; fg?: string; bg?: string }

// With the page background known, soft edges are blended into it so round logos stay round. Without
// it (a transparent theme), a pixel is either shown or not.
function toCells(px: Pixels, bg: [number, number, number] | null): Cell[][] {
  const rows: Cell[][] = []
  const at = (x: number, y: number) => {
    const o = (y * px.w + x) * 4
    const a = px.rgba[o + 3]!
    if (a < (bg ? 16 : 128)) return undefined
    const mix = (i: number) =>
      bg ? Math.round((px.rgba[o + i]! * a + bg[i]! * (255 - a)) / 255) : px.rgba[o + i]!
    return hex(mix(0), mix(1), mix(2))
  }
  for (let y = 0; y + 1 < px.h; y += 2) {
    const row: Cell[] = []
    for (let x = 0; x < px.w; x++) {
      const top = at(x, y)
      const bottom = at(x, y + 1)
      if (top && bottom) row.push({ ch: '▀', fg: top, bg: bottom })
      else if (top) row.push({ ch: '▀', fg: top })
      else if (bottom) row.push({ ch: '▄', fg: bottom })
      else row.push({ ch: ' ' })
    }
    rows.push(row)
  }
  return rows
}

/* ---------------------------------------------------------------------------------------------- */
/* charts                                                                                          */
/* ---------------------------------------------------------------------------------------------- */

// Price history from GeckoTerminal's keyless API: the token's deepest pool, then its candles.
// About 30 calls a minute on the free tier, so charts load for the selected token only, after the
// selection settles, and each series is cached for a minute.
const GT = 'https://api.geckoterminal.com/api/v2/networks/solana'

type Range = { label: string; path: string; aggregate: number; limit: number }
const RANGES: Range[] = [
  { label: '1h', path: 'minute', aggregate: 1, limit: 60 },
  { label: '24h', path: 'minute', aggregate: 15, limit: 96 },
  { label: '7d', path: 'hour', aggregate: 4, limit: 42 },
  { label: '30d', path: 'day', aggregate: 1, limit: 30 },
]

type Series = { closes: number[]; volumes: number[]; times: number[] }

// Every GeckoTerminal call goes through 1 queue, about 2 s apart, because its free tier allows
// about 30 a minute: a watchlist asking for 10 sparklines at once got 429 on every one. The detail
// chart jumps the queue, so the token being looked at is never behind the sidebar.
type Job = { url: string; resolve: (v: unknown) => void; reject: (e: unknown) => void }
const gtQueue: Job[] = []
let gtBusy = false
const gtGet = (url: string, urgent: boolean) =>
  new Promise<unknown>((resolve, reject) => {
    const job = { url, resolve, reject }
    if (urgent) gtQueue.unshift(job)
    else gtQueue.push(job)
    void pump()
  })
async function pump() {
  if (gtBusy) return
  gtBusy = true
  while (gtQueue.length) {
    const job = gtQueue.shift()!
    try {
      const res = await fetch(job.url, { signal: AbortSignal.timeout(10_000) })
      if (!res.ok)
        throw new Error(
          `GeckoTerminal answered ${res.status}${res.status === 429 ? ', its limit of about 30 calls a minute' : ''}`,
        )
      job.resolve(await res.json())
    } catch (e) {
      job.reject(e)
    }
    await new Promise((r) => setTimeout(r, 2_100))
  }
  gtBusy = false
}

async function topPool(mint: string, urgent: boolean): Promise<string | null> {
  const body = (await gtGet(`${GT}/tokens/${mint}/pools?page=1`, urgent)) as {
    data?: Array<{ attributes?: Record<string, any> }>
  }
  const pools = (body.data ?? [])
    .map((p) => p.attributes ?? {})
    .filter((a) => typeof a.address === 'string')
    .sort((a, b) => Number(b.reserve_in_usd ?? 0) - Number(a.reserve_in_usd ?? 0))
  return pools[0]?.address ?? null
}

async function candles(pool: string, range: Range, urgent: boolean): Promise<Series> {
  const url = `${GT}/pools/${pool}/ohlcv/${range.path}?aggregate=${range.aggregate}&limit=${range.limit}&token=base`
  const body = (await gtGet(url, urgent)) as {
    data?: { attributes?: { ohlcv_list?: unknown[][] } }
  }
  // Newest first from the API; charts read oldest first. A candle without a finite close is
  // dropped, because 1 NaN reaching the braille grid throws inside the renderer.
  const list = [...(body.data?.attributes?.ohlcv_list ?? [])]
    .reverse()
    .filter((c) => Array.isArray(c) && num(c[4]) !== null)
  return {
    closes: list.map((c) => num(c[4])!),
    volumes: list.map((c) => num(c[5]) ?? 0),
    times: list.map((c) => num(c[0]) ?? 0),
  }
}

// Braille: each cell is a 2 by 4 dot grid, so a W by H cell chart has 2W by 4H dots.
const DOT = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
]

function brailleLine(values: number[], w: number, h: number): string[] {
  const dotsW = w * 2
  const dotsH = h * 4
  const grid = Array.from({ length: h }, () => Array.from({ length: w }, () => 0))
  if (values.length < 2) return grid.map((r) => r.map(() => ' ').join(''))
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const span = hi - lo || 1
  const yAt = (v: number) => Math.round((1 - (v - lo) / span) * (dotsH - 1))
  const plot = (x: number, y: number) => {
    grid[Math.floor(y / 4)]![Math.floor(x / 2)]! |= DOT[y % 4]![x % 2]!
  }
  let prevY: number | null = null
  for (let x = 0; x < dotsW; x++) {
    const i = (x / (dotsW - 1)) * (values.length - 1)
    const a = values[Math.floor(i)]!
    const b = values[Math.min(values.length - 1, Math.ceil(i))]!
    const y = yAt(a + (b - a) * (i - Math.floor(i)))
    // Fill the vertical gap to the previous column so steep moves stay a connected line.
    const from = prevY ?? y
    for (let yy = Math.min(from, y); yy <= Math.max(from, y); yy++) plot(x, yy)
    prevY = y
  }
  return grid.map((r) => r.map((bits) => String.fromCharCode(0x2800 + bits)).join(''))
}

const BARS = '\u2581\u2582\u2583\u2584\u2585\u2586\u2587\u2588'
function sparkline(values: number[], w: number): string {
  if (values.length === 0) return ''
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const span = hi - lo || 1
  return Array.from({ length: w }, (_, x) => {
    const v = values[Math.round((x / Math.max(1, w - 1)) * (values.length - 1))]!
    return BARS[Math.min(7, Math.floor(((v - lo) / span) * 8))]!
  }).join('')
}

/* ---------------------------------------------------------------------------------------------- */
/* formatting                                                                                      */
/* ---------------------------------------------------------------------------------------------- */

export const pad = (s: string, n: number) =>
  s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length)
export const lpad = (s: string, n: number) =>
  s.length >= n ? s.slice(0, n) : ' '.repeat(n - s.length) + s
const price = (p: number | null) =>
  p === null ? '-' : p >= 1 ? `$${p.toFixed(2)}` : `$${p.toPrecision(3)}`
// Compact so a 7425% move fits the column instead of losing its sign or its % sign.
const pct = (c: number | null) => {
  if (c === null) return '-'
  const sign = c >= 0 ? '+' : '-'
  const a = Math.abs(c)
  const body = a >= 1000 ? `${(a / 1000).toFixed(1)}K` : a >= 100 ? a.toFixed(0) : a.toFixed(2)
  return `${sign}${body}%`
}
const compact = (v: number | null, dollar = true) => {
  if (v === null) return '-'
  const [d, s] =
    v >= 1e12
      ? [1e12, 'T']
      : v >= 1e9
        ? [1e9, 'B']
        : v >= 1e6
          ? [1e6, 'M']
          : v >= 1e3
            ? [1e3, 'K']
            : [1, '']
  return `${dollar ? '$' : ''}${(v / d).toFixed(v >= 1e3 ? 1 : 0)}${s}`
}
export const short = (mint: string) => `${mint.slice(0, 4)}...${mint.slice(-4)}`

type SortKey = { label: string; get: (t: Token) => number | null }
const SORTS: SortKey[] = [
  { label: 'volume 24h', get: (t) => t.volume24h },
  { label: 'change 5m', get: (t) => t.change5m },
  { label: 'change 1h', get: (t) => t.change1h },
  { label: 'change 24h', get: (t) => t.change24h },
  { label: 'market cap', get: (t) => t.mcap },
  { label: 'liquidity', get: (t) => t.liquidity },
  { label: 'holders', get: (t) => t.holders },
  { label: 'organic score', get: (t) => t.organic },
  { label: 'traders 1h', get: (t) => t.traders1h },
]

/* ---------------------------------------------------------------------------------------------- */
/* model                                                                                           */
/* ---------------------------------------------------------------------------------------------- */

function createModel(api: TuiPluginApi, options: Options) {
  const stored = api.kv.get<unknown>(WATCH_KEY, DEFAULT_WATCHLIST)
  const [watchMints, setWatchMints] = createSignal<string[]>(
    Array.isArray(stored)
      ? stored.filter((m) => typeof m === 'string' && BASE58.test(m))
      : DEFAULT_WATCHLIST,
  )
  const [watchlist, setWatchlist] = createSignal<Token[]>([])
  const [list, setList] = createSignal<Token[]>([])
  const [source, setSource] = createSignal(0)
  const [interval, setInterval_] = createSignal(1)
  const [updatedAt, setUpdatedAt] = createSignal<number | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [now, setNow] = createSignal(Date.now())
  const [logos, setLogos] = createSignal(new Map<string, Cell[][] | null>())
  const [focus, setFocus] = createSignal<string | null>(null)
  const pending = new Set<string>()

  // Logo cache, keyed by icon URL and size. A logo that fails is cached as null, so it is not
  // retried every refresh; the row then shows the symbol's first letter.
  const logo = (url: string | null, size: number): Cell[][] | null | undefined => {
    if (!url) return null
    const back = api.theme.current?.background?.toInts()
    const bg =
      back && back[3] >= 128 ? ([back[0], back[1], back[2]] as [number, number, number]) : null
    const key = `${size}:${bg ?? 'none'}:${url}`
    const have = logos().get(key)
    if (have !== undefined || pending.has(key)) return have
    pending.add(key)
    // ipfs.io and the other public gateways refuse the proxy, so a quarter of trending logos never
    // loaded. Filebase served 12 of 12 through it on 2026-10-01.
    const ipfs = url.match(/^(?:ipfs:\/\/|https?:\/\/[^/]+\/ipfs\/)(.+)$/)
    const source = ipfs ? `https://ipfs.filebase.io/ipfs/${ipfs[1]}` : url
    const proxied = `https://wsrv.nl/?url=${encodeURIComponent(source)}&w=${size}&h=${size}&fit=cover&output=png`
    void fetch(proxied)
      .then(async (r) =>
        r.ok ? toCells(decodePng(new Uint8Array(await r.arrayBuffer())), bg) : null,
      )
      .catch(() => null)
      .then((cells) => {
        pending.delete(key)
        setLogos((m) => new Map(m).set(key, cells))
      })
    return undefined
  }

  // Chart cache, keyed by mint and range. A missing entry is not asked yet; data null is a failure.
  const [series, setSeries] = createSignal(
    new Map<string, { at: number; data: Series | null; error: string | null }>(),
  )
  const pools = new Map<string, Promise<string | null>>()
  const loadingSeries = new Set<string>()
  const chart = (mint: string, range: number, maxAgeMs = 60_000, urgent = false) => {
    const key = `${mint}:${range}`
    const have = series().get(key)
    // A failure is asked again after 15 s, not cached for the session.
    const fresh = have && Date.now() - have.at < (have.data ? maxAgeMs : 15_000)
    if (fresh || loadingSeries.has(key)) return have
    loadingSeries.add(key)
    if (!pools.has(mint))
      pools.set(
        mint,
        topPool(mint, urgent).catch((e) => {
          pools.delete(mint)
          throw e
        }),
      )
    void pools
      .get(mint)!
      .then(async (pool) => {
        if (!pool) {
          // Asked again later: a new token usually gets its first pool minutes after launch.
          pools.delete(mint)
          return { data: null, error: 'GeckoTerminal lists no pool for this token yet' }
        }
        return { data: await candles(pool, RANGES[range]!, urgent), error: null }
      })
      .catch((e) => ({ data: null, error: e instanceof Error ? e.message : String(e) }))
      .then((r) => {
        loadingSeries.delete(key)
        setSeries((m) => new Map(m).set(key, { at: Date.now(), ...r }))
      })
    return have
  }

  const listUrl = () => {
    const s = SOURCES[source()]!
    const i = s.interval ? `/${INTERVALS[interval()]}` : ''
    return `${JUP}/${s.path}${i}?limit=${options.limit}`
  }

  // Only the latest refresh writes, so a slow answer for the list the user just left cannot land
  // under the new list's heading.
  // A poll waits for a refresh still in flight instead of superseding it, or a Jupiter slower than
  // the poll would never land a list and never show an error.
  let run = 0
  let busy = false
  const refresh = async () => {
    const mine = ++run
    busy = true
    try {
      const mints = watchMints()
      const [w, l] = await Promise.all([
        mints.length ? getTokens(`${JUP}/search?query=${mints.join(',')}`) : Promise.resolve([]),
        getTokens(listUrl()),
      ])
      if (mine !== run) return
      const byMint = new Map(w.map((t) => [t.mint, t]))
      setWatchlist(mints.flatMap((m) => (byMint.has(m) ? [byMint.get(m)!] : [])))
      setList(l)
      setUpdatedAt(Date.now())
      setError(null)
    } catch (e) {
      // The last good rows stay on screen, and the reason they are not moving is said.
      if (mine !== run) return
      setError(
        `${e instanceof Error ? e.message : String(e)}. ${updatedAt() === null ? 'No data yet' : `Showing data from ${age()}`}, retrying in ${options.refreshMs / 1000}s`,
      )
    } finally {
      if (mine === run) busy = false
    }
  }
  // A new list or watchlist is fetched at once rather than on the next poll.
  createEffect(on([source, interval, watchMints], () => void refresh()))
  const poll = setInterval(() => {
    if (!busy) void refresh()
  }, options.refreshMs)
  const tick = setInterval(() => setNow(Date.now()), 1_000)

  const toggleWatch = (mint: string) => {
    const next = watchMints().includes(mint)
      ? watchMints().filter((m) => m !== mint)
      : [...watchMints(), mint]
    setWatchMints(next)
    api.kv.set(WATCH_KEY, next)
    return next.includes(mint)
  }

  const age = () => {
    const at = updatedAt()
    return at === null ? 'loading' : `${Math.max(0, Math.round((now() - at) / 1000))}s ago`
  }
  const stop = () => {
    clearInterval(poll)
    clearInterval(tick)
  }
  return {
    api,
    watchMints,
    watchlist,
    list,
    source,
    setSource,
    interval,
    setInterval: setInterval_,
    error,
    age,
    logo,
    chart,
    focus,
    setFocus,
    toggleWatch,
    stop,
  }
}

type Model = ReturnType<typeof createModel>

/* ---------------------------------------------------------------------------------------------- */
/* views                                                                                           */
/* ---------------------------------------------------------------------------------------------- */

function Logo(props: { model: Model; token: Token; size: number }) {
  const cells = () => props.model.logo(props.token.icon, props.size)
  const theme = () => props.model.api.theme.current
  return (
    <box flexDirection="column" width={props.size} height={props.size / 2}>
      <Show
        when={cells()}
        fallback={
          <text fg={ink(props.model.api, theme()?.accent)}>
            {pad(props.token.symbol.slice(0, 1), props.size)}
          </text>
        }
      >
        <For each={cells()!}>
          {(row) => (
            <box flexDirection="row" height={1}>
              <For each={row}>
                {(c) => (
                  <text fg={c.fg} bg={c.bg}>
                    {c.ch}
                  </text>
                )}
              </For>
            </box>
          )}
        </For>
      </Show>
    </box>
  )
}

// A clickable label. Left button only; the click stops here so the row under it does not also act.
// It acts on mouse-up, as opencode's own buttons do: acting on mouse-down opened a dialog whose
// backdrop then received the same click's mouse-up and closed it, so a Buy dialog stayed on screen
// only while the button was held.
function Button(props: { model: Model; label: string; active?: boolean; onPress: () => void }) {
  const api = props.model.api
  const theme = () => api.theme.current
  const [hover, setHover] = createSignal(false)
  return (
    <box
      height={1}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={hover() || props.active ? theme()?.backgroundElement : undefined}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={(e) => {
        e.stopPropagation()
        if (e.button !== 0 || api.ui.dialog.open) return
        props.onPress()
      }}
    >
      <text
        fg={ink(
          api,
          props.active ? theme()?.primary : theme()?.accent,
          hover() || props.active ? theme()?.backgroundElement : undefined,
        )}
        wrapMode="none"
      >
        {props.label}
      </text>
    </box>
  )
}

type Colour = NonNullable<TuiPluginApi['theme']['current']>['text']
const luminance = (rgb: number[]) => {
  const [r, g, b] = rgb.map((v) => {
    const x = v / 255
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}
const ratio = (a: number[], b: number[]) => {
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
const inked = new Map<string, Colour | string>()
// A theme colour that reads at 4.5 to 1 or better on its background: unchanged when it already
// does, otherwise moved toward black on a light background or white on a dark one, a tenth at a
// time, so a gain stays green and a loss stays red. Measured on opencode's default light theme:
// accent, warning, success and textMuted all fell under 4.5, between 2.6 and 3.4.
export const ink = (
  api: TuiPluginApi,
  fg: Colour | undefined,
  bg?: Colour,
): Colour | string | undefined => {
  const back = bg ?? api.theme.current?.background
  if (!fg || !back) return fg
  const b = back.toInts()
  if (b[3]! < 128) return fg
  const f = fg.toInts().slice(0, 3)
  const key = `${f}|${b}`
  const hit = inked.get(key)
  if (hit) return hit
  const target = luminance(b) > 0.18 ? 0 : 255
  let rgb = f
  for (let k = 1; k <= 10 && ratio(rgb, b) < 4.5; k++)
    rgb = f.map((v) => Math.round(v + (target - v) * (k / 10)))
  const out = rgb === f ? fg : '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('')
  inked.set(key, out)
  return out
}

// A move that rounds to 0.00% is neither green nor red.
const colourOf = (api: TuiPluginApi, c: number | null, bg?: Colour) =>
  ink(
    api,
    c === null || Math.abs(c) < 0.005
      ? api.theme.current?.textMuted
      : c > 0
        ? api.theme.current?.success
        : api.theme.current?.error,
    bg,
  )

// At most this many tokens in the sidebar, so a long watchlist does not push opencode's own panels
// (MCP, LSP, todo, files) off the screen; the rest are a line that opens the page.
const SIDEBAR_ROWS = 5

function Sidebar(props: { model: Model; open: () => void; openSetup: () => void }) {
  const api = props.model.api
  const theme = () => api.theme.current
  const shown = () => props.model.watchlist().slice(0, SIDEBAR_ROWS)
  const more = () => props.model.watchlist().length - shown().length
  return (
    <box flexDirection="column" gap={0}>
      <box flexDirection="row" gap={1} height={1}>
        <text fg={theme()?.text}>
          <b>Agon watchlist</b>
        </text>
        <text fg={ink(api, theme()?.textMuted, theme()?.backgroundPanel)}>{props.model.age()}</text>
      </box>
      <For each={shown()}>
        {(t) => (
          <box
            flexDirection="row"
            gap={1}
            height={3}
            onMouseDown={(e) => {
              if (e.button !== 0 || api.ui.dialog.open) return
              props.model.setFocus(t.mint)
              props.open()
            }}
          >
            <Logo model={props.model} token={t} size={6} />
            <box flexDirection="column">
              <text fg={theme()?.text} wrapMode="none">
                {pad(t.symbol, 7) + ' ' + lpad(price(t.price), 11)}
              </text>
              <box flexDirection="row" gap={1} height={1}>
                <text fg={colourOf(api, t.change24h, theme()?.backgroundPanel)} wrapMode="none">
                  {pad(
                    sparkline(props.model.chart(t.mint, 1, 300_000)?.data?.closes ?? [], 10),
                    10,
                  )}
                </text>
                <text fg={colourOf(api, t.change5m, theme()?.backgroundPanel)} wrapMode="none">
                  {`5m ${pct(t.change5m)}`}
                </text>
              </box>
            </box>
          </box>
        )}
      </For>
      <Show when={more() > 0}>
        <text fg={ink(api, theme()?.textMuted, theme()?.backgroundPanel)}>
          {`+${more()} more on the discovery page`}
        </text>
      </Show>
      <box flexDirection="row" height={1}>
        <Button model={props.model} label="open discovery" onPress={props.open} />
        <Button model={props.model} label="setup" onPress={props.openSetup} />
      </box>
      <Show when={props.model.error()}>
        <text fg={ink(api, theme()?.error)}>{props.model.error()}</text>
      </Show>
    </box>
  )
}

function Chart(props: {
  model: Model
  token: Token
  range: number
  setRange: (r: number) => void
  rows: number
  compact: boolean
}) {
  const api = props.model.api
  const theme = () => api.theme.current
  // Waits for the selection to settle before asking, so scrolling a list is not 30 requests.
  const [settled, setSettled] = createSignal<string | null>(null)
  createEffect(
    on(
      () => `${props.token.mint}:${props.range}`,
      (key) => {
        setSettled(null)
        const t = setTimeout(() => setSettled(key), 400)
        onCleanup(() => clearTimeout(t))
      },
    ),
  )
  const entry = () =>
    settled() ? props.model.chart(props.token.mint, props.range, 60_000, true) : undefined
  const data = () => entry()?.data ?? null
  const first = () => data()?.closes[0] ?? null
  const last = () => data()?.closes.at(-1) ?? null
  const change = () => (first() && last() ? ((last()! - first()!) / first()!) * 100 : null)
  // Hovering the chart reads it: the column under the mouse, its price and its time.
  const W = 36
  let area: { x: number } | undefined
  const [hover, setHover] = createSignal<number | null>(null)
  const at = () => {
    const h = hover()
    const d = data()
    if (h === null || !d || d.closes.length < 2) return null
    const i = Math.round((h / (W - 1)) * (d.closes.length - 1))
    const t = d.times[i]
    const when = t ? new Date(t * 1000).toISOString().slice(5, 16).replace('T', ' ') + ' UTC' : ''
    return { col: h, text: `${price(d.closes[i]!)}  ${when}` }
  }
  return (
    <box flexDirection="column" gap={0} flexShrink={0}>
      <box flexDirection="row" height={1}>
        <For each={RANGES}>
          {(r, i) => (
            <Button
              model={props.model}
              label={r.label}
              active={i() === props.range}
              onPress={() => props.setRange(i())}
            />
          )}
        </For>
        <text fg={colourOf(api, change())}>{data() ? ` ${pct(change())}` : ''}</text>
      </box>
      <Show
        when={data() && data()!.closes.length > 1}
        fallback={
          <text fg={ink(api, theme()?.textMuted)}>
            {entry()?.error ? `no chart: ${entry()!.error}` : 'loading chart'}
          </text>
        }
      >
        <box
          flexDirection="column"
          ref={(r: { x: number }) => (area = r)}
          onMouseMove={(e) => area && setHover(Math.max(0, Math.min(W - 1, e.x - area.x)))}
          onMouseOut={() => setHover(null)}
        >
          <For each={brailleLine(data()!.closes, W, props.rows)}>
            {(line) => (
              <text fg={colourOf(api, change())} wrapMode="none">
                {line}
              </text>
            )}
          </For>
        </box>
        <Show when={at()}>
          {(a) => (
            <>
              <text fg={theme()?.text} wrapMode="none">
                {' '.repeat(a().col) + '^'}
              </text>
              <text fg={theme()?.text} wrapMode="none">
                {a().text}
              </text>
            </>
          )}
        </Show>
        <Show when={!props.compact}>
          <text fg={ink(api, theme()?.textMuted)} wrapMode="none">
            {sparkline(data()!.volumes, 36)}
          </text>
          <text fg={ink(api, theme()?.textMuted)} wrapMode="none">
            {`hi ${price(Math.max(...data()!.closes))}  lo ${price(Math.min(...data()!.closes))}  last ${price(last())}`}
          </text>
        </Show>
      </Show>
    </box>
  )
}

type Actions = {
  trade: (t: Token) => void
  buy: (t: Token) => void
  sell: (t: Token) => void
  check: (t: Token) => void
  watch: (t: Token) => void
  copy: (t: Token) => void
}

function Detail(props: {
  model: Model
  token: Token | undefined
  range: number
  setRange: (r: number) => void
  actions: Actions
  compact: boolean
  note?: string
}) {
  const api = props.model.api
  const theme = () => api.theme.current
  const muted = () => ink(api, theme()?.textMuted)
  const yes = (v: boolean | null, good: string, bad: string) =>
    v === null ? 'unknown' : v ? good : bad
  const live = (off: boolean | null) => (off === false ? ink(api, theme()?.error) : theme()?.text)
  // The pane is taller than a short terminal, so it clips at its bottom edge instead of squeezing
  // its lines on top of each other, and the safety lines come right after the buttons, where a
  // short screen still shows them. Below 46 rows the logo and chart shrink.
  return (
    <box flexDirection="column" width={42} paddingLeft={2} gap={0} overflow="hidden">
      <Show when={props.token} fallback={<text fg={muted()}>no token selected</text>}>
        {(t) => (
          <>
            <box flexDirection="row" gap={2} flexShrink={0}>
              <Logo model={props.model} token={t()} size={props.compact ? 8 : 20} />
              <box flexDirection="column">
                <text fg={theme()?.text} wrapMode="none">
                  <b>{t().symbol.slice(0, 18)}</b>
                </text>
                <text fg={theme()?.text}>{price(t().price)}</text>
                <text fg={colourOf(api, t().change24h)}>{`24h ${pct(t().change24h)}`}</text>
              </box>
            </box>
            <Show when={props.note}>
              <text fg={ink(api, theme()?.warning)} flexShrink={0}>
                {props.note}
              </text>
            </Show>
            <box flexDirection="row" height={1} flexShrink={0}>
              <Button model={props.model} label="Trade" onPress={() => props.actions.trade(t())} />
              <Button model={props.model} label="Buy" onPress={() => props.actions.buy(t())} />
              <Button model={props.model} label="Sell" onPress={() => props.actions.sell(t())} />
              <Button model={props.model} label="Check" onPress={() => props.actions.check(t())} />
              <Button
                model={props.model}
                label={props.model.watchMints().includes(t().mint) ? 'Unwatch' : 'Watch'}
                onPress={() => props.actions.watch(t())}
              />
              <Button model={props.model} label="Copy" onPress={() => props.actions.copy(t())} />
            </box>
            <text fg={live(t().mintAuthorityOff)} flexShrink={0}>
              {`mint authority ${yes(t().mintAuthorityOff, 'disabled', 'LIVE')}`}
            </text>
            <text fg={live(t().freezeAuthorityOff)} flexShrink={0}>
              {`freeze authority ${yes(t().freezeAuthorityOff, 'disabled', 'LIVE')}`}
            </text>
            <text fg={theme()?.text} flexShrink={0}>
              {`top holders ${t().topHoldersPct === null ? '-' : t().topHoldersPct!.toFixed(1) + '%'}, dev ${t().devPct === null ? '-' : t().devPct!.toFixed(2) + '%'}`}
            </text>
            <Chart
              model={props.model}
              token={t()}
              range={props.range}
              setRange={props.setRange}
              rows={props.compact ? 4 : 8}
              compact={props.compact}
            />
            <text fg={muted()} wrapMode="none" flexShrink={0}>
              {t().name.length > 36 ? t().name.slice(0, 35) + '~' : t().name}
            </text>
            <text fg={muted()} flexShrink={0}>
              {short(t().mint)}
            </text>
            <text fg={theme()?.text} flexShrink={0}>
              {`${price(t().price)}  mcap ${compact(t().mcap)}  liq ${compact(t().liquidity)}`}
            </text>
            <text fg={colourOf(api, t().change24h)} flexShrink={0}>
              {`5m ${pct(t().change5m)}  1h ${pct(t().change1h)}  24h ${pct(t().change24h)}`}
            </text>
            <text fg={theme()?.text} flexShrink={0}>
              {`1h ${compact(t().buys1h, false)} buys ${compact(t().sells1h, false)} sells ${compact(t().traders1h, false)} traders`}
            </text>
            <text fg={theme()?.text} flexShrink={0}>
              {`holders ${compact(t().holders, false)} (${pct(t().holderChange1h)} 1h)`}
            </text>
            <text fg={theme()?.text} flexShrink={0}>
              {`organic ${t().organic === null ? '-' : t().organic!.toFixed(0)} ${t().organicLabel ?? ''}${t().verified ? ', verified' : ''}`}
            </text>
            <text fg={muted()} wrapMode="none" flexShrink={0}>
              {t().tags.reduce((line, tag) => {
                const next = line ? `${line} ${tag}` : tag
                return next.length <= 40 ? next : line
              }, '')}
            </text>
          </>
        )}
      </Show>
    </box>
  )
}

// A token as a card: logo, price, volume and liquidity, and the 24h change in a 2-line font.
// Fixed size, so a grid of them lines up and the page can work out how many fit.
const CARD_W = 30
const CARD_H = 7

function Card(props: {
  model: Model
  token: Token
  width: number
  selected: boolean
  watched: boolean
  onSelect: () => void
}) {
  const api = props.model.api
  const theme = () => api.theme.current
  const t = () => props.token
  const bg = () => (props.selected ? theme()?.backgroundElement : undefined)
  return (
    <box
      border
      borderStyle="rounded"
      width={props.width}
      height={CARD_H}
      borderColor={props.selected ? ink(api, theme()?.primary) : colourOf(api, t().change24h)}
      backgroundColor={bg()}
      title={` ${props.selected ? '> ' : ''}${props.watched ? '*' : ''}${t().symbol.slice(0, 18)} `}
      paddingLeft={1}
      flexDirection="column"
      onMouseDown={(e) => {
        if (e.button === 0 && !api.ui.dialog.open) props.onSelect()
      }}
    >
      <box flexDirection="row" gap={1} height={3}>
        <Logo model={props.model} token={t()} size={6} />
        <box flexDirection="column">
          <text fg={theme()?.text} wrapMode="none">
            {price(t().price)}
          </text>
          <text fg={ink(api, theme()?.textMuted, bg())} wrapMode="none">
            {`vol ${compact(t().volume24h)}`}
          </text>
          <text fg={ink(api, theme()?.textMuted, bg())} wrapMode="none">
            {`liq ${compact(t().liquidity)}`}
          </text>
        </box>
      </box>
      <ascii_font
        text={pct(t().change24h)}
        font="tiny"
        color={colourOf(api, t().change24h, bg())}
      />
    </box>
  )
}

function Page(props: {
  model: Model
  back: () => void
  trade: (mint: string, label: string) => void
}) {
  const model = props.model
  const api = model.api
  const theme = () => api.theme.current
  const [sort, setSort] = createSignal(0)
  const [desc, setDesc] = createSignal(true)
  const [selected, setSelected] = createSignal(0)
  const [offset, setOffset] = createSignal(0)
  const [search, setSearch] = createSignal('')
  const [auditedOnly, setAuditedOnly] = createSignal(false)
  const [range, setRange] = createSignal(1)
  const [view, setView] = createSignal<'table' | 'cards'>(
    api.kv.get<unknown>(VIEW_KEY, 'table') === 'cards' ? 'cards' : 'table',
  )
  const dims = useTerminalDimensions()
  const toggleView = () => {
    const next = view() === 'table' ? 'cards' : 'table'
    setView(next)
    api.kv.set(VIEW_KEY, next)
    reset()
  }

  // The list gets the width left beside the 42-column detail pane and the page's padding. Cards
  // stretch to fill it, so a wide screen has no gap the size of a missing card.
  const listWidth = () => Math.max(20, dims().width - 44)
  const cols = () => Math.max(1, Math.floor(listWidth() / CARD_W))
  const cardWidth = () => Math.floor(listWidth() / cols())
  const compactDetail = () => dims().height < 46
  const hint = () =>
    view() === 'cards'
      ? 'arrows or h/j/k/l move  click, wheel  enter trade view  m table  s sort  r order  t list  i interval  v chart  / search  a audited  w watch  y copy  b buy  x sell  c check  esc back'
      : 'j/k move  click, wheel  enter trade view  click a title to sort  m cards  s sort  r order  t list  i interval  v chart  / search  a audited  w watch  y copy  b buy  x sell  c check  esc back'
  // Lines the list does not get: padding 2, the 2 header rows, the hint as it wraps, the error line
  // when there is one, and in the table the column titles.
  const chrome = () =>
    4 +
    Math.ceil(hint().length / Math.max(20, dims().width - 2)) +
    (model.error() ? 1 : 0) +
    (view() === 'table' ? 1 : 0)
  // Table rows are 2 lines tall for a 4 by 4 pixel logo; cards fill whole rows of cards.
  const visible = () =>
    view() === 'cards'
      ? cols() * Math.max(1, Math.floor((dims().height - chrome()) / CARD_H))
      : Math.max(3, Math.floor((dims().height - chrome()) / 2))

  const rows = createMemo(() => {
    const key = SORTS[sort()]!
    const dir = desc() ? -1 : 1
    const q = search().toLowerCase()
    return model
      .list()
      .filter((t) => !q || t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q))
      .filter(
        (t) => !auditedOnly() || (t.mintAuthorityOff === true && t.freezeAuthorityOff === true),
      )
      .sort((a, b) => {
        const x = key.get(a)
        const y = key.get(b)
        // Missing values always sort last, whichever way the column is ordered.
        if (x === null && y === null) return 0
        if (x === null) return 1
        if (y === null) return -1
        return (x - y) * dir
      })
  })

  // The selection is a token, not a position: every refresh re-sorts the list, and a position would
  // hand Check or Buy a token the user never picked.
  const [selMint, setSelMint] = createSignal<string | null>(null)
  const [selToken, setSelToken] = createSignal<Token | null>(null)
  // The selected token after a refresh dropped it from the list: still shown and still what the
  // buttons act on, until the user moves.
  const [gone, setGone] = createSignal<Token | null>(null)
  // Cards scroll a whole row of cards at a time, so the grid does not reflow under the cursor.
  const scroll = (i: number) => {
    const step = view() === 'cards' ? cols() : 1
    const rowStart = i - (i % step)
    if (i < offset()) setOffset(rowStart)
    else if (i >= offset() + visible()) setOffset(rowStart - visible() + step)
  }
  const move = (to: number) => {
    model.setFocus(null)
    setGone(null)
    const n = rows().length
    const i = n === 0 ? 0 : Math.max(0, Math.min(n - 1, to))
    setSelected(i)
    setSelMint(rows()[i]?.mint ?? null)
    setSelToken(rows()[i] ?? null)
    scroll(i)
  }
  const reset = () => {
    setOffset(0)
    move(0)
  }

  // A token clicked in the sidebar: selected in the list when it is there, else shown on its own in
  // the detail pane until the selection moves.
  const focused = () => {
    const m = model.focus()
    return m
      ? (rows().find((t) => t.mint === m) ?? model.watchlist().find((t) => t.mint === m))
      : undefined
  }
  createEffect(
    on(rows, (list) => {
      const m = model.focus()
      if (m) {
        const i = list.findIndex((t) => t.mint === m)
        if (i >= 0) move(i)
        return
      }
      const i = list.findIndex((t) => t.mint === selMint())
      if (i >= 0) {
        setSelected(i)
        setSelToken(list[i]!)
        scroll(i)
      } else if (selToken() && !gone()) setGone(selToken())
      else if (!selToken()) move(selected())
    }),
  )
  // A resize, an error line or a view change alters how many rows or cards fit, so the window is
  // worked out again around the selection, without dropping a token opened from the sidebar.
  createEffect(on(visible, () => scroll(selected()), { defer: true }))
  const current = () => focused() ?? gone() ?? rows()[selected()]
  const [hovered, setHovered] = createSignal<string | null>(null)

  // Hands the instruction to the agent's chat box and goes back to the session. It is never
  // submitted from here: the person reads it and presses Enter.
  const handOff = async (text: string) => {
    props.back()
    try {
      await api.client.tui.appendPrompt({ text })
      api.ui.toast({
        variant: 'info',
        message: 'Added to your prompt. Review it, then press Enter.',
      })
    } catch (e) {
      api.ui.toast({
        variant: 'error',
        message: `Could not fill the prompt (${e instanceof Error ? e.message : String(e)}). Nothing was sent.`,
      })
    }
  }

  const askAmount = (side: 'buy' | 'sell', t: Token) => {
    api.ui.dialog.replace(() => (
      <api.ui.DialogPrompt
        title={side === 'buy' ? `Buy ${t.symbol.slice(0, 20)}` : `Sell ${t.symbol.slice(0, 20)}`}
        placeholder={
          side === 'buy' ? 'amount of SOL to spend, e.g. 0.1' : "amount to sell, or 'all'"
        }
        onCancel={() => api.ui.dialog.clear()}
        onConfirm={(value) => {
          api.ui.dialog.clear()
          const amount = value.trim()
          if (!amount) return
          // Only the mint goes into the prompt. A token's symbol and name are outside text, and a
          // symbol can say anything, including an instruction to the agent.
          void handOff(
            side === 'buy'
              ? `Buy ${amount} SOL of the token with mint ${t.mint}. Run Agon check_trade on it first and show me the verdict with its reasons. Build nothing unless it passes, and let me sign.`
              : `Sell ${amount} of the token with mint ${t.mint} for SOL. Run Agon check_trade on it first and show me the verdict with its reasons. Build nothing unless it passes, and let me sign.`,
          )
        }}
      />
    ))
  }

  const askSearch = () => {
    api.ui.dialog.replace(() => (
      <api.ui.DialogPrompt
        title="Search tokens"
        placeholder="symbol or name, empty to clear"
        value={search()}
        onCancel={() => api.ui.dialog.clear()}
        onConfirm={(value) => {
          api.ui.dialog.clear()
          setSearch(value.trim())
          reset()
        }}
      />
    ))
  }

  const actions: Actions = {
    trade: (t) => props.trade(t.mint, t.symbol),
    buy: (t) => askAmount('buy', t),
    sell: (t) => askAmount('sell', t),
    check: (t) =>
      void handOff(
        `Run Agon check_trade for a buy of the token with mint ${t.mint} at my usual size and explain the verdict. Do not trade.`,
      ),
    watch: (t) => {
      const on = model.toggleWatch(t.mint)
      api.ui.toast({
        variant: 'info',
        message: `${t.symbol} ${on ? 'added to' : 'removed from'} your watchlist`,
      })
    },
    copy: (t) => {
      const ok = api.renderer.copyToClipboardOSC52(t.mint)
      api.ui.toast({
        variant: ok ? 'success' : 'warning',
        message: ok
          ? `Copied ${t.symbol} mint`
          : 'This terminal does not accept clipboard writes (OSC 52)',
      })
    },
  }
  // A different list is a fresh start: the first token of the new list is selected when it arrives,
  // rather than the old token being kept as one that left.
  const freshList = () => {
    reset()
    setSelMint(null)
    setSelToken(null)
  }
  const nextSource = () => {
    model.setSource((model.source() + 1) % SOURCES.length)
    freshList()
  }
  const nextInterval = () => {
    model.setInterval((model.interval() + 1) % INTERVALS.length)
    freshList()
  }
  const nextSort = () => {
    setSort((sort() + 1) % SORTS.length)
    reset()
  }
  const reverse = () => {
    setDesc(!desc())
    reset()
  }
  const toggleAudited = () => {
    setAuditedOnly(!auditedOnly())
    reset()
  }
  // A column title sorts by that column, and a second click on the same one reverses it.
  const sortBy = (i: number) => {
    if (sort() === i) setDesc(!desc())
    else {
      setSort(i)
      setDesc(true)
    }
    reset()
  }

  useKeyboard((key) => {
    // A dialog owns the keyboard while it is open, and a Ctrl or Meta combination belongs to
    // opencode (ctrl+x is its leader key, ctrl+p its palette), never to this page.
    if (api.ui.dialog.open || key.ctrl || key.meta) return
    const k = key.name
    const t = current()
    if (k === 'escape' || k === 'q') props.back()
    else if (k === 'down' || k === 'j') move(selected() + (view() === 'cards' ? cols() : 1))
    else if (k === 'up' || k === 'k') move(selected() - (view() === 'cards' ? cols() : 1))
    else if (view() === 'cards' && (k === 'right' || k === 'l')) move(selected() + 1)
    else if (view() === 'cards' && (k === 'left' || k === 'h')) move(selected() - 1)
    else if (k === 'm') toggleView()
    else if (k === 'pagedown') move(selected() + visible())
    else if (k === 'pageup') move(selected() - visible())
    else if (k === 'home' || k === 'g') move(0)
    else if (k === 'end') move(rows().length - 1)
    else if (k === 's') nextSort()
    else if (k === 'r') reverse()
    else if (k === 't') nextSource()
    else if (k === 'i') nextInterval()
    else if (k === 'v') setRange((range() + 1) % RANGES.length)
    else if (k === 'a') toggleAudited()
    else if (k === '/') askSearch()
    else if (!t) return
    else if (k === 'return' || k === 'enter') actions.trade(t)
    else if (k === 'w') actions.watch(t)
    else if (k === 'y') actions.copy(t)
    else if (k === 'b') actions.buy(t)
    else if (k === 'x') actions.sell(t)
    else if (k === 'c') actions.check(t)
  })

  const window = () => rows().slice(offset(), offset() + visible())
  const src = () => SOURCES[model.source()]!
  // Optional columns after logo, token and price (26 columns), in screen order. `keep` is the order
  // they are kept in when the list is narrow: 24h first, organic score last.
  type Column = {
    label: string
    width: number
    sort: number
    keep: number
    value: (t: Token) => string
    change?: (t: Token) => number | null
  }
  const columns: Column[] = [
    {
      label: '5m',
      width: 9,
      sort: 1,
      keep: 4,
      value: (t) => pct(t.change5m),
      change: (t) => t.change5m,
    },
    {
      label: '1h',
      width: 9,
      sort: 2,
      keep: 2,
      value: (t) => pct(t.change1h),
      change: (t) => t.change1h,
    },
    {
      label: '24h',
      width: 9,
      sort: 3,
      keep: 0,
      value: (t) => pct(t.change24h),
      change: (t) => t.change24h,
    },
    { label: 'vol 24h', width: 10, sort: 0, keep: 1, value: (t) => compact(t.volume24h) },
    { label: 'liq', width: 10, sort: 5, keep: 3, value: (t) => compact(t.liquidity) },
    { label: 'mcap', width: 10, sort: 4, keep: 5, value: (t) => compact(t.mcap) },
    { label: 'holders', width: 9, sort: 6, keep: 6, value: (t) => compact(t.holders, false) },
    {
      label: 'org',
      width: 5,
      sort: 7,
      keep: 7,
      value: (t) => (t.organic === null ? '-' : t.organic.toFixed(0)),
    },
  ]
  const shownColumns = createMemo(() => {
    let room = listWidth() - 26
    const kept = new Set<Column>()
    const rank = (c: Column) => (c.sort === sort() ? -1 : c.keep)
    for (const c of [...columns].sort((a, b) => rank(a) - rank(b))) {
      if (c.width > room) break
      kept.add(c)
      room -= c.width
    }
    return columns.filter((c) => kept.has(c))
  })

  return (
    <box flexDirection="column" padding={1} gap={0} flexGrow={1}>
      <box flexDirection="row" gap={1} height={1}>
        <text fg={theme()?.text}>
          <b>Agon discovery</b>
        </text>
        <Button model={model} label={src().label} active onPress={nextSource} />
        <Show when={src().interval}>
          <Button
            model={model}
            label={INTERVALS[model.interval()]!}
            active
            onPress={nextInterval}
          />
        </Show>
        <text fg={ink(api, theme()?.textMuted)}>{`${rows().length} tokens, ${model.age()}`}</text>
      </box>
      <box flexDirection="row" gap={1} height={1}>
        <Button model={model} label={`sort: ${SORTS[sort()]!.label}`} onPress={nextSort} />
        <Button model={model} label={desc() ? 'high to low' : 'low to high'} onPress={reverse} />
        <Button model={model} label={`view: ${view()}`} onPress={toggleView} />
        <Button
          model={model}
          label={search() ? `search: "${search()}"` : 'search'}
          onPress={askSearch}
        />
        <Button
          model={model}
          label={auditedOnly() ? 'audited only' : 'all tokens'}
          active={auditedOnly()}
          onPress={toggleAudited}
        />
      </box>
      <box flexDirection="row" flexGrow={1}>
        <box
          flexDirection="column"
          flexGrow={1}
          overflow="hidden"
          onMouseScroll={(e) => {
            if (api.ui.dialog.open) return
            const d = e.scroll?.direction
            if (d === 'down') move(selected() + 1)
            else if (d === 'up') move(selected() - 1)
          }}
        >
          <Show when={rows().length === 0}>
            <text fg={ink(api, theme()?.textMuted)} wrapMode="word">
              {model.list().length === 0
                ? `no tokens yet: ${model.error() ?? 'loading from Jupiter'}`
                : `no tokens match ${search() ? `"${search()}"` : 'these filters'}${auditedOnly() ? ' with authorities disabled' : ''}. / changes the search${auditedOnly() ? ', a shows all tokens' : ''}`}
            </text>
          </Show>
          <Show
            when={view() === 'table'}
            fallback={
              <box flexDirection="row" flexWrap="wrap">
                <For each={window()}>
                  {(t, i) => (
                    <Card
                      model={model}
                      token={t}
                      width={cardWidth()}
                      selected={current()?.mint === t.mint}
                      watched={model.watchMints().includes(t.mint)}
                      onSelect={() => move(offset() + i())}
                    />
                  )}
                </For>
              </box>
            }
          >
            <box flexDirection="row" height={1} flexShrink={0}>
              <text fg={ink(api, theme()?.textMuted)} wrapMode="none">
                {pad('', 5) + pad('token', 10) + lpad('price', 11)}
              </text>
              <For each={shownColumns()}>
                {(c) => {
                  const active = () => sort() === c.sort
                  return (
                    <box
                      width={c.width}
                      height={1}
                      onMouseDown={(e) => {
                        if (e.button === 0 && !api.ui.dialog.open) sortBy(c.sort)
                      }}
                    >
                      <text
                        fg={ink(api, active() ? theme()?.primary : theme()?.textMuted)}
                        wrapMode="none"
                      >
                        {lpad((active() ? (desc() ? '\u25bc' : '\u25b2') : '') + c.label, c.width)}
                      </text>
                    </box>
                  )
                }}
              </For>
            </box>
            <For each={window()}>
              {(t, i) => {
                const isSel = () => current()?.mint === t.mint
                const bg = () =>
                  isSel()
                    ? theme()?.backgroundElement
                    : hovered() === t.mint
                      ? theme()?.backgroundPanel
                      : undefined
                const watched = () => model.watchMints().includes(t.mint)
                return (
                  <box
                    flexDirection="row"
                    height={2}
                    flexShrink={0}
                    backgroundColor={bg()}
                    onMouseOver={() => setHovered(t.mint)}
                    onMouseOut={() => setHovered((h) => (h === t.mint ? null : h))}
                    onMouseDown={(e) => {
                      if (e.button === 0 && !api.ui.dialog.open) move(offset() + i())
                    }}
                  >
                    <box width={5} flexShrink={0}>
                      <Logo model={model} token={t} size={4} />
                    </box>
                    <text fg={theme()?.text} wrapMode="none">
                      {pad((isSel() ? '>' : '') + (watched() ? '*' : '') + t.symbol, 9) +
                        ' ' +
                        lpad(price(t.price), 11)}
                    </text>
                    <For each={shownColumns()}>
                      {(c) => (
                        <text
                          fg={c.change ? colourOf(api, c.change(t), bg()) : theme()?.text}
                          wrapMode="none"
                        >
                          {lpad(c.value(t), c.width)}
                        </text>
                      )}
                    </For>
                  </box>
                )
              }}
            </For>
          </Show>
        </box>
        <Detail
          model={model}
          token={current()}
          range={range()}
          setRange={setRange}
          actions={actions}
          compact={compactDetail()}
          note={gone() && !model.focus() ? 'left this list on the last refresh' : undefined}
        />
      </box>
      <Show when={model.error()}>
        <text fg={ink(api, theme()?.error)} flexShrink={0} wrapMode="none">
          {model.error()}
        </text>
      </Show>
      <text fg={ink(api, theme()?.textMuted)} wrapMode="word" flexShrink={0}>
        {hint()}
      </text>
    </box>
  )
}

/* ---------------------------------------------------------------------------------------------- */
/* setup                                                                                           */
/* ---------------------------------------------------------------------------------------------- */

const SETUP_ROUTE = 'agon.setup'
const WALLET_KEY = 'agon.setup.wallet'

// 1 MCP tool call over Streamable HTTP. The server answers as JSON or as 1 server-sent event.
async function mcpCall(
  base: string,
  name: string,
  args: object,
): Promise<{ ok: boolean; text: string }> {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`the Agon server at ${base} answered ${res.status}`)
  const raw = await res.text()
  const data = raw.trimStart().startsWith('{')
    ? raw
    : raw
        .split('\n')
        .find((l) => l.startsWith('data:'))
        ?.slice(5)
  if (!data) throw new Error(`the Agon server at ${base} sent an answer with no body`)
  const json = JSON.parse(data) as {
    error?: { message: string }
    result?: { isError?: boolean; content?: { text?: string }[] }
  }
  if (json.error) throw new Error(json.error.message)
  return { ok: !json.result?.isError, text: json.result?.content?.[0]?.text ?? '' }
}

// Base units to a decimal string by integer arithmetic, for the 2 mints whose decimals we pin.
const DECIMALS: Record<string, [number, string]> = {
  So11111111111111111111111111111111111111112: [9, 'SOL'],
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: [6, 'USDC'],
}
function units(amount: string, mint: string): string {
  const d = DECIMALS[mint]
  if (!d || !/^\d+$/.test(amount)) return `${amount} base units`
  const padded = amount.padStart(d[0] + 1, '0')
  const whole = padded.slice(0, -d[0])
  const frac = padded.slice(-d[0]).replace(/0+$/, '')
  return `${whole}${frac ? '.' + frac : ''} ${d[1]}`
}

type Rule = {
  vault: string
  effectiveRemaining: string
  rollingWorstCase: string
  swigRole: {
    authority: string
    tokenRecurringLimit: { mint: string; amount: string; windowSlots: number }
  }
}

function openInBrowser(url: string, failed: (cause: string) => void) {
  const [cmd, args] =
    process.platform === 'win32'
      ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
      : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url]]
  const child = spawn(cmd, args as string[], { detached: true, stdio: 'ignore' })
  child.on('error', (e) => failed(`${cmd}: ${e.message}`))
  // xdg-open with no browser installed exits non-zero instead of failing to start.
  child.on('exit', (code) => {
    if (code) failed(`${cmd} exited with code ${code}`)
  })
  child.unref()
}

// A rule as the server sent it is outside data: each field is checked before it is drawn.
const isRule = (r: unknown): r is Rule => {
  const x = r as Rule
  return (
    !!x &&
    typeof x.vault === 'string' &&
    typeof x.effectiveRemaining === 'string' &&
    typeof x.rollingWorstCase === 'string' &&
    typeof x.swigRole?.authority === 'string' &&
    typeof x.swigRole?.tokenRecurringLimit?.mint === 'string' &&
    typeof x.swigRole?.tokenRecurringLimit?.amount === 'string' &&
    typeof x.swigRole?.tokenRecurringLimit?.windowSlots === 'number'
  )
}

function Setup(props: { model: Model; options: Options; back: () => void }) {
  const api = props.model.api
  const theme = () => api.theme.current
  const [wallet, setWallet] = createSignal(api.kv.get<string>(WALLET_KEY, ''))
  const [server, setServer] = createSignal<'checking' | 'up' | string>('checking')
  const [network, setNetwork] = createSignal<string | null>(null)
  const [rules, setRules] = createSignal<Rule[] | null>(null)
  const [refusal, setRefusal] = createSignal<string | null>(null)
  const [loading, setLoading] = createSignal(false)
  const dims = useTerminalDimensions()

  // Only the latest run writes: a slow answer for a wallet the user has since changed is dropped,
  // rather than shown under the new address. The last answer stays on screen until the new one
  // lands, so the page does not blank out every 30 s, unless the server or the wallet changed.
  let run = 0
  let readFor = ''
  const refresh = async () => {
    const mine = ++run
    if (server() !== 'up') setServer('checking')
    let up: string
    try {
      const res = await fetch(`${props.options.mcpUrl}/health`, {
        signal: AbortSignal.timeout(5_000),
      })
      up = res.ok ? 'up' : `answered ${res.status}`
    } catch (e) {
      up = e instanceof Error ? e.message : String(e)
    }
    if (mine !== run) return
    setServer(up)
    if (up !== 'up' || !wallet() || readFor !== wallet()) {
      setRules(null)
      setRefusal(null)
      setNetwork(null)
    }
    if (up !== 'up' || !wallet()) return
    setLoading(true)
    try {
      const r = await mcpCall(props.options.mcpUrl, 'list_rules', { wallet: wallet() })
      if (mine !== run) return
      readFor = wallet()
      if (!r.ok) {
        setRules(null)
        return setRefusal(r.text.trim().slice(0, 400))
      }
      const body = JSON.parse(r.text) as { network?: unknown; rules?: unknown }
      if (!Array.isArray(body.rules) || !body.rules.every(isRule)) {
        setRules(null)
        return setRefusal(
          'the server answered list_rules without a list of rules in the expected shape, so nothing is shown rather than a guess. Check that the Agon server is current, or rebuild it with docker compose up -d --build',
        )
      }
      setNetwork(typeof body.network === 'string' ? body.network : null)
      setRefusal(null)
      setRules(body.rules)
    } catch (e) {
      // A failed read clears the rules, so an old "can spend now" is never shown as current.
      if (mine === run) {
        setRules(null)
        setRefusal(e instanceof Error ? e.message : String(e))
      }
    } finally {
      if (mine === run) setLoading(false)
    }
  }
  void refresh()
  const timer = setInterval(() => void refresh(), 30_000)
  onCleanup(() => clearInterval(timer))

  const askWallet = () => {
    api.ui.dialog.replace(() => (
      <api.ui.DialogPrompt
        title="Your wallet address"
        placeholder="the public address your agent trades for, not a key"
        value={wallet()}
        onCancel={() => api.ui.dialog.clear()}
        onConfirm={(value) => {
          api.ui.dialog.clear()
          const v = value.trim()
          if (v && !BASE58.test(v)) {
            api.ui.toast({
              variant: 'error',
              message: `"${v.slice(0, 12)}" is not a Solana address: it must be 32 to 44 base58 characters. Nothing was saved.`,
            })
            return
          }
          setWallet(v)
          api.kv.set(WALLET_KEY, v)
          void refresh()
        }}
      />
    ))
  }
  const openArm = () => {
    openInBrowser(props.options.armUrl, (cause) =>
      api.ui.toast({
        variant: 'error',
        message: `Could not open a browser (${cause}). Open ${props.options.armUrl} yourself.`,
      }),
    )
    api.ui.toast({
      variant: 'info',
      message: `Opening ${props.options.armUrl}. Your wallet signs there, not here.`,
    })
  }
  const onboard = async () => {
    props.back()
    try {
      await api.client.tui.appendPrompt({ text: 'Onboard me with Agon.' })
      api.ui.toast({
        variant: 'info',
        message: 'Added to your prompt. Review it, then press Enter.',
      })
    } catch (e) {
      api.ui.toast({
        variant: 'error',
        message: `Could not fill the prompt (${e instanceof Error ? e.message : String(e)}). Nothing was sent.`,
      })
    }
  }

  useKeyboard((key) => {
    if (api.ui.dialog.open || key.ctrl || key.meta) return
    const k = key.name
    if (k === 'escape' || k === 'q') props.back()
    else if (k === 'w') askWallet()
    else if (k === 'r') void refresh()
    else if (k === 'o') openArm()
    else if (k === 'p') void onboard()
  })

  const mark = (ok: boolean | null) => (ok === null ? '[ ]' : ok ? '[x]' : '[!]')
  const colour = (ok: boolean | null) =>
    ink(api, ok === null ? theme()?.textMuted : ok ? theme()?.success : theme()?.error)
  // Padding on a text does nothing in this OpenTUI, so the detail is indented by a box.
  const Step = (p: { ok: boolean | null; title: string; detail: string }) => (
    <box flexDirection="column" flexShrink={0}>
      <text fg={colour(p.ok)}>{`${mark(p.ok)} ${p.title}`}</text>
      <box paddingLeft={4}>
        <text fg={ink(api, theme()?.textMuted)} wrapMode="word">
          {p.detail}
        </text>
      </box>
    </box>
  )
  // The number that matters, as large as the width allows: 6 lines when it fits, 2 when not, and
  // plain text for a mint whose decimals are not pinned, which also names the mint.
  const Remaining = (p: { amount: string; mint: string }) => {
    const text = () => units(p.amount, p.mint)
    const room = () => dims().width - 10
    return (
      <Show
        when={DECIMALS[p.mint] && text().length * 4 <= room()}
        fallback={<text fg={ink(api, theme()?.success)}>{`${text()} of ${short(p.mint)}`}</text>}
      >
        <ascii_font
          text={text()}
          font={text().length * 8 <= room() ? 'block' : 'tiny'}
          color={ink(api, theme()?.success)}
        />
      </Show>
    )
  }

  return (
    <box flexDirection="column" padding={1} gap={1} flexGrow={1}>
      <box flexDirection="row" gap={1} height={1}>
        <text fg={theme()?.text}>
          <b>Agon setup</b>
        </text>
        <text fg={ink(api, theme()?.textMuted)}>
          {network() ? `network: ${network()}` : 'network: not read yet'}
        </text>
      </box>
      <scrollbox flexGrow={1}>
        <Step
          ok={server() === 'checking' ? null : server() === 'up'}
          title="Agon server"
          detail={
            server() === 'up'
              ? `answering at ${props.options.mcpUrl}`
              : server() === 'checking'
                ? `checking ${props.options.mcpUrl}`
                : `not answering at ${props.options.mcpUrl} (${server()}). Start it with:`
          }
        />
        <Show when={server() !== 'up' && server() !== 'checking'}>
          <box paddingLeft={4} flexShrink={0}>
            <text fg={theme()?.text} wrapMode="none">
              docker compose up -d --build
            </text>
          </box>
        </Show>
        <Step
          ok={wallet() ? true : null}
          title="Your wallet"
          detail={
            wallet()
              ? `${wallet()} (public address only, stored in opencode)`
              : 'not set. Press w or the button below'
          }
        />
        <Step
          ok={rules() ? rules()!.length > 0 : refusal() ? false : null}
          title="Vault and agent role"
          detail={
            refusal()
              ? `not read: ${refusal()}`
              : !rules()
                ? server() === 'up' && wallet()
                  ? loading()
                    ? `reading list_rules from ${props.options.mcpUrl}`
                    : 'not read yet'
                  : `needs ${[server() === 'up' ? '' : 'the server', wallet() ? '' : 'your wallet'].filter(Boolean).join(' and ')}`
                : rules()!.length === 0
                  ? 'no agent role is armed on this wallet. Arm one on the web screen'
                  : `${rules()!.length} armed`
          }
        />
        <For each={rules() ?? []}>
          {(r) => {
            const lim = r.swigRole.tokenRecurringLimit
            return (
              <box flexDirection="column" paddingLeft={4} flexShrink={0}>
                <text
                  fg={theme()?.text}
                >{`vault ${short(r.vault)}   agent ${short(r.swigRole.authority)}`}</text>
                <text
                  fg={theme()?.text}
                >{`cap ${units(lim.amount, lim.mint)} per ${lim.windowSlots} slots`}</text>
                <text fg={ink(api, theme()?.success)}>can spend now</text>
                <Remaining amount={r.effectiveRemaining} mint={lim.mint} />
                <text fg={ink(api, theme()?.textMuted)} wrapMode="word">
                  {`most that can go out across a window edge ${units(r.rollingWorstCase, lim.mint)}`}
                </text>
              </box>
            )
          }}
        </For>
      </scrollbox>
      <box flexDirection="row" gap={1} height={1} flexShrink={0}>
        <Button model={props.model} label="w wallet" onPress={askWallet} />
        <Button model={props.model} label="o open arming screen" onPress={openArm} />
        <Button model={props.model} label="p onboard me in chat" onPress={() => void onboard()} />
        <Button model={props.model} label="r refresh" onPress={() => void refresh()} />
      </box>
      <text fg={ink(api, theme()?.textMuted)} wrapMode="word" flexShrink={0}>
        {
          'Arming, funding and revoking happen on the web screen, signed by your own wallet. This page only reads. esc back'
        }
      </text>
    </box>
  )
}

/* ---------------------------------------------------------------------------------------------- */
/* plugin                                                                                          */
/* ---------------------------------------------------------------------------------------------- */

const tui: TuiPlugin = async (api, rawOptions) => {
  const options = toOptions(rawOptions)
  const [model, dispose] = createRoot((disposeRoot) => {
    const m = createModel(api, options)
    return [
      m,
      () => {
        m.stop()
        disposeRoot()
      },
    ] as const
  })
  api.lifecycle.onDispose(dispose)

  // Loaded here rather than at the top: agon-trade.tsx imports helpers from this file, and by now
  // this module has finished evaluating, so the cycle is harmless.
  const { TRADE_ROUTE, createTrade } = await import('./agon-trade.tsx')
  const trade = createTrade(api, options.mcpUrl)
  const ours = new Set([ROUTE, SETUP_ROUTE, TRADE_ROUTE])

  // Where to return to when the page closes: the route that was open when it was entered.
  let previous: { name: string; params?: Record<string, unknown> } = { name: 'home' }
  const enter = (name: string) => {
    const cur = api.route.current as { name: string; params?: Record<string, unknown> }
    if (!ours.has(cur.name)) previous = cur
    api.route.navigate(name)
  }
  const open = () => enter(ROUTE)
  const back = () => api.route.navigate(previous.name, previous.params)
  const openSetup = () => enter(SETUP_ROUTE)
  // The trade view goes back to discovery when it was opened from there.
  let tradeFromDiscovery = false
  const openTrade = (mint?: string, label?: string) => {
    if (mint && !trade.show(mint, label ?? null)) return
    tradeFromDiscovery = api.route.current.name === ROUTE
    enter(TRADE_ROUTE)
  }
  const tradeBack = () => (tradeFromDiscovery ? api.route.navigate(ROUTE) : back())

  api.route.register([
    { name: ROUTE, render: () => <Page model={model} back={back} trade={openTrade} /> },
    { name: SETUP_ROUTE, render: () => <Setup model={model} options={options} back={back} /> },
    { name: TRADE_ROUTE, render: () => trade.render(tradeBack, back) },
  ])

  api.command?.register(() => [
    {
      title: 'Agon discovery',
      value: ROUTE,
      description: 'Live tokens: trending, most traded, top organic, new',
      category: 'Agon',
      slash: { name: 'discover' },
      onSelect: open,
    },
    {
      title: 'Agon setup',
      value: SETUP_ROUTE,
      description: 'Where onboarding stands: the Agon server, your wallet, your vault and cap',
      category: 'Agon',
      slash: { name: 'agon-setup' },
      onSelect: openSetup,
    },
    {
      title: 'Agon trade',
      value: TRADE_ROUTE,
      description: 'Candles, book or depth, recent trades and the status line for the last token',
      category: 'Agon',
      slash: { name: 'trade' },
      onSelect: () => openTrade(),
    },
  ])

  api.slots.register({
    order: 150,
    slots: {
      sidebar_content() {
        return <Sidebar model={model} open={open} openSetup={openSetup} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = { id: ID, tui }
export default plugin
