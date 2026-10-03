/** @jsxImportSource @opentui/solid */
// Agon discovery inside opencode.
//
// - A live sidebar panel for your watchlist.
// - A full-screen page (`/discover`, or "Agon discovery" in the command palette) with the trending,
//   most traded, top organic, new, about to graduate and graduated lists, sortable and searchable,
//   with a detail pane and a braille price chart for the selected token. The sidebar has sparklines.
// - Every list, figure and chart comes from the Agon server: `GET /discover` for the lists and
//   `GET /market` for charts and the watchlist. The plugin calls no Jupiter, GeckoTerminal or other
//   outside host itself (T-E26), so the numbers here are the ones every other Agon surface shows. A
//   figure the server names as not sent is drawn as a dim "not sent", never as 0.
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
// opencode 1.18.33 has no image element for plugins. They come from the Agon server's `/logo` by
// mint (T-C39), so this page calls no host but the Agon server; tui.json `"logos": false` turns them
// off. A token with no logo, or with logos off, shows the symbol's first letter.

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
// Symbols for the default watchlist, pinned here rather than read, for a watched token no list on
// screen carries.
const PINNED: Record<string, string> = {
  So11111111111111111111111111111111111111112: 'SOL',
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC',
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: 'JUP',
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: 'BONK',
  J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn: 'JitoSOL',
}
/** A watched token's /market answer is asked again after 5 minutes, 3 GeckoTerminal calls each. */
const WATCH_MAX_AGE_MS = 300_000

type Options = {
  refreshMs: number
  limit: number
  mcpUrl: string
  armUrl: string
  logos: boolean
}
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
    logos: o.logos !== false,
  }
}

/* ---------------------------------------------------------------------------------------------- */
/* data                                                                                            */
/* ---------------------------------------------------------------------------------------------- */

// A token as the page draws it. Every figure is null when the server sent none, drawn as "not sent".
// symbol, name and icon are `display` text the token creator chose: drawn for a person, matched by
// the search box, and never put into anything handed to the agent, which gets the mint only.
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
  organic: number | null
  mintAuthorityOff: boolean | null
  freezeAuthorityOff: boolean | null
  topHoldersPct: number | null
  devPct: number | null
  curve: number | null
  graduatedAt: string | null
  ageSeconds: number | null
}
const blank = (mint: string): Token => ({
  mint,
  symbol: mint.slice(0, 4),
  name: '',
  icon: null,
  price: null,
  change5m: null,
  change1h: null,
  change24h: null,
  volume24h: null,
  liquidity: null,
  mcap: null,
  holders: null,
  organic: null,
  mintAuthorityOff: null,
  freezeAuthorityOff: null,
  topHoldersPct: null,
  devPct: null,
  curve: null,
  graduatedAt: null,
  ageSeconds: null,
})

type Json = Record<string, unknown>
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {})
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
// The server strips these already. Stripped again here, because 1 control or bidi character in a
// symbol would redraw the terminal around it.
const UNSAFE = /[\p{Cc}\p{Cf}]/gu
const display = (v: unknown): string | null =>
  typeof v === 'string' ? v.replace(UNSAFE, '').slice(0, 64) : null
const fig = (v: unknown) => num(obj(v)['value'])
const authorityOff = (v: unknown) => {
  const x = obj(v)['value']
  return x === 'disabled' ? true : x === 'enabled' ? false : null
}

/** 1 row of `/discover` as the page draws it, or null when its mint is not a Solana address. */
const toToken = (raw: unknown): Token | null => {
  const t = obj(raw)
  const mint = str(t['mint'])
  if (!mint || !BASE58.test(mint)) return null
  const d = obj(t['display'])
  const change = obj(t['change'])
  const curve = obj(t['bondingCurvePct'])
  return {
    mint,
    symbol: display(d['symbol']) || mint.slice(0, 4),
    name: display(d['name']) ?? '',
    icon: str(d['icon']),
    price: fig(t['price']),
    change5m: fig(change['5m']),
    change1h: fig(change['1h']),
    change24h: fig(change['24h']),
    volume24h: fig(t['volume24h']),
    liquidity: fig(t['liquidity']),
    mcap: fig(t['marketCap']),
    holders: fig(t['holders']),
    organic: fig(t['organicScore']),
    mintAuthorityOff: authorityOff(t['mintAuthority']),
    freezeAuthorityOff: authorityOff(t['freezeAuthority']),
    topHoldersPct: fig(t['topHoldersPct']),
    devPct: fig(t['devPct']),
    curve: num(curve['value']),
    graduatedAt: str(curve['graduatedAt']),
    ageSeconds: fig(t['age']),
  }
}

/** A GET to the Agon server: its JSON, or an error carrying the server's own reason. */
export const getJson = async (url: string) => {
  let res: Response
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  } catch (e) {
    throw new Error(`no answer (${e instanceof Error ? e.message : String(e)})`)
  }
  // A body that is not JSON (a proxy's HTML page, say) is a failure with its cause, never an empty
  // answer that would read as "not sent".
  const body = (await res.json().catch(() => undefined)) as unknown
  if (!res.ok)
    throw new Error(str(obj(body)['error']) ?? `answered ${res.status} with no reason given`)
  if (body === undefined) throw new Error(`answered ${res.status} with a body that is not JSON`)
  return body
}

