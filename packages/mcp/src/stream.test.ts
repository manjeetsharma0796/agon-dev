import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  assembleStatus,
  backoffMs,
  createStream,
  OFFLINE_AFTER,
  parseAccounts,
  parseFees,
  parseSlot,
  parseSolPrice,
  parseTipFloor,
  parseTps,
  type StreamDeps,
} from './stream.js'

// Sample answers in the shape each upstream returns them. The numbers are made up; the shapes are
// copied from real answers seen while measuring this task.
const SLOT_ANSWER = { jsonrpc: '2.0', id: 1, result: 371_000_123 }
const PERF_ANSWER = {
  jsonrpc: '2.0',
  id: 1,
  result: [
    {
      slot: 371_000_100,
      numSlots: 150,
      numTransactions: 240_000,
      numNonVoteTransactions: 60_000,
      samplePeriodSecs: 60,
    },
  ],
}
const FEES_ANSWER = {
  jsonrpc: '2.0',
  id: 1,
  result: [0, 0, 100, 200, 300, 400, 500, 600, 1000, 50_000].map((fee, i) => ({
    slot: 371_000_000 + i,
    prioritizationFee: fee,
  })),
}
const TIP_ANSWER = [
  {
    time: '2026-10-03T10:00:00Z',
    landed_tips_25th_percentile: 0.000001,
    landed_tips_50th_percentile: 0.00001,
    landed_tips_75th_percentile: 0.0001,
    landed_tips_95th_percentile: 0.001,
    landed_tips_99th_percentile: 0.01,
    ema_landed_tips_50th_percentile: 0.000012,
  },
]
const SOL = 'So11111111111111111111111111111111111111112'
const PRICE_ANSWER = { [SOL]: { usdPrice: 151.25, blockId: 371_000_090, decimals: 9 } }

test('backoff doubles from 1 s and stops at 30 s', () => {
  expect([1, 2, 3, 4, 5, 6, 7, 20].map(backoffMs)).toEqual([
    1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000,
  ])
  // Offline is the attempt where the wait reaches its cap, so "reconnecting" never sits at 30 s.
  expect(backoffMs(OFFLINE_AFTER)).toBeLessThan(30000)
  expect(backoffMs(OFFLINE_AFTER + 1)).toBe(30000)
})

test('the parsers read the sample answers as arithmetic', () => {
  expect(parseSlot(SLOT_ANSWER)).toBe(371_000_123)
  expect(parseTps(PERF_ANSWER)).toEqual({
    total: 4000,
    nonVote: 1000,
    periodSecs: 60,
    sampleSlot: 371_000_100,
  })
  // Nearest rank over 10 values: p25 is the 3rd, p50 the 5th, p75 the 8th, p95 the 10th.
  expect(parseFees(FEES_ANSWER)).toEqual({
    microLamportsPerCu: { min: 0, p25: 100, p50: 300, p75: 600, p95: 50_000, max: 50_000 },
    slots: 10,
  })
  expect(parseTipFloor(TIP_ANSWER)).toEqual({
    p25: 1000,
    p50: 10_000,
    p75: 100_000,
    p95: 1_000_000,
    p99: 10_000_000,
    ema50: 12_000,
  })
  expect(parseSolPrice(PRICE_ANSWER)).toEqual({ usd: 151.25, blockId: 371_000_090 })
})

test('a parser refuses an answer it cannot read, and says what it got', () => {
  expect(() => parseSlot({ error: { code: -32600, message: 'x' } })).toThrow(/RPC error -32600/)
  expect(() => parseSlot({ result: 'soon' })).toThrow(/no slot number/)
  expect(() => parseTps({ result: [] })).toThrow(/0 performance samples/)
  expect(() => parseTipFloor([{ landed_tips_50th_percentile: -1 }])).toThrow(/tip floor/)
  expect(() => parseSolPrice({})).toThrow(/no usdPrice/)
})

