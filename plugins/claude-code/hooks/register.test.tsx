import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

// The Agon server, stubbed: /status and /market as packages/mcp answers them, the book as T-C35's
// contract. The test has no network. Every number the screens print must be one of these.
const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'
const POOL = 'Gu8Rk4X2ZZ6a3DR1V7yCdGzRMh3q2URo6gJ9VnZxSn5o'
const WALLET = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
const SIG = '5'.repeat(88)
const STATUS = {
  network: 'fork',
  readsFrom: 'mainnet',
  at: '2026-10-03T12:00:00.000Z',
  dataSlot: 371234567,
  upstream: { state: 'live', since: '2026-10-03T11:58:00.000Z' },
  ping: { source: 'getSlot', value: { ms: 41, p50Ms: 44, samples: 20 }, ageMs: 1200 },
  solPrice: { source: 'Jupiter Price v3', value: { usd: 151.23, blockId: 1 }, ageMs: 3000 },
}
const CANDLES = [
  {
    t: 1759489200,
    open: 0.0000211,
    high: 0.0000225,
    low: 0.0000209,
    close: 0.0000219,
    volume: 51000.5,
  },
  {
    t: 1759492800,
    open: 0.0000219,
    high: 0.0000221,
    low: 0.0000201,
    close: 0.0000204,
    volume: 73000.25,
  },
  {
    t: 1759496400,
    open: 0.0000204,
    high: 0.0000214,
    low: 0.0000203,
    close: 0.00002113,
    volume: 41000,
  },
]
const TRADES = [
  {
    time: '2026-10-03T11:59:41.000Z',
    slot: 371234560,
    side: 'buy',
    amount: '1500000.5',
    priceUsd: 0.00002115,
    volumeUsd: 31.72,
    wallet: WALLET,
    signature: SIG,
  },
  {
    time: '2026-10-03T11:59:12.000Z',
    slot: 371234501,
    side: 'sell',
    amount: '820000',
    priceUsd: 0.00002109,
    volumeUsd: 17.29,
    wallet: WALLET,
    signature: SIG,
  },
]
const ORDERBOOK = {
  kind: 'orderbook',
  label: 'Manifest order book: resting orders',
  venue: 'Manifest',
  pool: POOL,
  slot: 371234555,
  fetchedAt: '2026-10-03T11:59:50.000Z',
  mid: 0.00002112,
  asks: [
    { price: 0.00002114, size: 400000, total: 400000 },
    { price: 0.00002117, size: 250000, total: 650000 },
  ],
  bids: [
    { price: 0.0000211, size: 300000, total: 300000 },
    { price: 0.00002106, size: 125000, total: 425000 },
  ],
  moves: [],
}
const CURVE = {
  kind: 'amm-curve',
  label: 'AMM liquidity, not resting orders',
  venue: 'Raydium CPMM',
  pool: POOL,
  slot: 371234556,
  fetchedAt: '2026-10-03T11:59:51.000Z',
  mid: 0.00002113,
  asks: [],
  bids: [],
  moves: [
    { pct: 1, side: 'buy', quoteIn: 1204.75, baseOut: 56713000 },
    { pct: 5, side: 'buy', quoteIn: 6150.5, baseOut: 281200000 },
  ],
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
  stats24h: {
    pool: POOL,
    fetchedAt: '2026-10-03T11:59:30.000Z',
    price: 0.00002113,
    changePct: -3.25,
    high: 0.0000225,
    low: 0.0000201,
    volumeUsd: 1834567.5,
  },
  trades: { pool: POOL, fetchedAt: '2026-10-03T11:59:45.000Z', list: TRADES, leftOut: null },
  ...(book === undefined ? {} : { book }),
})

const PANE = (surface: 'terminal' | 'desktop', bodyColumns: number) =>
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
      scroll: { offset: 0, bodyRows: 60 },
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

// Every Text the drawing shows, as one string.
const shown = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) =>
  (await ui.findAll({ type: 'Text' })).map((t) => t.text).join('\n')

type Server = { book: unknown; urls: string[]; down: boolean }
function stub(on: On, server: Server, filled: string[]) {
  mock.store(on)
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('http.fetch', async (_$, e) => {
    server.urls.push(e.url)
    if (server.down) throw new Error('connect ECONNREFUSED 127.0.0.1:8787')
    const body = e.url.includes('/status') ? STATUS : market(server.book)
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } }
  })
  on('prompt.fill', async (_$, e) => {
    filled.push(e.text)
    return { isFilled: true }
  })
}

