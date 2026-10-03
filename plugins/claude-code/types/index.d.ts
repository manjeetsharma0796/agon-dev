// What the plugin reads from the Agon server, as the server sends it. The plugin computes no
// number of its own: every price, change, size and total on screen is one of these, rounded for
// display only.

// GET /market?mint=&range= (packages/mcp/src/market.ts).
export type Candle = {
  t: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}
export type Trade = {
  time: string
  slot: number
  side: 'buy' | 'sell'
  amount: string
  priceUsd: number
  volumeUsd: number
  wallet: string
  signature: string
}
// The book, by where the token trades (T-C35's contract). `label` is always shown.
export type Level = { price: number; size: number; total: number }
export type Move = { pct: number; side: string; quoteIn: number; baseOut: number }
export type Book =
  | {
      kind: 'orderbook' | 'amm-liquidity' | 'amm-curve'
      label: string
      venue: string
      pool: string
      slot: number | null
      fetchedAt: string
      mid: number | null
      bids: Level[]
      asks: Level[]
      moves: Move[]
      basis?: string
      ttlSeconds?: number
    }
  | { error: string }
// An indicator line, index for index with candles.list; null while it warms up.
export type Line = { params?: { period?: number }; values?: (number | null)[] }
export type Market = {
  mint?: string
  range?: string
  source?: string
  error?: string
  pool?: { address?: string; fetchedAt?: string }
  candles?: {
    fetchedAt?: string
    stepSeconds?: number
    list?: Candle[]
    gaps?: { missing: number; reason: string }[]
    error?: string
  }
  stats24h?: {
    price?: number
    changePct?: number
    high?: number
    low?: number
    volumeUsd?: number
    // T-C37: the chosen pool's reserve in USD, flagged when over 100 times its 24h volume.
    liquidityUsd?: { value?: number; flag?: string | null; fetchedAt?: string; error?: string }
    fetchedAt?: string
    error?: string
  }
  indicators?: {
    ma?: Line
    ema?: Line
    error?: string
  }
  trades?: { list?: Trade[]; leftOut?: string | null; fetchedAt?: string; error?: string }
  book?: Book
}

// GET /status (packages/mcp/src/stream.ts).
export type Reading<T> = { source?: string; value?: T; ageMs?: number; error?: string }
export type Status = {
  network?: string
  readsFrom?: string
  networkNote?: string
  at?: string
  dataSlot?: number | null
  error?: string
  upstream?: { state: string; since?: string; attempt?: number; cause?: string; next?: string }
  ping?: Reading<{ ms: number; p50Ms: number; samples: number }>
  solPrice?: Reading<{ usd: number; blockId: number | null }>
}

// An answer and the request it answers, or why there is none.
export type Loaded<T> = { key: string; body: T | null; error: string | null }

// The band: its name only, or the status line.
export type BandMode = 'collapsed' | 'line'

declare module 'claude-code' {
  interface PluginState {
    agon: {
      mode: BandMode
      selected: string
      range: string
      market: Loaded<Market> | null
      status: Loaded<Status> | null
      mintNote: string | null
    }
  }
}