test('status is assembled from readings, each with its age and source', () => {
  const now = 1_000_000
  const status = assembleStatus(
    {
      network: 'mainnet',
      upstream: { state: 'live', since: now - 60_000 },
      slot: { value: { slot: 371_000_124, parent: 371_000_123, root: 371_000_092 }, at: now - 300 },
      ping: { value: { ms: 41, p50Ms: 40, samples: 20 }, at: now - 2000 },
      slotLag: { value: { slots: 1 }, at: now - 2000 },
      tps: { value: parseTps(PERF_ANSWER), at: now - 30_000 },
      fees: { value: parseFees(FEES_ANSWER), at: now - 5000 },
      tipFloor: { value: parseTipFloor(TIP_ANSWER), at: now - 4000 },
      solPrice: { error: 'Jupiter Price v3 failed: HTTP 503 after 120 ms. Retrying in 10 s.' },
      accounts: [],
    },
    now,
  )
  expect(status.dataSlot).toBe(371_000_124)
  expect(status.upstream).toEqual({ state: 'live', since: new Date(now - 60_000).toISOString() })
  expect(status.slot).toMatchObject({ value: { slot: 371_000_124 }, ageMs: 300 })
  expect(status.ping).toMatchObject({ value: { ms: 41, p50Ms: 40 }, ageMs: 2000 })
  expect(status.tps).toMatchObject({ value: { total: 4000 }, ageMs: 30_000 })
  expect(status.jitoTipFloor).toMatchObject({ value: { p50: 10_000 }, ageMs: 4000 })
  // A failed reading carries its cause and no invented value or age.
  expect(status.solPrice).toEqual({
    source: expect.stringMatching(/Jupiter Price v3/),
    error: expect.stringMatching(/HTTP 503 after 120 ms/),
  })
  // Every reading names where it came from.
  for (const k of ['slot', 'ping', 'slotLag', 'tps', 'priorityFee', 'jitoTipFloor', 'solPrice']) {
    expect((status as unknown as Record<string, { source: string }>)[k]?.source).toBeTruthy()
  }
  // No accounts, so the answer warns that it reads 0.
  expect(status.priorityFee.note).toMatch(/no accounts/i)
  expect(status.priorityFee.note).toMatch(/0/)
})

test('accounts are base58 addresses, at most 128, and a bad one is refused by position', () => {
  expect(parseAccounts(null)).toEqual([])
  expect(parseAccounts(`${SOL},${SOL}`)).toEqual([SOL, SOL])
  expect(parseAccounts(`${SOL},0OIl`)).toEqual({ error: expect.stringMatching(/account 2 /) })
  expect(parseAccounts(Array(129).fill(SOL).join(','))).toEqual({
    error: expect.stringMatching(/129 .* at most 128/),
  })
})

// The hub, with a fake upstream. A real key never enters this file; a recognisable fake one does,
// and every byte the hub hands out is scanned for it.
const KEY = 'test-key-5f3a9c-do-not-leak'

class FakeSocket {
  static last: FakeSocket | null = null
  static opened = 0
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onclose: ((ev: { code: number; reason: string }) => void) | null = null
  onerror: (() => void) | null = null
  sent: string[] = []
  constructor(readonly url: string) {
    FakeSocket.last = this
    FakeSocket.opened += 1
  }
  send(data: string): void {
    this.sent.push(data)
  }
  close(): void {}
  slot(slot: number): void {
    this.onmessage?.({
      data: JSON.stringify({
        jsonrpc: '2.0',
        method: 'slotNotification',
        params: { result: { slot, parent: slot - 1, root: slot - 32 }, subscription: 7 },
      }),
    })
  }
  drop(): void {
    // A provider can put anything in a close reason, including the URL it was called on.
    this.onclose?.({ code: 1006, reason: `closed wss://x/?api-key=${KEY}` })
  }
}

/** A fetch that answers every RPC method from the samples, or fails while leaking the URL. */
const fakeFetch =
  (fail: boolean): typeof fetch =>
  async (input, init) => {
    const url = String(input)
    if (fail) throw new TypeError(`fetch to ${url} failed`, { cause: { code: 'ECONNRESET' } })
    const method = init?.body ? (JSON.parse(String(init.body)) as { method: string }).method : ''
    const body =
      method === 'getSlot'
        ? SLOT_ANSWER
        : method === 'getRecentPerformanceSamples'
          ? PERF_ANSWER
          : method === 'getRecentPrioritizationFees'
            ? FEES_ANSWER
            : url.includes('tip_floor')
              ? TIP_ANSWER
              : url.includes('price')
                ? PRICE_ANSWER
                : { error: { code: -32601, message: `unknown, key ${KEY}` } }
    return new Response(JSON.stringify(body), { status: 200 })
  }

const deps = (fail = false): StreamDeps => ({
  rpcUrl: `https://mainnet.helius-rpc.com/?api-key=${KEY}`,
  live: true,
  network: 'mainnet',
  fetch: fakeFetch(fail),
  WebSocket: FakeSocket as unknown as StreamDeps['WebSocket'],
})

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 })
  FakeSocket.last = null
  FakeSocket.opened = 0
})
afterEach(() => {
  vi.useRealTimers()
})

