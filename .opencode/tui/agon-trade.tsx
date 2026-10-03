/** @jsxImportSource @opentui/solid */
// The trade view inside opencode (T-E24): a status line, the market header, half-block candles with
// MA and EMA, a hover crosshair, the order book or depth, and recent trades for 1 mint.
//
// Every number on this page comes from the Agon server: `GET /market` (candles, indicators, trades,
// 24h stats, the pool it chose with its liquidity and, once T-C35 lands, the book), `GET /status`
// (ping, SOL price, network) and `GET /stream` (connection state and the live slot). The page does 0 money
// arithmetic: it formats and draws what the server sent. Scaling prices onto rows and ages in
// seconds are the only sums here, and neither produces a number a trade could use.
//
// Loaded by agon-discovery.tsx, which owns the plugin and its routes. b and s open a ticket that
// only fills the chat box with the mint, never a token's name or symbol, and never sends: order
// entry is Part 4 of docs/plans/agon-terminal.md. a (T-E28) fills it with the ask packet below, the
// screen's numbers and the mint, and never sends either. opencode 1.18.34 binds no bare a: of its
// 153 default keys only the diff viewer's take bare letters (b, d, n, p, q, s, v).

import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from 'solid-js'
import { useKeyboard, useTerminalDimensions } from '@opentui/solid'
import { RGBA } from '@opentui/core'
import type { TuiPluginApi } from '@opencode-ai/plugin/tui'
import { BASE58, getJson, ink, money, short } from './agon-discovery.tsx'

export const TRADE_ROUTE = 'agon.trade'
const MINT_KEY = 'agon.trade.mint'
const SOL = 'So11111111111111111111111111111111111111112'
const RANGES = ['1m', '5m', '15m', '1h', '4h', '12h', '1d'] as const
const MARKET_EVERY_MS = 10_000
const STATUS_EVERY_MS = 5_000

/* ---------------------------------------------------------------------------------------------- */
/* what the server sends, read defensively                                                         */
/* ---------------------------------------------------------------------------------------------- */

type Json = Record<string, unknown>
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {})
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const failed = (v: Json): string | null => str(v['error'])

export type Candle = {
  t: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}
type Gap = { from: number | null; to: number | null; missing: number; reason: string }
type Fill = {
  time: string
  side: 'buy' | 'sell'
  priceUsd: number
  volumeUsd: number
  wallet: string
}
type Cellv = number | string
type Level = { price: Cellv; size: Cellv; total: Cellv }
type Move = { pct: Cellv; side: string; quoteIn: Cellv; baseOut: Cellv }
export type Book = {
  kind: 'orderbook' | 'amm-liquidity' | 'amm-curve'
  label: string
  venue: string
  pool: string
  slot: number | null
  fetchedAt: string | null
  mid: Cellv | null
  bids: Level[]
  asks: Level[]
  moves: Move[]
}
type Block<T> = T | { error: string }
export type Market = {
  mint: string
  range: string
  pool: { address: string; choice: string | null } | null
  candles: Block<{ fetchedAt: string | null; stepSeconds: number; list: Candle[]; gaps: Gap[] }>
  ma: { period: number | null; values: (number | null)[] } | null
  ema: { period: number | null; values: (number | null)[] } | null
  stats: Block<{
    price: number
    changePct: number
    high: number
    low: number
    volumeUsd: number
    fetchedAt: string | null
  }>
  trades: Block<{ fetchedAt: string | null; list: Fill[]; leftOut: string | null }>
  // undefined: the server sends no book field at all, which is the case until T-C35 merges.
  book: Block<Book> | undefined
  // The chosen pool's reserve in USD (T-C37), with the server's reserve-to-volume flag when it
  // raised one. null: this server sends no liquidity at all, a build from before T-C37.
  liquidity: Block<{ value: number; flag: string | null }> | null
}

const cellv = (v: unknown): Cellv | null => num(v) ?? str(v)
const series = (v: unknown) => (Array.isArray(v) ? v.map((x) => num(x)) : [])

const readBook = (raw: unknown): Block<Book> => {
  const b = obj(raw)
  const err = failed(b)
  if (err) return { error: err }
  const kind = b['kind']
  if (kind !== 'orderbook' && kind !== 'amm-liquidity' && kind !== 'amm-curve')
    return {
      error: `the server sent a book of kind "${String(kind).slice(0, 20)}", which this plugin does not draw. Update the plugin.`,
    }
  const levels = (v: unknown): Level[] =>
    (Array.isArray(v) ? v : []).flatMap((x) => {
      const l = obj(x)
      const [price, size, total] = [cellv(l['price']), cellv(l['size']), cellv(l['total'])]
      return price !== null && size !== null && total !== null ? [{ price, size, total }] : []
    })
  const moves = (Array.isArray(b['moves']) ? b['moves'] : []).flatMap((x) => {
    const m = obj(x)
    const [p, side, q, o] = [
      cellv(m['pct']),
      str(m['side']),
      cellv(m['quoteIn']),
      cellv(m['baseOut']),
    ]
    return p !== null && side !== null && q !== null && o !== null
      ? [{ pct: p, side, quoteIn: q, baseOut: o }]
      : []
  })
  return {
    kind,
    label: str(b['label']) ?? `${kind}, sent with no label`,
    venue: str(b['venue']) ?? 'venue not named',
    pool: str(b['pool']) ?? '',
    slot: num(b['slot']),
    fetchedAt: str(b['fetchedAt']),
    mid: cellv(b['mid']),
    bids: levels(b['bids']),
    asks: levels(b['asks']),
    moves,
  }
}

/** /market's answer as this page draws it. Each block keeps its own error. Pure. */
export function readMarket(raw: unknown): Market {
  const m = obj(raw)
  const pool = obj(m['pool'])
  const c = obj(m['candles'])
  const ind = obj(m['indicators'])
  const s = obj(m['stats24h'])
  const tr = obj(m['trades'])
  const candles: Market['candles'] =
    failed(c) !== null
      ? { error: failed(c)! }
      : !Array.isArray(c['list']) || num(c['stepSeconds']) === null
        ? {
            error:
              'the server sent candles without a list or a step; nothing drawn rather than a guess',
          }
        : {
            fetchedAt: str(c['fetchedAt']),
            stepSeconds: num(c['stepSeconds'])!,
            list: (c['list'] as unknown[]).flatMap((x) => {
              const k = obj(x)
              const v = [k['t'], k['open'], k['high'], k['low'], k['close'], k['volume']].map(num)
              return v.every((n) => n !== null)
                ? [{ t: v[0]!, open: v[1]!, high: v[2]!, low: v[3]!, close: v[4]!, volume: v[5]! }]
                : []
            }),
            gaps: (Array.isArray(c['gaps']) ? c['gaps'] : []).map((x) => {
              const g = obj(x)
              return {
                from: num(g['from']),
                to: num(g['to']),
                missing: num(g['missing']) ?? 0,
                reason: str(g['reason']) ?? 'no reason sent',
              }
            }),
          }
  const line = (v: unknown) => {
    const o = obj(v)
    return Array.isArray(o['values'])
      ? { period: num(obj(o['params'])['period']), values: series(o['values']) }
      : null
  }
  const statNums = ['price', 'changePct', 'high', 'low', 'volumeUsd'].map((k) => num(s[k]))
  const stats: Market['stats'] =
    failed(s) !== null
      ? { error: failed(s)! }
      : statNums.some((n) => n === null)
        ? {
            error:
              'the server sent 24h stats with a field missing; nothing shown rather than a guess',
          }
        : {
            price: statNums[0]!,
            changePct: statNums[1]!,
            high: statNums[2]!,
            low: statNums[3]!,
            volumeUsd: statNums[4]!,
            fetchedAt: str(s['fetchedAt']),
          }
  const trades: Market['trades'] =
    failed(tr) !== null
      ? { error: failed(tr)! }
      : {
          fetchedAt: str(tr['fetchedAt']),
          leftOut: str(tr['leftOut']),
          list: (Array.isArray(tr['list']) ? tr['list'] : []).flatMap((x) => {
            const t = obj(x)
            const side = t['side']
            const [p, v] = [num(t['priceUsd']), num(t['volumeUsd'])]
            const [time, wallet] = [str(t['time']), str(t['wallet'])]
            return (side === 'buy' || side === 'sell') && p !== null && v !== null && time && wallet
              ? [{ time, side, priceUsd: p, volumeUsd: v, wallet }]
              : []
          }),
        }
  // Sent inside stats24h, and kept when the rest of the 24h stats failed.
  const liq = 'liquidityUsd' in s ? obj(s['liquidityUsd']) : null
  const liquidity: Market['liquidity'] =
    liq === null
      ? null
      : failed(liq) !== null
        ? { error: failed(liq)! }
        : num(liq['value']) !== null
          ? { value: num(liq['value'])!, flag: str(liq['flag']) }
          : {
              error: 'the server sent liquidity without a value; nothing shown rather than a guess',
            }
  const address = str(pool['address'])
  return {
    mint: str(m['mint']) ?? '',
    range: str(m['range']) ?? '',
    pool: address ? { address, choice: str(pool['choice']) } : null,
    candles,
    ma: failed(ind) === null ? line(ind['ma']) : null,
    ema: failed(ind) === null ? line(ind['ema']) : null,
    stats,
    trades,
    book: 'book' in m ? readBook(m['book']) : undefined,
    liquidity,
  }
}

