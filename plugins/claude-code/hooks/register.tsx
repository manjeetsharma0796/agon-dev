// Agon inside Claude Code: the status band above the prompt, and a pane with 2 views: the trade
// view and the market list.
//
// Everything on screen comes from the Agon server: GET /status for the band (connection, RPC ping,
// SOL), GET /market?mint=&range= for the trade view (24h stats, candles with MA and EMA, recent
// trades, the book) and GET /discover?list=&sort= for the market list (6 lists, each token's figures
// and safety columns, a figure not sent named as not sent). The plugin computes no number: it rounds the server's numbers for display by
// the opencode trade view's rules (.opencode/tui/agon-trade.tsx), so the two screens read alike. The
// chart scales the server's candles to cells and pixels; that is drawing, not a number anyone reads.
//
// Buy, Sell and Check only fill the prompt, never send it. A draft carries the token's mint and
// never a name or symbol (OP-38). A token's symbol is shown only from /discover's `display`, which
// the server labels untrusted, and it reaches no prompt: a row opens by its mint. Up and down are never colour alone: an arrow, a sign, a word, or
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

import type {
  BandMode,
  Book,
  Candle,
  Discover,
  Figure,
  Line,
  Loaded,
  Market,
  Status,
  Token,
  View,
} from '../types'

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
// The server caches each list for 30 s, so asking more often shows nothing new.
const DISCOVER_EVERY_MS = 30_000
// The server's lists and sorts (discover.ts LISTS and SORTS), labelled here and not by upstream text.
const LISTS: [string, string][] = [
  ['trending', 'trending'],
  ['most-traded', 'most traded'],
  ['top-organic', 'top organic'],
  ['new', 'new'],
  ['about-to-graduate', 'about to graduate'],
  ['graduated', 'graduated'],
]
// Each sort, its label and the column it sorts by, which is never dropped for width.
const SORTS: [string, string, string | null][] = [
  ['rank', 'rank', null],
  ['change24h', '24h', 'chg'],
  ['volume', 'vol', 'vol'],
  ['liquidity', 'liq', 'liq'],
  ['mcap', 'mcap', 'mcap'],
  ['holders', 'holders', 'holders'],
  ['age', 'age', 'age'],
  ['bondingCurve', 'curve', 'curve'],
]

