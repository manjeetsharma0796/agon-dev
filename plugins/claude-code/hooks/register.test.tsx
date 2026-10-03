import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

// The Agon server, stubbed with raw floats as a live server sends them: /status and /market as
// packages/mcp answers them, the book as T-C35's depth.ts builds it. The test has no network.
// Every number on screen must be the stub's, rounded by the opencode trade view's rules.
const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'
const POOL = 'Gu8Rk4X2ZZ6a3DR1V7yCdGzRMh3q2URo6gJ9VnZxSn5o'
const WALLET = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
const SIG = '5'.repeat(88)
const status = (state: string) => ({
  network: 'fork',
  readsFrom: 'mainnet',
  networkNote:
    'This server is on fork, but every reading below is from mainnet through Helius. Use it for how the real chain is doing, not for fork.',
  at: '2026-10-03T12:00:00.000Z',
  dataSlot: 371234567,
  upstream: { state, since: '2026-10-03T11:58:00.000Z' },
  ping: { source: 'getSlot', value: { ms: 41, p50Ms: 44, samples: 20 }, ageMs: 1200 },
  solPrice: { source: 'Jupiter Price v3', value: { usd: 119.44073547737729, blockId: 1 } },
})
const CANDLES = [
  {
    t: 1759489200,
    open: 0.0000211,
    high: 0.0000225123,
    low: 0.0000209,
    close: 0.0000219,
    volume: 51000.5,
  },
  {
    t: 1759492800,
    open: 0.0000219,
    high: 0.0000221,
    low: 0.00002012345,
    close: 0.0000204,
    volume: 73000.25,
  },
  {
    t: 1759496400,
    open: 0.0000204,
    high: 0.0000214,
    low: 0.0000203,
    close: 0.000021131234567891,
    volume: 41000,
  },
]
const TRADES = [
  {
    time: '2026-10-03T11:59:41.000Z',
    slot: 371234560,
    side: 'buy',
    amount: '1500000.5',
    priceUsd: 0.0000211512345,
    volumeUsd: 31.7234,
    wallet: WALLET,
    signature: SIG,
  },
  // A 14-decimal price, as GeckoTerminal's arithmetic hands it on.
  {
    time: '2026-10-03T11:59:12.000Z',
    slot: 371234501,
    side: 'sell',
    amount: '820000',
    priceUsd: 118.56912345678901,
    volumeUsd: 4923.456,
    wallet: WALLET,
    signature: SIG,
  },
]
const ORDERBOOK = {
  kind: 'orderbook',
  label: 'Order book',
  venue: 'Manifest',
  pool: POOL,
  slot: 371234555,
  fetchedAt: '2026-10-03T11:59:50.000Z',
  mid: 0.00002112345,
  asks: [
    { price: 0.0000211412, size: 400000, total: 400000 },
    { price: 0.0000211734, size: 250000.123456, total: 650000.123456 },
  ],
  bids: [
    { price: 0.0000211, size: 300000, total: 300000 },
    { price: 0.00002106, size: 125000, total: 425000 },
    // Below 1e-6 toPrecision writes 2.110e-7; the screen must show decimals.
    { price: 0.000000211, size: 5, total: 425005 },
  ],
  moves: [],
  basis: 'Read from the Manifest accounts at slot 371234555.',
  ttlSeconds: 10,
}
const CURVE = {
  kind: 'amm-curve',
  label: 'Cost to move the price',
  venue: 'Raydium CPMM',
  pool: POOL,
  slot: 371234556,
  fetchedAt: '2026-10-03T11:59:51.000Z',
  mid: 0.00002113,
  asks: [],
  bids: [],
  moves: [
    { pct: 1, side: 'buy', quoteIn: 1204.7512, baseOut: 56713000.5 },
    { pct: 5, side: 'sell', quoteIn: 6400, baseOut: 281200000 },
    // A size too wide for its column and under 1: 4 significant digits, never 0.00.
    { pct: 10, side: 'buy', quoteIn: 12.5, baseOut: 0.00123456789 },
  ],
  basis: 'Constant product from the reserves.',
  ttlSeconds: 10,
}
const market = (book: unknown) => ({
  mint: BONK,
  range: '1h',
  source: 'GeckoTerminal, Solana mainnet',
  pool: { address: POOL, fetchedAt: '2026-10-03T11:59:00.000Z' },
  candles: {
    pool: POOL,
    fetchedAt: '2026-10-03T11:59:30.000Z',
    stepSeconds: 3600,
    list: CANDLES,
    gaps: [],
  },
  indicators: {
    pool: POOL,
    basis: '3 candles above, index for index; 0 gaps not filled',
    ma: { params: { period: 20 }, values: [null, null, 0.0000210987654] },
    ema: { params: { period: 20 }, values: [null, null, null] },
  },
  stats24h: {
    pool: POOL,
    fetchedAt: '2026-10-03T11:59:30.000Z',
    price: 0.000021131234567891,
    changePct: -2.1632792743127722,
    high: 0.0000225123,
    low: 0.00002012345,
    volumeUsd: 165217658.2824979,
  },
  trades: { pool: POOL, fetchedAt: '2026-10-03T11:59:45.000Z', list: TRADES, leftOut: null },
  ...(book === undefined ? {} : { book }),
})

