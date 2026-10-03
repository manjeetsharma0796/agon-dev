// `GET /stream` and `GET /status`: the status bar's data, held on this server so upstream keys never
// leave it (docs/plans/agon-terminal.md sections 3 and 7b). Owned by T-C34.
//
// One hub per process. It starts on the first request and stops itself after 2 minutes with no
// stream open and no status asked for, because a 5 s ping alone is 17,280 Helius calls a day and a
// server nobody is looking at has no reason to spend them.
//
// Upstream text is data: every frame and body is built here from numbers we parsed, never from text
// an upstream sent, and the serialized output is scrubbed of the key as a last line.

import type { IncomingMessage, ServerResponse } from 'node:http'
import { mode, network as networkOf } from '@agon/core'
import { rpcCall } from '@agon/core/dist/net/record.js'

const SOL_MINT = 'So11111111111111111111111111111111111111112'
const JITO_TIP_FLOOR = 'https://bundles.jito.wtf/api/v1/bundles/tip_floor'
const SOL_PRICE = `https://lite-api.jup.ag/price/v3?ids=${SOL_MINT}`

const PING_EVERY_MS = 5_000
const TPS_EVERY_MS = 60_000
const MARKET_EVERY_MS = 10_000
const FEES_FRESH_MS = 10_000
const FEES_CACHE_MAX = 32
/** Slots ran 266 ms apart when measured: 10 s with none is a dead socket that has not said so. */
const STALL_MS = 10_000
const IDLE_MS = 120_000
const TIMEOUT_MS = 4_000
const PING_WINDOW = 20
const HEARTBEAT_MS = 15_000
/** getRecentPrioritizationFees takes at most 128 accounts. */
const MAX_ACCOUNTS = 128
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

/** Reconnecting this many times without a slot, the upstream is called offline. */
export const OFFLINE_AFTER = 5

/** 1, 2, 4, 8, 16 s, then every 30 s for as long as it stays down. */
export const backoffMs = (attempt: number): number =>
  attempt > OFFLINE_AFTER ? 30_000 : 1000 * 2 ** (attempt - 1)

// ---- parsers: plain data in, numbers out, a cause when the answer is not what we expect ----