type Upstream = {
  state: string
  since: string | null
  attempt: number | null
  cause: string | null
}
type Status = {
  network: string | null
  networkNote: string | null
  upstream: Upstream | null
  slot: number | null
  pingMs: number | null
  pingError: string | null
  solUsd: number | null
  solError: string | null
}

const readUpstream = (v: unknown): Upstream | null => {
  const u = obj(v)
  const state = str(u['state'])
  return state
    ? { state, since: str(u['since']), attempt: num(u['attempt']), cause: str(u['cause']) }
    : null
}

/** /status as the status line draws it. Pure. */
export function readStatus(raw: unknown): Status {
  const s = obj(raw)
  const ping = obj(s['ping'])
  const sol = obj(s['solPrice'])
  return {
    network: str(s['network']),
    networkNote: str(s['networkNote']),
    upstream: readUpstream(s['upstream']),
    slot: num(obj(obj(s['slot'])['value'])['slot']),
    pingMs: num(obj(ping['value'])['ms']),
    pingError: str(ping['error']),
    solUsd: num(obj(sol['value'])['usd']),
    solError: str(sol['error']),
  }
}

/* ---------------------------------------------------------------------------------------------- */
/* formatting: display only, never a new number                                                    */
/* ---------------------------------------------------------------------------------------------- */

// Plain decimals below 1e-6, never 2.110e-7: the same figure as discovery and Claude Code.
export const usd = (v: number | null) => (v === null ? 'none' : money(v))
export const big = (v: number | null, dollar = true) => {
  if (v === null) return 'none'
  const [d, s] = v >= 1e9 ? [1e9, 'B'] : v >= 1e6 ? [1e6, 'M'] : v >= 1e3 ? [1e3, 'K'] : [1, '']
  return `${dollar ? '$' : ''}${(v / d).toFixed(d === 1 ? 2 : 1)}${s}`
}
// Up and down are never colour alone: an arrow and a sign every time.
export const move = (c: number) => `${c > 0 ? '▲ +' : c < 0 ? '▼ ' : '= '}${c.toFixed(2)}%`
// A book value as the server sent it, compacted only when it would not fit its column: from 1,000
// as 1.2K, below as the price rule's plain decimals, so a sub-cent price never reads 0.00 (BONK's
// mid did, T-E28) and never as an exponent.
const cell = (v: Cellv | null, width = 10) =>
  v === null
    ? 'none'
    : typeof v === 'string'
      ? v
      : String(v).length <= width && !String(v).includes('e')
        ? String(v)
        : Math.abs(v) >= 1000
          ? big(v, false)
          : money(v).slice(1)
const utc = (iso: string | number) => {
  const d = new Date(typeof iso === 'number' ? iso * 1000 : iso)
  return Number.isNaN(d.getTime())
    ? 'time unreadable'
    : d.toISOString().slice(5, 16).replace('T', ' ')
}
const clock = (iso: string | null) =>
  iso && !Number.isNaN(Date.parse(iso)) ? new Date(iso).toISOString().slice(11, 19) : 'unknown'
const ageOf = (iso: string | null, now: number) =>
  iso && !Number.isNaN(Date.parse(iso))
    ? `${Math.max(0, Math.round((now - Date.parse(iso)) / 1000))}s`
    : 'unknown'

/* ---------------------------------------------------------------------------------------------- */
/* ask the agent (T-E28)                                                                           */
/* ---------------------------------------------------------------------------------------------- */

// The ask packet: 1 shape in both terminal plugins. This file and plugins/claude-code/hooks/
// register.tsx each hold this same tiny builder (the Claude plugin cannot import repo code), and both
// tests check it against the same expected text. Every value is a string the screen already shows,
// formatted by the screen's own code, so the packet's numbers are the screen's. Only numbers, times,
// the mint (base58 checked), our own range and kind words go in: never a token's name or symbol, nor
// any text the server or a token's creator wrote (OP-38). Lines, in order:
//   Agon screen: mint <mint>, range <range>, slot <slot>
//   price <p>, 24h <change>, high <h>, low <l>, vol <v>      (or: 24h stats not sent)
//   liq <liq>[, flagged: reserve over 100 times its 24h volume]
//   candle <time> UTC: O <o> H <h> L <l> C <c>                (or: candle not sent)
//   book <kind>: mid <m>, best bid <b>, best ask <a>          (each only if shown; or: book not sent)
//   selected trade <time> UTC <side> at <price> for <usd>     (only when a trade is selected)
//   ages: candles <a>, book <a>, trades <a>
//   the instruction, ASK_LINE
export type Ask = {
  mint: string
  range: string
  slot: string | null
  stats: { price: string; change: string; high: string; low: string; vol: string } | null
  liq: string | null
  flagged: boolean
  candle: { time: string; o: string; h: string; l: string; c: string } | null
  book: { kind: string; mid: string | null; bid: string | null; ask: string | null } | null
  trade: { time: string; side: string; price: string; usd: string } | null
  ages: { candles: string | null; book: string | null; trades: string | null }
}
export const ASK_LINE =
  'Explain what this shows and what check_trade would say before any trade; do not trade.'
const NS = 'not sent'
// The book's figures, each left out when the screen shows none (a curve draws no mid and no levels).
const bookFigures = (b: NonNullable<Ask['book']>) => {
  const parts = [
    b.mid && `mid ${b.mid}`,
    b.bid && `best bid ${b.bid}`,
    b.ask && `best ask ${b.ask}`,
  ]
  return parts.some(Boolean) ? `: ${parts.filter(Boolean).join(', ')}` : ''
}
export const askPacket = (a: Ask) =>
  [
    `Agon screen: mint ${a.mint}, range ${a.range}, slot ${a.slot ?? 'not read'}`,
    a.stats
      ? `price ${a.stats.price}, 24h ${a.stats.change}, high ${a.stats.high}, low ${a.stats.low}, vol ${a.stats.vol}`
      : `24h stats ${NS}`,
    `liq ${a.liq ?? NS}${a.flagged ? ', flagged: reserve over 100 times its 24h volume' : ''}`,
    a.candle
      ? `candle ${a.candle.time} UTC: O ${a.candle.o} H ${a.candle.h} L ${a.candle.l} C ${a.candle.c}`
      : `candle ${NS}`,
    a.book ? `book ${a.book.kind}${bookFigures(a.book)}` : `book ${NS}`,
    ...(a.trade
      ? [
          `selected trade ${a.trade.time} UTC ${a.trade.side} at ${a.trade.price} for ${a.trade.usd}`,
        ]
      : []),
    `ages: candles ${a.ages.candles ?? NS}, book ${a.ages.book ?? NS}, trades ${a.ages.trades ?? NS}`,
    ASK_LINE,
  ].join('\n')

