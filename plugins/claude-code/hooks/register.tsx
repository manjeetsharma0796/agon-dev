// Agon inside Claude Code: the status band above the prompt and the trade view in a pane.
//
// Everything on screen comes from the Agon server: GET /status for the band (connection, RPC ping,
// SOL) and GET /market?mint=&range= for the trade view (24h stats, candles, recent trades, the
// book). The plugin does no money arithmetic: every number is printed exactly as the server sent
// it, so this screen and the web and opencode screens agree for the same answer. The chart scales
// the server's candles to cells and pixels; that is drawing, not a number anyone reads.
//
// Buy, Sell and Check only fill the prompt, never send it. A draft carries the token's mint and
// never a name or symbol (OP-38). Up and down are never colour alone: a sign, an arrow or a word.
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

import type { BandMode, Candle, Market, Status } from '../types'

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
// Printed as sent, never rounded, so every number equals the server's. String(n) writes 2.11e-7
// below 1e-6; its digits are moved into plain decimals, not recomputed.
const plain = (n: number) => {
  const s = String(n)
  const m = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(s)
  if (!m) return s
  const [, sign, int, frac = '', exp] = m
  const e = Number(exp)
  return e < 0
    ? `${sign}0.${'0'.repeat(-e - 1)}${int}${frac}`
    : `${sign}${int}${frac}${'0'.repeat(Math.max(0, e - frac.length))}`
}
const usd = (v: unknown) => {
  const n = num(v)
  return n === null ? null : `$${plain(n)}`
}
const amt = (v: unknown) => {
  const n = num(v)
  return n === null ? 'not sent' : plain(n)
}
const signed = (v: number) => `${v > 0 ? '+' : ''}${plain(v)}`
// A move as an arrow, a sign and its number, so it reads without colour.
const move = (v: unknown) => {
  const n = num(v)
  if (n === null) return null
  return `${n > 0 ? '▲' : n < 0 ? '▼' : '='} ${signed(n)}%`
}
const tone = (v: unknown) => {
  const n = num(v)
  return n === null || n === 0 ? undefined : n > 0 ? 'green' : 'red'
}
const clock = (iso: string | undefined) => (iso ? `${iso.slice(11, 19)} UTC` : 'unknown time')

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
  let next: { key: string; body: Market | null; error: string | null }
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
  // Only the newest request writes: a slow answer, or one for a token the person left, is dropped.
  if (seq === marketSeq) await $.state.set(MARKET, next)
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
  const s = st?.body ?? null
  // Only an answer for the token and range selected now: never one token's price under another's label.
  const current = mk?.key === `${mint}:${(await $.state.get(RANGE)).value ?? '1h'}` ? mk : null
  const stats = current?.body?.stats24h
  const parts: [string, string, string | undefined][] = []
  if (!st) parts.push(['conn', `asking ${server}`, undefined])
  else if (!s) parts.push(['conn', `Offline: ${st.error}`, 'yellow'])
  else {
    parts.push(['conn', connection(s), s.upstream?.state === 'live' ? 'green' : 'yellow'])
    const ms = num(s.ping?.value?.ms)
    parts.push([
      'ping',
      ms === null ? `ping: ${s.ping?.error ?? 'first reading in 5 s'}` : `ping ${ms} ms`,
      undefined,
    ])
    const sol = usd(s.solPrice?.value?.usd)
    parts.push([
      'sol',
      sol ? `SOL ${sol}` : `SOL: ${s.solPrice?.error ?? 'first reading in 10 s'}`,
      undefined,
    ])
  }
  const price = usd(stats?.price)
  const tokenText = price
    ? `${labelOf(mint)} ${price}`
    : `${labelOf(mint)}: ${current?.error ?? stats?.error ?? 'loading from /market'}`
  return (
    <Box flexDirection="row" gap={2} alignItems="center" flexWrap="nowrap" overflow="hidden">
      {toggle}
      {parts.map(([k, text, color]) => (
        <Box key={`b-${k}`} flexShrink={k === 'conn' ? 1 : 0} minWidth={4}>
          <Text color={color} wrap="truncate-end">
            {text}
          </Text>
        </Box>
      ))}
      <Box key="b-token" flexShrink={1} minWidth={4} flexDirection="row" gap={1}>
        <Text wrap="truncate-end">{tokenText}</Text>
        {price && <Text color={tone(stats?.changePct)}>{move(stats?.changePct) ?? ''}</Text>}
      </Box>
      <Button key="pane" label="trade" onPress={() => togglePane($)} />
    </Box>
  )
}