const rpcResult = (body: unknown): unknown => {
  const b = body as { result?: unknown; error?: { code?: unknown } } | null
  if (b?.error) {
    // The code only. The message is upstream text and the status bar is read by agents too.
    throw new Error(`RPC error ${typeof b.error.code === 'number' ? b.error.code : 'with no code'}`)
  }
  return b?.result
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export const parseSlot = (body: unknown): number => {
  const r = rpcResult(body)
  if (!num(r)) throw new Error('the answer carried no slot number')
  return r
}

interface Tps {
  total: number
  nonVote: number
  periodSecs: number
  sampleSlot: number
}

export const parseTps = (body: unknown): Tps => {
  const r = rpcResult(body)
  const list = Array.isArray(r) ? r : []
  const s = list[0] as Record<string, unknown> | undefined
  if (!s) throw new Error(`the answer carried 0 performance samples`)
  const { numTransactions: all, numNonVoteTransactions: nonVote, samplePeriodSecs: secs } = s
  if (!num(all) || !num(nonVote) || !num(secs) || secs <= 0 || !num(s['slot'])) {
    throw new Error('the performance sample is missing a count or its period')
  }
  return {
    total: Math.round(all / secs),
    nonVote: Math.round(nonVote / secs),
    periodSecs: secs,
    sampleSlot: s['slot'],
  }
}

/** Nearest rank: the smallest value with at least p percent of the sample at or below it. */
const rank = (sorted: number[], p: number): number =>
  sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0

interface Fees {
  microLamportsPerCu: {
    min: number
    p25: number
    p50: number
    p75: number
    p95: number
    max: number
  }
  slots: number
}

export const parseFees = (body: unknown): Fees => {
  const r = rpcResult(body)
  if (!Array.isArray(r)) throw new Error('the answer carried no fee list')
  const fees = r
    .map((x) => (x as { prioritizationFee?: unknown }).prioritizationFee)
    .filter(num)
    .sort((a, b) => a - b)
  if (fees.length === 0) throw new Error('the answer carried 0 slots of fees')
  return {
    microLamportsPerCu: {
      min: fees[0] ?? 0,
      p25: rank(fees, 25),
      p50: rank(fees, 50),
      p75: rank(fees, 75),
      p95: rank(fees, 95),
      max: fees[fees.length - 1] ?? 0,
    },
    slots: fees.length,
  }
}

interface TipFloor {
  p25: number
  p50: number
  p75: number
  p95: number
  p99: number
  ema50: number
}

/** Jito answers in SOL; this answers in lamports, rounded, so nobody multiplies a float twice. */
export const parseTipFloor = (body: unknown): TipFloor => {
  const s = (Array.isArray(body) ? body[0] : undefined) as Record<string, unknown> | undefined
  const lamports = (k: string): number => {
    const v = s?.[k]
    if (!num(v) || v < 0) throw new Error(`the tip floor answer has no valid ${k}`)
    return Math.round(v * 1e9)
  }
  return {
    p25: lamports('landed_tips_25th_percentile'),
    p50: lamports('landed_tips_50th_percentile'),
    p75: lamports('landed_tips_75th_percentile'),
    p95: lamports('landed_tips_95th_percentile'),
    p99: lamports('landed_tips_99th_percentile'),
    ema50: lamports('ema_landed_tips_50th_percentile'),
  }
}

export const parseSolPrice = (body: unknown): { usd: number; blockId: number | null } => {
  const e = (body as Record<string, { usdPrice?: unknown; blockId?: unknown }> | null)?.[SOL_MINT]
  if (!num(e?.usdPrice) || e.usdPrice <= 0)
    throw new Error('the answer carried no usdPrice for SOL')
  return { usd: e.usdPrice, blockId: num(e.blockId) ? e.blockId : null }
}

/** The `accounts` query: comma separated base58 addresses, or none. */
export const parseAccounts = (raw: string | null): string[] | { error: string } => {
  if (raw === null || raw === '') return []
  const list = raw.split(',')
  if (list.length > MAX_ACCOUNTS) {
    return {
      error:
        `accounts has ${list.length} addresses and getRecentPrioritizationFees takes at most ` +
        `${MAX_ACCOUNTS}. Pass the pools you trade, ${MAX_ACCOUNTS} or fewer.`,
    }
  }
  const bad = list.findIndex((a) => !BASE58.test(a))
  if (bad >= 0) {
    return {
      error:
        `account ${bad + 1} is not a base58 address of 32 to 44 characters. Pass pool or mint ` +
        `addresses, comma separated.`,
    }
  }
  return list
}

// ---- assembly: readings and a clock in, the status body out ----

/** A value and when it was read, or why it could not be. A stale value keeps its age. */
interface Reading<T> {
  value?: T
  at?: number
  error?: string
}

type Upstream =
  | { state: 'live'; since: number }
  | { state: 'connecting'; since: number }
  | { state: 'reconnecting'; since: number; attempt: number; backoffMs: number; cause: string }
  | { state: 'offline'; since: number; attempt?: number; cause: string; next: string }

interface Snapshot {
  network: string
  upstream: Upstream
  slot: Reading<{ slot: number; parent: number; root: number }>
  ping: Reading<{ ms: number; p50Ms: number; samples: number }>
  slotLag: Reading<{ slots: number }>
  tps: Reading<Tps>
  fees: Reading<Fees>
  tipFloor: Reading<TipFloor>
  solPrice: Reading<{ usd: number; blockId: number | null }>
  accounts: string[]
}

const SOURCES = {
  slot: 'Helius websocket slotSubscribe, held on this server',
  ping: `round trip of getSlot (processed) to Helius RPC, every ${PING_EVERY_MS / 1000} s; p50 over the last ${PING_WINDOW}`,
  slotLag:
    'getSlot (processed) minus the last slotSubscribe slot at the moment getSlot answered; ' +
    'positive means the stream is behind',
  tps: `getRecentPerformanceSamples, the latest 60 s sample, read every ${TPS_EVERY_MS / 1000} s`,
  priorityFee: `getRecentPrioritizationFees over the last 150 slots, cached ${FEES_FRESH_MS / 1000} s per account set; nearest rank`,
  jitoTipFloor: `${JITO_TIP_FLOOR}, in lamports, every ${MARKET_EVERY_MS / 1000} s`,
  solPrice: `Jupiter Price v3, every ${MARKET_EVERY_MS / 1000} s`,
}

const render = <T>(r: Reading<T>, source: string, now: number) => ({
  source,
  ...(r.value !== undefined && r.at !== undefined
    ? { value: r.value, ageMs: Math.max(0, Math.round(now - r.at)) }
    : {}),
  ...(r.error !== undefined ? { error: r.error } : {}),
})

const iso = (t: number): string => new Date(t).toISOString()

export const assembleStatus = (s: Snapshot, now: number) => ({
  network: s.network,
  // `rpcCall` only knows mainnet, and a fork or devnet has no live feed of its own here.
  readsFrom: 'mainnet',
  ...(s.network !== 'mainnet'
    ? {
        // network() names a missing or unknown AGON_NETWORK 'unset', which is not a network to be on.
        networkNote:
          s.network === 'unset'
            ? 'AGON_NETWORK is not set on this server, or is not 1 of fork, devnet or mainnet, and every reading below is from mainnet through Helius. Set AGON_NETWORK to fork, devnet or mainnet to say which chain this server trades on.'
            : `This server is on ${s.network}, but every reading below is from mainnet through Helius. Use it for how the real chain is doing, not for ${s.network}.`,
      }
    : {}),
  at: iso(now),
  dataSlot: s.slot.value?.slot ?? null,
  upstream: { ...s.upstream, since: iso(s.upstream.since) },
  slot: render(s.slot, SOURCES.slot, now),
  ping: render(s.ping, SOURCES.ping, now),
  slotLag: render(s.slotLag, SOURCES.slotLag, now),
  tps: render(s.tps, SOURCES.tps, now),
  priorityFee: {
    ...render(s.fees, SOURCES.priorityFee, now),
    accounts: s.accounts.length,
    ...(s.accounts.length === 0
      ? {
          note:
            'No accounts given, so this is the lowest fee that landed in each slot, which ' +
            'reads 0 nearly always. Pass ?accounts=<pool or mint addresses> for the fee on what ' +
            'you trade.',
        }
      : {}),
  },
  jitoTipFloor: render(s.tipFloor, SOURCES.jitoTipFloor, now),
  solPrice: render(s.solPrice, SOURCES.solPrice, now),
})

// ---- the hub: the only part here that touches the network ----

export interface StreamDeps {
  /** The Helius RPC URL with its key, from `rpcCall`, or undefined when HELIUS_API_KEY is unset. */
  rpcUrl: string | undefined
  /** AGON_NET_MODE is live or record. Replay makes no network calls, so this hub makes none. */
  live: boolean
  network: string
  fetch: typeof fetch
  WebSocket: new (url: string) => {
    onopen: (() => void) | null
    onmessage: ((ev: { data: unknown }) => void) | null
    onclose: ((ev: { code: number }) => void) | null
    onerror: (() => void) | null
    send(data: string): void
    close(): void
  }
}

const elapsed = (t0: number): number => Math.round(performance.now() - t0)

/** GET or POST JSON with a timeout. A failure names the HTTP status or the error code, never a URL. */
const getJson = async (
  f: typeof fetch,
  url: string,
  body?: unknown,
): Promise<{ body: unknown; ms: number }> => {
  const t0 = performance.now()
  let res: Response
  try {
    res = await f(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (e) {
    const code = (e as { cause?: { code?: unknown } }).cause?.code
    const why = typeof code === 'string' ? code : (e as Error).name
    throw new Error(`no answer after ${elapsed(t0)} ms (${why})`)
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} after ${elapsed(t0)} ms`)
  try {
    return { body: await res.json(), ms: elapsed(t0) }
  } catch {
    throw new Error(`an answer that is not JSON after ${elapsed(t0)} ms`)
  }
}

export const createStream = (deps: StreamDeps) => {
  const { rpcUrl = '' } = deps
  // The key as it sits in the URL actually called, so the scrub can never target a different one.
  const key = rpcUrl ? new URL(rpcUrl).searchParams.get('api-key') : null
  const scrub = (text: string): string => (key ? text.replaceAll(key, 'REDACTED') : text)
  const configError = !deps.live
    ? {
        cause: 'AGON_NET_MODE is replay, so this server makes no network calls',
        next: 'Set AGON_NET_MODE=live and HELIUS_API_KEY on the server and restart it.',
      }
    : !rpcUrl
      ? {
          cause: 'HELIUS_API_KEY is not set on the server',
          next: 'Set HELIUS_API_KEY in the server environment and restart it.',
        }
      : null
  const s: Omit<Snapshot, 'accounts' | 'fees'> = {
    network: deps.network,
    upstream: { state: 'connecting', since: Date.now() },
    slot: { error: 'waiting for the first slotSubscribe event' },
    ping: { error: 'waiting for the first getSlot' },
    slotLag: { error: 'needs 1 getSlot answer and 1 slot event' },
    tps: { error: 'waiting for the first performance sample' },
    tipFloor: { error: 'waiting for the first Jito tip floor read' },
    solPrice: { error: 'waiting for the first Jupiter price read' },
  }
  const fees = new Map<string, Reading<Fees>>()
  const pings: number[] = []
  const clients = new Set<(frame: string) => void>()
  let timers: ReturnType<typeof setInterval>[] = []
  let retry: ReturnType<typeof setTimeout> | null = null
  let socket: InstanceType<StreamDeps['WebSocket']> | null = null
  let running = false
  let ready: Promise<void> = Promise.resolve()
  let lastDemand = 0
  let attempt = 0
  let outageSince = 0
  /** When the current socket was opened or last sent a slot, whichever is later. */
  let heardAt = 0

  const send = (event: string, data: unknown): void => {
    const frame = scrub(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    for (const c of clients) c(frame)
  }
  const upstreamFrame = () => ({ ...s.upstream, since: iso(s.upstream.since) })
  const setUpstream = (u: Upstream): void => {
    s.upstream = u
    send('upstream', upstreamFrame())
  }

  /** Run a read, keep the last good value on failure, and say what failed and what happens next. */
  const read = async <T>(
    label: string,
    every: string,
    get: () => Promise<T>,
    set: (r: Reading<T>) => void,
    prev: Reading<T>,
  ): Promise<void> => {
    try {
      set({ value: await get(), at: Date.now() })
    } catch (e) {
      const stale = prev.value !== undefined ? ' The value shown is the last good one.' : ''
      set({
        value: prev.value,
        at: prev.at,
        error: scrub(`${label} failed: ${(e as Error).message}. Retrying ${every}.${stale}`),
      })
    }
  }

  const rpc = async (method: string, params: unknown[]) =>
    getJson(deps.fetch, rpcUrl, rpcCall(method, params).body)

  const ping = (): Promise<void> =>
    read(
      'getSlot to Helius RPC',
      `in ${PING_EVERY_MS / 1000} s; if it keeps failing, check HELIUS_API_KEY`,
      async () => {
        const { body, ms } = await rpc('getSlot', [{ commitment: 'processed' }])
        const slot = parseSlot(body)
        pings.push(ms)
        if (pings.length > PING_WINDOW) pings.shift()
        const ws = s.slot.value?.slot
        if (ws !== undefined) s.slotLag = { value: { slots: slot - ws }, at: Date.now() }
        return {
          ms,
          p50Ms: rank(
            [...pings].sort((a, b) => a - b),
            50,
          ),
          samples: pings.length,
        }
      },
      (r) => (s.ping = r),
      s.ping,
    )
  const tps = (): Promise<void> =>
    read(
      'getRecentPerformanceSamples',
      `in ${TPS_EVERY_MS / 1000} s`,
      async () => parseTps((await rpc('getRecentPerformanceSamples', [1])).body),
      (r) => (s.tps = r),
      s.tps,
    )
  const tip = (): Promise<void> =>
    read(
      'Jito tip floor',
      `in ${MARKET_EVERY_MS / 1000} s`,
      async () => parseTipFloor((await getJson(deps.fetch, JITO_TIP_FLOOR)).body),
      (r) => (s.tipFloor = r),
      s.tipFloor,
    )
  const price = (): Promise<void> =>
    read(
      'Jupiter Price v3 for SOL',
      `in ${MARKET_EVERY_MS / 1000} s`,
      async () => parseSolPrice((await getJson(deps.fetch, SOL_PRICE)).body),
      (r) => (s.solPrice = r),
      s.solPrice,
    )
  const feesFor = async (accounts: string[]): Promise<Reading<Fees>> => {
    const k = accounts.join(',')
    const prev = fees.get(k) ?? {}
    if (prev.at !== undefined && Date.now() - prev.at < FEES_FRESH_MS) return prev
    let next: Reading<Fees> = prev
    await read(
      'getRecentPrioritizationFees',
      'on the next status request',
      async () => parseFees((await rpc('getRecentPrioritizationFees', [accounts])).body),
      (r) => (next = r),
      prev,
    )
    if (fees.size >= FEES_CACHE_MAX) fees.clear()
    fees.set(k, next)
    return next
  }

  const onSlot = (slot: number, parent: number, root: number): void => {
    const now = Date.now()
    heardAt = now
    s.slot = { value: { slot, parent, root }, at: now }
    if (s.upstream.state !== 'live') {
      attempt = 0
      setUpstream({ state: 'live', since: now })
    }
    send('slot', { slot, parent, root, receivedAt: iso(now) })
  }

  const drop = (cause: string): void => {
    socket = null
    if (!running) return
    const now = Date.now()
    if (attempt === 0) outageSince = now
    attempt += 1
    const wait = backoffMs(attempt)
    setUpstream(
      attempt > OFFLINE_AFTER
        ? {
            state: 'offline',
            since: outageSince,
            attempt,
            cause,
            next: `Retrying every ${wait / 1000} s. If it stays down, check HELIUS_API_KEY and the Helius status page.`,
          }
        : { state: 'reconnecting', since: outageSince, attempt, backoffMs: wait, cause },
    )
    retry = setTimeout(connect, wait)
  }

  function connect(): void {
    retry = null
    if (!running) return
    heardAt = Date.now()
    let ws: InstanceType<StreamDeps['WebSocket']>
    try {
      ws = new deps.WebSocket(rpcUrl.replace(/^https:/, 'wss:'))
    } catch (e) {
      drop(`the websocket could not be opened (${(e as Error).name})`)
      return
    }
    socket = ws
    ws.onopen = () => ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'slotSubscribe' }))
    ws.onmessage = (ev) => {
      if (socket !== ws) return
      let m: { method?: unknown; params?: { result?: Record<string, unknown> } }
      try {
        m = JSON.parse(String(ev.data)) as typeof m
      } catch {
        return
      }
      const r = m.params?.result
      if (m.method === 'slotNotification' && num(r?.['slot'])) {
        onSlot(r['slot'], num(r['parent']) ? r['parent'] : 0, num(r['root']) ? r['root'] : 0)
      }
    }
    // The close code only: a close reason is upstream text.
    ws.onclose = (ev) => {
      if (socket === ws) drop(`the websocket closed with code ${ev.code}`)
    }
    ws.onerror = () => {}
  }

  const stop = (): void => {
    running = false
    for (const t of timers) clearInterval(t)
    timers = []
    if (retry) clearTimeout(retry)
    retry = null
    const ws = socket
    socket = null
    ws?.close()
  }

  const tick = (): void => {
    const now = Date.now()
    if (clients.size === 0 && now - lastDemand > IDLE_MS) return stop()
    if (socket && now - heardAt > STALL_MS) {
      const ws = socket
      drop(`no slot event for ${Math.round((now - heardAt) / 1000)} s on an open websocket`)
      ws.close()
    }
    void ping()
  }

  const start = (): void => {
    lastDemand = Date.now()
    if (running) return
    running = true
    if (configError) {
      s.upstream = { state: 'offline', since: Date.now(), ...configError }
      for (const k of ['slot', 'ping', 'slotLag', 'tps', 'tipFloor', 'solPrice'] as const) {
        s[k] = { error: `${configError.cause}. ${configError.next}` }
      }
      return
    }
    attempt = 0
    s.upstream = { state: 'connecting', since: Date.now() }
    // A slot kept from before an idle stop would make the first lag hours wrong and look fresh.
    s.slot = { error: 'waiting for the first slotSubscribe event' }
    s.slotLag = { error: 'needs 1 getSlot answer and 1 slot event' }
    connect()
    timers = [
      setInterval(tick, PING_EVERY_MS),
      setInterval(() => void tps(), TPS_EVERY_MS),
      setInterval(() => void Promise.all([tip(), price()]), MARKET_EVERY_MS),
    ]
    ready = Promise.all([ping(), tps(), tip(), price()]).then(() => {})
  }

  return {
    stop,
    /** Every frame this subscriber will ever get goes through `write`. Returns the unsubscribe. */
    subscribe(write: (frame: string) => void): () => void {
      start()
      clients.add(write)
      write(scrub(`event: upstream\ndata: ${JSON.stringify(upstreamFrame())}\n\n`))
      const v = s.slot.value
      if (v && s.slot.at !== undefined) {
        write(`event: slot\ndata: ${JSON.stringify({ ...v, receivedAt: iso(s.slot.at) })}\n\n`)
      }
      return () => {
        clients.delete(write)
        lastDemand = Date.now()
      }
    },
    async statusBody(url: URL): Promise<{ code: number; body: string }> {
      const accounts = parseAccounts(url.searchParams.get('accounts'))
      if (!Array.isArray(accounts)) return { code: 400, body: JSON.stringify(accounts) }
      start()
      await ready
      const f: Reading<Fees> = configError
        ? { error: `${configError.cause}. ${configError.next}` }
        : await feesFor(accounts)
      const body = assembleStatus({ ...s, fees: f, accounts }, Date.now())
      return { code: 200, body: scrub(JSON.stringify(body)) }
    },
  }
}

let hub: ReturnType<typeof createStream> | null = null

/** The 2 routes. Returns false for any other request, so serve.ts carries on to its own. */
export const routeStream = (req: IncomingMessage, res: ServerResponse): boolean => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (req.method !== 'GET' || (url.pathname !== '/status' && url.pathname !== '/stream')) {
    return false
  }
  hub ??= createStream({
    rpcUrl: process.env['HELIUS_API_KEY'] ? rpcCall('getSlot', []).url : undefined,
    live: mode() !== 'replay',
    network: networkOf(process.env['AGON_NETWORK']).id,
    fetch,
    WebSocket: globalThis.WebSocket as unknown as StreamDeps['WebSocket'],
  })
  const h = hub
  if (url.pathname === '/status') {
    h.statusBody(url).then(
      ({ code, body }) => {
        res.writeHead(code, { 'content-type': 'application/json' })
        res.end(body)
      },
      (e: unknown) => {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            error: `The status could not be assembled (${(e as Error).name}). Ask again in ${PING_EVERY_MS / 1000} s.`,
          }),
        )
      },
    )
    return true
  }
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
  const unsubscribe = h.subscribe((frame) => res.write(frame))
  // A comment line every 15 s, so a proxy does not close a stream that is quiet while offline.
  const beat = setInterval(() => res.write(': keep-alive\n\n'), HEARTBEAT_MS)
  res.on('close', () => {
    clearInterval(beat)
    unsubscribe()
  })
  return true
}
