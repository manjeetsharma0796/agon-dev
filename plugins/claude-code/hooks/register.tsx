// Agon inside Claude Code: the status band above the prompt and the trade view in a pane.
//
// Everything on screen comes from the Agon server: GET /status for the band (connection, RPC ping,
// SOL) and GET /market?mint=&range= for the trade view (24h stats, candles with MA and EMA, recent
// trades, the book). The plugin computes no number: it rounds the server's numbers for display by
// the opencode trade view's rules (.opencode/tui/agon-trade.tsx), so the two screens read alike. The
// chart scales the server's candles to cells and pixels; that is drawing, not a number anyone reads.
//
// Buy, Sell and Check only fill the prompt, never send it. A draft carries the token's mint and
// never a name or symbol (OP-38). Up and down are never colour alone: an arrow, a sign, a word, or
// a different glyph.
//
// It reads only. It never signs, sends or holds a key.

import type {
  ElementConstructor,
  EngineInterface,
  InputProps,
  RasterProps,
  Register,
  RenderInput,
  SvgProps,
} from 'claude-code'

import type { BandMode, Book, Candle, Line, Loaded, Market, Status } from '../types'

// The address docs/public/agent-setup.md and the opencode plugin use; `serverUrl` overrides it.
const DEFAULT_SERVER = 'http://127.0.0.1:8787'
const PANE = 'agon-trade'
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
// The server's own ranges (market.ts RANGES), in its order.
const RANGES = ['1m', '5m', '15m', '1h', '4h', '12h', '1d']
// Quick picks, labelled by this list and not by any upstream text.
const PICKS: [string, string][] = [
  ['SOL', 'So11111111111111111111111111111111111111112'],
  ['JUP', 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN'],
  ['BONK', 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'],
]
const STATUS_EVERY_MS = 5_000
const MARKET_EVERY_MS = 15_000

const MODE = { plugin: 'agon', key: 'mode' } as const
const SELECTED = { plugin: 'agon', key: 'selected' } as const
const RANGE = { plugin: 'agon', key: 'range' } as const
const MARKET = { plugin: 'agon', key: 'market' } as const
const STATUS = { plugin: 'agon', key: 'status' } as const
const MINT_NOTE = { plugin: 'agon', key: 'mintNote' } as const

// Set from the plugin's options each time `register` runs.
let server = DEFAULT_SERVER

const httpUrl = (v: unknown) => {
  try {
    const u = new URL(String(v))
    return u.protocol === 'http:' || u.protocol === 'https:'
      ? u.toString().replace(/\/$/, '')
      : DEFAULT_SERVER
  } catch {
    return DEFAULT_SERVER
  }
}
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const why = (e: unknown) => (e instanceof Error ? e.message : String(e))
const short = (a: string) => `${a.slice(0, 4)}..${a.slice(-4)}`
const labelOf = (mint: string) => PICKS.find(([, m]) => m === mint)?.[0] ?? short(mint)

// ---- formatting: display only, never a new number; the opencode trade view's rules ----

// toPrecision writes 2.110e-7 below 1e-6; its digits are moved into plain decimals.
const decimals = (s: string) => {
  const m = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(s)
  if (!m) return s
  const [, sign, int, frac = '', exp] = m
  const e = Number(exp)
  return e < 0
    ? `${sign}0.${'0'.repeat(-e - 1)}${int}${frac}`
    : `${sign}${int}${frac}${'0'.repeat(Math.max(0, e - frac.length))}`
}
// A price: 2 decimals from $1,000, 6 significant digits from $1, 4 below.
const usd = (v: unknown) => {
  const n = num(v)
  if (n === null) return null
  const a = Math.abs(n)
  return `$${decimals(a >= 1000 ? n.toFixed(2) : a >= 1 ? n.toPrecision(6) : n.toPrecision(4))}`
}
// Volume and other large amounts: $204.0M, $4.9K.
const big = (v: unknown, dollar = true) => {
  const n = num(v)
  if (n === null) return null
  const [d, s] = n >= 1e9 ? [1e9, 'B'] : n >= 1e6 ? [1e6, 'M'] : n >= 1e3 ? [1e3, 'K'] : [1, '']
  return `${dollar ? '$' : ''}${(n / d).toFixed(d === 1 ? 2 : 1)}${s}`
}
// A change with an arrow and a sign, so it reads without colour.
const move = (v: unknown) => {
  const c = num(v)
  if (c === null) return null
  return `${c > 0 ? '▲ +' : c < 0 ? '▼ ' : '= '}${c.toFixed(2)}%`
}
// A book size as sent when it fits its column, compacted when it would not.
const cell = (v: unknown, width: number) => {
  const n = num(v)
  if (n === null) return 'none'
  return String(n).length <= width ? String(n) : big(n, false)!
}
const tone = (v: unknown) => {
  const n = num(v)
  return n === null || n === 0 ? undefined : n > 0 ? 'green' : 'red'
}
const clock = (iso: string | undefined) =>
  iso && !Number.isNaN(Date.parse(iso)) ? new Date(iso).toISOString().slice(11, 19) : 'unknown time'
const utc = (t: number) => new Date(t * 1000).toISOString().slice(5, 16).replace('T', ' ')
const age = (iso: string | undefined) =>
  iso && !Number.isNaN(Date.parse(iso))
    ? `${Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000))}s`
    : 'unknown age'

type Dollar = EngineInterface
type Site = RenderInput<'AbovePrompt'> | RenderInput<'Pane'>

async function getJson(
  $: Dollar,
  path: string,
): Promise<{ ok: boolean; status: number; body: any }> {
  const res = await $.http.fetch(`${server}${path}`, { headers: { accept: 'application/json' } })
  let body: any = null
  try {
    body = JSON.parse(res.text)
  } catch {
    throw new Error(
      `the server answered ${res.status} with ${res.text.length} characters that are not JSON`,
    )
  }
  return { ok: res.ok, status: res.status, body }
}

async function refreshStatus($: Dollar) {
  try {
    const r = await getJson($, '/status')
    const error = r.ok
      ? null
      : `the Agon server answered ${r.status}: ${String(r.body?.error ?? 'no reason given')}`
    await $.state.set(STATUS, { key: 'status', body: r.ok ? (r.body as Status) : null, error })
  } catch (e) {
    await $.state.set(STATUS, {
      key: 'status',
      body: null,
      error: `the Agon server is not answering at ${server} (${why(e)}). Start it as docs/public/agent-setup.md says, or set this plugin's serverUrl.`,
    })
  }
  // The band and the pane draw from this one value; both are asked to redraw with it.
  $.ui.invalidate('ui.render')
}

// Each /market request's number: only the newest writes, so a slow timer answer never lands over
// a fresher one for the same token.
let marketSeq = 0

async function refreshMarket($: Dollar) {
  const seq = ++marketSeq
  const mint = (await $.state.get(SELECTED)).value ?? PICKS[0]![1]
  const range = (await $.state.get(RANGE)).value ?? '1h'
  const key = `${mint}:${range}`
  if ((await $.state.get(MARKET)).value?.key !== key)
    await $.state.set(MARKET, { key, body: null, error: null })
  let next: Loaded<Market>
  try {
    const r = await getJson(
      $,
      `/market?mint=${encodeURIComponent(mint)}&range=${encodeURIComponent(range)}`,
    )
    next = r.ok
      ? { key, body: r.body as Market, error: null }
      : {
          key,
          body: null,
          error: `/market answered ${r.status}: ${String(r.body?.error ?? 'no reason given')}`,
        }
  } catch (e) {
    next = {
      key,
      body: null,
      error: `/market not answering at ${server} (${why(e)}); asked again in ${MARKET_EVERY_MS / 1000} s`,
    }
  }
  if (seq !== marketSeq) return
  await $.state.set(MARKET, next)
  $.ui.invalidate('ui.render')
}

async function choose($: Dollar, mint: string) {
  await $.state.set(SELECTED, mint)
  await $.state.set(MINT_NOTE, null)
  await refreshMarket($)
}

async function refreshAll($: Dollar) {
  await Promise.all([refreshStatus($), refreshMarket($)])
}

async function togglePane($: Dollar) {
  if ((await $.ui.panes()).some((p) => p.id === PANE)) {
    await $.ui.close({ id: PANE })
    return 'Agon trade view closed.'
  }
  const opened = await $.ui.open({
    id: PANE,
    title: 'Agon trade',
    focus: true,
    closeOnEscape: true,
  })
  void refreshAll($)
  return opened.isPlaced
    ? 'Agon trade view opened.'
    : `The Agon trade view could not be placed here (${opened.reason}). Widen the terminal or use the desktop app.`
}

// Claude Code before 2.1.286 has no `$.state`: the plugin then stays out of the way and says why.
const OLD = 'Agon needs Claude Code 2.1.286 or newer. Run `claude update`, then restart claude.'
async function ready($: Dollar) {
  try {
    await $.state.get(MODE)
    return true
  } catch {
    return false
  }
}

export const register: Register = (on, options) => {
  server = httpUrl(options['serverUrl'] ?? DEFAULT_SERVER)

  on('session.start', async ($, e, next) => {
    if (!(await ready($))) {
      $.ui.toast(OLD)
      return next(e)
    }
    await $.command.register({ name: 'agon', description: 'Open or close the Agon trade view' })
    await $.command.register({ name: 'agon-band', description: 'Collapse or expand the Agon band' })
    await $.state.set(MODE, (await $.store.get('mode')) === 'collapsed' ? 'collapsed' : 'line')
    void refreshAll($)
    $.clock.every(STATUS_EVERY_MS, () => void refreshStatus($))
    $.clock.every(MARKET_EVERY_MS, () => void refreshMarket($))
    return next(e)
  })

  on('command.run', { command: 'agon-band' }, async ($) => {
    if (!(await ready($))) return { text: OLD }
    const m: BandMode = (await $.state.get(MODE)).value === 'collapsed' ? 'line' : 'collapsed'
    await $.state.set(MODE, m)
    await $.store.set('mode', m)
    return { text: `Agon band ${m === 'collapsed' ? 'collapsed' : 'expanded'}.` }
  })

  on('command.run', { command: 'agon' }, async ($) => {
    if (!(await ready($))) return { text: OLD }
    return { text: await togglePane($) }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await ready($))) return next(e)
    return band($, e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (!(await ready($))) return next(e)
    return pane($, e)
  })
}

// ---- the connection, one reading for the band and the pane alike ----

type Tone = 'green' | 'yellow' | 'red'
function link(st: Loaded<Status> | null): [string, Tone] {
  if (!st) return [`◌ asking ${server}`, 'yellow']
  const s = st.body
  if (!s) return [`○ server offline: ${st.error}`, 'red']
  const u = s.upstream
  if (!u) return ['◌ connection unknown: /status sent no upstream state', 'yellow']
  const cause = u.cause ? `: ${u.cause}` : ''
  if (u.state === 'live') return ['● live', 'green']
  if (u.state === 'connecting') return ['◌ connecting', 'yellow']
  if (u.state === 'reconnecting')
    return [`◌ reconnecting, attempt ${u.attempt ?? 'not counted'}${cause}`, 'yellow']
  if (u.state === 'offline')
    return [`○ offline since ${clock(u.since)} UTC${cause}${u.next ? `. ${u.next}` : ''}`, 'red']
  return [`◌ upstream "${u.state.slice(0, 20)}", a state this plugin does not know`, 'yellow']
}
const ping = (s: Status) => {
  const ms = num(s.ping?.value?.ms)
  return ms === null ? `ping ${s.ping?.error ?? 'none yet'}` : `ping ${ms} ms`
}
const sol = (s: Status) => `SOL ${usd(s.solPrice?.value?.usd) ?? s.solPrice?.error ?? 'none yet'}`
// "fork, feed from mainnet" when the server says its readings come from another network.
const network = (s: Status) => {
  const name = !s.network
    ? 'network not read yet'
    : s.network === 'unset'
      ? 'network not set'
      : s.network
  return s.networkNote ? `${name}, feed from ${s.readsFrom ?? 'mainnet'}` : name
}

// The band: connection, RPC ping, SOL, the selected token's price and change, the pane's toggle.
async function band($: Dollar, e: RenderInput<'AbovePrompt'>) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const mode = (await $.state.get(MODE)).value ?? 'line'
  const toggle = (
    <Button
      key="toggle"
      plain
      label={mode === 'collapsed' ? 'Agon >' : 'Agon v'}
      onPress={async () => {
        const m: BandMode = mode === 'collapsed' ? 'line' : 'collapsed'
        await $.state.set(MODE, m)
        await $.store.set('mode', m)
      }}
    />
  )
  if (mode === 'collapsed') return <Box>{toggle}</Box>

  const st = (await $.state.get(STATUS)).value ?? null
  const mk = (await $.state.get(MARKET)).value ?? null
  const mint = (await $.state.get(SELECTED)).value ?? PICKS[0]![1]
  const range = (await $.state.get(RANGE)).value ?? '1h'
  // Only an answer for the token and range selected now: never one token's price under another's.
  const current = mk?.key === `${mint}:${range}` ? mk : null
  const stats = current?.body?.stats24h
  const [conn, connTone] = link(st)
  const s = st?.body ?? null
  const price = usd(stats?.price)
  return (
    <Box flexDirection="row" gap={2} alignItems="center" flexWrap="nowrap" overflow="hidden">
      {toggle}
      <Box key="b-conn" flexShrink={1} minWidth={6}>
        <Text color={connTone} wrap="truncate-end">
          {conn}
        </Text>
      </Box>
      {s && <Text key="b-ping">{ping(s)}</Text>}
      {s && <Text key="b-sol">{sol(s)}</Text>}
      <Box key="b-token" flexShrink={1} minWidth={4} flexDirection="row" gap={1}>
        <Text wrap="truncate-end">
          {price
            ? `${labelOf(mint)} ${price}`
            : `${labelOf(mint)}: ${current?.error ?? stats?.error ?? 'loading from /market'}`}
        </Text>
        {price && <Text color={tone(stats?.changePct)}>{move(stats?.changePct) ?? ''}</Text>}
      </Box>
      <Button key="pane" label="trade" onPress={() => togglePane($)} />
    </Box>
  )
}