function connection(s: Status) {
  const u = s.upstream
  if (!u) return 'connection unknown: /status sent no upstream state'
  if (u.state === 'live') return 'Live'
  if (u.state === 'connecting') return 'Connecting'
  const cause = u.cause ? `: ${u.cause}` : ''
  if (u.state === 'reconnecting')
    return `Reconnecting (attempt ${u.attempt ?? 'not counted'})${cause}`
  if (u.state === 'offline')
    return `Offline since ${clock(u.since)}${cause}${u.next ? `. ${u.next}` : ''}`
  return `upstream state "${u.state.slice(0, 20)}" is not one this plugin knows; update it`
}

// Candles as half-block cells: each cell 2 pixels tall, a candle a column. A last row carries + or -
// per candle, so direction reads without colour.
const NONE = 0x01000000
const UP = 0x22c55e
const DOWN = 0xef4444
const WICK = 0x888888
function candleCells(list: Candle[], rows: number) {
  const hi = Math.max(...list.map((c) => c.high))
  const lo = Math.min(...list.map((c) => c.low))
  const span = hi - lo || 1
  const px = rows * 2
  const y = (v: number) => Math.min(px - 1, Math.max(0, Math.floor(((hi - v) / span) * px)))
  const cols = list.length
  const words = new Uint32Array(cols * (rows + 1) * 3)
  list.forEach((c, x) => {
    const up = c.close >= c.open
    const body = up ? UP : DOWN
    const [bTop, bBot] = [y(Math.max(c.open, c.close)), y(Math.min(c.open, c.close))]
    const [wTop, wBot] = [y(c.high), y(c.low)]
    const at = (p: number) => (p >= bTop && p <= bBot ? body : p >= wTop && p <= wBot ? WICK : null)
    for (let r = 0; r < rows; r++) {
      const top = at(r * 2)
      const bottom = at(r * 2 + 1)
      const i = (r * cols + x) * 3
      if (top !== null) words.set([0x2580, top, bottom ?? NONE], i)
      else if (bottom !== null) words.set([0x2584, bottom, NONE], i)
      else words.set([0x20, NONE, NONE], i)
    }
    words.set([up ? 0x2b : 0x2d, body, NONE], (rows * cols + x) * 3)
  })
  return (new Uint8Array(words.buffer) as unknown as { toBase64(): string }).toBase64()
}