const PANE = (surface: 'terminal' | 'desktop', bodyColumns: number, bodyRows = 60) =>
  ({
    plugin: 'agon',
    surface,
    component: 'Pane',
    requestId: 'agon-trade',
    props: {
      title: 'Agon trade',
      isFocused: true,
      bodyColumns,
      placement: 'dock',
      scroll: { offset: 0, bodyRows },
      view: {},
    },
  }) as const
const BAND = (surface: 'terminal' | 'desktop', bodyColumns: number) =>
  ({
    plugin: 'agon',
    surface,
    component: 'AbovePrompt',
    props: {
      hasSurvey: false,
      isWorking: false,
      maxRows: 3,
      bodyColumns,
      scroll: { offset: 0, bodyRows: 3 },
      view: {},
    },
  }) as const

// Every Text the drawing shows, one per line.
const shown = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) =>
  (await ui.findAll({ type: 'Text' })).map((t) => t.text).join('\n')
// A raw float leaking through: 7 or more significant digits after the point, or an exponent.
const RAW = /\.\d*[1-9]\d{6,}|\de-\d/

type Server = { book: unknown; urls: string[]; down: boolean; upstream: string }
function stub(on: On, server: Server, filled: string[]) {
  mock.store(on)
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('http.fetch', async (_$, e) => {
    server.urls.push(e.url)
    if (server.down) throw new Error('connect ECONNREFUSED 127.0.0.1:8787')
    const body = e.url.includes('/status') ? status(server.upstream) : market(server.book)
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } }
  })
  on('prompt.fill', async (_$, e) => {
    filled.push(e.text)
    return { isFilled: true }
  })
}

test('band and pane at 60, 80 and 140 columns show every number rounded from /status and /market', async ($, on) => {
  const server: Server = { book: ORDERBOOK, urls: [], down: false, upstream: 'live' }
  const filled: string[] = []
  stub(on, server, filled)

  const first = await $.ui.mount(PANE('desktop', 80))
  await first.press({ key: 'pick-BONK' })
  await first.press({ key: 'refresh' })
  await first.unmount()
  expect(server.urls).toContain(`http://127.0.0.1:8787/market?mint=${BONK}&range=1h`)
  expect(server.urls).toContain('http://127.0.0.1:8787/status')

  for (const surface of ['terminal', 'desktop'] as const)
    for (const width of [60, 80, 140]) {
      const band = await $.ui.mount(BAND(surface, width))
      const b = await shown(band)
      // 119.44073547737729 has 14 decimals: 6 significant digits on screen.
      for (const want of ['● live', 'ping 41 ms', 'SOL $119.441', 'BONK $0.00002113', '▼ -2.16%'])
        expect(b).toContain(want)
      expect(b).not.toMatch(RAW)
      expect(await band.find({ key: 'pane' })).toBeDefined()
      await band.press({ key: 'toggle' })
      expect(await shown(band)).not.toContain('119.441')
      await band.press({ key: 'toggle' })
      await band.unmount()

      const pane = await $.ui.mount(PANE(surface, width))
      const p = await shown(pane)
      for (const want of [
        // the status line
        '● live',
        'ping 41 ms',
        'slot 371234567',
        'SOL $119.441',
        'fork, feed from mainnet',
        // the header
        'BONK  $0.00002113',
        '▼ -2.16% 24h',
        'H $0.00002251',
        'L $0.00002012',
        'vol $165.2M',
        'liquidity: /market sends none',
        // the axis and the latest candle with MA20 and EMA20
        'O $0.00002040 H $0.00002140 L $0.00002030 C $0.00002113',
        '▲ up',
        'vol $41.0K',
        'MA20 $0.00002110',
        'EMA20 warming up',
        // trades: a 14-decimal price as 6 significant digits, volumes compact
        '▲ buy',
        '$0.00002115',
        '$31.72',
        '▼ sell',
        '$118.569',
        '$4.9K',
        // the book, labelled, asks above the mid, bids below
        'Order book',
        'Manifest  Gu8R..Sn5o  slot 371234555',
        '$0.00002114',
        '$0.00002117',
        '250.0K',
        '650.0K',
        '$0.00002112',
        '$0.00002110',
        '$0.0000002110',
        '425005',
      ])
        expect(p).toContain(want)
      expect(p).not.toMatch(RAW)
      expect(p).not.toContain('unset')
      // Asks above the mid, highest first, then bids below it.
      const at = ['$0.00002117', '$0.00002114', '\nmid\n', '$0.00002110\n300000'].map((s) =>
        p.indexOf(s),
      )
      expect(at[0]!).toBeGreaterThanOrEqual(0)
      for (let i = 1; i < at.length; i++) expect(at[i]!).toBeGreaterThan(at[i - 1]!)
      if (surface === 'terminal') {
        const r = await pane.find({ type: 'Raster' })
        expect(r?.props['rows']).toBeGreaterThanOrEqual(13)
        for (const want of ['$0.00002251', '$0.00002012', '◀$0.00002113', 'vol'])
          expect(p).toContain(want)
      } else {
        const svg = await pane.find({ type: 'Svg' })
        const source = String(svg?.props['source'])
        for (const want of ['$0.00002251', '$0.00002012', '◀ $0.00002113', '>vol<'])
          expect(source).toContain(want)
      }
      await pane.press({ key: 'buy' })
      await pane.press({ key: 'sell' })
      await pane.unmount()
    }

  expect(filled.length).toBe(12)
  for (const text of filled) {
    expect(text).toContain(BONK)
    expect(text).not.toMatch(/bonk/i)
  }
})