// Our words for the server's 3 book kinds; the server's own label is never passed on.
const KIND = { orderbook: 'order book', 'amm-liquidity': 'AMM liquidity', 'amm-curve': 'AMM curve' }

/**
 * The ask packet for what the trade view shows: the market answer as read, the range and slot on
 * screen, the candle in the readout (the crosshair's, else the newest) and the selected trade. Each
 * value goes through the formatter the screen uses for it. Pure.
 */
export function askOf(
  m: Market,
  o: {
    mint: string
    range: string
    slot: number | null
    candle: Candle | null
    trade: Fill | null
    now: number
  },
): string {
  const s = 'error' in m.stats ? null : m.stats
  const c = 'error' in m.candles || m.range !== o.range ? null : m.candles
  const b = m.book && !('error' in m.book) ? m.book : null
  const t = 'error' in m.trades ? null : m.trades
  const k = c ? o.candle : null
  // A book value only as a number: a string the server sent is its text, not ours to pass on.
  const level = (v: Cellv | null | undefined) => (typeof v === 'number' ? cell(v) : null)
  return askPacket({
    mint: o.mint,
    range: o.range,
    slot: o.slot === null ? null : String(o.slot),
    stats: s && {
      price: usd(s.price),
      change: move(s.changePct),
      high: usd(s.high),
      low: usd(s.low),
      vol: big(s.volumeUsd),
    },
    liq: m.liquidity && !('error' in m.liquidity) ? big(m.liquidity.value) : null,
    flagged: !!(m.liquidity && !('error' in m.liquidity) && m.liquidity.flag),
    candle: k && {
      time: utc(k.t),
      o: usd(k.open),
      h: usd(k.high),
      l: usd(k.low),
      c: usd(k.close),
    },
    book: b && {
      kind: KIND[b.kind],
      mid: b.kind === 'amm-curve' ? null : level(b.mid),
      bid: level(b.bids[0]?.price),
      ask: level(b.asks[0]?.price),
    },
    trade: o.trade && {
      time: clock(o.trade.time),
      side: o.trade.side === 'buy' ? '▲ buy' : '▼ sell',
      price: usd(o.trade.priceUsd),
      usd: big(o.trade.volumeUsd),
    },
    ages: {
      candles: c ? ageOf(c.fetchedAt, o.now) : null,
      book: b ? ageOf(b.fetchedAt, o.now) : null,
      trades: t ? ageOf(t.fetchedAt, o.now) : null,
    },
  })
}

/* ---------------------------------------------------------------------------------------------- */
/* candles as half-block cells, 2 vertical pixels per cell                                         */
/* ---------------------------------------------------------------------------------------------- */

export type Glyph = { ch: string; tone: 'up' | 'down' | 'flat' | 'ma' | 'ema' | 'muted' }
export type Grid = {
  cells: (Glyph | null)[][]
  buckets: number[]
  byT: Map<number, number>
  hi: number
  lo: number
  rowOf: (v: number) => number
}

// Up bodies are solid half blocks; down bodies are heavy lines, so a candle's direction reads in a
// terminal with no colour too. Wicks are light lines, all at half-cell resolution.
const UP = { both: '█', top: '▀', bottom: '▄' }
const DOWN = { both: '┃', top: '╹', bottom: '╻' }
const WICK = { both: '│', top: '╵', bottom: '╷' }
export const MA_DOT = '•'
export const EMA_DOT = '◦'
export const toneOf = (c: Candle) => (c.close > c.open ? 'up' : c.close < c.open ? 'down' : 'flat')

/**
 * The last `width` buckets of the series, ending at the newest candle or the newest gap the server
 * named, whichever is later. A bucket with no candle stays an empty column. Pure.
 */
export function buildGrid(
  list: Candle[],
  gaps: Gap[],
  step: number,
  width: number,
  rows: number,
  overlays: { values: (number | null)[]; dot: string; tone: 'ma' | 'ema' }[],
): Grid | null {
  const last = list.at(-1)
  if (!last || width < 1 || rows < 1) return null
  const end = Math.max(last.t, ...gaps.map((g) => g.to ?? -Infinity))
  const buckets = Array.from({ length: width }, (_, i) => end - (width - 1 - i) * step)
  const byT = new Map(list.map((c, i) => [c.t, i]))
  const shown = buckets.flatMap((t) => (byT.has(t) ? [list[byT.get(t)!]!] : []))
  if (shown.length === 0) return { cells: [], buckets, byT, hi: 0, lo: 0, rowOf: () => 0 }
  const hi = Math.max(...shown.map((c) => c.high))
  const lo = Math.min(...shown.map((c) => c.low))
  const px = rows * 2
  const pxOf = (v: number) => (hi === lo ? rows - 1 : Math.round(((hi - v) / (hi - lo)) * (px - 1)))
  const cells: (Glyph | null)[][] = Array.from({ length: rows }, () =>
    Array.from({ length: width }, () => null),
  )
  buckets.forEach((t, x) => {
    const i = byT.get(t)
    if (i === undefined) return
    const c = list[i]!
    const tone = toneOf(c)
    const set = tone === 'down' ? DOWN : UP
    const [bTop, bBot] = [pxOf(Math.max(c.open, c.close)), pxOf(Math.min(c.open, c.close))]
    const [wTop, wBot] = [pxOf(c.high), pxOf(c.low)]
    for (let r = 0; r < rows; r++) {
      const body = [2 * r, 2 * r + 1].map((p) => p >= bTop && p <= bBot)
      const wick = [2 * r, 2 * r + 1].map((p) => p >= wTop && p <= wBot)
      const ch =
        body[0] && body[1]
          ? set.both
          : body[0]
            ? set.top
            : body[1]
              ? set.bottom
              : wick[0] && wick[1]
                ? WICK.both
                : wick[0]
                  ? WICK.top
                  : wick[1]
                    ? WICK.bottom
                    : null
      if (ch) cells[r]![x] = { ch, tone }
    }
  })
  // Overlays sit in empty cells only, so they never hide a candle.
  for (const o of overlays)
    buckets.forEach((t, x) => {
      const i = byT.get(t)
      const v = i === undefined ? null : (o.values[i] ?? null)
      if (v === null || v > hi || v < lo) return
      const r = Math.floor(pxOf(v) / 2)
      if (!cells[r]![x]) cells[r]![x] = { ch: o.dot, tone: o.tone }
    })
  return { cells, buckets, byT, hi, lo, rowOf: (v) => Math.floor(pxOf(v) / 2) }
}

/* ---------------------------------------------------------------------------------------------- */
/* data: /market and /status polled, /stream held open, all while the page is on screen            */
/* ---------------------------------------------------------------------------------------------- */

