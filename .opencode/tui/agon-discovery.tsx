/** @jsxImportSource @opentui/solid */
// Agon discovery inside opencode.
//
// - A live sidebar panel for your watchlist.
// - A full-screen page (`/discover`, or "Agon discovery" in the command palette) with Jupiter's
//   trending, most traded, top organic or newest tokens, sortable and searchable, with a detail pane,
//   a large logo and a braille price chart for the selected token. The sidebar has 24h sparklines.
// - Quick actions that hand an instruction to the opencode agent: b buy, x sell, c check. They
//   only ever fill the chat box. You read it and press Enter; the agent then runs Agon's check_trade
//   before anything is built, and your wallet signs. This plugin never signs, sends or reads keys.
//
// - Mouse: click a row to select it, the wheel scrolls the list, column titles sort, and the chips
//   and buttons do what their keys do. Clicking a sidebar token opens the page on it.
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
import { useKeyboard } from '@opentui/solid'
import { inflateSync } from 'node:zlib'
import { spawn } from 'node:child_process'
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from '@opencode-ai/plugin/tui'

const ID = 'agon-discovery'
const ROUTE = 'agon.discovery'
const JUP = 'https://lite-api.jup.ag/tokens/v2'
const WATCH_KEY = 'agon.discovery.watchlist'

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
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Jupiter answered ${res.status}`)
  const body = (await res.json()) as unknown
  if (!Array.isArray(body)) throw new Error('Jupiter answered something that is not a token list')
  return body.map((t) => toToken(t as Record<string, any>))
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

type Series = { closes: number[]; volumes: number[] }

async function topPool(mint: string): Promise<string | null> {
  const res = await fetch(`${GT}/tokens/${mint}/pools?page=1`)
  if (!res.ok) throw new Error(`GeckoTerminal answered ${res.status}`)
  const body = (await res.json()) as { data?: Array<{ attributes?: Record<string, any> }> }
  const pools = (body.data ?? [])
    .map((p) => p.attributes ?? {})
    .filter((a) => typeof a.address === 'string')
    .sort((a, b) => Number(b.reserve_in_usd ?? 0) - Number(a.reserve_in_usd ?? 0))
  return pools[0]?.address ?? null
}

async function candles(pool: string, range: Range): Promise<Series> {
  const url = `${GT}/pools/${pool}/ohlcv/${range.path}?aggregate=${range.aggregate}&limit=${range.limit}&token=base`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`GeckoTerminal answered ${res.status}`)
  const body = (await res.json()) as { data?: { attributes?: { ohlcv_list?: number[][] } } }
  // Newest first from the API; charts read oldest first.
  const list = [...(body.data?.attributes?.ohlcv_list ?? [])].reverse()
  return { closes: list.map((c) => c[4]!), volumes: list.map((c) => c[5]!) }
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

const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length))
const lpad = (s: string, n: number) =>
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
  const [d, s] = v >= 1e9 ? [1e9, 'B'] : v >= 1e6 ? [1e6, 'M'] : v >= 1e3 ? [1e3, 'K'] : [1, '']
  return `${dollar ? '$' : ''}${(v / d).toFixed(v >= 1e3 ? 1 : 0)}${s}`
}
const short = (mint: string) => `${mint.slice(0, 4)}...${mint.slice(-4)}`

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
  const [watchMints, setWatchMints] = createSignal<string[]>(
    api.kv.get<string[]>(WATCH_KEY, DEFAULT_WATCHLIST),
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
  const chart = (mint: string, range: number, maxAgeMs = 60_000) => {
    const key = `${mint}:${range}`
    const have = series().get(key)
    if ((have && Date.now() - have.at < maxAgeMs) || loadingSeries.has(key)) return have
    loadingSeries.add(key)
    if (!pools.has(mint))
      pools.set(
        mint,
        topPool(mint).catch(() => null),
      )
    void pools
      .get(mint)!
      .then(async (pool) => {
        if (!pool) return { data: null, error: 'no pool with a price history' }
        return { data: await candles(pool, RANGES[range]!), error: null }
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

  const refresh = async () => {
    try {
      const mints = watchMints()
      const [w, l] = await Promise.all([
        mints.length ? getTokens(`${JUP}/search?query=${mints.join(',')}`) : Promise.resolve([]),
        getTokens(listUrl()),
      ])
      const byMint = new Map(w.map((t) => [t.mint, t]))
      setWatchlist(mints.flatMap((m) => (byMint.has(m) ? [byMint.get(m)!] : [])))
      setList(l)
      setUpdatedAt(Date.now())
      setError(null)
    } catch (e) {
      // The last good rows stay on screen, and the reason they are not moving is said.
      setError(
        `${e instanceof Error ? e.message : String(e)}, retrying in ${options.refreshMs / 1000}s`,
      )
    }
  }
  // A new list or watchlist is fetched at once rather than on the next poll.
  createEffect(on([source, interval, watchMints], () => void refresh()))
  const poll = setInterval(() => void refresh(), options.refreshMs)
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
          <text fg={theme()?.accent}>{pad(props.token.symbol.slice(0, 1), props.size)}</text>
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
      <text fg={props.active ? theme()?.primary : theme()?.accent} wrapMode="none">
        {props.label}
      </text>
    </box>
  )
}

const colourOf = (api: TuiPluginApi, c: number | null) =>
  c === null
    ? api.theme.current?.textMuted
    : c >= 0
      ? api.theme.current?.success
      : api.theme.current?.error

function Sidebar(props: { model: Model; open: () => void; openSetup: () => void }) {
  const api = props.model.api
  const theme = () => api.theme.current
  return (
    <box flexDirection="column" gap={0}>
      <box flexDirection="row" gap={1} height={1}>
        <text fg={theme()?.text}>
          <b>Agon watchlist</b>
        </text>
        <text fg={theme()?.textMuted}>{props.model.age()}</text>
      </box>
      <For each={props.model.watchlist()}>
        {(t) => (
          <box
            flexDirection="row"
            gap={1}
            height={3}
            onMouseDown={(e) => {
              if (e.button !== 0) return
              props.model.setFocus(t.mint)
              props.open()
            }}
          >
            <Logo model={props.model} token={t} size={6} />
            <box flexDirection="column">
              <text fg={theme()?.text} wrapMode="none">
                {pad(t.symbol, 8) + lpad(price(t.price), 11)}
              </text>
              <box flexDirection="row" gap={1} height={1}>
                <text fg={colourOf(api, t.change24h)} wrapMode="none">
                  {sparkline(props.model.chart(t.mint, 1, 300_000)?.data?.closes ?? [], 10)}
                </text>
                <text fg={colourOf(api, t.change5m)} wrapMode="none">
                  {`5m ${pct(t.change5m)}`}
                </text>
              </box>
            </box>
          </box>
        )}
      </For>
      <box flexDirection="row" height={1}>
        <Button model={props.model} label="open discovery" onPress={props.open} />
        <Button model={props.model} label="setup" onPress={props.openSetup} />
      </box>
      <Show when={props.model.error()}>
        <text fg={theme()?.warning}>{props.model.error()}</text>
      </Show>
    </box>
  )
}

function Chart(props: {
  model: Model
  token: Token
  range: number
  setRange: (r: number) => void
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
  const entry = () => (settled() ? props.model.chart(props.token.mint, props.range) : undefined)
  const data = () => entry()?.data ?? null
  const first = () => data()?.closes[0] ?? null
  const last = () => data()?.closes.at(-1) ?? null
  const change = () => (first() && last() ? ((last()! - first()!) / first()!) * 100 : null)
  return (
    <box flexDirection="column" gap={0}>
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
          <text fg={theme()?.textMuted}>
            {entry()?.error ? `no chart: ${entry()!.error}` : 'loading chart'}
          </text>
        }
      >
        <For each={brailleLine(data()!.closes, 36, 8)}>
          {(line) => (
            <text fg={colourOf(api, change())} wrapMode="none">
              {line}
            </text>
          )}
        </For>
        <text fg={theme()?.textMuted} wrapMode="none">
          {sparkline(data()!.volumes, 36)}
        </text>
        <text fg={theme()?.textMuted} wrapMode="none">
          {`hi ${price(Math.max(...data()!.closes))}  lo ${price(Math.min(...data()!.closes))}  last ${price(last())}`}
        </text>
      </Show>
    </box>
  )
}

type Actions = {
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
}) {
  const api = props.model.api
  const theme = () => api.theme.current
  const yes = (v: boolean | null, good: string, bad: string) =>
    v === null ? 'unknown' : v ? good : bad
  return (
    <box flexDirection="column" width={42} paddingLeft={2} gap={0}>
      <Show when={props.token} fallback={<text fg={theme()?.textMuted}>no token selected</text>}>
        {(t) => (
          <>
            <box flexDirection="row" gap={2}>
              <Logo model={props.model} token={t()} size={20} />
              <box flexDirection="column">
                <text fg={theme()?.text}>
                  <b>{t().symbol}</b>
                </text>
                <text fg={theme()?.text}>{price(t().price)}</text>
                <text fg={colourOf(api, t().change24h)}>{`24h ${pct(t().change24h)}`}</text>
              </box>
            </box>
            <box flexDirection="row" height={1}>
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
            <Chart model={props.model} token={t()} range={props.range} setRange={props.setRange} />
            <text fg={theme()?.textMuted} wrapMode="none">
              {pad(t().name, 36)}
            </text>
            <text fg={theme()?.textMuted}>{short(t().mint)}</text>
            <text fg={theme()?.text}>{`${price(t().price)}  mcap ${compact(t().mcap)}`}</text>
            <text fg={colourOf(api, t().change24h)}>
              {`5m ${pct(t().change5m)}  1h ${pct(t().change1h)}  24h ${pct(t().change24h)}`}
            </text>
            <text fg={theme()?.text}>
              {`1h: ${compact(t().buys1h, false)} buys, ${compact(t().sells1h, false)} sells, ${compact(t().traders1h, false)} traders`}
            </text>
            <text fg={theme()?.text}>
              {`holders ${compact(t().holders, false)} (${pct(t().holderChange1h)} 1h)`}
            </text>
            <text fg={theme()?.text}>{`liquidity ${compact(t().liquidity)}`}</text>
            <text fg={t().mintAuthorityOff === false ? theme()?.warning : theme()?.text}>
              {`mint authority ${yes(t().mintAuthorityOff, 'disabled', 'LIVE')}`}
            </text>
            <text fg={t().freezeAuthorityOff === false ? theme()?.warning : theme()?.text}>
              {`freeze authority ${yes(t().freezeAuthorityOff, 'disabled', 'LIVE')}`}
            </text>
            <text fg={theme()?.text}>
              {`top holders ${t().topHoldersPct === null ? '-' : t().topHoldersPct!.toFixed(1) + '%'}, dev ${t().devPct === null ? '-' : t().devPct!.toFixed(2) + '%'}`}
            </text>
            <text fg={theme()?.text}>
              {`organic ${t().organic === null ? '-' : t().organic!.toFixed(0)} ${t().organicLabel ?? ''}${t().verified ? ', verified' : ''}`}
            </text>
            <text fg={theme()?.textMuted} wrapMode="word">
              {t().tags.slice(0, 6).join(', ')}
            </text>
            <text
              fg={
                props.model.watchMints().includes(t().mint) ? theme()?.success : theme()?.textMuted
              }
            >
              {props.model.watchMints().includes(t().mint)
                ? 'on your watchlist'
                : 'w to add to watchlist'}
            </text>
          </>
        )}
      </Show>
    </box>
  )
}

function Page(props: { model: Model; back: () => void }) {
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

  // Each row is 2 lines tall for a 4 by 4 pixel logo. Header, filters, column titles and key hints
  // take 8 lines, so what is left decides how many rows fit.
  const visible = () => Math.max(3, Math.floor(((api.renderer.height ?? 40) - 8) / 2))

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

  const move = (to: number) => {
    model.setFocus(null)
    const n = rows().length
    const i = n === 0 ? 0 : Math.max(0, Math.min(n - 1, to))
    setSelected(i)
    if (i < offset()) setOffset(i)
    else if (i >= offset() + visible()) setOffset(i - visible() + 1)
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
      const i = m ? list.findIndex((t) => t.mint === m) : -1
      if (i >= 0) move(i)
    }),
  )
  const current = () => focused() ?? rows()[selected()]
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
        title={side === 'buy' ? `Buy ${t.symbol}` : `Sell ${t.symbol}`}
        placeholder={
          side === 'buy' ? 'amount of SOL to spend, e.g. 0.1' : "amount to sell, or 'all'"
        }
        onCancel={() => api.ui.dialog.clear()}
        onConfirm={(value) => {
          api.ui.dialog.clear()
          const amount = value.trim()
          if (!amount) return
          void handOff(
            side === 'buy'
              ? `Buy ${amount} SOL of ${t.symbol} (mint ${t.mint}). Run Agon check_trade on it first and show me the verdict with its reasons. Build nothing unless it passes, and let me sign.`
              : `Sell ${amount} of ${t.symbol} (mint ${t.mint}) for SOL. Run Agon check_trade on it first and show me the verdict with its reasons. Build nothing unless it passes, and let me sign.`,
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
    buy: (t) => askAmount('buy', t),
    sell: (t) => askAmount('sell', t),
    check: (t) =>
      void handOff(
        `Run Agon check_trade for a buy of ${t.symbol} (mint ${t.mint}) at my usual size and explain the verdict. Do not trade.`,
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
  const nextSource = () => {
    model.setSource((model.source() + 1) % SOURCES.length)
    reset()
  }
  const nextInterval = () => {
    model.setInterval((model.interval() + 1) % INTERVALS.length)
    reset()
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
    // A dialog owns the keyboard while it is open.
    if (api.ui.dialog.open) return
    const k = key.name
    const t = current()
    if (k === 'escape' || k === 'q') props.back()
    else if (k === 'down' || k === 'j') move(selected() + 1)
    else if (k === 'up' || k === 'k') move(selected() - 1)
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
    else if (k === 'w') actions.watch(t)
    else if (k === 'y') actions.copy(t)
    else if (k === 'b') actions.buy(t)
    else if (k === 'x') actions.sell(t)
    else if (k === 'c') actions.check(t)
  })

  const window = () => rows().slice(offset(), offset() + visible())
  const src = () => SOURCES[model.source()]!
  // Column titles: label, width, and the SORTS index a click sorts by (null for none).
  const columns: [string, number, number | null][] = [
    ['', 5, null],
    ['token', 10, null],
    ['price', 11, null],
    ['5m', 9, 1],
    ['1h', 9, 2],
    ['24h', 9, 3],
    ['vol 24h', 10, 0],
    ['liq', 10, 5],
    ['mcap', 10, 4],
    ['holders', 9, 6],
    ['org', 5, 7],
  ]

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
        <text fg={theme()?.textMuted}>{`${rows().length} tokens, ${model.age()}`}</text>
      </box>
      <box flexDirection="row" gap={1} height={1}>
        <Button model={model} label={`sort: ${SORTS[sort()]!.label}`} onPress={nextSort} />
        <Button model={model} label={desc() ? 'high to low' : 'low to high'} onPress={reverse} />
        <Button
          model={model}
          label={search() ? `search: "${search()}"` : 'search'}
          onPress={askSearch}
        />
        <Button
          model={model}
          label={auditedOnly() ? 'authorities disabled only' : 'all tokens'}
          active={auditedOnly()}
          onPress={toggleAudited}
        />
      </box>
      <box flexDirection="row" flexGrow={1}>
        <box
          flexDirection="column"
          flexGrow={1}
          onMouseScroll={(e) => {
            const d = e.scroll?.direction
            if (d === 'down') move(selected() + 1)
            else if (d === 'up') move(selected() - 1)
          }}
        >
          <box flexDirection="row" height={1}>
            <For each={columns}>
              {([label, width, key]) => {
                const active = () => key !== null && sort() === key
                const text = () => (active() ? (desc() ? 'v ' : '^ ') : '') + label
                return (
                  <box
                    width={width}
                    height={1}
                    onMouseDown={(e) => {
                      if (e.button === 0 && key !== null) sortBy(key)
                    }}
                  >
                    <text fg={active() ? theme()?.primary : theme()?.textMuted} wrapMode="none">
                      {label === 'token' ? pad(text(), width) : lpad(text(), width)}
                    </text>
                  </box>
                )
              }}
            </For>
          </box>
          <For each={window()}>
            {(t, i) => {
              const isSel = () => current()?.mint === t.mint
              const base = () => (isSel() ? theme()?.primary : theme()?.text)
              const watched = () => model.watchMints().includes(t.mint)
              return (
                <box
                  flexDirection="row"
                  height={2}
                  gap={1}
                  backgroundColor={
                    isSel()
                      ? theme()?.backgroundElement
                      : hovered() === t.mint
                        ? theme()?.backgroundPanel
                        : undefined
                  }
                  onMouseOver={() => setHovered(t.mint)}
                  onMouseOut={() => setHovered((h) => (h === t.mint ? null : h))}
                  onMouseDown={(e) => {
                    if (e.button === 0) move(offset() + i())
                  }}
                >
                  <Logo model={model} token={t} size={4} />
                  <text fg={base()} wrapMode="none">
                    {pad((watched() ? '*' : '') + t.symbol, 10) + lpad(price(t.price), 11)}
                  </text>
                  <text fg={colourOf(api, t.change5m)} wrapMode="none">
                    {lpad(pct(t.change5m), 8)}
                  </text>
                  <text fg={colourOf(api, t.change1h)} wrapMode="none">
                    {lpad(pct(t.change1h), 8)}
                  </text>
                  <text fg={colourOf(api, t.change24h)} wrapMode="none">
                    {lpad(pct(t.change24h), 8)}
                  </text>
                  <text fg={base()} wrapMode="none">
                    {lpad(compact(t.volume24h), 9) +
                      lpad(compact(t.liquidity), 10) +
                      lpad(compact(t.mcap), 10) +
                      lpad(compact(t.holders, false), 9) +
                      lpad(t.organic === null ? '-' : t.organic.toFixed(0), 5)}
                  </text>
                </box>
              )
            }}
          </For>
        </box>
        <Detail
          model={model}
          token={current()}
          range={range()}
          setRange={setRange}
          actions={actions}
        />
      </box>
      <Show when={model.error()}>
        <text fg={theme()?.warning}>{model.error()}</text>
      </Show>
      <text fg={theme()?.textMuted} wrapMode="word">
        {`click or j/k select, wheel scrolls, click a column to sort  s sort  r reverse  t list  i interval  v chart  / search  a audited  w watch  y copy  b buy  x sell  c check  esc back`}
      </text>
    </box>
  )
}

/* ---------------------------------------------------------------------------------------------- */
/* setup                                                                                           */
/* ---------------------------------------------------------------------------------------------- */

const SETUP_ROUTE = 'agon.setup'
const WALLET_KEY = 'agon.setup.wallet'
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

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

function openInBrowser(url: string) {
  const [cmd, args] =
    process.platform === 'win32'
      ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
      : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url]]
  const child = spawn(cmd, args as string[], { detached: true, stdio: 'ignore' })
  child.on('error', () => {})
  child.unref()
}

function Setup(props: { model: Model; options: Options; back: () => void }) {
  const api = props.model.api
  const theme = () => api.theme.current
  const [wallet, setWallet] = createSignal(api.kv.get<string>(WALLET_KEY, ''))
  const [server, setServer] = createSignal<'checking' | 'up' | string>('checking')
  const [network, setNetwork] = createSignal<string | null>(null)
  const [rules, setRules] = createSignal<Rule[] | null>(null)
  const [refusal, setRefusal] = createSignal<string | null>(null)

  // Only the latest run writes: a slow answer for a wallet the user has since changed is dropped,
  // rather than shown under the new address.
  let run = 0
  const refresh = async () => {
    const mine = ++run
    setServer('checking')
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
    setRules(null)
    setRefusal(null)
    setNetwork(null)
    if (up !== 'up' || !wallet()) return
    try {
      const r = await mcpCall(props.options.mcpUrl, 'list_rules', { wallet: wallet() })
      if (mine !== run) return
      if (!r.ok) return setRefusal(r.text.split('\n')[0] ?? r.text)
      const body = JSON.parse(r.text) as { network?: string; rules?: Rule[] }
      setNetwork(body.network ?? null)
      setRules(body.rules ?? [])
    } catch (e) {
      if (mine === run) setRefusal(e instanceof Error ? e.message : String(e))
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
    openInBrowser(props.options.armUrl)
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
    if (api.ui.dialog.open) return
    const k = key.name
    if (k === 'escape' || k === 'q') props.back()
    else if (k === 'w') askWallet()
    else if (k === 'r') void refresh()
    else if (k === 'o') openArm()
    else if (k === 'p') void onboard()
  })

  const mark = (ok: boolean | null) => (ok === null ? '[ ]' : ok ? '[x]' : '[!]')
  const colour = (ok: boolean | null) =>
    ok === null ? theme()?.textMuted : ok ? theme()?.success : theme()?.warning
  const Step = (p: { ok: boolean | null; title: string; detail: string }) => (
    <box flexDirection="column">
      <text fg={colour(p.ok)}>{`${mark(p.ok)} ${p.title}`}</text>
      <text fg={theme()?.textMuted} wrapMode="word" paddingLeft={4}>
        {p.detail}
      </text>
    </box>
  )

  return (
    <box flexDirection="column" padding={1} gap={1} flexGrow={1}>
      <box flexDirection="row" gap={1} height={1}>
        <text fg={theme()?.text}>
          <b>Agon setup</b>
        </text>
        <text fg={theme()?.textMuted}>
          {network() ? `network: ${network()}` : 'network: not read yet'}
        </text>
      </box>
      <Step
        ok={server() === 'checking' ? null : server() === 'up'}
        title="Agon server"
        detail={
          server() === 'up'
            ? `answering at ${props.options.mcpUrl}`
            : server() === 'checking'
              ? `checking ${props.options.mcpUrl}`
              : `not answering at ${props.options.mcpUrl} (${server()}). Start it with: docker compose up -d --build`
        }
      />
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
              ? 'needs the server and your wallet'
              : rules()!.length === 0
                ? 'no agent role is armed on this wallet. Arm one on the web screen'
                : `${rules()!.length} armed`
        }
      />
      <For each={rules() ?? []}>
        {(r) => {
          const lim = r.swigRole.tokenRecurringLimit
          return (
            <box flexDirection="column" paddingLeft={4}>
              <text
                fg={theme()?.text}
              >{`vault ${short(r.vault)}   agent ${short(r.swigRole.authority)}`}</text>
              <text
                fg={theme()?.text}
              >{`cap ${units(lim.amount, lim.mint)} per ${lim.windowSlots} slots`}</text>
              <text
                fg={theme()?.success}
              >{`can spend now ${units(r.effectiveRemaining, lim.mint)}`}</text>
              <text fg={theme()?.textMuted}>
                {`most that can go out across a window edge ${units(r.rollingWorstCase, lim.mint)}`}
              </text>
            </box>
          )
        }}
      </For>
      <box flexDirection="row" gap={1} height={1}>
        <Button model={props.model} label="w wallet" onPress={askWallet} />
        <Button model={props.model} label="o open arming screen" onPress={openArm} />
        <Button model={props.model} label="p onboard me in chat" onPress={() => void onboard()} />
        <Button model={props.model} label="r refresh" onPress={() => void refresh()} />
      </box>
      <text fg={theme()?.textMuted} wrapMode="word">
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

  // Where to return to when the page closes: the route that was open when it was entered.
  let previous: { name: string; params?: Record<string, unknown> } = { name: 'home' }
  const open = () => {
    const cur = api.route.current as { name: string; params?: Record<string, unknown> }
    if (cur.name !== ROUTE && cur.name !== SETUP_ROUTE) previous = cur
    api.route.navigate(ROUTE)
  }
  const back = () => api.route.navigate(previous.name, previous.params)

  const openSetup = () => {
    const cur = api.route.current as { name: string; params?: Record<string, unknown> }
    if (cur.name !== ROUTE && cur.name !== SETUP_ROUTE) previous = cur
    api.route.navigate(SETUP_ROUTE)
  }

  api.route.register([
    { name: ROUTE, render: () => <Page model={model} back={back} /> },
    { name: SETUP_ROUTE, render: () => <Setup model={model} options={options} back={back} /> },
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