test('the band and the pane read one connection state and change together', async ($, on) => {
  const server: Server = { book: ORDERBOOK, urls: [], down: false, upstream: 'connecting' }
  stub(on, server, [])
  for (const surface of ['terminal', 'desktop'] as const) {
    server.upstream = 'connecting'
    const band = await $.ui.mount(BAND(surface, 80))
    const pane = await $.ui.mount(PANE(surface, 80, 20))
    await pane.press({ key: 'refresh' })
    expect(await shown(band)).toContain('◌ connecting')
    expect(await shown(pane)).toContain('◌ connecting')
    // The smallest pane still gets 12 rows of candles.
    if (surface === 'terminal')
      expect((await pane.find({ type: 'Raster' }))?.props['rows']).toBe(13)
    server.upstream = 'live'
    await pane.press({ key: 'refresh' })
    for (const ui of [band, pane]) {
      const t = await shown(ui)
      expect(t).toContain('● live')
      expect(t).not.toContain('connecting')
    }
    await band.unmount()
    await pane.unmount()
  }
})

test('the book is honest when missing, failed or a curve; a bad mint and a down server say why', async ($, on) => {
  const server: Server = { book: undefined, urls: [], down: false, upstream: 'live' }
  stub(on, server, [])

  for (const surface of ['terminal', 'desktop'] as const) {
    server.book = undefined
    let pane = await $.ui.mount(PANE(surface, 80))
    await pane.press({ key: 'pick-BONK' })
    expect(await shown(pane)).toContain("this Agon server's /market sends no book")
    await pane.unmount()

    server.book = { error: 'Order book: Manifest market account not readable at slot 371234555.' }
    pane = await $.ui.mount(PANE(surface, 80))
    await pane.press({ key: 'refresh' })
    expect(await shown(pane)).toContain(
      'not shown: Order book: Manifest market account not readable',
    )
    await pane.unmount()

    server.book = CURVE
    pane = await $.ui.mount(PANE(surface, 140))
    await pane.press({ key: 'refresh' })
    const p = await shown(pane)
    for (const want of [
      'Cost to move the price',
      'Raydium CPMM  Gu8R..Sn5o  slot 371234556',
      '1%\n▲ buy\n$1.2K\n56.7M',
      // A sell pays base units and gets USD; 9 characters fit the column, so shown as sent.
      '5%\n▼ sell\n281200000\n$6.4K',
      '10%\n▲ buy\n$12.50\n0.001235',
      'a buy pays USD and gets base token units, a sell the reverse',
    ])
      expect(p).toContain(want)

    // A pasted value that is not a mint is refused before any request carries it.
    const before = server.urls.length
    await pane.input({ key: 'mint', text: 'not-a-mint' })
    expect(await shown(pane)).toContain('Not a Solana mint: 10 characters')
    expect(server.urls.length).toBe(before)
    await pane.unmount()
  }

  server.down = true
  const band = await $.ui.mount(BAND('terminal', 80))
  const pane = await $.ui.mount(PANE('terminal', 80))
  await pane.press({ key: 'refresh' })
  expect(await shown(band)).toContain(
    '○ server offline: the Agon server is not answering at http://127.0.0.1:8787',
  )
  expect(await shown(pane)).toContain('/market not answering at http://127.0.0.1:8787')
})