const MODE = { plugin: 'agon', key: 'mode' } as const
const SELECTED = { plugin: 'agon', key: 'selected' } as const
const RANGE = { plugin: 'agon', key: 'range' } as const
const MARKET = { plugin: 'agon', key: 'market' } as const
const STATUS = { plugin: 'agon', key: 'status' } as const
const MINT_NOTE = { plugin: 'agon', key: 'mintNote' } as const
const VIEW = { plugin: 'agon', key: 'view' } as const
const LIST = { plugin: 'agon', key: 'list' } as const
const SORT = { plugin: 'agon', key: 'sort' } as const
const DISCOVER = { plugin: 'agon', key: 'discover' } as const

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
// A book size as sent when it fits its column; otherwise compact from 1,000 and 4 significant
// digits below, so a small size never prints as 0.00.
const cell = (v: unknown, width: number) => {
  const n = num(v)
  if (n === null) return 'none'
  if (String(n).length <= width) return String(n)
  return Math.abs(n) >= 1000 ? big(n, false)! : decimals(n.toPrecision(4))
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
  // The band and the pane draw from this one value. The write alone should redraw both, but live on
  // 2.1.288's desktop the band kept "Connecting" while the pane showed "Live", so this plugin's own
  // instances are asked to redraw too (at most once per poll).
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

// Each /discover request's number, as for /market: only the newest answer is written.
let discoverSeq = 0

async function refreshDiscover($: Dollar) {
  const seq = ++discoverSeq
  const list = (await $.state.get(LIST)).value ?? 'trending'
  const sort = (await $.state.get(SORT)).value ?? 'rank'
  const key = `${list}:${sort}`
  if ((await $.state.get(DISCOVER)).value?.key !== key)
    await $.state.set(DISCOVER, { key, body: null, error: null })
  let next: Loaded<Discover>
  try {
    const r = await getJson(
      $,
      `/discover?list=${encodeURIComponent(list)}&sort=${encodeURIComponent(sort)}`,
    )
    next = r.ok
      ? { key, body: r.body as Discover, error: null }
      : {
          key,
          body: null,
          error: `/discover answered ${r.status}: ${String(r.body?.error ?? 'no reason given')}${r.status === 404 ? ' This Agon server predates /discover: update and restart it.' : ''}`,
        }
  } catch (e) {
    next = {
      key,
      body: null,
      error: `/discover not answering at ${server} (${why(e)}); asked again in ${DISCOVER_EVERY_MS / 1000} s`,
    }
  }
  if (seq !== discoverSeq) return
  await $.state.set(DISCOVER, next)
  $.ui.invalidate('ui.render')
}

async function showView($: Dollar, v: View) {
  await $.state.set(VIEW, v)
  if (v === 'markets') await refreshDiscover($)
}

// The list is asked for only while the markets view is on screen.
async function refreshShownDiscover($: Dollar) {
  if ((await $.state.get(VIEW)).value !== 'markets') return
  if (!(await $.ui.panes()).some((p) => p.id === PANE)) return
  await refreshDiscover($)
}

// A row of the market list opens its token in the trade view, by its mint and nothing else.
async function openToken($: Dollar, mint: string) {
  if (!BASE58.test(mint)) return
  await $.state.set(VIEW, 'trade')
  await choose($, mint)
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
  if ((await $.state.get(VIEW)).value === 'markets') void refreshDiscover($)
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
    $.clock.every(DISCOVER_EVERY_MS, () => void refreshShownDiscover($))
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
    return (await $.state.get(VIEW)).value === 'markets' ? markets($, e) : pane($, e)
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
// The status feed's SOL price, from Jupiter. Left out where SOL is the selected token, whose price
// from /market's pool is already on screen: never 2 numbers for 1 asset.
const sol = (s: Status, mint: string) =>
  mint === PICKS[0]![1]
    ? null
    : `SOL ${usd(s.solPrice?.value?.usd) ?? s.solPrice?.error ?? 'none yet'}`
// "fork, feed from mainnet" when the server says its readings come from another network.
const network = (s: Status) => {
  const name = !s.network
    ? 'network not read yet'
    : s.network === 'unset'
      ? 'network not set'
      : s.network
  return s.networkNote ? `${name}, feed from ${s.readsFrom ?? 'mainnet'}` : name
}

// ---- layout: every line is laid out to a known width, never left to the surface to wrap ----

type Part = { text: string; prio: number; color?: string; bold?: boolean; dim?: boolean }
// Cells a character takes: 2 for wide East Asian characters and emoji, 0 for combining marks and
// format characters. A token's symbol is its creator's text and can hold any of them.
const WIDE =
  /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u{20000}-\u{3FFFD}]|\p{Emoji_Presentation}/u
const ZERO = /[\p{M}\p{Cf}]/u
const charCells = (c: string) => (ZERO.test(c) ? 0 : WIDE.test(c) ? 2 : 1)
const cells = (s: string) => [...s].reduce((n, c) => n + charCells(c), 0)
// Text shortened to `width` cells, marked with `..` when cut; the full text is in the pane.
function clip(s: string, width: number) {
  if (cells(s) <= width) return s
  let out = ''
  for (const c of s) {
    if (cells(out) + charCells(c) > Math.max(0, width - 2)) break
    out += c
  }
  return `${out}..`
}
// The parts that fit `width`, lowest `prio` first, kept in their order, 2 spaces apart.
function fit(parts: Part[], width: number) {
  const keep = new Set<Part>()
  let used = 0
  for (const p of [...parts].sort((a, b) => a.prio - b.prio)) {
    const add = cells(p.text) + (keep.size ? 2 : 0)
    if (used + add > width) continue
    keep.add(p)
    used += add
  }
  return parts.filter((p) => keep.has(p))
}
// Parts over at most 2 lines: what does not fit the first goes to the second.
function fit2(parts: Part[], width: number) {
  const first = fit(parts, width)
  const rest = fit(
    parts.filter((p) => !first.includes(p)),
    width,
  )
  return rest.length ? [first, rest] : [first]
}
/** Greedy word wrap into at most `max` lines; a word longer than the width is split. */
function wrap(t: string, width: number, max = 4): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of t.split(' ')) {
    const next = line ? `${line} ${word}` : word
    if (cells(next) <= width) line = next
    else {
      if (line) lines.push(line)
      line = word
      while (cells(line) > width) {
        lines.push([...line].slice(0, width).join(''))
        line = [...line].slice(width).join('')
      }
    }
  }
  if (line) lines.push(line)
  return lines.slice(0, max)
}
// Table columns, 1 space apart; a negative width aligns right.
const row = (cols: [string, number][]) =>
  cols
    .map(([v, n]) => {
      const w = Math.abs(n)
      const pad = ' '.repeat(Math.max(0, w - cells(v)))
      return n < 0 ? pad + v : v + pad
    })
    .join(' ')
    .trimEnd()
// How wide the terminal draws a Button: `[ label ]`, plain `label`, a hotkey as `k: label`.
const buttonCells = (label: string, plain: boolean, hotkey?: string) =>
  cells(label) + (hotkey ? 3 : 0) + (plain ? 0 : 4)

type Els = ReturnType<Dollar['ui']['resolve']>
function line(els: Els, key: string, parts: Part[]) {
  const { Box, Text } = els
  return (
    <Box key={key} flexDirection="row" gap={2} flexWrap="nowrap">
      {parts.map((p, i) => (
        <Text
          key={`${key}-${i}`}
          color={p.color}
          bold={p.bold}
          dimColor={p.dim}
          wrap="truncate-end"
        >
          {p.text}
        </Text>
      ))}
    </Box>
  )
}
function lines(els: Els, key: string, list: string[], color?: string, dim?: boolean) {
  const { Text } = els
  return list.map((l, i) => (
    <Text key={`${key}-${i}`} color={color} dimColor={dim} wrap="truncate-end">
      {l}
    </Text>
  ))
}

// The transcript's width, which the band is given while the pane is docked beside it. A fallback:
// a docked pane takes the narrower of its reported body and the terminal less the transcript.
// Measured live on 2.1.288 (2026-10-03): a normal Windows Terminal window gave body 74 with viewport
// and transcript both 45, and the pane fit; launched maximized it gave body 74 with viewport and
// transcript both 81, and only about 45 of the 74 columns were on screen. The viewport there equals
// the transcript's width, so this check does not engage; the clipping is the host's idea of the
// terminal's size when launched maximized, not something the plugin can see.
let transcriptColumns: number | null = null
function usable(e: Site, body: number) {
  let w = body
  const vp = e.viewport?.columns
  // Only beside the transcript: an inline pane has the terminal's full width.
  const placement = (e.props as { placement?: string }).placement
  if (
    e.surface === 'terminal' &&
    placement === 'dock' &&
    vp &&
    transcriptColumns &&
    transcriptColumns < vp
  ) {
    const room = vp - transcriptColumns - 2
    if (room >= 30 && room < w) w = room
  }
  // A column for the scrollbar a tall pane draws, and 1 to spare.
  return Math.max(30, w - 2)
}