test('band and pane at 60, 80 and 140 columns print every number exactly as /status and /market sent it', async ($, on) => {
  const server: Server = { book: ORDERBOOK, urls: [], down: false }
  const filled: string[] = []
  stub(on, server, filled)

  const first = await $.ui.mount(PANE('desktop', 80))
  await first.press({ key: 'pick-BONK' })
  await first.press({ key: 'refresh' })
  await first.unmount()
  expect(server.urls.some((u) => u === `http://127.0.0.1:8787/market?mint=${BONK}&range=1h`)).toBe(
    true,
  )
  expect(server.urls.some((u) => u === 'http://127.0.0.1:8787/status')).toBe(true)

  for (const surface of ['terminal', 'desktop'] as const)
    for (const width of [60, 80, 140]) {
      const band = await $.ui.mount(BAND(surface, width))
      const b = await shown(band)
      for (const want of ['Live', 'ping 41 ms', 'SOL $151.23', 'BONK $0.00002113', '▼ -3.25%'])
        expect(b).toContain(want)
      expect(await band.find({ key: 'pane' })).toBeDefined()
      await band.press({ key: 'toggle' })
      expect(await shown(band)).not.toContain('151.23')
      await band.press({ key: 'toggle' })
      await band.unmount()

      const pane = await $.ui.mount(PANE(surface, width))
      const p = await shown(pane)
      const numbers = [
        // /status
        'slot 371234567',
        'RPC ping 41 ms',
        'SOL $151.23',
        // stats24h
        'price $0.00002113',
        '▼ -3.25% 24h',
        'high $0.0000225',
        'low $0.0000201',
        'volume $1834567.5',
        // the chart's own extremes and last close, picked from the candles, not computed
        'top $0.0000225',
        'bottom $0.0000201',
        'last close $0.00002113',
        '3 candles of 1h',
        // trades
        '▲ buy  $0.00002115 $31.72',
        '▼ sell $0.00002109 $17.29',
        // the book, labelled
        'Manifest order book: resting orders',
        'orderbook on Manifest',
        'slot 371234555',
        'mid $0.00002112',
        'ask $0.00002114  size 400000  total 400000',
        'ask $0.00002117  size 250000  total 650000',
        'bid $0.0000211  size 300000  total 300000',
        'bid $0.00002106  size 125000  total 425000',
      ]
      for (const want of numbers) expect(p).toContain(want)
      if (width >= 80) expect(p).toContain('1500000.5')
      expect(p).toContain('liquidity: not in /market')
      if (surface === 'terminal') expect(await pane.find({ type: 'Raster' })).toBeDefined()
      else expect(await pane.find({ type: 'Svg' })).toBeDefined()
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

test('the book is honest when it is missing, failed or AMM depth; a bad mint and a down server say why', async ($, on) => {
  const server: Server = { book: undefined, urls: [], down: false }
  stub(on, server, [])

  for (const surface of ['terminal', 'desktop'] as const) {
    server.book = undefined
    let pane = await $.ui.mount(PANE(surface, 80))
    await pane.press({ key: 'pick-BONK' })
    expect(await shown(pane)).toContain("this Agon server's /market sends no book yet")
    await pane.unmount()

    server.book = {
      error: 'Manifest market account not readable at slot 371234555; try again in 15 s',
    }
    pane = await $.ui.mount(PANE(surface, 80))
    await pane.press({ key: 'refresh' })
    expect(await shown(pane)).toContain(
      'Order book: Manifest market account not readable at slot 371234555',
    )
    await pane.unmount()

    server.book = CURVE
    pane = await $.ui.mount(PANE(surface, 140))
    await pane.press({ key: 'refresh' })
    const p = await shown(pane)
    for (const want of [
      'AMM liquidity, not resting orders',
      'amm-curve on Raydium CPMM',
      'mid $0.00002113',
      'move +1% (buy): pay 1204.75, get 56713000',
      'move +5% (buy): pay 6150.5, get 281200000',
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
  expect(await shown(band)).toContain('the Agon server is not answering at http://127.0.0.1:8787')
  expect(await shown(pane)).toContain('/market not answering at http://127.0.0.1:8787')
})