// ---- the chart ----

const NONE = 0x01000000
const COLOUR = { up: 0x22c55e, down: 0xef4444, flat: 0x888888, ma: 0xeab308, ema: 0x38bdf8 }
// Up bodies are solid half blocks, down bodies heavy lines, wicks light lines, so a candle's
// direction reads with no colour too (the opencode trade view's glyphs).
const UP = { both: '█', top: '▀', bottom: '▄' }
const DOWN = { both: '┃', top: '╹', bottom: '╻' }
const WICK = { both: '│', top: '╵', bottom: '╷' }
const MA_DOT = '•'
const EMA_DOT = '◦'
const BARS = '▁▂▃▄▅▆▇█'
const AXIS = 12
type Dir = 'up' | 'down' | 'flat'
const dirOf = (c: Candle): Dir => (c.close > c.open ? 'up' : c.close < c.open ? 'down' : 'flat')

// The last `width` buckets ending at the newest candle; a bucket with no candle stays empty.
function buckets(list: Candle[], step: number, width: number) {
  const last = list.at(-1)!
  const byT = new Map(list.map((c, i) => [c.t, i]))
  const first = list[0]!.t
  const span = step > 0 ? Math.floor((last.t - first) / step) + 1 : list.length
  const cols = Math.max(1, Math.min(width, span))
  const index = Array.from({ length: cols }, (_, x) =>
    step > 0 ? byT.get(last.t - (cols - 1 - x) * step) : list.length - cols + x,
  )
  const shown = index.flatMap((i) => (i === undefined ? [] : [list[i]!]))
  return {
    index,
    hi: Math.max(...shown.map((c) => c.high)),
    lo: Math.min(...shown.map((c) => c.low)),
  }
}