// The stale notes (T-E29): 1 wording in both terminal plugins. .opencode/tui/agon-discovery.tsx
// and plugins/claude-code/hooks/register.tsx each hold this same builder, byte for byte (the Claude
// plugin cannot import repo code), and both tests check it against the same expected text. It reads /market's answer as sent (T-C41): a
// block served from its last good value carries `stale: true`, `ageSeconds` and `staleReason`, and
// the book's USD quote price says so in its basis. `elapsedS`, the seconds since the answer arrived,
// is added to each age and taken off the cool-down, so a note counts on between polls. Blocks with
// 1 reason share 1 line:
//   prices 247 s old, candles 247 s old: GeckoTerminal is rate-limiting, next try in 41 s
// `coolDownS` is the longest GeckoTerminal pause any block names, stale or never loaded, while it
// lasts. `blocks` names the stale ones, so a view draws them dim. Pure.
export type Stale = { lines: string[]; blocks: string[]; coolDownS: number | null }
export function staleOf(raw: unknown, elapsedS: number): Stale {
  const rec = (v: unknown): Record<string, unknown> =>
    v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  const text = (v: unknown) => (typeof v === 'string' ? v : '')
  const m = rec(raw)
  const late = Math.max(0, Math.floor(elapsedS))
  const named: [string, string][] = [
    ['stats24h', 'prices'],
    ['candles', 'candles'],
    ['trades', 'trades'],
    ['book', 'book'],
    ['pool', 'pool'],
  ]
  // The server's words for a pause: "holds every GeckoTerminal call for 41 more s" while it lasts,
  // "pauses every GeckoTerminal call for 60 s" from the call that met the 429.
  const left = named.flatMap(([k]) => {
    const b = rec(m[k])
    const n = /GeckoTerminal call for (\d+) (?:more )?s\b/.exec(
      text(b['stale'] === true ? b['staleReason'] : b['error']),
    )
    return n ? [Number(n[1]) - late] : []
  })
  const longest = left.length ? Math.max(...left) : 0
  const coolDownS = longest > 0 ? longest : null
  const limited =
    'GeckoTerminal is rate-limiting' + (coolDownS === null ? '' : `, next try in ${coolDownS} s`)
  // A GeckoTerminal 429 reads as the rate limit. Anything else is the cause the server named,
  // without its block's name, its retry advice or the "last good value" tail this note replaces.
  const reasonOf = (t: string) =>
    /GeckoTerminal(?: answered)? 429/.test(t)
      ? limited
      : t
          .replace(/^[^:]{1,40}: /, '')
          .replace(/\s*(This server asks again|Showing the last good value)[\s\S]*$/, '')
          .replace(/[.;\s]+$/, '') || 'the server named no reason'
  const groups = new Map<string, string[]>()
  const blocks: string[] = []
  const add = (block: string, what: string, age: number | null, reason: string) => {
    blocks.push(block)
    groups.set(reason, [
      ...(groups.get(reason) ?? []),
      age === null ? `${what} of unknown age` : `${what} ${age + late} s old`,
    ])
  }
  for (const [k, what] of named) {
    const b = rec(m[k])
    if (b['stale'] !== true) continue
    const age = b['ageSeconds']
    add(
      k,
      what,
      typeof age === 'number' && Number.isFinite(age) ? Math.max(0, Math.round(age)) : null,
      reasonOf(text(b['staleReason'])),
    )
  }
  // The book is read on chain, but its USD prices use GeckoTerminal's quote price, which can be
  // the last good one while the book itself is fresh.
  const usd =
    /\(the last good price, (\d+) s old, because its refresh (?:failed: ([\s\S]*)|met a GeckoTerminal 429[^)]*)\)/.exec(
      text(rec(m['book'])['basis']),
    )
  if (usd)
    add(
      'usd',
      'book USD price',
      Number(usd[1]),
      usd[2] === undefined
        ? limited
        : usd[2].replace(/[.;\s]+$/, '') || 'the server named no reason',
    )
  return {
    lines: [...groups].map(([reason, parts]) => `${parts.join(', ')}: ${reason}`),
    blocks,
    coolDownS,
  }
}
/** The status line's cool-down part, the same words in both plugins. */
export const coolDownText = (s: number) => `GeckoTerminal cool-down ${s} s`

// `curve`: the list carries a bonding curve % or a graduation time, so it gets a curve column.
type Source = { label: string; list: string; interval: boolean; curve: boolean }
const SOURCES: Source[] = [
  { label: 'trending', list: 'trending', interval: true, curve: false },
  { label: 'most traded', list: 'most-traded', interval: true, curve: false },
  { label: 'top organic', list: 'top-organic', interval: true, curve: false },
  { label: 'new', list: 'new', interval: false, curve: false },
  { label: 'about to graduate', list: 'about-to-graduate', interval: false, curve: true },
  { label: 'graduated', list: 'graduated', interval: false, curve: true },
]
const INTERVALS = ['5m', '1h', '6h', '24h']