test('the Helius key appears 0 times in any status body or stream frame', async () => {
  for (const fail of [false, true]) {
    const hub = createStream(deps(fail))
    const frames: string[] = []
    const unsubscribe = hub.subscribe((f) => frames.push(f))
    const socket = FakeSocket.last!
    // The websocket URL is the one place the key must be, since that is how Helius takes it.
    expect(socket.url).toContain(KEY)
    socket.onopen?.()
    socket.slot(371_000_124)
    socket.drop()
    await vi.advanceTimersByTimeAsync(1000)
    FakeSocket.last!.slot(371_000_125)
    const bodies = [
      await hub.statusBody(new URL('http://x/status')),
      await hub.statusBody(new URL(`http://x/status?accounts=${SOL}`)),
      await hub.statusBody(new URL('http://x/status?accounts=bad')),
    ]
    unsubscribe()
    hub.stop()
    const everything = [...frames, ...bodies.map((b) => b.body)].join('\n')
    expect(frames.length, 'the stream carried nothing to scan').toBeGreaterThan(3)
    expect(everything.split(KEY).length - 1, `key found with fail=${fail}`).toBe(0)
  }
})

test('a dropped upstream reconnects with backoff, counts attempts, and goes offline after 5', async () => {
  const hub = createStream(deps())
  const frames: string[] = []
  hub.subscribe((f) => frames.push(f))
  FakeSocket.last!.onopen?.()
  FakeSocket.last!.slot(371_000_124)
  const upstream = async () =>
    (JSON.parse((await hub.statusBody(new URL('http://x/status'))).body) as { upstream: unknown })
      .upstream
  expect(await upstream()).toMatchObject({ state: 'live' })

  const outageStart = Date.now()
  for (let attempt = 1; attempt <= OFFLINE_AFTER; attempt++) {
    FakeSocket.last!.drop()
    expect(await upstream()).toMatchObject({
      state: 'reconnecting',
      attempt,
      backoffMs: backoffMs(attempt),
      cause: expect.stringMatching(/code 1006/),
    })
    const before = FakeSocket.opened
    await vi.advanceTimersByTimeAsync(backoffMs(attempt) - 1)
    expect(FakeSocket.opened, 'reconnected before the backoff ran out').toBe(before)
    await vi.advanceTimersByTimeAsync(1)
    expect(FakeSocket.opened).toBe(before + 1)
  }
  FakeSocket.last!.drop()
  // Offline since the outage began, not since the attempt that crossed the line.
  expect(await upstream()).toMatchObject({
    state: 'offline',
    since: new Date(outageStart).toISOString(),
    attempt: OFFLINE_AFTER + 1,
    next: expect.stringMatching(/30 s/),
  })

  // A slot after reconnecting is what proves it is live again, and resets the count.
  await vi.advanceTimersByTimeAsync(30_000)
  FakeSocket.last!.slot(371_000_200)
  expect(await upstream()).toMatchObject({ state: 'live' })
  expect(frames.some((f) => f.startsWith('event: upstream') && f.includes('"reconnecting"'))).toBe(
    true,
  )
  expect(frames.filter((f) => f.startsWith('event: slot')).length).toBe(2)
  hub.stop()
})

test('a socket that stays open but sends no slot is treated as dropped', async () => {
  const hub = createStream(deps())
  hub.subscribe(() => {})
  FakeSocket.last!.onopen?.()
  FakeSocket.last!.slot(371_000_124)
  await vi.advanceTimersByTimeAsync(15_000)
  const body = JSON.parse((await hub.statusBody(new URL('http://x/status'))).body) as {
    upstream: { state: string; cause: string }
  }
  expect(body.upstream.state).toBe('reconnecting')
  expect(body.upstream.cause).toMatch(/no slot event for \d+ s/)
  hub.stop()
})

test('replay mode or a missing key is offline with the cause, and makes 0 network calls', async () => {
  let calls = 0
  const counting: typeof fetch = async () => {
    calls += 1
    return new Response('{}')
  }
  for (const d of [
    { ...deps(), live: false, fetch: counting },
    { ...deps(), rpcUrl: undefined, fetch: counting },
  ]) {
    const hub = createStream(d)
    const { code, body } = await hub.statusBody(new URL('http://x/status'))
    hub.stop()
    expect(code).toBe(200)
    const s = JSON.parse(body) as { upstream: { state: string; cause: string; next: string } }
    expect(s.upstream.state).toBe('offline')
    expect(s.upstream.cause).toMatch(d.live ? /HELIUS_API_KEY/ : /AGON_NET_MODE/)
    expect(s.upstream.next).toBeTruthy()
  }
  expect(calls).toBe(0)
  expect(FakeSocket.opened).toBe(0)
})

test('bad accounts are a 400 that names the position and the fix', async () => {
  const hub = createStream(deps())
  const { code, body } = await hub.statusBody(new URL('http://x/status?accounts=,'))
  hub.stop()
  expect(code).toBe(400)
  expect(JSON.parse(body)).toEqual({ error: expect.stringMatching(/account 1 .*comma separated/) })
})