// Half-block cells, 2 pixels a row, then 1 row of volume bars. MA and EMA dots sit in empty cells.
function candleCells(
  list: Candle[],
  w: ReturnType<typeof buckets>,
  rows: number,
  lines: { values: (number | null)[]; dot: string; colour: number }[],
) {
  const { index, hi, lo } = w
  const cols = index.length
  const px = rows * 2
  const pxOf = (v: number) => (hi === lo ? rows - 1 : Math.round(((hi - v) / (hi - lo)) * (px - 1)))
  const grid: ([string, number] | null)[][] = Array.from({ length: rows + 1 }, () =>
    Array.from({ length: cols }, () => null),
  )
  index.forEach((i, x) => {
    if (i === undefined) return
    const c = list[i]!
    const d = dirOf(c)
    const set = d === 'down' ? DOWN : UP
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
      if (ch) grid[r]![x] = [ch, COLOUR[d]]
    }
  })
  for (const l of lines)
    index.forEach((i, x) => {
      const v = i === undefined ? null : (l.values[i] ?? null)
      if (v === null || v > hi || v < lo) return
      const r = Math.floor(pxOf(v) / 2)
      if (!grid[r]![x]) grid[r]![x] = [l.dot, l.colour]
    })
  const vols = index.map((i) => (i === undefined ? null : list[i]!.volume))
  const top = Math.max(0, ...vols.map((v) => v ?? 0))
  vols.forEach((v, x) => {
    if (v !== null && top > 0)
      grid[rows]![x] = [BARS[Math.min(7, Math.floor((v / top) * 8))]!, COLOUR.flat]
  })
  const words = new Uint32Array(cols * (rows + 1) * 3)
  grid
    .flat()
    .forEach((g, k) => words.set([g ? g[0].codePointAt(0)! : 0x20, g ? g[1] : NONE, NONE], k * 3))
  return (new Uint8Array(words.buffer) as unknown as { toBase64(): string }).toBase64()
}