/* ---------------------------------------------------------------------------------------------- */
/* logos, as half-block pixels                                                                    */
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

// Price history from the Agon server's `/market`, 100 candles of the chosen width on the pool it
// picked, the same answer the trade view draws. The server queues and caches GeckoTerminal for every
// client, so charts load for the selected token only, after the selection settles, and each answer
// is kept for a minute here.
const RANGES = ['1m', '15m', '1h', '1d']
/** The sidebar's sparklines: 15-minute candles, about the last 25 hours. */
const WATCH_RANGE = 1

// 1 `/market` answer, as far as discovery uses it: closes oldest first, and the 24h figures that
// stand in for a watched token the current list does not carry.
type Series = {
  closes: number[]
  volumes: number[]
  times: number[]
  price: number | null
  change24h: number | null
  liquidity: number | null
  // The server's own reason when its candles or its 24h stats failed, each failing on its own.
  candlesError: string | null
  statsError: string | null
  // The answer as sent and when it arrived, for staleOf, whose notes count on from then.
  raw: unknown
  receivedAt: number
}

const readSeries = (raw: unknown, receivedAt = Date.now()): Series => {
  const m = obj(raw)
  const c = obj(m['candles'])
  const s = obj(m['stats24h'])
  // A candle without a finite close is dropped, because 1 NaN reaching the braille grid throws
  // inside the renderer.
  const list = (Array.isArray(c['list']) ? c['list'] : [])
    .map(obj)
    .filter((k) => num(k['close']) !== null)
  return {
    closes: list.map((k) => num(k['close'])!),
    volumes: list.map((k) => num(k['volume']) ?? 0),
    times: list.map((k) => num(k['t']) ?? 0),
    price: num(s['price']),
    change24h: num(s['changePct']),
    liquidity: fig(s['liquidityUsd']),
    candlesError: str(c['error']),
    statsError: str(s['error']),
    raw,
    receivedAt,
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

// Widths in terminal cells, not string length: a CJK character or an emoji in a symbol takes 2
// cells, and padding by length pushed a graduated token's price over the next column. Bun's
// measure is the one OpenTUI itself uses under Bun, which is what opencode runs on.
const cells = (s: string): number =>
  (globalThis as { Bun?: { stringWidth(s: string): number } }).Bun?.stringWidth(s) ?? s.length
/** At most `n` cells of `s`, cut between code points. */
const cut = (s: string, n: number) => {
  if (cells(s) <= n) return s
  let out = ''
  for (const ch of s) {
    if (cells(out + ch) > n) break
    out += ch
  }
  return out
}
export const pad = (s: string, n: number) => {
  const c = cut(s, n)
  return c + ' '.repeat(Math.max(0, n - cells(c)))
}
export const lpad = (s: string, n: number) => {
  const c = cut(s, n)
  return ' '.repeat(Math.max(0, n - cells(c))) + c
}
// A figure the server did not send. Drawn dim, never as 0, never as "N/A".
const NOT_SENT = 'not sent'
// toPrecision writes 2.110e-7 below 1e-6; its digits are moved into plain decimals, as the Claude
// Code plugin (T-E25) prints them, so a trader reads the same figure on both surfaces.
const decimals = (s: string) => {
  const m = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(s)
  if (!m) return s
  const [, sign, int, frac = '', exp] = m
  const e = Number(exp)
  return e < 0
    ? `${sign}0.${'0'.repeat(-e - 1)}${int}${frac}`
    : `${sign}${int}${frac}${'0'.repeat(Math.max(0, e - frac.length))}`
}
/** A price, T-E25's rule: 2 decimals from $1,000, 6 significant digits from $1, 4 below. */
export const money = (v: number) => {
  const a = Math.abs(v)
  return `$${decimals(a >= 1000 ? v.toFixed(2) : a >= 1 ? v.toPrecision(6) : v.toPrecision(4))}`
}
const price = (p: number | null) => (p === null ? NOT_SENT : money(p))
// Compact so a 7425% move fits the column instead of losing its sign or its % sign.
const pct = (c: number | null) => {
  if (c === null) return NOT_SENT
  const sign = c >= 0 ? '+' : '-'
  const a = Math.abs(c)
  const body = a >= 1000 ? `${(a / 1000).toFixed(1)}K` : a >= 100 ? a.toFixed(0) : a.toFixed(2)
  return `${sign}${body}%`
}
const compact = (v: number | null, dollar = true) => {
  if (v === null) return NOT_SENT
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
const fixed = (v: number | null, digits: number, unit = '') =>
  v === null ? NOT_SENT : v.toFixed(digits) + unit
// The curve column: graduated, the curve's %, or not sent.
const curveText = (t: Token) => (t.graduatedAt ? 'graduated' : fixed(t.curve, 1, '%'))
const ageText = (s: number | null) =>
  s === null
    ? NOT_SENT
    : s < 3_600
      ? `${Math.floor(s / 60)}m`
      : s < 86_400
        ? `${Math.floor(s / 3_600)}h`
        : `${Math.floor(s / 86_400)}d`

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
  { label: 'bonding curve', get: (t) => t.curve },
]
const CURVE_SORT = SORTS.length - 1

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
  const [list, setList] = createSignal<Token[]>([])
  // The last display text any list sent for a watched mint, so a watched token keeps its symbol
  // after the user moves to a list without it. Bounded by the watchlist.
  const [seen, setSeen] = createSignal(new Map<string, Pick<Token, 'symbol' | 'name' | 'icon'>>())
  const [source, setSource] = createSignal(0)
  const [interval, setInterval_] = createSignal(1)
  const [updatedAt, setUpdatedAt] = createSignal<number | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [now, setNow] = createSignal(Date.now())
  const [logos, setLogos] = createSignal(new Map<string, Cell[][] | null>())
  const [focus, setFocus] = createSignal<string | null>(null)
  const pending = new Set<string>()

  // Logo cache, keyed by mint and size. A logo that fails (the server answers 404 with the reason) is
  // cached as null, so it is not retried every refresh; the row then shows the symbol's first letter.
  // A busy server (503) or an unreachable one is not cached: a later draw asks again.
  // A token /discover sent no icon for is not asked at all.
  const logo = (t: Token, size: number): Cell[][] | null | undefined => {
    if (!t.icon || !options.logos) return null
    const back = api.theme.current?.background?.toInts()
    const bg =
      back && back[3] >= 128 ? ([back[0], back[1], back[2]] as [number, number, number]) : null
    const key = `${size}:${bg ?? 'none'}:${t.mint}`
    const have = logos().get(key)
    if (have !== undefined || pending.has(key)) return have
    pending.add(key)
    void fetch(`${options.mcpUrl}/logo?mint=${encodeURIComponent(t.mint)}&size=${size}`)
      .then(async (r) => {
        if (r.status === 503) return undefined
        if (!r.ok) return null
        try {
          return toCells(decodePng(new Uint8Array(await r.arrayBuffer())), bg)
        } catch {
          return null
        }
      })
      .catch(() => undefined)
      .then((cells) => {
        pending.delete(key)
        if (cells !== undefined) setLogos((m) => new Map(m).set(key, cells))
      })
    return undefined
  }

  // Chart cache, keyed by mint and range. A missing entry is not asked yet; data null is a failure.
  const [series, setSeries] = createSignal(
    new Map<string, { at: number; data: Series | null; error: string | null }>(),
  )
  const loadingSeries = new Set<string>()
  const chart = (mint: string, range: number, maxAgeMs = 60_000) => {
    const key = `${mint}:${range}`
    const have = series().get(key)
    // A failure is asked again after 15 s, not cached for the session. The last good answer stays
    // meanwhile, with the failure beside it, so 1 timeout does not blank a watched row.
    const fresh = have && Date.now() - have.at < (have.error ? 15_000 : maxAgeMs)
    if (fresh || loadingSeries.has(key)) return have
    loadingSeries.add(key)
    void getJson(`${options.mcpUrl}/market?mint=${encodeURIComponent(mint)}&range=${RANGES[range]}`)
      .then((body) => ({ data: readSeries(body, Date.now()), error: null }))
      .catch((e) => ({
        data: series().get(key)?.data ?? null,
        error: `/market: ${e instanceof Error ? e.message : String(e)}`,
      }))
      .then((r) => {
        loadingSeries.delete(key)
        setSeries((m) => new Map(m).set(key, { at: Date.now(), ...r }))
      })
    return have
  }

  // The watchlist: a watched token's row from the list on screen when it is there, else its 24h
  // figures from `/market`, the answer its sparkline is drawn from. Shown once either has arrived.
  const watchlist = createMemo(() =>
    watchMints().flatMap((mint): Token[] => {
      const row = list().find((t) => t.mint === mint)
      if (row) return [row]
      const s = chart(mint, WATCH_RANGE, WATCH_MAX_AGE_MS)?.data
      if (!s) return []
      const known = seen().get(mint)
      return [
        {
          ...blank(mint),
          symbol: known?.symbol ?? PINNED[mint] ?? mint.slice(0, 4),
          name: known?.name ?? '',
          icon: known?.icon ?? null,
          price: s.price,
          change24h: s.change24h,
          liquidity: s.liquidity,
        },
      ]
    }),
  )

  // Why a watched token is missing or shows "not sent": the server's reason, named by token.
  const watchErrors = createMemo(() =>
    watchMints().flatMap((mint) => {
      if (list().some((t) => t.mint === mint)) return []
      const e = series().get(`${mint}:${WATCH_RANGE}`)
      const why = e?.error ?? e?.data?.statsError ?? e?.data?.candlesError
      return why ? [`${seen().get(mint)?.symbol ?? PINNED[mint] ?? short(mint)}: ${why}`] : []
    }),
  )

  // A chart's stale notes (T-E29), counted on by the 1 s clock, for the blocks a view draws from
  // /market. Null before any answer.
  const staleAt = (mint: string, range: number, blocks: string[]) => {
    const d = series().get(`${mint}:${range}`)?.data
    if (!d) return null
    const raw = obj(d.raw)
    return staleOf(
      Object.fromEntries(blocks.map((b) => [b, raw[b]])),
      (now() - d.receivedAt) / 1000,
    )
  }
  // The blocks a watched row draws from /market: its sparkline always, its price and change when
  // the list on screen does not carry it.
  const watchBlocks = (mint: string) =>
    list().some((t) => t.mint === mint) ? ['candles'] : ['candles', 'stats24h', 'pool']
  // A watched row whose numbers are their last good ones: the note, by token.
  const watchStale = createMemo(() =>
    watchMints().flatMap((mint) => {
      const s = staleAt(mint, WATCH_RANGE, watchBlocks(mint))
      const name = seen().get(mint)?.symbol ?? PINNED[mint] ?? short(mint)
      return (s?.lines ?? []).map((l) => `${name}: ${l}`)
    }),
  )

  const listUrl = () => {
    const s = SOURCES[source()]!
    const i = s.interval ? `&interval=${INTERVALS[interval()]}` : ''
    return `${options.mcpUrl}/discover?list=${s.list}${i}`
  }

  // Only the latest refresh writes, so a slow answer for the list the user just left cannot land
  // under the new list's heading.
  // A poll waits for a refresh still in flight instead of superseding it, or a server slower than
  // the poll would never land a list and never show an error.
  let run = 0
  let busy = false
  const refresh = async () => {
    const mine = ++run
    busy = true
    try {
      const body = obj(await getJson(listUrl()))
      const tokens = body['tokens']
      if (!Array.isArray(tokens))
        throw new Error('the answer has no token list, so nothing is shown rather than a guess')
      if (mine !== run) return
      const l = tokens.flatMap((t) => toToken(t) ?? []).slice(0, options.limit)
      setList(l)
      const watched = l.filter((t) => watchMints().includes(t.mint))
      if (watched.length)
        setSeen((m) => {
          const next = new Map([...m].filter(([k]) => watchMints().includes(k)))
          for (const t of watched)
            next.set(t.mint, { symbol: t.symbol, name: t.name, icon: t.icon })
          return next
        })
      // The data's age is the server's: when it read the list, not when this page asked.
      const at = Date.parse(str(obj(body['source'])['fetchedAt']) ?? '')
      setUpdatedAt(Number.isFinite(at) ? Math.min(at, Date.now()) : Date.now())
      setError(null)
    } catch (e) {
      // The last good rows stay on screen, and the reason they are not moving is said.
      if (mine !== run) return
      setError(
        `/discover at ${options.mcpUrl}: ${e instanceof Error ? e.message : String(e)}. ${updatedAt() === null ? 'No data yet' : `Showing data from ${age()}`}, retrying in ${options.refreshMs / 1000}s`,
      )
    } finally {
      if (mine === run) busy = false
    }
  }
  // A new list is fetched at once rather than on the next poll.
  createEffect(on([source, interval], () => void refresh()))
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
    mcpUrl: options.mcpUrl,
    logos: options.logos,
    watchMints,
    watchlist,
    watchErrors,
    watchStale,
    staleAt,
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
  const cells = () => props.model.logo(props.token, props.size)
  const theme = () => props.model.api.theme.current
  // With logos off only the letter is drawn, so it takes 1 line, not the logo's.
  return (
    <box flexDirection="column" width={props.size} height={props.model.logos ? props.size / 2 : 1}>
      <Show
        when={cells()}
        fallback={
          <text fg={ink(props.model.api, theme()?.accent)}>
            {pad([...props.token.symbol][0] ?? '', props.size)}
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

// A figure inside a line of text: dim when the server did not send it (v null), else `fg`, or the
// line's own colour when `fg` is not given.
function V(props: {
  api: TuiPluginApi
  v: unknown
  text: string
  fg?: Colour | string
  bg?: Colour
}) {
  return (
    <span
      // @ts-expect-error OpenTUI 0.4.5 draws a span's fg, but its SpanProps type does not declare it
      fg={
        props.v === null ? ink(props.api, props.api.theme.current?.textMuted, props.bg) : props.fg
      }
    >
      {props.text}
    </span>
  )
}

// At most this many tokens in the sidebar, so a long watchlist does not push opencode's own panels
// (MCP, LSP, todo, files) off the screen; the rest are a line that opens the page.
const SIDEBAR_ROWS = 5

function Sidebar(props: { model: Model; open: () => void; openSetup: () => void }) {
  const api = props.model.api
  const theme = () => api.theme.current
  const shown = () => props.model.watchlist().slice(0, SIDEBAR_ROWS)
  const more = () => props.model.watchlist().length - shown().length
  // Stale numbers are drawn dim, never green or red: the sparkline when its candles are, and the
  // price and change of a row drawn from /market when its 24h stats are.
  const muted = () => ink(api, theme()?.textMuted, theme()?.backgroundPanel)
  const staleIn = (mint: string, block: string) =>
    !!props.model.staleAt(mint, WATCH_RANGE, [block])?.blocks.includes(block)
  const statsStale = (mint: string) =>
    staleIn(mint, 'stats24h') && !props.model.list().some((x) => x.mint === mint)
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
            height={props.model.logos ? 3 : 2}
            onMouseDown={(e) => {
              if (e.button !== 0 || api.ui.dialog.open) return
              props.model.setFocus(t.mint)
              props.open()
            }}
          >
            <Logo model={props.model} token={t} size={6} />
            <box flexDirection="column">
              <text fg={theme()?.text} wrapMode="none">
                {pad(t.symbol, 7) + ' '}
                <V
                  api={api}
                  v={t.price}
                  text={lpad(price(t.price), 13)}
                  fg={statsStale(t.mint) ? muted() : undefined}
                  bg={theme()?.backgroundPanel}
                />
              </text>
              <box flexDirection="row" gap={1} height={1}>
                <text
                  fg={
                    staleIn(t.mint, 'candles')
                      ? muted()
                      : colourOf(api, t.change24h, theme()?.backgroundPanel)
                  }
                  wrapMode="none"
                >
                  {pad(
                    sparkline(
                      props.model.chart(t.mint, WATCH_RANGE, WATCH_MAX_AGE_MS)?.data?.closes ?? [],
                      10,
                    ),
                    10,
                  )}
                </text>
                <text
                  fg={
                    statsStale(t.mint)
                      ? muted()
                      : colourOf(api, t.change24h, theme()?.backgroundPanel)
                  }
                  wrapMode="none"
                >
                  {`24h ${pct(t.change24h)}${statsStale(t.mint) ? ' stale' : ''}`}
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
      <Show when={props.model.watchErrors()[0]}>
        <text fg={ink(api, theme()?.textMuted, theme()?.backgroundPanel)}>
          {props.model.watchErrors()[0]! +
            (props.model.watchErrors().length > 1
              ? ` And ${props.model.watchErrors().length - 1} more watched ${props.model.watchErrors().length > 2 ? 'tokens' : 'token'} failed.`
              : '')}
        </text>
      </Show>
      <Show when={props.model.watchStale()[0]}>
        <text fg={muted()}>
          {props.model.watchStale()[0]! +
            (props.model.watchStale().length > 1
              ? ` And ${props.model.watchStale().length - 1} more stale ${props.model.watchStale().length > 2 ? 'notes' : 'note'}.`
              : '')}
        </text>
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
  const entry = () => (settled() ? props.model.chart(props.token.mint, props.range) : undefined)
  const data = () => entry()?.data ?? null
  const first = () => data()?.closes[0] ?? null
  const last = () => data()?.closes.at(-1) ?? null
  const change = () => (first() && last() ? ((last()! - first()!) / first()!) * 100 : null)
  // Stale candles (T-E29) are drawn dim, never green or red, with the note saying how old and why.
  // Only the candles: the rest of this pane's figures come from /discover.
  const stale = () =>
    settled() ? props.model.staleAt(props.token.mint, props.range, ['candles']) : null
  const dim = () => !!stale()?.blocks.includes('candles')
  const lineInk = () => (dim() ? ink(api, theme()?.textMuted) : colourOf(api, change()))
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
              label={r}
              active={i() === props.range}
              onPress={() => props.setRange(i())}
            />
          )}
        </For>
        <text fg={lineInk()}>{data() ? ` ${pct(change())}${dim() ? ' stale' : ''}` : ''}</text>
      </box>
      <Show
        when={data() && data()!.closes.length > 1}
        fallback={
          <text fg={ink(api, theme()?.textMuted)}>
            {entry()?.error
              ? `no chart: ${entry()!.error}`
              : data()?.candlesError
                ? `no chart: ${data()!.candlesError}`
                : data()
                  ? `no chart: /market sent ${data()!.closes.length} of the 2 candles a line needs for ${RANGES[props.range]}; try another range (v)`
                  : `loading ${RANGES[props.range]} candles from /market`}
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
              <text fg={lineInk()} wrapMode="none">
                {line}
              </text>
            )}
          </For>
        </box>
        <For each={stale()?.lines ?? []}>
          {(line) => (
            <text fg={ink(api, theme()?.textMuted)} flexShrink={0}>
              {line}
            </text>
          )}
        </For>
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
        <Show when={entry()?.error}>
          <text fg={ink(api, theme()?.warning)} flexShrink={0}>
            {`the last chart, not refreshed: ${entry()!.error}`}
          </text>
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
  const live = (off: boolean | null) => (off === false ? ink(api, theme()?.error) : theme()?.text)
  const authority = (off: boolean | null) => (off === null ? NOT_SENT : off ? 'disabled' : 'LIVE')
  const change = (v: number | null) => <V api={api} v={v} text={pct(v)} fg={colourOf(api, v)} />
  // The curve line shows on the 2 lists that carry it, and wherever a token has one.
  const showCurve = (t: Token) =>
    t.curve !== null || t.graduatedAt !== null || SOURCES[props.model.source()]!.curve
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
                  <b>{cut(t().symbol, 18)}</b>
                </text>
                <text fg={t().price === null ? muted() : theme()?.text}>{price(t().price)}</text>
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
            <text fg={live(t().mintAuthorityOff)} flexShrink={0} wrapMode="none">
              {'mint authority '}
              <V api={api} v={t().mintAuthorityOff} text={authority(t().mintAuthorityOff)} />
            </text>
            <text fg={live(t().freezeAuthorityOff)} flexShrink={0} wrapMode="none">
              {'freeze authority '}
              <V api={api} v={t().freezeAuthorityOff} text={authority(t().freezeAuthorityOff)} />
            </text>
            <text fg={theme()?.text} flexShrink={0} wrapMode="none">
              {'top holders '}
              <V api={api} v={t().topHoldersPct} text={fixed(t().topHoldersPct, 1, '%')} />
              {', dev '}
              <V api={api} v={t().devPct} text={fixed(t().devPct, 2, '%')} />
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
              {cells(t().name) > 36 ? cut(t().name, 35) + '~' : t().name}
            </text>
            <text fg={muted()} flexShrink={0}>
              {short(t().mint)}
            </text>
            <text fg={theme()?.text} flexShrink={0} wrapMode="none">
              <V api={api} v={t().price} text={price(t().price)} />
              {'  mcap '}
              <V api={api} v={t().mcap} text={compact(t().mcap)} />
              {'  liq '}
              <V api={api} v={t().liquidity} text={compact(t().liquidity)} />
            </text>
            <text fg={theme()?.text} flexShrink={0} wrapMode="none">
              {'5m '}
              {change(t().change5m)}
              {'  1h '}
              {change(t().change1h)}
              {'  24h '}
              {change(t().change24h)}
            </text>
            <text fg={theme()?.text} flexShrink={0} wrapMode="none">
              {'holders '}
              <V api={api} v={t().holders} text={compact(t().holders, false)} />
              {'  organic '}
              <V api={api} v={t().organic} text={fixed(t().organic, 0)} />
            </text>
            <text fg={theme()?.text} flexShrink={0} wrapMode="none">
              {'age '}
              <V api={api} v={t().ageSeconds} text={ageText(t().ageSeconds)} />
              <Show when={showCurve(t())}>
                {t().graduatedAt ? '  graduated ' : '  bonding curve '}
                <V
                  api={api}
                  v={t().graduatedAt ?? t().curve}
                  text={
                    t().graduatedAt
                      ? `${t().graduatedAt!.slice(5, 16).replace('T', ' ')} UTC`
                      : fixed(t().curve, 1, '%')
                  }
                />
              </Show>
            </text>
          </>
        )}
      </Show>
    </box>
  )
}