function createFeed(base: string, mint: string, range: () => string) {
  const [market, setMarket] = createSignal<Market | null>(null)
  const [marketError, setMarketError] = createSignal<string | null>(null)
  const [status, setStatus] = createSignal<Status | null>(null)
  const [statusError, setStatusError] = createSignal<string | null>(null)
  // The page's own link to /stream, apart from the server's link to Helius it reports.
  const [link, setLink] = createSignal<{ up: boolean; since: number; attempt: number }>({
    up: false,
    since: Date.now(),
    attempt: 0,
  })
  const [upstream, setUpstream] = createSignal<Upstream | null>(null)
  const [slot, setSlot] = createSignal<number | null>(null)
  const [now, setNow] = createSignal(Date.now())
  let liveSlot: number | null = null

  // Only the latest request writes, so a slow answer for the range the user just left is dropped.
  let run = 0
  const loadMarket = async () => {
    const mine = ++run
    try {
      const body = await getJson(
        `${base}/market?mint=${encodeURIComponent(mint)}&range=${encodeURIComponent(range())}`,
      )
      if (mine !== run) return
      setMarket(readMarket(body))
      setMarketError(null)
    } catch (e) {
      if (mine !== run) return
      setMarketError(
        `/market at ${base}: ${e instanceof Error ? e.message : String(e)}. Asked again every ${MARKET_EVERY_MS / 1000} s; if the server is not running, start it with docker compose up -d --build`,
      )
    }
  }
  const loadStatus = async () => {
    try {
      const s = readStatus(await getJson(`${base}/status`))
      setStatus(s)
      setStatusError(null)
      if (!upstream() && s.upstream) setUpstream(s.upstream)
    } catch (e) {
      setStatusError(`/status at ${base}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // A new range is asked for at once. The mint never changes: a new mint mounts a new page.
  createEffect(on(range, () => void loadMarket()))
  void loadStatus()
  const timers = [
    setInterval(() => void loadMarket(), MARKET_EVERY_MS),
    setInterval(() => void loadStatus(), STATUS_EVERY_MS),
    // Slots arrive about every 266 ms; the line redraws once a second.
    setInterval(() => {
      setNow(Date.now())
      if (liveSlot !== null && liveSlot !== slot()) setSlot(liveSlot)
    }, 1_000),
  ]

  // /stream: server-sent events, read by hand from the fetch body. Reconnects with backoff 1, 2,
  // 4, 8, 16, then 30 s, and says which attempt it is on.
  const abort = new AbortController()
  let stopped = false
  const listen = async () => {
    let attempt = 0
    while (!stopped) {
      try {
        const res = await fetch(`${base}/stream`, { signal: abort.signal })
        if (!res.ok || !res.body) throw new Error(`answered ${res.status}`)
        const reader = res.body.getReader()
        const text = new TextDecoder()
        let buf = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += text.decode(value, { stream: true })
          let cut: number
          while ((cut = buf.indexOf('\n\n')) >= 0) {
            const frame = buf.slice(0, cut)
            buf = buf.slice(cut + 2)
            const event = /^event: (.+)$/m.exec(frame)?.[1]
            const data = /^data: (.+)$/m.exec(frame)?.[1]
            if (!event || !data) continue
            let body: unknown
            try {
              body = JSON.parse(data)
            } catch {
              continue
            }
            if (!link().up) {
              attempt = 0
              setLink({ up: true, since: Date.now(), attempt: 0 })
            }
            if (event === 'upstream') setUpstream(readUpstream(body))
            else if (event === 'slot') liveSlot = num(obj(body)['slot']) ?? liveSlot
          }
        }
        throw new Error('the stream ended')
      } catch {
        if (stopped) return
        attempt++
        const was = link()
        setLink({ up: false, since: was.up ? Date.now() : was.since, attempt })
        await new Promise((r) => setTimeout(r, attempt > 5 ? 30_000 : 1000 * 2 ** (attempt - 1)))
      }
    }
  }
  void listen()

  onCleanup(() => {
    stopped = true
    abort.abort()
    for (const t of timers) clearInterval(t)
  })
  return {
    market,
    marketError,
    status,
    statusError,
    link,
    upstream,
    // The stream's slot while it is connected, else the last /status reading, never a frozen one.
    slot: () => (link().up ? slot() : null) ?? status()?.slot ?? null,
    now,
    reload: () => {
      void loadMarket()
      void loadStatus()
    },
  }
}

/* ---------------------------------------------------------------------------------------------- */
/* view                                                                                            */
/* ---------------------------------------------------------------------------------------------- */

type Theme = NonNullable<TuiPluginApi['theme']['current']>
const rgba = (c: ReturnType<typeof ink>): RGBA =>
  c === undefined ? RGBA.fromInts(255, 255, 255, 255) : typeof c === 'string' ? RGBA.fromHex(c) : c
const CLEAR = RGBA.fromInts(0, 0, 0, 0)

// A clickable label that acts on mouse-up, as opencode's own buttons do (T-E18 finding 2).
function Chip(props: { api: TuiPluginApi; label: string; active?: boolean; onPress: () => void }) {
  const theme = () => props.api.theme.current
  const [hover, setHover] = createSignal(false)
  const bg = () => (hover() || props.active ? theme()?.backgroundElement : undefined)
  return (
    <box
      height={1}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={bg()}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={(e) => {
        e.stopPropagation()
        if (e.button !== 0 || props.api.ui.dialog.open) return
        props.onPress()
      }}
    >
      <text
        fg={ink(props.api, props.active ? theme()?.primary : theme()?.accent, bg())}
        wrapMode="none"
      >
        {props.label}
      </text>
    </box>
  )
}

/** Joins parts by priority until the width is used, so a narrow screen drops the least useful. */
const fit = (parts: [string, number][], width: number) => {
  const keep = new Set<string>()
  let used = 0
  for (const [p] of [...parts].sort((a, b) => a[1] - b[1])) {
    if (used + p.length + (keep.size ? 2 : 0) > width) continue
    keep.add(p)
    used += p.length + (keep.size > 1 ? 2 : 0)
  }
  return parts
    .filter(([p]) => keep.has(p))
    .map(([p]) => p)
    .join('  ')
}

// Columns of a table row, 1 space apart. A negative width aligns right. A value wider than its
// column pushes the row rather than being cut, because a cut number reads as a different number;
// the panel clips the row at its edge instead.
type Col = [string, number]
const row = (cols: Col[]) =>
  cols
    .map(([v, n]) => {
      const w = Math.abs(n)
      return v.length >= w ? v : n < 0 ? ' '.repeat(w - v.length) + v : v + ' '.repeat(w - v.length)
    })
    .join(' ')

/** Greedy word wrap into at most `max` lines; a word longer than the width is split. */
const wrap = (t: string | null, width: number, max: number): string[] => {
  const lines: string[] = []
  let line = ''
  for (const word of (t ?? '').split(' ')) {
    const next = line ? `${line} ${word}` : word
    if (next.length <= width) line = next
    else {
      if (line.trim()) lines.push(line.trimEnd())
      line = word
      while (line.length > width) {
        lines.push(line.slice(0, width))
        line = line.slice(width)
      }
    }
  }
  if (line.trim()) lines.push(line.trimEnd())
  return lines.slice(0, max)
}

export function Trade(props: {
  api: TuiPluginApi
  base: string
  mint: string
  label: string | null
  back: () => void
  /** Out of the Agon pages to the session, where the filled prompt is. */
  leave: () => void
}) {
  const api = props.api
  const theme = () => api.theme.current as Theme | undefined
  const dims = useTerminalDimensions()
  const [rangeIx, setRangeIx] = createSignal(3)
  const [showMa, setShowMa] = createSignal(true)
  const [showEma, setShowEma] = createSignal(true)
  const [panel, setPanel] = createSignal<'book' | 'trades'>('book')
  const [hoverAt, setHover] = createSignal<number | null>(null)
  const [scroll, setScroll] = createSignal(0)
  // j or k selects a trade: the first row the trades list shows, highlighted. `a` passes it on.
  const [picked, setPicked] = createSignal(false)
  const [help, setHelp] = createSignal(false)
  const feed = createFeed(props.base, props.mint, () => RANGES[rangeIx()]!)

  // Layout, in cells. The side column holds the book and the trades: stacked when the screen is
  // big enough for both, one at a time (h and l switch) when it is not.
  const W = () => dims().width
  const H = () => dims().height
  const inner = () => W() - 2
  const side = () => (W() >= 120 ? 46 : W() >= 100 ? 36 : 32)
  const stacked = () => W() >= 120 && H() >= 30
  // The widest price label is 14 cells: an arrow and $0.0000002110, in plain decimals.
  const AXIS = 15
  const chartW = () => Math.max(10, inner() - side() - 1 - AXIS)
  const headerRows = () => (W() >= 120 ? 1 : 2)
  const volRow = () => (H() >= 30 ? 1 : 0)
  // Every failure on its own lines, the server's first: each names its cause and what happens
  // next. Wrapped here, by word, into lines drawn 1 text each, so the layout knows their exact
  // height: up to 3 lines per failure, 4 for a warning, and 4 in all.
  const errors = () => {
    const l = feed.link()
    const s = feed.market()?.stats
    return [
      feed.marketError(),
      feed.statusError(),
      s && 'error' in s ? s.error : null,
      l.up || l.attempt === 0
        ? null
        : `/stream at ${props.base}: not connected after ${l.attempt} attempt${l.attempt === 1 ? '' : 's'}, trying again within 30 s. Connection state and the live slot wait for it`,
    ].filter((e): e is string => e !== null)
  }
  // Not failures, drawn as warnings after them: why liquidity is not shown, or the server's flag
  // on a reserve over 100 times its 24h volume (T-C37).
  const warnings = () => {
    const l = feed.market()?.liquidity
    return !l ? [] : 'error' in l ? [l.error] : l.flag ? [l.flag] : []
  }
  const errorLines = () =>
    [
      ...errors().map((e) => [e, 'error'] as const),
      ...warnings().map((e) => [e, 'warning'] as const),
    ]
      .flatMap(([e, tone]) =>
        wrap(e, inner(), tone === 'error' ? 3 : 4).map((line) => [line, tone] as const),
      )
      .slice(0, 4)
  const hintLines = () => wrap(hint(), inner(), 4)
  const chartH = () =>
    Math.max(
      4,
      H() - (1 + headerRows() + 1 + volRow() + 1 + 1 + errorLines().length + hintLines().length),
    )

  // Candles for the range on screen only: after a range key, the old range's chart is not drawn
  // under the new label while the new one loads. The header, book and trades do not depend on it.
  const candles = () => {
    const m = feed.market()
    const c = m?.range === RANGES[rangeIx()] ? m.candles : null
    return c && !('error' in c) ? c : null
  }
  const ink2 = (tone: Glyph['tone']) => {
    const t = theme()
    return rgba(
      ink(
        api,
        tone === 'up'
          ? t?.success
          : tone === 'down'
            ? t?.error
            : tone === 'ma'
              ? t?.warning
              : tone === 'ema'
                ? t?.info
                : t?.textMuted,
      ),
    )
  }
  const grid = createMemo(() => {
    const c = candles()
    if (!c) return null
    const m = feed.market()!
    const overlays = [
      ...(showEma() && m.ema ? [{ values: m.ema.values, dot: EMA_DOT, tone: 'ema' as const }] : []),
      ...(showMa() && m.ma ? [{ values: m.ma.values, dot: MA_DOT, tone: 'ma' as const }] : []),
    ]
    return buildGrid(c.list, c.gaps, c.stepSeconds, chartW(), chartH(), overlays)
  })

  // The crosshair column, dropped when a resize leaves it outside the chart.
  const hover = () => {
    const h = hoverAt()
    return h !== null && h < chartW() ? h : null
  }
  // The candle under the crosshair, or the newest one when the mouse is elsewhere.
  const focus = () => {
    const g = grid()
    const c = candles()
    if (!g || !c) return null
    const x = hover() ?? g.buckets.length - 1
    const t = g.buckets[x]!
    const i = g.byT.get(t)
    return { x, t, i, candle: i === undefined ? null : c.list[i]! }
  }

  let canvas: { x: number; y: number; requestRender: () => void } | undefined
  createEffect(on([grid, hover, () => theme()], () => canvas?.requestRender(), { defer: true }))
  function draw(
    this: { x: number; y: number },
    buf: {
      setCellWithAlphaBlending: (x: number, y: number, ch: string, fg: RGBA, bg: RGBA) => void
      drawText: (t: string, x: number, y: number, fg: RGBA) => void
    },
  ) {
    const g = grid()
    if (!g || g.cells.length === 0) return
    const f = focus()
    const t = theme()
    const tones = {
      up: ink2('up'),
      down: ink2('down'),
      flat: ink2('flat'),
      ma: ink2('ma'),
      ema: ink2('ema'),
      muted: ink2('muted'),
    }
    const muted = tones.muted
    const text = rgba(ink(api, t?.text))
    const cross = t?.backgroundElement ?? CLEAR
    const closeRow = f?.candle ? g.rowOf(f.candle.close) : null
    for (let r = 0; r < g.cells.length; r++)
      for (let x = 0; x < g.buckets.length; x++) {
        const c = g.cells[r]![x]
        const onCol = hover() !== null && x === hover()
        const onRow = hover() !== null && r === closeRow
        if (c)
          buf.setCellWithAlphaBlending(
            this.x + x,
            this.y + r,
            c.ch,
            tones[c.tone],
            onCol ? cross : CLEAR,
          )
        else if (onCol || onRow)
          buf.setCellWithAlphaBlending(
            this.x + x,
            this.y + r,
            onCol ? '┊' : '┄',
            muted,
            onCol ? cross : CLEAR,
          )
      }
    // The axis prints values the server sent: the window's high and low, and the close under the
    // crosshair or the newest close, beside its row.
    const ax = this.x + g.buckets.length + 1
    const rows = g.cells.length
    buf.drawText(row([[usd(g.hi), 1 - AXIS]]), ax, this.y, muted)
    buf.drawText(row([[usd(g.lo), 1 - AXIS]]), ax, this.y + rows - 1, muted)
    if (f?.candle && closeRow !== null)
      buf.drawText(row([[`◀${usd(f.candle.close)}`, AXIS - 1]]), ax, this.y + closeRow, text)
    if (volRow()) {
      const c = candles()!
      const vols = g.buckets.map((b) => (g.byT.has(b) ? c.list[g.byT.get(b)!]!.volume : null))
      const top = Math.max(0, ...vols.map((v) => v ?? 0))
      vols.forEach((v, x) => {
        if (v === null || top === 0) return
        const ch = '▁▂▃▄▅▆▇█'[Math.min(7, Math.floor((v / top) * 8))]!
        buf.setCellWithAlphaBlending(this.x + x, this.y + rows, ch, muted, CLEAR)
      })
      buf.drawText(row([['vol', 1 - AXIS]]), ax, this.y + rows, muted)
    }
  }

  const readout = () => {
    const f = focus()
    const c = candles()
    if (!f || !c) return ''
    const when = `${utc(f.t)} UTC`
    if (!f.candle) {
      const gap = c.gaps.find(
        (g) => g.from !== null && g.to !== null && f.t >= g.from && f.t <= g.to,
      )
      return `${when}  no candle: ${gap?.reason ?? 'none sent for this bucket'}`
    }
    const k = f.candle
    const m = feed.market()!
    const dir = toneOf(k) === 'up' ? '▲ up' : toneOf(k) === 'down' ? '▼ down' : '= flat'
    const ma = f.i !== undefined ? m.ma?.values[f.i] : null
    const ema = f.i !== undefined ? m.ema?.values[f.i] : null
    return fit(
      [
        [`${hover() === null ? 'last ' : ''}${when}`, 0],
        [`O ${usd(k.open)} H ${usd(k.high)} L ${usd(k.low)} C ${usd(k.close)}`, 1],
        [dir, 2],
        [`vol ${big(k.volume)}`, 3],
        [`MA${m.ma?.period ?? ''} ${ma == null ? 'warming up' : usd(ma)}`, 4],
        [`EMA${m.ema?.period ?? ''} ${ema == null ? 'warming up' : usd(ema)}`, 5],
      ],
      inner(),
    )
  }
  const legend = () => {
    const c = candles()
    const missing = c ? c.gaps.reduce((n, g) => n + g.missing, 0) : 0
    return fit(
      [
        [`${UP.both} up ${DOWN.both} down`, 1],
        [`${MA_DOT} MA${feed.market()?.ma?.period ?? ''} ${showMa() ? 'on' : 'off'} (m)`, 2],
        [`${EMA_DOT} EMA${feed.market()?.ema?.period ?? ''} ${showEma() ? 'on' : 'off'} (e)`, 3],
        [
          c
            ? c.gaps.length
              ? `${c.gaps.length} gap${c.gaps.length === 1 ? '' : 's'}, ${missing} bucket${missing === 1 ? '' : 's'} with no candle, drawn empty`
              : 'no gaps'
            : '',
          0,
        ],
        [`candles ${feed.market() && c ? ageOf(c.fetchedAt, feed.now()) + ' old' : 'none'}`, 4],
      ].filter(([p]) => p) as [string, number][],
      inner(),
    )
  }

  const statusLine = () => {
    const l = feed.link()
    const u = feed.upstream()
    const s = feed.status()
    const conn = !l.up
      ? l.attempt === 0
        ? '◌ connecting'
        : `○ server offline since ${clock(new Date(l.since).toISOString())} UTC, retry ${l.attempt}`
      : !u
        ? '◌ connecting'
        : u.state === 'live'
          ? '● live'
          : u.state === 'reconnecting'
            ? `◌ reconnecting ${u.attempt ?? ''}`.trim()
            : u.state === 'offline'
              ? `○ offline since ${clock(u.since)} UTC`
              : `◌ ${u.state}`
    const c = candles()
    return fit(
      [
        [conn, 0],
        [`ping ${s?.pingMs != null ? `${s.pingMs} ms` : 'none yet'}`, 1],
        [`slot ${feed.slot() ?? 'none yet'}`, 2],
        [`data ${c ? ageOf(c.fetchedAt, feed.now()) : 'none yet'}`, 3],
        [`SOL ${s?.solUsd != null ? '$' + s.solUsd.toFixed(2) : 'none yet'}`, 4],
        [
          s?.network
            ? s.networkNote && inner() >= 100
              ? `${s.network}, feed from mainnet`
              : s.network
            : 'network not read yet',
          5,
        ],
      ],
      inner(),
    )
  }
  const connColour = () => {
    const l = feed.link()
    const u = feed.upstream()
    const t = theme()
    return ink(
      api,
      (!l.up && l.attempt > 0) || u?.state === 'offline'
        ? t?.error
        : l.up && u?.state === 'live'
          ? t?.success
          : t?.warning,
    )
  }

  const header = () => {
    const m = feed.market()
    const name = `${props.label ? props.label.slice(0, 12) + ' ' : ''}${short(props.mint)}`
    if (!m)
      return [
        name,
        feed.marketError() ? 'no market data' : `loading /market for ${RANGES[rangeIx()]}`,
      ]
    const s = m.stats
    const first =
      'error' in s
        ? `${name}  24h stats did not load, see the red lines below`
        : `${name}  ${usd(s.price)}  ${move(s.changePct)} 24h`
    const second = fit(
      [
        ...('error' in s
          ? []
          : ([
              [`H ${usd(s.high)}`, 0],
              [`L ${usd(s.low)}`, 1],
              [`vol ${big(s.volumeUsd)}`, 2],
            ] as [string, number][])),
        [
          !m.liquidity || 'error' in m.liquidity
            ? 'liq not sent'
            : `liq ${big(m.liquidity.value)}${m.liquidity.flag ? ' flagged, see below' : ''}`,
          3,
        ],
        [`pool ${m.pool ? short(m.pool.address) : 'none'}`, 4],
      ],
      headerRows() === 1 ? inner() - first.length - 2 : inner(),
    )
    return [first, second]
  }
  const headerColour = () => {
    const s = feed.market()?.stats
    const t = theme()
    return ink(
      api,
      !s || 'error' in s
        ? t?.text
        : s.changePct > 0
          ? t?.success
          : s.changePct < 0
            ? t?.error
            : t?.text,
    )
  }

  /* side panels ------------------------------------------------------------------------------- */

  const sideRows = () => chartH() + volRow()
  const list = () => {
    const t = feed.market()?.trades
    return t && !('error' in t) ? t.list : []
  }
  // A refresh can return fewer trades than the scroll had passed, so the first row is clamped.
  const top = () => Math.min(scroll(), Math.max(0, list().length - 1))
  // Selected only while the trades panel is on screen: h back to the book hides it, and a then
  // leaves it out.
  const selected = () =>
    picked() && (stacked() || panel() === 'trades') ? (list()[top()] ?? null) : null
  const Trades = (p: { rows: number }) => {
    const tr = () => feed.market()?.trades
    const wide = () => side() >= 42
    return (
      <box flexDirection="column" height={p.rows} overflow="hidden" flexShrink={0}>
        <text flexShrink={0} fg={theme()?.text} wrapMode="none">
          <b>{`Recent trades${tr() && !('error' in tr()!) ? `, ${ageOf((tr() as { fetchedAt: string | null }).fetchedAt, feed.now())} old` : ''}`}</b>
        </text>
        <Show
          when={tr() && !('error' in tr()!)}
          fallback={
            <text
              flexShrink={0}
              fg={ink(api, tr() ? theme()?.error : theme()?.textMuted)}
              wrapMode="word"
            >
              {tr() && 'error' in tr()! ? (tr() as { error: string }).error : 'waiting for /market'}
            </text>
          }
        >
          <text flexShrink={0} fg={ink(api, theme()?.textMuted)} wrapMode="none">
            {row([
              ['time', 8],
              ['side', 6],
              ['price', -8],
              ['usd', -7],
              ...(wide() ? ([['wallet', 11]] as Col[]) : []),
            ])}
          </text>
          <Show when={list().length === 0}>
            <text flexShrink={0} fg={ink(api, theme()?.textMuted)} wrapMode="word">
              0 trades in the answer. The pool may be quiet.
            </text>
          </Show>
          <For each={list().slice(top(), top() + Math.max(1, p.rows - 2))}>
            {(f, i) => (
              <text
                flexShrink={0}
                fg={ink(
                  api,
                  f.side === 'buy' ? theme()?.success : theme()?.error,
                  picked() && i() === 0 ? theme()?.backgroundElement : undefined,
                )}
                bg={picked() && i() === 0 ? theme()?.backgroundElement : undefined}
                wrapMode="none"
              >
                {row([
                  [clock(f.time), 8],
                  [f.side === 'buy' ? '▲ buy' : '▼ sell', 6],
                  [usd(f.priceUsd).slice(1), -8],
                  [big(f.volumeUsd), -7],
                  ...(wide() ? ([[short(f.wallet), 11]] as Col[]) : []),
                ])}
              </text>
            )}
          </For>
        </Show>
      </box>
    )
  }

  const BookPanel = (p: { rows: number }) => {
    const book = () => feed.market()?.book
    const ready = () => {
      const b = book()
      return b && !('error' in b) ? b : null
    }
    // The label and the venue line, wrapped here so the ladder knows how many lines they take: a
    // real Orca answer wraps the venue to 2 lines at 80 columns, and a ladder sized for 1 pushed
    // every line into the next.
    const head = (b: Book) => [
      ...wrap(b.label, side(), 2).map((l) => [l, theme()?.warning] as const),
      ...wrap(
        `${b.venue}  ${b.pool ? short(b.pool) : 'pool not named'}  slot ${b.slot ?? 'none'}  ${ageOf(b.fetchedAt, feed.now())} old`,
        side(),
        2,
      ).map((l) => [l, theme()?.textMuted] as const),
    ]
    // Lines left under the title, the head and the column titles.
    const room = () => {
      const b = ready()
      return p.rows - 2 - (b ? head(b).length : 0)
    }
    // Levels nearest the mid sit next to it: asks above, highest first, bids below.
    const depth = () => Math.max(1, Math.floor((room() - 1) / 2))
    const levelLine = (side: 'ask' | 'bid', l: Level) =>
      row([
        [side, 3],
        [cell(l.price), -10],
        [cell(l.size, 8), -8],
        [cell(l.total, 8), -8],
      ])
    return (
      <box flexDirection="column" height={p.rows} overflow="hidden" flexShrink={0}>
        <text flexShrink={0} fg={theme()?.text} wrapMode="none">
          <b>Order book / depth</b>
        </text>
        <Show
          when={ready()}
          fallback={
            <text
              flexShrink={0}
              fg={ink(api, book() ? theme()?.error : theme()?.textMuted)}
              wrapMode="word"
            >
              {!feed.market()
                ? 'waiting for /market'
                : book()
                  ? `not shown: ${(book() as { error: string }).error}`
                  : 'Order book arrives with T-C35. This /market sends no book yet, so nothing is drawn rather than a made-up ladder.'}
            </text>
          }
        >
          {(b) => (
            <>
              <For each={head(b())}>
                {([line, tone]) => (
                  <text flexShrink={0} fg={ink(api, tone)} wrapMode="none">
                    {line}
                  </text>
                )}
              </For>
              <Show
                when={b().kind !== 'amm-curve'}
                fallback={
                  <>
                    <text flexShrink={0} fg={ink(api, theme()?.textMuted)} wrapMode="none">
                      {row([
                        ['move', 5],
                        ['side', 6],
                        ['pay', -9],
                        ['get', -9],
                      ])}
                    </text>
                    <For each={b().moves.slice(0, Math.max(1, room()))}>
                      {(mv) => (
                        <text
                          flexShrink={0}
                          fg={ink(api, mv.side === 'buy' ? theme()?.success : theme()?.error)}
                          wrapMode="none"
                        >
                          {row([
                            [`${cell(mv.pct)}%`, 5],
                            [
                              mv.side === 'buy'
                                ? '▲ buy'
                                : mv.side === 'sell'
                                  ? '▼ sell'
                                  : mv.side.slice(0, 6),
                              6,
                            ],
                            [cell(mv.quoteIn, 9), -9],
                            [cell(mv.baseOut, 9), -9],
                          ])}
                        </text>
                      )}
                    </For>
                  </>
                }
              >
                <text flexShrink={0} fg={ink(api, theme()?.textMuted)} wrapMode="none">
                  {row([
                    ['', 3],
                    ['price', -10],
                    ['size', -8],
                    ['total', -8],
                  ])}
                </text>
                <For each={b().asks.slice(0, depth()).reverse()}>
                  {(l) => (
                    <text flexShrink={0} fg={ink(api, theme()?.error)} wrapMode="none">
                      {levelLine('ask', l)}
                    </text>
                  )}
                </For>
                <text flexShrink={0} fg={theme()?.text} wrapMode="none">
                  {row([
                    ['mid', 3],
                    [cell(b().mid), -10],
                  ])}
                </text>
                <For each={b().bids.slice(0, depth())}>
                  {(l) => (
                    <text flexShrink={0} fg={ink(api, theme()?.success)} wrapMode="none">
                      {levelLine('bid', l)}
                    </text>
                  )}
                </For>
              </Show>
            </>
          )}
        </Show>
      </box>
    )
  }

  /* keys and the ticket ----------------------------------------------------------------------- */

  const ticket = (sideName: 'buy' | 'sell') => {
    const mint = props.mint
    if (!BASE58.test(mint)) return
    api.ui.dialog.replace(() => (
      <api.ui.DialogPrompt
        title={`${sideName === 'buy' ? 'Buy' : 'Sell'} ticket, mint ${short(mint)}`}
        placeholder={
          sideName === 'buy' ? 'amount of SOL to spend, e.g. 0.1' : "amount to sell, or 'all'"
        }
        onCancel={() => api.ui.dialog.clear()}
        onConfirm={(value) => {
          api.ui.dialog.clear()
          const amount = value.trim().slice(0, 40)
          if (!amount) return
          // Only the mint goes into the prompt, never a token's name or symbol (OP-38).
          const text =
            sideName === 'buy'
              ? `Buy ${amount} SOL of the token with mint ${mint}. Run Agon check_trade on it first and show me the verdict with its reasons. Build nothing unless it passes, and let me sign.`
              : `Sell ${amount} of the token with mint ${mint} for SOL. Run Agon check_trade on it first and show me the verdict with its reasons. Build nothing unless it passes, and let me sign.`
          props.leave()
          api.client.tui.appendPrompt({ text }).then(
            () =>
              api.ui.toast({
                variant: 'info',
                message: 'Added to your prompt. Review it, then press Enter. Nothing was sent.',
              }),
            (e: unknown) =>
              api.ui.toast({
                variant: 'error',
                message: `Could not fill the prompt (${e instanceof Error ? e.message : String(e)}). Nothing was sent.`,
              }),
          )
        }}
      />
    ))
  }

  const setRange = (i: number) => {
    setRangeIx(Math.max(0, Math.min(RANGES.length - 1, i)))
    setHover(null)
  }
  const moveCross = (d: number | 'home' | 'end') => {
    const n = grid()?.buckets.length ?? 0
    if (!n) return
    const at = hover() ?? n - 1
    setHover(d === 'home' ? 0 : d === 'end' ? n - 1 : Math.max(0, Math.min(n - 1, at + d)))
  }
  // Fills the prompt with the ask packet for what is on screen, and never sends it.
  const ask = () => {
    const m = feed.market()
    if (!BASE58.test(props.mint)) return
    if (!m) {
      api.ui.toast({
        variant: 'warning',
        message: `Nothing to ask about yet: /market has not answered for ${short(props.mint)} ${RANGES[rangeIx()]}. Press a again once the header shows a price. Nothing was added.`,
      })
      return
    }
    const text = askOf(m, {
      mint: props.mint,
      range: RANGES[rangeIx()]!,
      slot: feed.slot(),
      // The readout's candle: none when the crosshair, or the newest bucket, is a gap.
      candle: focus() ? focus()!.candle : null,
      trade: selected(),
      now: feed.now(),
    })
    props.leave()
    api.client.tui.appendPrompt({ text }).then(
      () =>
        api.ui.toast({
          variant: 'info',
          message:
            'The screen, as numbers and the mint, is in your prompt. Review it, then press Enter. Nothing was sent.',
        }),
      (e: unknown) =>
        api.ui.toast({
          variant: 'error',
          message: `Could not fill the prompt (${e instanceof Error ? e.message : String(e)}). Nothing was sent.`,
        }),
    )
  }

  useKeyboard((key) => {
    // A dialog owns the keyboard, and every Ctrl, Alt or Meta combination belongs to opencode.
    if (api.ui.dialog.open || key.ctrl || key.meta || key.option) return
    // The character typed: the raw sequence when it is 1 character, else the name, upper case when
    // shifted, which is how the kitty keyboard protocol reports G, R and ?.
    const k =
      key.sequence?.length === 1
        ? key.sequence
        : key.shift && key.name === '/'
          ? '?'
          : key.shift && key.name.length === 1
            ? key.name.toUpperCase()
            : key.name
    if (k === 'escape' || k === 'q' || k === '\x1b') props.back()
    else if (/^[1-7]$/.test(k)) setRange(Number(k) - 1)
    else if (k === '[') setRange(rangeIx() - 1)
    else if (k === ']') setRange(rangeIx() + 1)
    else if (k === 'm') setShowMa(!showMa())
    else if (k === 'e') setShowEma(!showEma())
    else if (k === 'left') moveCross(-1)
    else if (k === 'right') moveCross(1)
    else if (k === 'home' || k === 'g') moveCross('home')
    else if (k === 'end' || k === 'G') moveCross('end')
    else if (k === 'h' || k === 'l') setPanel(panel() === 'book' ? 'trades' : 'book')
    // The first j or k selects the top trade and shows the trades panel; after that they move the
    // selection.
    else if (k === 'j' || k === 'down' || k === 'k' || k === 'up') {
      if (picked())
        setScroll(
          k === 'j' || k === 'down'
            ? Math.min(Math.max(0, list().length - 1), top() + 1)
            : Math.max(0, top() - 1),
        )
      setPicked(true)
      setPanel('trades')
    } else if (k === 'a') ask()
    else if (k === 'b') ticket('buy')
    else if (k === 's') ticket('sell')
    else if (k === 'R') feed.reload()
    else if (k === '?') setHelp(!help())
  })

  const hint = () =>
    help()
      ? `${feed.status()?.networkNote ? `network ${feed.status()!.network}, status readings from mainnet  ` : ''}1-7 or [ ] range  m MA  e EMA  arrows, g, G crosshair  ${stacked() ? '' : 'h/l book or trades  '}j/k select a trade  a ask the agent  b buy  s sell (a, b and s fill your prompt, never send)  R refresh  ? fewer keys  q or esc back`
      : `1-7 range  m MA  e EMA  arrows crosshair  a ask  b/s ticket  ? keys  esc back`

  return (
    <box flexDirection="column" paddingLeft={1} paddingRight={1} flexGrow={1}>
      <text fg={connColour()} wrapMode="none" flexShrink={0}>
        {statusLine()}
      </text>
      <box
        flexDirection={headerRows() === 1 ? 'row' : 'column'}
        height={headerRows()}
        flexShrink={0}
      >
        <text fg={headerColour()} wrapMode="none" flexShrink={0}>
          {header()[0]}
        </text>
        <text fg={theme()?.text} wrapMode="none" flexShrink={0}>
          {(headerRows() === 1 ? '  ' : '') + header()[1]}
        </text>
      </box>
      <box flexDirection="row" height={1} flexShrink={0}>
        <For each={RANGES}>
          {(r, i) => (
            <Chip
              api={api}
              label={`${i() + 1} ${r}`}
              active={i() === rangeIx()}
              onPress={() => setRange(i())}
            />
          )}
        </For>
        <Chip
          api={api}
          label={`MA ${showMa() ? 'on' : 'off'}`}
          active={showMa()}
          onPress={() => setShowMa(!showMa())}
        />
        <Chip
          api={api}
          label={`EMA ${showEma() ? 'on' : 'off'}`}
          active={showEma()}
          onPress={() => setShowEma(!showEma())}
        />
      </box>
      <box flexDirection="row" height={sideRows()} flexShrink={0}>
        <Show
          when={grid() && grid()!.cells.length > 0}
          fallback={
            <box width={chartW() + AXIS} height={sideRows()} flexShrink={0}>
              <text fg={ink(api, theme()?.textMuted)} wrapMode="word">
                {feed.market()?.range === RANGES[rangeIx()] && 'error' in feed.market()!.candles
                  ? `no chart: ${(feed.market()!.candles as { error: string }).error}`
                  : candles()
                    ? `no candle in the last ${chartW()} buckets of ${RANGES[rangeIx()]}: every one is a gap, so nothing is drawn. Try a longer range (]).`
                    : feed.marketError()
                      ? 'no chart: /market has not answered, the reason is on the red line below'
                      : `loading ${RANGES[rangeIx()]} candles from ${props.base}/market`}
              </text>
            </box>
          }
        >
          <box
            width={chartW() + AXIS}
            height={sideRows()}
            flexShrink={0}
            ref={(r: typeof canvas) => (canvas = r)}
            renderAfter={draw}
            onMouseMove={(e) => {
              const x = canvas ? e.x - canvas.x : -1
              setHover(x >= 0 && x < chartW() ? x : null)
            }}
            onMouseOut={() => setHover(null)}
          />
        </Show>
        <box width={1} flexShrink={0} />
        <box flexDirection="column" width={side()} flexShrink={0}>
          <Show
            when={stacked()}
            fallback={
              <>
                <box flexDirection="row" height={1} flexShrink={0}>
                  <Chip
                    api={api}
                    label="book"
                    active={panel() === 'book'}
                    onPress={() => setPanel('book')}
                  />
                  <Chip
                    api={api}
                    label="trades"
                    active={panel() === 'trades'}
                    onPress={() => setPanel('trades')}
                  />
                  <text fg={ink(api, theme()?.textMuted)} wrapMode="none">
                    h/l
                  </text>
                </box>
                <Show when={panel() === 'book'} fallback={<Trades rows={sideRows() - 1} />}>
                  <BookPanel rows={sideRows() - 1} />
                </Show>
              </>
            }
          >
            <BookPanel rows={Math.floor(sideRows() / 2)} />
            <Trades rows={sideRows() - Math.floor(sideRows() / 2)} />
          </Show>
        </box>
      </box>
      <text fg={theme()?.text} wrapMode="none" flexShrink={0}>
        {readout() || ' '}
      </text>
      <text fg={ink(api, theme()?.textMuted)} wrapMode="none" flexShrink={0}>
        {legend()}
      </text>
      <For each={errorLines()}>
        {([line, tone]) => (
          <text
            fg={ink(api, tone === 'error' ? theme()?.error : theme()?.warning)}
            wrapMode="none"
            flexShrink={0}
          >
            {line}
          </text>
        )}
      </For>
      <For each={hintLines()}>
        {(line) => (
          <text fg={ink(api, theme()?.textMuted)} wrapMode="none" flexShrink={0}>
            {line}
          </text>
        )}
      </For>
    </box>
  )
}

/** The route and the way in. The mint survives restarts; a label (a symbol) is only ever drawn. */
export function createTrade(api: TuiPluginApi, base: string) {
  const stored = api.kv.get<unknown>(MINT_KEY, SOL)
  const [mint, setMint] = createSignal(
    typeof stored === 'string' && BASE58.test(stored) ? stored : SOL,
  )
  const [label, setLabel] = createSignal<string | null>(null)
  return {
    show(m: string, l: string | null) {
      if (!BASE58.test(m)) return false
      setMint(m)
      setLabel(l)
      api.kv.set(MINT_KEY, m)
      return true
    },
    render: (back: () => void, leave: () => void) => (
      <Show when={mint()} keyed>
        {(m) => <Trade api={api} base={base} mint={m} label={label()} back={back} leave={leave} />}
      </Show>
    ),
  }
}