// The same chart as SVG: up hollow, down filled; MA solid, EMA dashed; axis labels on the right.
function candleSvg(
  list: Candle[],
  w: ReturnType<typeof buckets>,
  width: number,
  height: number,
  lines: { values: (number | null)[]; colour: string; dash: boolean }[],
) {
  const { index, hi, lo } = w
  const plotW = width - 84
  const volH = 24
  const plotH = height - volH - 8
  const y = (v: number) => (hi === lo ? plotH / 2 : ((hi - v) / (hi - lo)) * (plotH - 8) + 4)
  const slot = plotW / index.length
  const f = (n: number) => n.toFixed(1)
  const parts: string[] = []
  const vols = index.map((i) => (i === undefined ? 0 : list[i]!.volume))
  const top = Math.max(0, ...vols)
  index.forEach((i, x) => {
    if (i === undefined) return
    const c = list[i]!
    const d = dirOf(c)
    const col = d === 'up' ? '#22c55e' : d === 'down' ? '#ef4444' : '#888888'
    const cx = x * slot + slot / 2
    const bTop = y(Math.max(c.open, c.close))
    const bH = Math.max(1, y(Math.min(c.open, c.close)) - bTop)
    parts.push(
      `<line x1="${f(cx)}" x2="${f(cx)}" y1="${f(y(c.high))}" y2="${f(y(c.low))}" stroke="${col}"/>`,
      `<rect x="${f(x * slot + slot * 0.2)}" y="${f(bTop)}" width="${f(Math.max(1, slot * 0.6))}" height="${f(bH)}" fill="${d === 'down' ? col : 'none'}" stroke="${col}"/>`,
    )
    if (top > 0) {
      const h = (c.volume / top) * (volH - 2)
      parts.push(
        `<rect x="${f(x * slot + slot * 0.2)}" y="${f(height - h)}" width="${f(Math.max(1, slot * 0.6))}" height="${f(Math.max(0.5, h))}" fill="#888888" fill-opacity="0.6"/>`,
      )
    }
  })
  for (const l of lines) {
    const pts = index.flatMap((i, x) => {
      const v = i === undefined ? null : (l.values[i] ?? null)
      return v === null || v > hi || v < lo ? [] : [`${f(x * slot + slot / 2)},${f(y(v))}`]
    })
    if (pts.length > 1)
      parts.push(
        `<polyline points="${pts.join(' ')}" fill="none" stroke="${l.colour}" stroke-width="1.2"${l.dash ? ' stroke-dasharray="4 3"' : ''}/>`,
      )
  }
  const last = list[index.filter((i) => i !== undefined).at(-1)!]!
  const ly = y(last.close)
  const label = (yy: number, text: string, fill = '#888888') =>
    `<text x="${plotW + 6}" y="${f(yy)}" font-size="11" font-family="monospace" fill="${fill}" dominant-baseline="middle">${text}</text>`
  parts.push(
    `<line x1="0" x2="${plotW}" y1="${f(ly)}" y2="${f(ly)}" stroke="#888888" stroke-dasharray="2 3"/>`,
    label(8, usd(hi)!),
    label(plotH - 4, usd(lo)!),
    label(ly, `◀ ${usd(last.close)}`, '#d4d4d4'),
    label(height - volH / 2, 'vol'),
  )
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>`
}

type Els = ReturnType<Dollar['ui']['resolve']>

// A row of fixed-width columns; a negative width right-aligns.
function cols(els: Els, key: string, parts: [string, number][], color?: string, bold?: boolean) {
  const { Box, Text } = els
  return (
    <Box key={key} flexDirection="row" gap={1}>
      {parts.map(([t, w], i) => (
        <Box
          key={`${key}-${i}`}
          width={Math.abs(w)}
          flexShrink={0}
          justifyContent={w < 0 ? 'flex-end' : 'flex-start'}
        >
          <Text color={color} bold={bold} dimColor={bold} wrap="truncate-end">
            {t}
          </Text>
        </Box>
      ))}
    </Box>
  )
}

// The trade view: status line, header, range buttons, candles, the book and recent trades.
async function pane($: Dollar, e: Site) {
  const els = $.ui.resolve(e)
  const { Box, Text, Button } = els
  // Read by name, and chosen by surface: the terminal's table answers Svg with an empty box.
  const { Input, Svg, Raster } = els as unknown as {
    Input?: ElementConstructor<InputProps>
    Svg?: ElementConstructor<SvgProps>
    Raster?: ElementConstructor<RasterProps>
  }
  const props = e.props as { bodyColumns?: number; scroll?: { bodyRows?: number } }
  const width = props.bodyColumns ?? 80
  const wide = width >= 110
  const st = (await $.state.get(STATUS)).value ?? null
  const mk = (await $.state.get(MARKET)).value ?? null
  const mint = (await $.state.get(SELECTED)).value ?? PICKS[0]![1]
  const range = (await $.state.get(RANGE)).value ?? '1h'
  const note = (await $.state.get(MINT_NOTE)).value ?? null
  const m = mk?.key === `${mint}:${range}` ? mk.body : null
  const marketError = mk?.key === `${mint}:${range}` ? mk.error : null
  const s = st?.body ?? null
  const draft = (text: string) => $.prompt.fill({ text, mode: 'replace' })
  const tab = (key: string, label: string, active: boolean, press: () => unknown) => (
    <Button
      key={key}
      plain
      label={active ? `[${label}]` : label}
      variant={active ? 'primary' : undefined}
      onPress={press}
    />
  )
  const [conn, connTone] = link(st)

  const top = (
    <Box key="top" flexDirection="column">
      <Box flexDirection="row" gap={2} flexWrap="wrap" alignItems="center">
        <Text bold>{`Agon trade  ${labelOf(mint)}  ${short(mint)}`}</Text>
        {PICKS.map(([label, pm]) => tab(`pick-${label}`, label, pm === mint, () => choose($, pm)))}
        <Button key="refresh" plain hotkey="r" label="refresh" onPress={() => refreshAll($)} />
      </Box>
      <Box key="status" flexDirection="row" gap={2} flexWrap="wrap">
        <Text color={connTone}>{conn}</Text>
        {s && <Text>{ping(s)}</Text>}
        {s && <Text>{`slot ${num(s.dataSlot) ?? 'none yet'}`}</Text>}
        {s && (
          <Text>{`data ${m?.candles?.fetchedAt ? age(m.candles.fetchedAt) : 'none yet'}`}</Text>
        )}
        {s && <Text>{sol(s)}</Text>}
        {s && <Text dimColor>{network(s)}</Text>}
      </Box>
      {Input && (
        <Input
          key="mint"
          placeholder="paste a mint address, then Enter"
          onSubmit={async (value: string) => {
            const v = value.trim()
            if (BASE58.test(v)) return choose($, v)
            await $.state.set(
              MINT_NOTE,
              `Not a Solana mint: ${v.length} characters, need 32 to 44 base58 characters. Nothing was asked.`,
            )
          }}
        />
      )}
      {note && <Text color="yellow">{note}</Text>}
    </Box>
  )

  const stats = m?.stats24h
  const header =
    stats && !stats.error ? (
      <Box key="header" flexDirection="column">
        <Box flexDirection="row" gap={2} flexWrap="wrap">
          <Text bold>{`${labelOf(mint)}  ${usd(stats.price) ?? 'price not sent'}`}</Text>
          <Text bold color={tone(stats.changePct)}>
            {`${move(stats.changePct) ?? 'change not sent'} 24h`}
          </Text>
        </Box>
        <Box flexDirection="row" gap={2} flexWrap="wrap">
          <Text>{`H ${usd(stats.high) ?? 'not sent'}`}</Text>
          <Text>{`L ${usd(stats.low) ?? 'not sent'}`}</Text>
          <Text>{`vol ${big(stats.volumeUsd) ?? 'not sent'}`}</Text>
          <Text dimColor>{`pool ${m?.pool?.address ? short(m.pool.address) : 'none'}`}</Text>
          <Text dimColor>liquidity: /market sends none</Text>
        </Box>
      </Box>
    ) : (
      <Text key="header" color={marketError || stats?.error ? 'yellow' : undefined} wrap="wrap">
        {marketError ??
          stats?.error ??
          m?.error ??
          `loading ${server}/market for ${short(mint)} ${range}`}
      </Text>
    )

  const ranges = (
    <Box key="ranges" flexDirection="row" gap={1} flexWrap="wrap">
      {RANGES.map((r) =>
        tab(`range-${r}`, r, r === range, async () => {
          await $.state.set(RANGE, r)
          await refreshMarket($)
        }),
      )}
    </Box>
  )

  const chart = chartBlock(els, Svg, Raster, e.surface !== 'terminal', m, range, width, props)
  const book = bookPanel(els, m, width)
  const trades = tradesPanel(els, m, wide ? Math.floor(width / 2) : width)

  const actions = (
    <Box key="actions" flexDirection="row" gap={1} flexWrap="wrap">
      <Button
        key="buy"
        hotkey="b"
        variant="primary"
        label="Buy"
        onPress={() =>
          draft(
            `Buy 0.01 SOL of the token with mint ${mint}. Run Agon check_trade on it first and show me the verdict with its reasons. Build nothing unless it passes, and let me sign.`,
          )
        }
      />
      <Button
        key="sell"
        hotkey="s"
        label="Sell"
        onPress={() =>
          draft(
            `Sell all of the token with mint ${mint} for SOL. Run Agon check_trade on it first and show me the verdict with its reasons. Build nothing unless it passes, and let me sign.`,
          )
        }
      />
      <Button
        key="check"
        hotkey="c"
        label="Check"
        onPress={() =>
          draft(
            `Run Agon check_trade for a buy of 0.01 SOL of the token with mint ${mint} and explain the verdict. Do not trade.`,
          )
        }
      />
      <Text dimColor>buttons only fill your prompt, never send</Text>
    </Box>
  )

  return (
    <Box flexDirection="column" gap={1}>
      {top}
      {header}
      {ranges}
      {chart}
      {wide ? (
        <Box flexDirection="row" gap={2}>
          <Box flexDirection="column" width={Math.floor(width / 2) - 1}>
            {book}
          </Box>
          <Box flexDirection="column" flexGrow={1}>
            {trades}
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column" gap={1}>
          {book}
          {trades}
        </Box>
      )}
      {actions}
      <Text dimColor>{mint}</Text>
    </Box>
  )
}

// Candles, the price axis with a last-price marker, a volume strip, and the latest candle's OHLC
// with MA and EMA as /market's indicators sent them.
function chartBlock(
  els: Els,
  Svg: ElementConstructor<SvgProps> | undefined,
  Raster: ElementConstructor<RasterProps> | undefined,
  svg: boolean,
  m: Market | null,
  range: string,
  width: number,
  props: { scroll?: { bodyRows?: number } },
) {
  const { Box, Text } = els
  const c = m?.candles
  const list = c?.list ?? []
  if (!m || c?.error || list.length === 0)
    return (
      <Text key="chart" color={c?.error ? 'yellow' : undefined} dimColor={!c?.error} wrap="wrap">
        {c?.error ?? (m ? `/market sent 0 candles for ${range}` : 'candles load with /market')}
      </Text>
    )
  const ind = m.indicators && !m.indicators.error ? m.indicators : null
  const ma: Line | undefined = ind?.ma
  const ema: Line | undefined = ind?.ema
  const maName = `MA${ma?.params?.period ?? ''}`
  const emaName = `EMA${ema?.params?.period ?? ''}`
  const rows = Math.max(12, Math.min(30, Math.floor((props.scroll?.bodyRows ?? 40) * 0.4)))
  const w = buckets(list, num(c?.stepSeconds) ?? 0, Math.max(10, width - AXIS - 3))
  const lastI = list.length - 1
  const last = list[lastI]!
  const d = dirOf(last)
  const maV = ma?.values?.[lastI] ?? null
  const emaV = ema?.values?.[lastI] ?? null

  let drawing
  if (svg && Svg) {
    const pxW = Math.max(320, (width - 2) * 7)
    const pxH = rows * 14
    drawing = (
      <Svg
        key="candles"
        source={candleSvg(list, w, pxW, pxH, [
          { values: ma?.values ?? [], colour: '#eab308', dash: false },
          { values: ema?.values ?? [], colour: '#38bdf8', dash: true },
        ])}
        alt={`${w.index.length} candles of ${range} from ${usd(w.lo)} to ${usd(w.hi)}, last close ${usd(last.close)}; hollow up, filled down`}
        width={pxW}
        height={pxH}
      />
    )
  } else if (Raster) {
    const pxOf = (v: number) =>
      w.hi === w.lo ? rows - 1 : Math.round(((w.hi - v) / (w.hi - w.lo)) * (rows * 2 - 1))
    const lastRow = Math.floor(pxOf(last.close) / 2)
    const axis = Array.from({ length: rows + 1 }, (_, r) =>
      r === lastRow
        ? `◀${usd(last.close)}`
        : r === 0
          ? usd(w.hi)!
          : r === rows - 1
            ? usd(w.lo)!
            : r === rows
              ? 'vol'
              : ' ',
    )
    drawing = (
      <Box key="candles" flexDirection="row" gap={1}>
        <Raster
          key="raster"
          columns={w.index.length}
          rows={rows + 1}
          cells={candleCells(list, w, rows, [
            { values: ma?.values ?? [], dot: MA_DOT, colour: COLOUR.ma },
            { values: ema?.values ?? [], dot: EMA_DOT, colour: COLOUR.ema },
          ])}
        />
        <Box flexDirection="column" width={AXIS} flexShrink={0}>
          {axis.map((t, r) => (
            <Text key={`ax-${r}`} dimColor={r !== lastRow} wrap="truncate-end">
              {t}
            </Text>
          ))}
        </Box>
      </Box>
    )
  }
  const missing = (c?.gaps ?? []).reduce((n, g) => n + (num(g.missing) ?? 0), 0)
  return (
    <Box key="chart" flexDirection="column">
      {drawing}
      <Text wrap="wrap">
        {`last ${utc(last.t)} UTC  O ${usd(last.open)} H ${usd(last.high)} L ${usd(last.low)} C ${usd(last.close)}  ${d === 'up' ? '▲ up' : d === 'down' ? '▼ down' : '= flat'}  vol ${big(last.volume)}  ${maName} ${usd(maV) ?? 'warming up'}  ${emaName} ${usd(emaV) ?? 'warming up'}`}
      </Text>
      <Text dimColor wrap="wrap">
        {`${svg ? 'hollow up, filled down' : `${UP.both} up ${DOWN.both} down`}  ${svg ? `${maName} solid, ${emaName} dashed` : `${MA_DOT} ${maName} ${EMA_DOT} ${emaName}`}  ${(c?.gaps ?? []).length ? `${c!.gaps!.length} gaps, ${missing} buckets with no candle, drawn empty` : 'no gaps'}  candles ${age(c?.fetchedAt)} old${ind ? '' : `  indicators: ${m.indicators?.error ?? 'not sent'}`}`}
      </Text>
    </Box>
  )
}

// The book or depth, labelled by its kind: a ladder with asks above the mid and bids below, or the
// cost to move the price for a curve. Every number is the server's.
function bookPanel(els: Els, m: Market | null, width: number) {
  const { Box, Text } = els
  const b: Book | undefined = m?.book
  const title = (
    <Text key="book-title" bold>
      Order book / depth
    </Text>
  )
  if (!m)
    return (
      <Box key="book" flexDirection="column">
        {title}
        <Text dimColor>waiting for /market</Text>
      </Box>
    )
  if (!b || 'error' in b)
    return (
      <Box key="book" flexDirection="column">
        {title}
        <Text color={b ? 'yellow' : undefined} dimColor={!b} wrap="wrap">
          {b
            ? `not shown: ${b.error}`
            : "this Agon server's /market sends no book, so none is drawn rather than a made-up ladder. Update the server."}
        </Text>
      </Box>
    )
  const depth = width >= 110 ? 10 : width >= 80 ? 6 : 4
  const line = (
    side: 'ask' | 'bid',
    l: { price: number; size: number; total: number },
    i: number,
  ) =>
    cols(
      els,
      `${side}-${i}`,
      [
        [side, 3],
        [usd(l.price) ?? 'none', -13],
        [cell(l.size, 9), -9],
        [cell(l.total, 9), -9],
      ],
      side === 'ask' ? 'red' : 'green',
    )
  return (
    <Box key="book" flexDirection="column">
      {title}
      <Text color="yellow" wrap="wrap">
        {b.label}
      </Text>
      <Text dimColor wrap="wrap">
        {`${b.venue}  ${b.pool ? short(b.pool) : 'pool not named'}  slot ${num(b.slot) ?? 'none'}  ${age(b.fetchedAt)} old`}
      </Text>
      {b.kind === 'amm-curve' ? (
        <Box flexDirection="column">
          {cols(
            els,
            'mv-head',
            [
              ['move', 5],
              ['side', 6],
              ['pay', -9],
              ['get', -9],
            ],
            undefined,
            true,
          )}
          {b.moves.slice(0, depth * 2).map((mv, i) =>
            cols(
              els,
              `move-${i}`,
              [
                [`${num(mv.pct) ?? 'none'}%`, 5],
                [
                  mv.side === 'buy' ? '▲ buy' : mv.side === 'sell' ? '▼ sell' : mv.side.slice(0, 6),
                  6,
                ],
                [big(mv.quoteIn) ?? 'none', -9],
                [cell(mv.baseOut, 9), -9],
              ],
              mv.side === 'buy' ? 'green' : 'red',
            ),
          )}
          <Text dimColor wrap="wrap">
            pay in USD, get in base token units, before the pool fee
          </Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          {cols(
            els,
            'lv-head',
            [
              ['', 3],
              ['price', -13],
              ['size', -9],
              ['total', -9],
            ],
            undefined,
            true,
          )}
          {b.asks
            .slice(0, depth)
            .reverse()
            .map((l, i) => line('ask', l, i))}
          {cols(els, 'mid', [
            ['mid', 3],
            [usd(b.mid) ?? 'none', -13],
          ])}
          {b.bids.slice(0, depth).map((l, i) => line('bid', l, i))}
        </Box>
      )}
    </Box>
  )
}

// Recent trades, newest first, the side as a word and an arrow. Narrow panes drop the wallet.
function tradesPanel(els: Els, m: Market | null, width: number) {
  const { Box, Text } = els
  const t = m?.trades
  if (!m)
    return (
      <Text key="trades" dimColor>
        recent trades load with /market
      </Text>
    )
  if (!t || t.error)
    return (
      <Text key="trades" color="yellow" wrap="wrap">
        {`Recent trades: ${t?.error ?? '/market sent no trades block'}`}
      </Text>
    )
  const all = t.list ?? []
  const list = all.slice(0, 10)
  const wallet = width >= 50
  return (
    <Box key="trades" flexDirection="column">
      <Text bold>{`Recent trades, ${age(t.fetchedAt)} old`}</Text>
      {cols(
        els,
        'tr-head',
        [
          ['time', 8],
          ['side', 6],
          ['price', -13],
          ['usd', -8],
          ...(wallet ? ([['wallet', 10]] as [string, number][]) : []),
        ],
        undefined,
        true,
      )}
      {list.length === 0 && <Text dimColor>0 trades in the answer. The pool may be quiet.</Text>}
      {list.map((x, i) =>
        cols(
          els,
          `trade-${i}`,
          [
            [clock(x.time), 8],
            [x.side === 'buy' ? '▲ buy' : '▼ sell', 6],
            [usd(x.priceUsd) ?? 'none', -13],
            [big(x.volumeUsd) ?? 'none', -8],
            ...(wallet ? ([[short(x.wallet), 10]] as [string, number][]) : []),
          ],
          x.side === 'buy' ? 'green' : 'red',
        ),
      )}
      {t.leftOut && (
        <Text dimColor wrap="wrap">
          {t.leftOut}
        </Text>
      )}
    </Box>
  )
}