// The band: connection, RPC ping, SOL, the selected token's price and change, the pane's toggle.
async function band($: Dollar, e: RenderInput<'AbovePrompt'>) {
  const els = $.ui.resolve(e)
  const { Box, Button } = els
  const width = e.props.bodyColumns ?? 80
  // The pane sizes itself by this width; when it changes, the pane is asked to lay out again.
  if (transcriptColumns !== width) {
    transcriptColumns = width
    $.ui.invalidate('ui.render')
  }
  const mode = (await $.state.get(MODE)).value ?? 'line'
  const toggleLabel = mode === 'collapsed' ? 'Agon >' : 'Agon v'
  const toggle = (
    <Button
      key="toggle"
      plain
      label={toggleLabel}
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
  const room = width - buttonCells(toggleLabel, true) - buttonCells('trade', false) - 4
  const solText = s ? sol(s, mint) : null
  // The connection is always shown, shortened to the room it has: a stale price never sits there
  // without its offline or reconnecting warning. A failed price keeps its cause, shortened too.
  // At most half the room, so the token's price or its cause still fits beside it.
  const connText = clip(conn, Math.min(40, Math.max(12, Math.floor(room / 2))))
  const parts = fit(
    [
      { text: connText, prio: 0, color: connTone },
      ...(s ? [{ text: ping(s), prio: 4 }] : []),
      ...(solText ? [{ text: solText, prio: 3 }] : []),
      {
        text: price
          ? `${labelOf(mint)} ${price}`
          : clip(
              `${labelOf(mint)}: ${current?.error ?? stats?.error ?? 'loading from /market'}`,
              Math.max(10, room - cells(connText) - 2),
            ),
        prio: 1,
        color: current?.error || stats?.error ? 'yellow' : undefined,
      },
      ...(price && move(stats?.changePct)
        ? [{ text: move(stats?.changePct)!, prio: 2, color: tone(stats?.changePct) }]
        : []),
    ],
    room,
  )
  return (
    <Box flexDirection="row" gap={2} alignItems="center" flexWrap="nowrap" overflow="hidden">
      {toggle}
      {line(els, 'b-line', parts)}
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
  overlays: { values: (number | null)[]; dot: string; colour: number }[],
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
  for (const o of overlays)
    index.forEach((i, x) => {
      const v = i === undefined ? null : (o.values[i] ?? null)
      if (v === null || v > hi || v < lo) return
      const r = Math.floor(pxOf(v) / 2)
      if (!grid[r]![x]) grid[r]![x] = [o.dot, o.colour]
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
  overlays: { values: (number | null)[]; colour: string; dash: boolean }[],
) {
  const { index, hi, lo } = w
  const plotW = width - 96
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
  for (const o of overlays) {
    const pts = index.flatMap((i, x) => {
      const v = i === undefined ? null : (o.values[i] ?? null)
      return v === null || v > hi || v < lo ? [] : [`${f(x * slot + slot / 2)},${f(y(v))}`]
    })
    if (pts.length > 1)
      parts.push(
        `<polyline points="${pts.join(' ')}" fill="none" stroke="${o.colour}" stroke-width="1.2"${o.dash ? ' stroke-dasharray="4 3"' : ''}/>`,
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

// ---- the trade view ----

async function pane($: Dollar, e: Site) {
  const els = $.ui.resolve(e)
  const { Box, Button } = els
  // Read by name, and chosen by surface: the terminal's table answers Svg with an empty box.
  const { Input, Svg, Raster } = els as unknown as {
    Input?: ElementConstructor<InputProps>
    Svg?: ElementConstructor<SvgProps>
    Raster?: ElementConstructor<RasterProps>
  }
  const props = e.props as { bodyColumns?: number; scroll?: { bodyRows?: number } }
  const width = usable(e, props.bodyColumns ?? 80)
  const wide = width >= 108
  const st = (await $.state.get(STATUS)).value ?? null
  const mk = (await $.state.get(MARKET)).value ?? null
  const mint = (await $.state.get(SELECTED)).value ?? PICKS[0]![1]
  const range = (await $.state.get(RANGE)).value ?? '1h'
  const note = (await $.state.get(MINT_NOTE)).value ?? null
  const m = mk?.key === `${mint}:${range}` ? mk.body : null
  const marketError = mk?.key === `${mint}:${range}` ? mk.error : null
  const s = st?.body ?? null
  const draft = (text: string) => $.prompt.fill({ text, mode: 'replace' })
  const tab = (key: string, label: string, active: boolean, press: () => unknown) =>
    tabButton(els, key, label, active, press)

  // Title, quick picks and refresh: on 1 row where they fit, else 2.
  const title = `Agon trade  ${labelOf(mint)}  ${short(mint)}`
  const picks = [
    ...PICKS.map(([label, pm]) => tab(`pick-${label}`, label, pm === mint, () => choose($, pm))),
    <Button key="refresh" plain hotkey="r" label="refresh" onPress={() => refreshAll($)} />,
  ]
  const picksCells =
    PICKS.reduce((n, [label, pm]) => n + cells(label) + (pm === mint ? 2 : 0) + 2, 0) +
    buttonCells('refresh', true, 'r')
  const head =
    cells(title) + 2 + picksCells <= width ? (
      <Box key="title" flexDirection="row" gap={2} flexWrap="nowrap">
        {line(els, 'title-text', [{ text: title, prio: 0, bold: true }])}
        {picks}
      </Box>
    ) : (
      <Box key="title" flexDirection="column">
        {line(els, 'title-text', fit([{ text: title, prio: 0, bold: true }], width))}
        <Box flexDirection="row" gap={2} flexWrap="nowrap">
          {picks}
        </Box>
      </Box>
    )

  // Status: the connection, then ping, slot, data age, SOL and network over at most 2 lines. A long
  // connection message (offline, with its cause) gets its own wrapped lines.
  const [conn, connTone] = link(st)
  const solText = s ? sol(s, mint) : null
  const statusParts: Part[] = [
    ...(cells(conn) <= 24 ? [{ text: conn, prio: 0, color: connTone }] : []),
    ...(s
      ? [
          { text: ping(s), prio: 1 },
          { text: `slot ${num(s.dataSlot) ?? 'none yet'}`, prio: 3 },
          {
            text: `data ${m?.candles?.fetchedAt ? age(m.candles.fetchedAt) : 'none yet'}`,
            prio: 4,
          },
          ...(solText ? [{ text: solText, prio: 2 }] : []),
          { text: network(s), prio: 5, dim: true },
        ]
      : []),
  ]
  const status = (
    <Box key="status" flexDirection="column">
      {cells(conn) > 24 && lines(els, 'conn', wrap(conn, width), connTone)}
      {fit2(statusParts, width).map((p, i) => line(els, `status-${i}`, p))}
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
      {note && lines(els, 'note', wrap(note, width), 'yellow')}
    </Box>
  )

  // Header: price and 24h change, then high, low, volume, liquidity and pool.
  const stats = m?.stats24h
  const liq = stats?.liquidityUsd
  const liqText =
    liq && num(liq.value) !== null
      ? `liq ${big(liq.value)}${liq.flag ? ' (see note)' : ''}`
      : liq?.error
        ? 'liq not shown (see note)'
        : 'liq not sent'
  const liqNote = liq?.flag ?? liq?.error ?? null
  const header =
    stats && !stats.error ? (
      <Box key="header" flexDirection="column">
        {line(
          els,
          'h1',
          fit(
            [
              {
                text: `${labelOf(mint)}  ${usd(stats.price) ?? 'price not sent'}`,
                prio: 0,
                bold: true,
              },
              {
                text: `${move(stats.changePct) ?? 'change not sent'} 24h`,
                prio: 1,
                bold: true,
                color: tone(stats.changePct),
              },
            ],
            width,
          ),
        )}
        {fit2(
          [
            { text: `H ${usd(stats.high) ?? 'not sent'}`, prio: 2 },
            { text: `L ${usd(stats.low) ?? 'not sent'}`, prio: 3 },
            { text: `vol ${big(stats.volumeUsd) ?? 'not sent'}`, prio: 0 },
            { text: liqText, prio: 1, color: liq?.flag ? 'yellow' : undefined },
            {
              text: `pool ${m?.pool?.address ? short(m.pool.address) : 'none'}`,
              prio: 4,
              dim: true,
            },
          ],
          width,
        ).map((p, i) => line(els, `h2-${i}`, p))}
        {liqNote &&
          lines(
            els,
            'liq-note',
            wrap(liqNote, width, 3),
            liq?.flag ? 'yellow' : undefined,
            !liq?.flag,
          )}
      </Box>
    ) : (
      <Box key="header" flexDirection="column">
        {lines(
          els,
          'header',
          wrap(
            marketError ??
              stats?.error ??
              m?.error ??
              `loading ${server}/market for ${short(mint)} ${range}`,
            width,
          ),
          marketError || stats?.error ? 'yellow' : undefined,
        )}
      </Box>
    )

  const ranges = (
    <Box key="ranges" flexDirection="row" gap={1} flexWrap="nowrap">
      {RANGES.map((r) =>
        tab(`range-${r}`, r, r === range, async () => {
          await $.state.set(RANGE, r)
          await refreshMarket($)
        }),
      )}
    </Box>
  )

  const chart = chartBlock(els, Svg, Raster, e.surface !== 'terminal', m, range, width, props)
  const side = wide ? Math.floor((width - 2) / 2) : width
  const book = bookPanel(els, m, side)
  const trades = tradesPanel(els, m, side)

  const actions = (
    <Box key="actions" flexDirection="column">
      <Box flexDirection="row" gap={1} flexWrap="nowrap">
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
      </Box>
      {lines(
        els,
        'act-note',
        wrap('buttons only fill your prompt, never send', width),
        undefined,
        true,
      )}
      {lines(els, 'mint', wrap(mint, width), undefined, true)}
    </Box>
  )

  return (
    <Box flexDirection="column">
      {viewTabs($, els, 'trade', width)}
      {head}
      {status}
      {header}
      {ranges}
      {chart}
      {wide ? (
        <Box flexDirection="row" gap={2} flexWrap="nowrap">
          <Box flexDirection="column" width={side}>
            {book}
          </Box>
          <Box flexDirection="column" width={side}>
            {trades}
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column">
          {book}
          {trades}
        </Box>
      )}
      {actions}
    </Box>
  )
}

// Candles, the price axis with a last-price marker, a volume strip, and the latest candle's OHLC
// with MA and EMA as /market's indicators sent them. The chart leaves room for the axis labels.
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
      <Box key="chart" flexDirection="column">
        {lines(
          els,
          'chart-msg',
          wrap(
            c?.error ?? (m ? `/market sent 0 candles for ${range}` : 'candles load with /market'),
            width,
          ),
          c?.error ? 'yellow' : undefined,
          !c?.error,
        )}
      </Box>
    )
  const ind = m.indicators && !m.indicators.error ? m.indicators : null
  const ma: Line | undefined = ind?.ma
  const ema: Line | undefined = ind?.ema
  const maName = `MA${ma?.params?.period ?? ''}`
  const emaName = `EMA${ema?.params?.period ?? ''}`
  const rows = Math.max(12, Math.min(30, Math.floor((props.scroll?.bodyRows ?? 40) * 0.4)))
  const lastI = list.length - 1
  const last = list[lastI]!
  // The axis column is as wide as its widest label, and the candles take the rest.
  const step = num(c?.stepSeconds) ?? 0
  // The labels depend on the window drawn and the window on the labels' width, so it settles in a
  // few passes; the axis column keeps the widest width seen, so no label is cut.
  const axisOf = (b: ReturnType<typeof buckets>) =>
    Math.max(...[usd(b.hi)!, usd(b.lo)!, `◀${usd(last.close)}`, 'vol'].map(cells))
  let axisCells = axisOf(buckets(list, step, Math.max(10, width - 16)))
  let w = buckets(list, step, Math.max(10, width - axisCells - 1))
  for (let pass = 0; pass < 3 && axisOf(w) > axisCells; pass++) {
    axisCells = axisOf(w)
    w = buckets(list, step, Math.max(10, width - axisCells - 1))
  }
  axisCells = Math.max(axisCells, axisOf(w))
  const d = dirOf(last)
  const maV = ma?.values?.[lastI] ?? null
  const emaV = ema?.values?.[lastI] ?? null

  let drawing
  if (svg && Svg) {
    const pxW = Math.max(320, width * 7)
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
      <Box key="candles" flexDirection="row" gap={1} flexWrap="nowrap">
        <Raster
          key="raster"
          columns={w.index.length}
          rows={rows + 1}
          cells={candleCells(list, w, rows, [
            { values: ma?.values ?? [], dot: MA_DOT, colour: COLOUR.ma },
            { values: ema?.values ?? [], dot: EMA_DOT, colour: COLOUR.ema },
          ])}
        />
        <Box flexDirection="column" width={axisCells} flexShrink={0}>
          {axis.map((t, r) => (
            <Text key={`ax-${r}`} dimColor={r !== lastRow} wrap="truncate-end">
              {t}
            </Text>
          ))}
        </Box>
      </Box>
    )
  }
  const gaps = c?.gaps ?? []
  const missing = gaps.reduce((n, g) => n + (num(g.missing) ?? 0), 0)
  const readout = fit2(
    [
      { text: `last ${utc(last.t)} UTC`, prio: 6, dim: true },
      { text: `O ${usd(last.open)}`, prio: 2 },
      { text: `H ${usd(last.high)}`, prio: 3 },
      { text: `L ${usd(last.low)}`, prio: 4 },
      { text: `C ${usd(last.close)}`, prio: 0 },
      {
        text: d === 'up' ? '▲ up' : d === 'down' ? '▼ down' : '= flat',
        prio: 1,
        color: d === 'up' ? 'green' : d === 'down' ? 'red' : undefined,
      },
      { text: `vol ${big(last.volume)}`, prio: 5 },
      { text: `${maName} ${usd(maV) ?? 'warming up'}`, prio: 2 },
      { text: `${emaName} ${usd(emaV) ?? 'warming up'}`, prio: 3 },
    ],
    width,
  )
  const legend = fit(
    [
      {
        text: svg ? 'hollow up, filled down' : `${UP.both} up ${DOWN.both} down`,
        prio: 0,
        dim: true,
      },
      {
        text: svg
          ? `${maName} solid, ${emaName} dashed`
          : `${MA_DOT} ${maName} ${EMA_DOT} ${emaName}`,
        prio: 1,
        dim: true,
      },
      {
        text: gaps.length ? `${gaps.length} gaps, ${missing} buckets empty` : 'no gaps',
        prio: 2,
        dim: true,
      },
      { text: `candles ${age(c?.fetchedAt)} old`, prio: 3, dim: true },
      ...(ind
        ? []
        : [{ text: `indicators: ${m.indicators?.error ?? 'not sent'}`, prio: 4, dim: true }]),
    ],
    width,
  )
  return (
    <Box key="chart" flexDirection="column">
      {drawing}
      {readout.map((p, i) => line(els, `readout-${i}`, p))}
      {line(els, 'legend', legend)}
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
  if (!m || !b || 'error' in b)
    return (
      <Box key="book" flexDirection="column">
        {title}
        {lines(
          els,
          'book-msg',
          wrap(
            !m
              ? 'waiting for /market'
              : b
                ? `not shown: ${(b as { error: string }).error}`
                : "this Agon server's /market sends no book, so none is drawn rather than a made-up ladder. Update the server.",
            width,
          ),
          b ? 'yellow' : undefined,
          !b,
        )}
      </Box>
    )
  const depth = width >= 50 ? 10 : width >= 40 ? 6 : 4
  const asks = b.asks.slice(0, depth).reverse()
  const bids = b.bids.slice(0, depth)
  const priceCells = Math.max(
    5,
    ...[...asks, ...bids].map((l) => cells(usd(l.price) ?? 'none')),
    cells(usd(b.mid) ?? 'none'),
  )
  const level = (
    side: 'ask' | 'bid',
    l: { price: number; size: number; total: number },
    i: number,
  ) => (
    <Text key={`${side}-${i}`} color={side === 'ask' ? 'red' : 'green'} wrap="truncate-end">
      {row([
        [side, 3],
        [usd(l.price) ?? 'none', -priceCells],
        [cell(l.size, 9), -9],
        [cell(l.total, 9), -9],
      ])}
    </Text>
  )
  return (
    <Box key="book" flexDirection="column">
      {title}
      {lines(els, 'book-label', wrap(b.label, width, 2), 'yellow')}
      {line(
        els,
        'book-meta',
        fit(
          [
            { text: b.venue, prio: 0, dim: true },
            { text: b.pool ? short(b.pool) : 'pool not named', prio: 2, dim: true },
            { text: `slot ${num(b.slot) ?? 'none'}`, prio: 1, dim: true },
            { text: `${age(b.fetchedAt)} old`, prio: 3, dim: true },
          ],
          width,
        ),
      )}
      {b.kind === 'amm-curve' ? (
        <Box flexDirection="column">
          <Text key="mv-head" dimColor bold>
            {row([
              ['move', 5],
              ['side', 6],
              ['pay', -9],
              ['get', -9],
            ])}
          </Text>
          {b.moves.slice(0, depth * 2).map((mv, i) => (
            <Text key={`move-${i}`} color={mv.side === 'buy' ? 'green' : 'red'} wrap="truncate-end">
              {row([
                [`${num(mv.pct) ?? 'none'}%`, 5],
                [
                  mv.side === 'buy' ? '▲ buy' : mv.side === 'sell' ? '▼ sell' : mv.side.slice(0, 6),
                  6,
                ],
                // depth.ts: a buy pays quoteIn (USD) for baseOut; a sell pays baseOut for quoteIn.
                ...((mv.side === 'sell'
                  ? [
                      [cell(mv.baseOut, 9), -9],
                      [big(mv.quoteIn) ?? 'none', -9],
                    ]
                  : [
                      [big(mv.quoteIn) ?? 'none', -9],
                      [cell(mv.baseOut, 9), -9],
                    ]) as [string, number][]),
              ])}
            </Text>
          ))}
          {lines(
            els,
            'mv-note',
            wrap(
              'a buy pays USD and gets base token units, a sell the reverse; before the pool fee',
              width,
            ),
            undefined,
            true,
          )}
        </Box>
      ) : (
        <Box flexDirection="column">
          <Text key="lv-head" dimColor bold>
            {row([
              ['', 3],
              ['price', -priceCells],
              ['size', -9],
              ['total', -9],
            ])}
          </Text>
          {asks.map((l, i) => level('ask', l, i))}
          <Text key="mid">
            {row([
              ['mid', 3],
              [usd(b.mid) ?? 'none', -priceCells],
            ])}
          </Text>
          {bids.map((l, i) => level('bid', l, i))}
        </Box>
      )}
    </Box>
  )
}

// Recent trades, newest first, the side as a word and an arrow. The wallet shows where it fits.
function tradesPanel(els: Els, m: Market | null, width: number) {
  const { Box, Text } = els
  const t = m?.trades
  if (!m || !t || t.error)
    return (
      <Box key="trades" flexDirection="column">
        {lines(
          els,
          'trades-msg',
          wrap(
            !m
              ? 'recent trades load with /market'
              : `Recent trades: ${t?.error ?? '/market sent no trades block'}`,
            width,
          ),
          m ? 'yellow' : undefined,
          !m,
        )}
      </Box>
    )
  const list = (t.list ?? []).slice(0, 10)
  const priceCells = Math.max(5, ...list.map((x) => cells(usd(x.priceUsd) ?? 'none')))
  const base = 8 + 1 + 6 + 1 + priceCells + 1 + 8
  const wallet = base + 11 <= width
  const cols = (x: [string, string, string, string, string]): [string, number][] => [
    [x[0], 8],
    [x[1], 6],
    [x[2], -priceCells],
    [x[3], -8],
    ...(wallet ? ([[x[4], 10]] as [string, number][]) : []),
  ]
  return (
    <Box key="trades" flexDirection="column">
      <Text bold>{`Recent trades, ${age(t.fetchedAt)} old`}</Text>
      <Text dimColor bold>
        {row(cols(['time', 'side', 'price', 'usd', 'wallet']))}
      </Text>
      {list.length === 0 &&
        lines(
          els,
          'tr-none',
          wrap('0 trades in the answer. The pool may be quiet.', width),
          undefined,
          true,
        )}
      {list.map((x, i) => (
        <Text key={`trade-${i}`} color={x.side === 'buy' ? 'green' : 'red'} wrap="truncate-end">
          {row(
            cols([
              clock(x.time),
              x.side === 'buy' ? '▲ buy' : '▼ sell',
              usd(x.priceUsd) ?? 'none',
              big(x.volumeUsd) ?? 'none',
              short(x.wallet),
            ]),
          )}
        </Text>
      ))}
      {t.leftOut && lines(els, 'tr-left', wrap(t.leftOut, width, 2), undefined, true)}
    </Box>
  )
}

// ---- the market list ----

// A tab: a plain Button, the active one bracketed, so the choice reads without colour.
function tabButton(
  els: Els,
  key: string,
  label: string,
  active: boolean,
  press: () => unknown,
  hotkey?: string,
) {
  const { Button } = els
  return (
    <Button
      key={key}
      plain
      hotkey={hotkey}
      label={active ? `[${label}]` : label}
      variant={active ? 'primary' : undefined}
      onPress={press}
    />
  )
}

// Tabs over as many rows as `width` needs, 2 cells apart, after an optional dim lead word.
function tabRows(
  els: Els,
  key: string,
  lead: string | null,
  tabs: { key: string; label: string; active: boolean; press: () => unknown; hotkey?: string }[],
  width: number,
) {
  const { Box, Text } = els
  type El = ReturnType<typeof tabButton>
  const rows: El[][] = [[]]
  let used = 0
  const place = (el: El, w: number) => {
    if (rows.at(-1)!.length && used + 2 + w > width) {
      rows.push([])
      used = 0
    }
    used += w + (rows.at(-1)!.length ? 2 : 0)
    rows.at(-1)!.push(el)
  }
  if (lead)
    place(
      <Text key={`${key}-lead`} dimColor>
        {lead}
      </Text>,
      cells(lead),
    )
  for (const t of tabs)
    place(
      tabButton(els, t.key, t.label, t.active, t.press, t.hotkey),
      buttonCells(t.active ? `[${t.label}]` : t.label, true, t.hotkey),
    )
  return (
    <Box key={key} flexDirection="column">
      {rows.map((r, i) => (
        <Box key={`${key}-${i}`} flexDirection="row" gap={2} flexWrap="nowrap">
          {r}
        </Box>
      ))}
    </Box>
  )
}

// The pane's 2 views.
function viewTabs($: Dollar, els: Els, current: View, width: number) {
  return tabRows(
    els,
    'views',
    'Agon',
    [
      {
        key: 'view-trade',
        label: 'trade',
        hotkey: 't',
        active: current === 'trade',
        press: () => showView($, 'trade'),
      },
      {
        key: 'view-markets',
        label: 'markets',
        hotkey: 'm',
        active: current === 'markets',
        press: () => showView($, 'markets'),
      },
    ],
    width,
  )
}

const NOT_SENT = 'not sent'
const figure = (f: Figure | undefined, fmt: (n: number) => string | null) => {
  const n = num(f?.value)
  return n === null ? NOT_SENT : (fmt(n) ?? NOT_SENT)
}
const pct = (n: number) => `${n.toFixed(2)}%`
// A holder count is whole: as sent below 1,000, compact from there.
const count = (n: number) => (n >= 1000 ? big(n, false) : String(n))
const since = (s: number) =>
  s < 60
    ? `${s}s`
    : s < 3600
      ? `${Math.floor(s / 60)}m`
      : s < 86400
        ? `${Math.floor(s / 3600)}h`
        : `${Math.floor(s / 86400)}d`
// Mint and freeze authority as words: off (revoked) or on (someone can still mint or freeze).
const auth = (a: Token['mintAuthority']) =>
  a?.value === 'disabled' ? 'off' : a?.value === 'enabled' ? 'on' : NOT_SENT
const graduated = (t: Token) =>
  t.bondingCurvePct?.graduatedAt ? 'yes' : num(t.bondingCurvePct?.value) !== null ? 'no' : NOT_SENT
// The symbol a person reads: from `display` only, separators and marks folded, at most 10 cells.
const UNSAFE = /[\p{Cc}\p{Cf}\p{M}\p{Z}\s]+/gu
const symbolOf = (t: Token) => {
  const s = (typeof t.display?.symbol === 'string' ? t.display.symbol : '')
    .replace(UNSAFE, ' ')
    .trim()
  return s ? clip(s, 10) : NOT_SENT
}

type Col = {
  id: string
  head: string
  prio: number
  right?: boolean
  text: (t: Token) => string
  color?: (t: Token) => string | undefined
}
// Columns by priority, the highest number dropping first as the pane narrows; the token and the
// sorted column never drop.
const columns = (list: string): Col[] => [
  { id: 'token', head: 'token', prio: 0, text: symbolOf },
  { id: 'price', head: 'price', prio: 1, right: true, text: (t) => figure(t.price, usd) },
  {
    id: 'chg',
    head: '24h',
    prio: 2,
    right: true,
    text: (t) => figure(t.change?.['24h'], move),
    color: (t) => tone(t.change?.['24h']?.value),
  },
  ...(list === 'about-to-graduate'
    ? [
        {
          id: 'curve',
          head: 'curve',
          prio: 2,
          right: true,
          text: (t: Token) => figure(t.bondingCurvePct, pct),
        },
      ]
    : []),
  {
    id: 'mintAuth',
    head: 'mint',
    prio: 3,
    text: (t) => auth(t.mintAuthority),
    color: (t) => (t.mintAuthority?.value === 'enabled' ? 'yellow' : undefined),
  },
  {
    id: 'freezeAuth',
    head: 'freeze',
    prio: 4,
    text: (t) => auth(t.freezeAuthority),
    color: (t) => (t.freezeAuthority?.value === 'enabled' ? 'yellow' : undefined),
  },
  { id: 'grad', head: 'grad', prio: list === 'graduated' ? 3 : 13, text: graduated },
  { id: 'liq', head: 'liq', prio: 5, right: true, text: (t) => figure(t.liquidity, big) },
  { id: 'holders', head: 'holders', prio: 6, right: true, text: (t) => figure(t.holders, count) },
  { id: 'top10', head: 'top10', prio: 7, right: true, text: (t) => figure(t.topHoldersPct, pct) },
  { id: 'dev', head: 'dev', prio: 8, right: true, text: (t) => figure(t.devPct, pct) },
  { id: 'vol', head: 'vol', prio: 9, right: true, text: (t) => figure(t.volume24h, big) },
  { id: 'mcap', head: 'mcap', prio: 10, right: true, text: (t) => figure(t.marketCap, big) },
  { id: 'address', head: 'address', prio: 11, text: (t) => short(t.mint) },
  { id: 'age', head: 'age', prio: 12, right: true, text: (t) => figure(t.age, since) },
]
const padTo = (s: string, w: number, right?: boolean) => {
  const pad = ' '.repeat(Math.max(0, w - cells(s)))
  return right ? pad + s : s + pad
}

async function markets($: Dollar, e: Site) {
  const els = $.ui.resolve(e)
  const { Box, Button, Text } = els
  const props = e.props as { bodyColumns?: number }
  const width = usable(e, props.bodyColumns ?? 80)
  const list = (await $.state.get(LIST)).value ?? 'trending'
  const sort = (await $.state.get(SORT)).value ?? 'rank'
  const d = (await $.state.get(DISCOVER)).value ?? null
  const current = d?.key === `${list}:${sort}` ? d : null
  const body = current?.body ?? null
  const tokens = (body?.tokens ?? []).filter((t) => BASE58.test(String(t?.mint)))
  const sortedBy = SORTS.find(([s]) => s === sort)?.[2] ?? null

  const lists = tabRows(
    els,
    'lists',
    null,
    LISTS.map(([l, label]) => ({
      key: `list-${l}`,
      label,
      active: l === list,
      press: async () => {
        await $.state.set(LIST, l)
        // The bonding curve is sent on about to graduate only.
        if (sort === 'bondingCurve' && l !== 'about-to-graduate') await $.state.set(SORT, 'rank')
        await refreshDiscover($)
      },
    })),
    width,
  )
  const sorts = tabRows(
    els,
    'sorts',
    'sort',
    SORTS.filter(([s]) => s !== 'bondingCurve' || list === 'about-to-graduate').map(
      ([s, label]) => ({
        key: `sort-${s}`,
        label,
        active: s === sort,
        press: async () => {
          await $.state.set(SORT, s)
          await refreshDiscover($)
        },
      }),
    ),
    width,
  )

  // Each column as wide as its widest cell; then the columns that fit, by priority.
  const all = columns(list).map((c) => {
    const head = c.id === sortedBy ? `${c.head} v` : c.head
    const texts = tokens.map((t) => c.text(t))
    return { ...c, head, texts, w: Math.max(cells(head), ...texts.map(cells)) }
  })
  const first = (c: Col) => (c.id === 'token' || c.id === sortedBy ? -1 : c.prio)
  const keep = new Set<string>()
  let used = 0
  for (const c of [...all].sort((a, b) => first(a) - first(b))) {
    const add = c.w + (keep.size ? 1 : 0)
    if (used + add > width) continue
    keep.add(c.id)
    used += add
  }
  const cols = all.filter((c) => keep.has(c.id))

  const msg = (text: string, color?: string) => (
    <Box key="table" flexDirection="column">
      {lines(els, 'mk-msg', wrap(text, width), color, !color)}
    </Box>
  )
  const table =
    !current || (!body && !current.error) ? (
      msg(`loading ${server}/discover for ${list}`)
    ) : current.error || body?.error ? (
      msg((current.error ?? body?.error)!, 'yellow')
    ) : tokens.length === 0 ? (
      msg(`/discover sent 0 tokens for ${list}`)
    ) : (
      <Box key="table" flexDirection="column">
        <Box key="mk-head" flexDirection="row" gap={1} flexWrap="nowrap">
          {cols.map((c) => (
            <Text key={`hd-${c.id}`} dimColor bold wrap="truncate-end">
              {padTo(c.head, c.w, c.right)}
            </Text>
          ))}
        </Box>
        {tokens.map((t, i) => (
          <Box key={`mk-${t.mint}`} flexDirection="row" gap={1} flexWrap="nowrap">
            {cols.map((c) =>
              c.id === 'token' ? (
                <Box key={`tk-${i}`} width={c.w} flexShrink={0}>
                  <Button
                    key={`open-${t.mint}`}
                    plain
                    label={c.texts[i]!}
                    onPress={() => openToken($, t.mint)}
                  />
                </Box>
              ) : (
                <Text key={`c-${i}-${c.id}`} color={c.color?.(t)} wrap="truncate-end">
                  {padTo(c.texts[i]!, c.w, c.right)}
                </Text>
              ),
            )}
          </Box>
        ))}
      </Box>
    )

  const src = body?.source
  const notes = body
    ? [
        `${tokens.length} tokens from ${src?.name ?? 'a source the server did not name'}, ${num(src?.ageSeconds) ?? 'unknown'} s old`,
        ...(body.leftOut ? [body.leftOut] : []),
        ...(body.authority ? [body.authority] : []),
        "Press a token to open it in the trade view. Symbols are the creator's own text, unchecked; a prompt carries the mint only.",
      ]
    : []

  return (
    <Box flexDirection="column">
      {viewTabs($, els, 'markets', width)}
      {lists}
      {sorts}
      {table}
      {notes.flatMap((n, i) => lines(els, `mk-note-${i}`, wrap(n, width, 4), undefined, true))}
    </Box>
  )
}