// Candles as SVG: up hollow, down filled, so direction reads without colour.
function candleSvg(list: Candle[], w: number, h: number) {
  const hi = Math.max(...list.map((c) => c.high))
  const lo = Math.min(...list.map((c) => c.low))
  const span = hi - lo || 1
  const y = (v: number) => (((hi - v) / span) * (h - 8) + 4).toFixed(1)
  const slot = w / list.length
  const marks = list
    .map((c, i) => {
      const up = c.close >= c.open
      const col = up ? '#22c55e' : '#ef4444'
      const cx = (i * slot + slot / 2).toFixed(1)
      const top = y(Math.max(c.open, c.close))
      const height = Math.max(1, Number(y(Math.min(c.open, c.close))) - Number(top)).toFixed(1)
      const bw = Math.max(1, slot * 0.6).toFixed(1)
      const bx = (i * slot + slot * 0.2).toFixed(1)
      return `<line x1="${cx}" x2="${cx}" y1="${y(c.high)}" y2="${y(c.low)}" stroke="${col}"/><rect x="${bx}" y="${top}" width="${bw}" height="${height}" fill="${up ? 'none' : col}" stroke="${col}"/>`
    })
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${marks}</svg>`
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
  const width = (e.props as { bodyColumns?: number }).bodyColumns ?? 80
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

  const statusLine = s
    ? [
        s.network ?? 'network unknown',
        s.readsFrom ? `reads ${s.readsFrom}` : null,
        s.dataSlot != null ? `slot ${s.dataSlot}` : 'slot not read yet',
        connection(s),
        num(s.ping?.value?.ms) !== null
          ? `RPC ping ${s.ping!.value!.ms} ms`
          : `ping: ${s.ping?.error ?? 'first reading in 5 s'}`,
        usd(s.solPrice?.value?.usd)
          ? `SOL ${usd(s.solPrice!.value!.usd)}`
          : `SOL: ${s.solPrice?.error ?? 'first reading in 10 s'}`,
      ]
        .filter(Boolean)
        .join(' | ')
    : (st?.error ?? `asking ${server}/status`)

  const top = (
    <Box key="top" flexDirection="column">
      <Box flexDirection="row" gap={2} flexWrap="wrap" alignItems="center">
        <Text bold>{`Agon trade ${labelOf(mint)}`}</Text>
        {PICKS.map(([label, pm]) => tab(`pick-${label}`, label, pm === mint, () => choose($, pm)))}
        <Button key="refresh" plain hotkey="r" label="refresh" onPress={() => refreshAll($)} />
      </Box>
      <Text key="status" color={s ? undefined : 'yellow'} wrap="wrap">
        {statusLine}
      </Text>
      {s?.networkNote && (
        <Text dimColor wrap="wrap">
          {s.networkNote}
        </Text>
      )}
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
      <Text dimColor>{mint}</Text>
    </Box>
  )

  const stats = m?.stats24h
  const header = stats?.error ? (
    <Text key="header" color="yellow" wrap="wrap">
      {stats.error}
    </Text>
  ) : stats ? (
    <Box key="header" flexDirection="row" gap={2} flexWrap="wrap">
      <Text key="h-price" bold>{`price ${usd(stats.price) ?? 'not sent'}`}</Text>
      <Text
        key="h-change"
        color={tone(stats.changePct)}
      >{`${move(stats.changePct) ?? 'change not sent'} 24h`}</Text>
      <Text key="h-high">{`high ${usd(stats.high) ?? 'not sent'}`}</Text>
      <Text key="h-low">{`low ${usd(stats.low) ?? 'not sent'}`}</Text>
      <Text key="h-vol">{`volume ${usd(stats.volumeUsd) ?? 'not sent'}`}</Text>
      <Text key="h-liq" dimColor>
        liquidity: not in /market's answer
      </Text>
      <Text
        key="h-at"
        dimColor
      >{`from ${m?.pool?.address ? short(m.pool.address) : 'unknown pool'} at ${clock(stats.fetchedAt)}`}</Text>
    </Box>
  ) : (
    <Text
      key="header"
      color={marketError ? 'yellow' : undefined}
      dimColor={!marketError}
      wrap="wrap"
    >
      {marketError ?? m?.error ?? `asking ${server}/market for ${short(mint)} ${range}`}
    </Text>
  )

  const list = m?.candles?.list ?? []
  const chartCols = Math.max(10, (wide ? Math.floor(width * 0.6) : width) - 2)
  const shown = list.slice(-chartCols)
  const svg = e.surface !== 'terminal'
  const pxW = Math.max(240, chartCols * 7)
  const chart =
    shown.length > 0 ? (
      <Box key="chart" flexDirection="column">
        {svg && Svg ? (
          <Svg
            key="candles"
            source={candleSvg(shown, pxW, 160)}
            alt={`${shown.length} candles of ${range}; hollow up, filled down`}
            width={pxW}
            height={160}
          />
        ) : Raster ? (
          <Raster
            key="candles"
            columns={shown.length}
            rows={(width < 80 ? 6 : 10) + 1}
            cells={candleCells(shown, width < 80 ? 6 : 10)}
          />
        ) : null}
        <Text dimColor wrap="wrap">
          {`${shown.length} candles of ${range}, top ${usd(Math.max(...shown.map((c) => c.high)))}, bottom ${usd(Math.min(...shown.map((c) => c.low)))}, last close ${usd(shown.at(-1)!.close)}${svg ? '; hollow up, filled down' : '; last row: + closed up, - closed down'}`}
        </Text>
        {(m?.candles?.gaps?.length ?? 0) > 0 && (
          <Text
            dimColor
            wrap="wrap"
          >{`${m!.candles!.gaps!.length} gaps not filled: ${m!.candles!.gaps![0]!.reason}`}</Text>
        )}
      </Box>
    ) : (
      <Text
        key="chart"
        dimColor={!m?.candles?.error}
        color={m?.candles?.error ? 'yellow' : undefined}
        wrap="wrap"
      >
        {m?.candles?.error ??
          (m ? `/market sent 0 candles for ${range}` : 'candles load with the answer above')}
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

  const book = bookPanel(els, m, wide)
  const trades = tradesPanel(els, m, width)

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
      <Text dimColor>buttons only fill your prompt</Text>
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
    </Box>
  )
}

type Els = ReturnType<Dollar['ui']['resolve']>

// The book or depth, labelled by its kind. Every number is the server's.
function bookPanel(els: Els, m: Market | null, wide: boolean) {
  const { Box, Text } = els
  const b = m?.book
  if (!m)
    return (
      <Text key="book" dimColor>
        order book loads with the answer above
      </Text>
    )
  if (!b)
    return (
      <Text key="book" dimColor wrap="wrap">
        Order book: this Agon server's /market sends no book yet, so none is drawn. Update the
        server to get the book or the AMM depth for this pool.
      </Text>
    )
  if ('error' in b)
    return (
      <Text key="book" color="yellow" wrap="wrap">
        {`Order book: ${b.error}`}
      </Text>
    )
  const n = wide ? 8 : 5
  const level = (
    side: 'ask' | 'bid',
    l: { price: number; size: number; total: number },
    i: number,
  ) => (
    <Text key={`${side}-${i}`} color={side === 'ask' ? 'red' : 'green'} wrap="truncate-end">
      {`${side} ${usd(l.price) ?? 'price not sent'}  size ${amt(l.size)}  total ${amt(l.total)}`}
    </Text>
  )
  return (
    <Box key="book" flexDirection="column">
      <Text bold wrap="wrap">
        {b.label}
      </Text>
      <Text
        dimColor
        wrap="wrap"
      >{`${b.kind} on ${b.venue}, pool ${short(b.pool)}, slot ${b.slot}, at ${clock(b.fetchedAt)}`}</Text>
      {b.asks
        .slice(0, n)
        .reverse()
        .map((l, i) => level('ask', l, i))}
      <Text key="mid">{`mid ${usd(b.mid) ?? 'not sent'}`}</Text>
      {b.bids.slice(0, n).map((l, i) => level('bid', l, i))}
      {b.moves.map((mv, i) => (
        <Text key={`move-${i}`} wrap="truncate-end">
          {`move ${signed(mv.pct)}% (${mv.side}): pay ${amt(mv.quoteIn)}, get ${amt(mv.baseOut)}`}
        </Text>
      ))}
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
        recent trades load with the answer above
      </Text>
    )
  if (!t || t.error)
    return (
      <Text key="trades" color="yellow" wrap="wrap">
        {`Recent trades: ${t?.error ?? '/market sent no trades block'}`}
      </Text>
    )
  const list = (t.list ?? []).slice(0, width >= 110 ? 12 : 6)
  return (
    <Box key="trades" flexDirection="column">
      <Text
        bold
      >{`Recent trades (${list.length} of ${(t.list ?? []).length}) at ${clock(t.fetchedAt)}`}</Text>
      {list.map((x, i) => (
        <Text key={`trade-${i}`} color={x.side === 'buy' ? 'green' : 'red'} wrap="truncate-end">
          {`${clock(x.time).slice(0, 8)} ${x.side === 'buy' ? '▲ buy ' : '▼ sell'} ${usd(x.priceUsd) ?? 'price not sent'} ${usd(x.volumeUsd) ?? 'volume not sent'}${width >= 80 ? `  ${x.amount}  ${short(x.wallet)}` : ''}`}
        </Text>
      ))}
      {t.leftOut && (
        <Text dimColor wrap="wrap">
          {t.leftOut}
        </Text>
      )}
    </Box>
  )
}