// A token as a card: logo, price, volume and liquidity (the curve on the 2 lists that carry it), and
// the 24h change in a 2-line font. Fixed size, so a grid of them lines up and the page can work out
// how many fit.
const CARD_W = 30
const CARD_H = 7

function Card(props: {
  model: Model
  token: Token
  width: number
  selected: boolean
  watched: boolean
  curve: boolean
  onSelect: () => void
}) {
  const api = props.model.api
  const theme = () => api.theme.current
  const t = () => props.token
  const bg = () => (props.selected ? theme()?.backgroundElement : undefined)
  const dim = () => ink(api, theme()?.textMuted, bg())
  return (
    <box
      border
      borderStyle="rounded"
      width={props.width}
      height={CARD_H}
      borderColor={props.selected ? ink(api, theme()?.primary, bg()) : colourOf(api, t().change24h)}
      backgroundColor={bg()}
      title={` ${props.selected ? '> ' : ''}${props.watched ? '*' : ''}${cut(t().symbol, 18)} `}
      paddingLeft={1}
      flexDirection="column"
      onMouseDown={(e) => {
        if (e.button === 0 && !api.ui.dialog.open) props.onSelect()
      }}
    >
      <box flexDirection="row" gap={1} height={3}>
        <Logo model={props.model} token={t()} size={6} />
        <box flexDirection="column">
          <text fg={t().price === null ? dim() : theme()?.text} wrapMode="none">
            {price(t().price)}
          </text>
          <text fg={dim()} wrapMode="none">
            {`vol ${compact(t().volume24h)}`}
          </text>
          <text fg={dim()} wrapMode="none">
            {props.curve ? `curve ${curveText(t())}` : `liq ${compact(t().liquidity)}`}
          </text>
        </box>
      </box>
      <Show when={t().change24h !== null} fallback={<text fg={dim()}>{`24h ${NOT_SENT}`}</text>}>
        <ascii_font
          text={pct(t().change24h)}
          font="tiny"
          color={colourOf(api, t().change24h, bg())}
        />
      </Show>
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
  // Table rows are 2 lines tall for a 4 by 4 pixel logo, 1 line with logos off, which left every
  // other line blank at 2; cards fill whole rows of cards.
  const rowH = model.logos ? 2 : 1
  // The logo column: a 4 by 4 pixel logo and a gap, or with logos off the letter (2 cells for a CJK
  // one) and a gap, which leaves room for the volume column beside a $0.0000005859 price at 80.
  const logoW = model.logos ? 5 : 3
  const visible = () =>
    view() === 'cards'
      ? cols() * Math.max(1, Math.floor((dims().height - chrome()) / CARD_H))
      : Math.max(3, Math.floor((dims().height - chrome()) / rowH))
  // The price column fits the widest price in view, so $0.0000002110 is never cut to a different
  // number; at least 11 wide.
  const priceW = () => Math.max(11, ...window().map((t) => price(t.price).length))

  const rows = createMemo(() => {
    const key = SORTS[sort()]!
    const dir = desc() ? -1 : 1
    const raw = search()
    const q = raw.toLowerCase()
    // A mint matches as typed, since base58 is case sensitive; a symbol or name in any case.
    return model
      .list()
      .filter(
        (t) =>
          !q ||
          t.mint.includes(raw) ||
          t.symbol.toLowerCase().includes(q) ||
          t.name.toLowerCase().includes(q),
      )
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
        placeholder="symbol, name or mint, empty to clear"
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
  // Optional columns after logo, token and price (the logo, 10 and the price's width), in screen
  // order. `keep` is the order they are kept in when the list is narrow: 24h first, organic last.
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
    // 9 wide: "$999.9M" and "not sent" fit with a space, and at 80 columns the volume still fits
    // beside a $0.00000001234 price.
    { label: 'vol 24h', width: 9, sort: 0, keep: 1, value: (t) => compact(t.volume24h) },
    { label: 'liq', width: 9, sort: 5, keep: 3, value: (t) => compact(t.liquidity) },
    { label: 'mcap', width: 9, sort: 4, keep: 5, value: (t) => compact(t.mcap) },
    { label: 'holders', width: 9, sort: 6, keep: 6, value: (t) => compact(t.holders, false) },
    // 9 wide, not 5, so "not sent" fits whole.
    { label: 'org', width: 9, sort: 7, keep: 7, value: (t) => fixed(t.organic, 0) },
  ]
  // The bonding curve, or "graduated", on the 2 lists that carry it, kept right after 24h.
  const curveColumn: Column = {
    label: 'curve',
    width: 10,
    sort: CURVE_SORT,
    keep: 0.5,
    value: curveText,
  }
  const shownColumns = createMemo(() => {
    let room = listWidth() - logoW - 10 - priceW()
    const kept = new Set<Column>()
    const all = src().curve ? [...columns.slice(0, 3), curveColumn, ...columns.slice(3)] : columns
    const rank = (c: Column) => (c.sort === sort() ? -1 : c.keep)
    for (const c of [...all].sort((a, b) => rank(a) - rank(b))) {
      if (c.width > room) break
      kept.add(c)
      room -= c.width
    }
    return all.filter((c) => kept.has(c))
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
                ? `no tokens yet: ${model.error() ?? `loading /discover from ${model.mcpUrl}`}`
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
                      curve={src().curve}
                      onSelect={() => move(offset() + i())}
                    />
                  )}
                </For>
              </box>
            }
          >
            <box flexDirection="row" height={1} flexShrink={0}>
              <text fg={ink(api, theme()?.textMuted)} wrapMode="none">
                {pad('', logoW) + pad('token', 10) + lpad('price', priceW())}
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
                    height={rowH}
                    flexShrink={0}
                    backgroundColor={bg()}
                    onMouseOver={() => setHovered(t.mint)}
                    onMouseOut={() => setHovered((h) => (h === t.mint ? null : h))}
                    onMouseDown={(e) => {
                      if (e.button === 0 && !api.ui.dialog.open) move(offset() + i())
                    }}
                  >
                    <box width={logoW} flexShrink={0}>
                      <Logo model={model} token={t} size={model.logos ? 4 : 2} />
                    </box>
                    <text fg={theme()?.text} wrapMode="none">
                      {pad((isSel() ? '>' : '') + (watched() ? '*' : '') + t.symbol, 9) + ' '}
                      <V api={api} v={t.price} text={lpad(price(t.price), priceW())} bg={bg()} />
                    </text>
                    <For each={shownColumns()}>
                      {(c) => (
                        <text
                          fg={
                            c.value(t) === NOT_SENT
                              ? ink(api, theme()?.textMuted, bg())
                              : c.change
                                ? colourOf(api, c.change(t), bg())
                                : theme()?.text
                          }
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
      description:
        'Live tokens from the Agon server: trending, most traded, top organic, new, graduating',
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
