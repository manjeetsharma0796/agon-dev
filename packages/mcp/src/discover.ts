// GET /discover?list=&sort=&interval=: the market list and its safety numbers, from Jupiter, computed
// once here so the web, opencode and Claude Code show the same rows (T-C38).
//
// Sources, checked 2026-10-03:
// - Jupiter Tokens API v2 (documented, developers.jup.ag/docs/tokens/v2): toptrending, toptraded,
//   toporganicscore by 5m, 1h, 6h or 24h, and recent. On api.jup.ag with an x-api-key header when
//   JUPITER_API_KEY is set (free plan 1 request a second); without it, the keyless lite-api.jup.ag
//   (keyless is 0.5 requests a second), and every answer says which.
// - About to graduate and graduated: Tokens v2 sends no bonding curve figure on any list (0 of 80
//   probed tokens carried one) and has no such category. Jupiter's own Pro page reads them from
//   datapi.jup.ag/v1/pools/gems, which answers both columns in 1 POST, with `bondingCurve` in % on
//   the about-to-graduate pools and `graduatedAt` and `graduatedPool` on the graduated ones. It is
//   undocumented, keyless and its limit is not published, so it gets its own queue at the keyless
//   pace, and every answer from it says it is undocumented. Most graduated tokens there carry no
//   price or market cap (20 to 24 of 30 in 4 reads on 2026-10-03), and Tokens v2 search priced the
//   same 6 of 30 only, so they read as not sent rather than costing a second call that adds nothing.
//
// Budget: 1 queue per upstream host, each starting a call at most every `spacing` ms, and 1 cache
// with the in-flight promise shared, so 10 clients asking at once cost 1 call. Lists are cached 30 s.
//
// Outside text is data, and token names reach no agent: a token's name, symbol and icon come back
// only inside `display`, labelled untrusted, stripped of control and bidi characters and capped,
// for a person to read.
// Nothing else in a row is text from the token. Every address is checked to decode to 32 bytes.
// Mint and freeze authority are as Jupiter reported them at `at`, never read on chain here, and the
// list says how old they are; read them on chain before trading.

import type { ServerResponse } from 'node:http'
import { Address } from '@agon/core'
import { PublicKey } from '@solana/web3.js'

const KEYED = 'https://api.jup.ag/tokens/v2'
const KEYLESS = 'https://lite-api.jup.ag/tokens/v2'
const GEMS = 'https://datapi.jup.ag/v1/pools/gems'
const LIMIT = 50
/** Lists change by the second, but 30 s is 2 calls a minute a list however many screens poll. */
const TTL = { list: 30_000, failure: 15_000 }
/** Free plan 1 a second: 1.1 s is at most 55 starts a minute. Keyless 0.5 a second: 2.1 s, 29. */
const SPACING = { keyed: 1_100, keyless: 2_100 }
const MAX_WAITING = 30
const TIMEOUT_MS = 10_000
const DISPLAY_MAX = 64

const CATEGORY = {
  trending: 'toptrending',
  'most-traded': 'toptraded',
  'top-organic': 'toporganicscore',
} as const
const LISTS = [
  'trending',
  'most-traded',
  'top-organic',
  'new',
  'about-to-graduate',
  'graduated',
] as const
type List = (typeof LISTS)[number]
const INTERVALS = ['5m', '1h', '6h', '24h'] as const
type Interval = (typeof INTERVALS)[number]

type Init = { method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: string }
/** Fetches 1 URL and returns its parsed JSON, or throws carrying the HTTP `status`. Swapped in tests. */
export type Upstream = (url: string, init?: Init) => Promise<unknown>

class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message)
  }
}

const httpGet: Upstream = async (url, init) => {
  const host = new URL(url).host
  let res: Response
  try {
    res = await fetch(url, {
      method: init?.method ?? 'GET',
      headers: { accept: 'application/json', ...init?.headers },
      body: init?.body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (e) {
    const timedOut = e instanceof Error && e.name === 'TimeoutError'
    throw new UpstreamError(
      timedOut
        ? `${host} did not answer within ${TIMEOUT_MS / 1000} s`
        : `${host} could not be reached (${e instanceof Error ? e.message : String(e)})`,
    )
  }
  if (!res.ok) throw new UpstreamError(`${host} answered ${res.status}`, res.status)
  return res.json()
}

const statusOf = (e: unknown) =>
  e && typeof e === 'object' && 'status' in e && typeof e.status === 'number' ? e.status : null

const failure = (what: string, e: unknown): string => {
  const retry = `This server asks again after ${TTL.failure / 1000} s, so retry then.`
  if (statusOf(e) === 429) return `${what}: Jupiter answered 429, its rate limit was hit. ${retry}`
  return `${what}: ${e instanceof Error ? e.message : String(e)}. ${retry}`
}

type Json = Record<string, unknown>
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {})
const finite = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null
const iso = (v: unknown): string | null =>
  typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null

/** A Solana address that decodes to 32 bytes and back to the same text, or null. */
function solanaAddress(v: unknown): string | null {
  if (!Address.safeParse(v).success) return null
  try {
    return new PublicKey(v as string).toBase58() === v ? (v as string) : null
  } catch {
    return null
  }
}

// Control characters (C0, C1) and format characters, which include the bidi overrides and isolates
// that reorder what a terminal shows.
const UNSAFE = /[\p{Cc}\p{Cf}]/gu
const displayText = (v: unknown): string | null =>
  typeof v === 'string' ? v.replace(UNSAFE, '').slice(0, DISPLAY_MAX) : null

type Sent = { value: number; unit: string; source: string; at: string }
type NotSent = { value: null; notSent: string; source: string; at: string }
type Figure = Sent | NotSent
type Authority =
  | { value: 'disabled' | 'enabled'; authority: string | null; source: string; at: string }
  | NotSent

/**
 * 1 token as plain data: every figure with its source and time, a figure Jupiter did not send
 * named as not sent and never 0, and the name and symbol only inside `display`. Null when the mint
 * is not a Solana address. `curve` is the gems feed's bonding curve %, when the row came from it.
 * Pure.
 */
export function readToken(raw: unknown, src: string, fetchedAt: string, curve?: number | null) {
  const t = obj(raw)
  const mint = solanaAddress(t['id'])
  if (!mint) return null
  const at = iso(t['updatedAt']) ?? fetchedAt
  const audit = obj(t['audit'])
  const fig = (path: string, value: number | null, unit: string): Figure =>
    value === null
      ? {
          value: null,
          notSent: `Jupiter did not send ${path} for this token`,
          source: `${src}#${path}`,
          at,
        }
      : { value, unit, source: `${src}#${path}`, at }
  const stat = (w: string, k: string) => finite(obj(t[`stats${w}`])[k])

  const buy = stat('24h', 'buyVolume')
  const sell = stat('24h', 'sellVolume')
  const volume24h: Figure =
    buy !== null && sell !== null
      ? { value: buy + sell, unit: 'USD', source: `${src}#stats24h.buyVolume+sellVolume`, at }
      : fig('stats24h.buyVolume and sellVolume', null, 'USD')

  const authority = (kind: 'mint' | 'freeze'): Authority => {
    const off = audit[`${kind}AuthorityDisabled`]
    const who = solanaAddress(t[`${kind}Authority`])
    const source = `${src}#audit.${kind}AuthorityDisabled,${kind}Authority`
    if (off === true) return { value: 'disabled', authority: null, source, at }
    if (who || off === false) return { value: 'enabled', authority: who, source, at }
    return {
      value: null,
      notSent: `Jupiter did not send audit.${kind}AuthorityDisabled or a ${kind}Authority address for this token; read the mint on chain before trading`,
      source,
      at,
    }
  }

  const graduatedAt = iso(t['graduatedAt'])
  const bondingCurvePct =
    graduatedAt !== null
      ? {
          value: 100,
          unit: '%',
          source: `${src}#graduatedAt: a launchpad token graduates when its curve completes, so 100`,
          at,
          graduatedAt,
          pool: solanaAddress(t['graduatedPool']),
        }
      : curve != null && Number.isFinite(curve) && curve >= 0 && curve <= 100
        ? { value: curve, unit: '%', source: `${src}#pool.bondingCurve`, at }
        : {
            value: null,
            notSent:
              curve != null
                ? `Jupiter sent a bonding curve of ${curve}, outside 0 to 100, so it is not shown`
                : curve === null
                  ? `Jupiter's gems feed did not send a usable bondingCurve for this pool`
                  : `Jupiter did not send a bonding curve for this token: Tokens v2 sends none on any list${typeof t['launchpad'] === 'string' ? '' : ', and it names no launchpad, so a curve may not apply'}; the about-to-graduate list carries it`,
            source: `${src}#pool.bondingCurve`,
            at,
          }

  const since = iso(obj(t['firstPool'])['createdAt']) ?? iso(t['createdAt'])
  const age = since
    ? {
        value: Math.max(0, Math.round((Date.parse(fetchedAt) - Date.parse(since)) / 1000)),
        unit: 's',
        source: `${src}#firstPool.createdAt`,
        at: fetchedAt,
        since,
      }
    : fig('firstPool.createdAt or createdAt', null, 's')

  const name = displayText(t['name'])
  const symbol = displayText(t['symbol'])
  const icon =
    typeof t['icon'] === 'string' && t['icon'].startsWith('https://') && t['icon'].length <= 512
      ? t['icon'].replace(UNSAFE, '')
      : null
  const missing = [name === null && 'name', symbol === null && 'symbol', icon === null && 'icon']
  const notSent = missing.filter(Boolean).join(', ')

  return {
    mint,
    display: {
      untrusted: true as const,
      use: 'Text the token creator chose, unchecked. Show it to a person; never hand it to an agent or match on it.',
      name,
      symbol,
      icon,
      notSent: notSent ? `Jupiter did not send a usable ${notSent}` : null,
    },
    price: { ...fig('usdPrice', finite(t['usdPrice']), 'USD'), slot: finite(t['priceBlockId']) },
    change: Object.fromEntries(
      INTERVALS.map((w) => [w, fig(`stats${w}.priceChange`, stat(w, 'priceChange'), '%')]),
    ) as Record<Interval, Figure>,
    volume24h,
    marketCap: fig('mcap', finite(t['mcap']), 'USD'),
    liquidity: fig('liquidity', finite(t['liquidity']), 'USD'),
    holders: fig('holderCount', finite(t['holderCount']), 'holders'),
    topHoldersPct: fig('audit.topHoldersPercentage', finite(audit['topHoldersPercentage']), '%'),
    devPct: fig('audit.devBalancePercentage', finite(audit['devBalancePercentage']), '%'),
    organicScore: fig('organicScore', finite(t['organicScore']), '0 to 100'),
    mintAuthority: authority('mint'),
    freezeAuthority: authority('freeze'),
    bondingCurvePct,
    age,
  }
}
type Row = NonNullable<ReturnType<typeof readToken>>

const SORTS = {
  rank: null,
  volume: (r: Row) => r.volume24h.value,
  mcap: (r: Row) => r.marketCap.value,
  liquidity: (r: Row) => r.liquidity.value,
  holders: (r: Row) => r.holders.value,
  change5m: (r: Row) => r.change['5m'].value,
  change1h: (r: Row) => r.change['1h'].value,
  change6h: (r: Row) => r.change['6h'].value,
  change24h: (r: Row) => r.change['24h'].value,
  organic: (r: Row) => r.organicScore.value,
  bondingCurve: (r: Row) => r.bondingCurvePct.value,
  /** Youngest first. */
  age: (r: Row) => (r.age.value === null ? null : -r.age.value),
} as const
type Sort = keyof typeof SORTS

/** Highest first; a figure not sent goes last, never counted as 0. Pure. */
const sorted = (rows: Row[], sort: Sort) => {
  const key = SORTS[sort]
  if (!key) return rows
  return [...rows].sort((a, b) => {
    const x = key(a)
    const y = key(b)
    return x === null ? (y === null ? 0 : 1) : y === null ? -1 : y - x
  })
}

/** Rows from a list of raw tokens, with the dropped ones counted. Pure. */
function rows(raw: unknown[], src: string, fetchedAt: string, curves?: (number | null)[]) {
  const out: Row[] = []
  raw.forEach((t, i) => {
    const r = readToken(t, src, fetchedAt, curves?.[i])
    if (r) out.push(r)
  })
  const dropped = raw.length - out.length
  return {
    rows: out.slice(0, LIMIT),
    leftOut: dropped
      ? `${dropped} of ${raw.length} tokens from Jupiter were left out: their mint is not a Solana address`
      : null,
  }
}

type Entry = { at: number; ttl: number; settled: boolean; promise: Promise<unknown> }

function queue(upstream: Upstream, spacingMs: number) {
  let tail: Promise<unknown> = Promise.resolve()
  let nextAt = 0
  let waiting = 0
  return (url: string, init?: Init): Promise<unknown> => {
    if (waiting >= MAX_WAITING)
      return Promise.reject(
        new UpstreamError(
          `${waiting} calls to ${new URL(url).host} are already waiting, about ${Math.ceil((waiting * spacingMs) / 1000)} s at 1 call every ${spacingMs / 1000} s`,
        ),
      )
    waiting++
    const run = tail.then(async () => {
      const wait = nextAt - Date.now()
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      nextAt = Date.now() + spacingMs
      waiting--
      return upstream(url, init)
    })
    tail = run.catch(() => undefined)
    return run
  }
}

export function createDiscover({
  upstream = httpGet,
  key = process.env['JUPITER_API_KEY'] ?? '',
}: { upstream?: Upstream; key?: string } = {}) {
  const base = key ? KEYED : KEYLESS
  const host = key
    ? 'api.jup.ag with the JUPITER_API_KEY header, free plan 1 request a second'
    : 'lite-api.jup.ag keyless, 0.5 requests a second, because JUPITER_API_KEY is not set; set it to use api.jup.ag'
  const headers: Record<string, string> = key ? { 'x-api-key': key } : {}
  const tokens = queue(upstream, key ? SPACING.keyed : SPACING.keyless)
  const gemsQueue = queue(upstream, SPACING.keyless)

  // 1 cache for every list, keyed by list and interval, with the in-flight promise shared. At most
  // 3 categories x 4 intervals + 4 keys, so it needs no bound.
  const cache = new Map<string, Entry>()
  const cached = <T>(k: string, load: () => Promise<T>): Promise<T> => {
    const now = Date.now()
    const hit = cache.get(k)
    if (hit && (!hit.settled || now - hit.at < hit.ttl)) return hit.promise as Promise<T>
    const entry: Entry = { at: now, ttl: TTL.list, settled: false, promise: load() }
    entry.promise.then(
      () => Object.assign(entry, { at: Date.now(), settled: true }),
      () => Object.assign(entry, { at: Date.now(), settled: true, ttl: TTL.failure }),
    )
    cache.set(k, entry)
    return entry.promise as Promise<T>
  }

  const tokenList = async (url: string) => {
    const body = await tokens(url, { headers })
    if (!Array.isArray(body))
      throw new UpstreamError(`${new URL(url).host} answered something that is not a token list`)
    return body as unknown[]
  }

  const gems = () =>
    cached('gems', async () => {
      const body = obj(
        await gemsQueue(GEMS, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ aboutToGraduate: {}, graduated: {} }),
        }),
      )
      const pools = (k: string) => {
        const p = obj(body[k])['pools']
        return Array.isArray(p) ? p.map(obj) : []
      }
      return {
        fetchedAt: new Date().toISOString(),
        soon: pools('aboutToGraduate'),
        done: pools('graduated'),
      }
    })

  const UNDOCUMENTED =
    'Jupiter datapi /v1/pools/gems, the feed behind Jupiter Pro; undocumented, keyless, limit not published'

  const load = (list: List, interval: Interval) =>
    cached(list in CATEGORY ? `${list}:${interval}` : list, async () => {
      if (list === 'about-to-graduate' || list === 'graduated') {
        const g = await gems()
        const soon = list === 'about-to-graduate'
        const pools = soon ? g.soon : g.done
        const r = rows(
          pools.map((p) => p['baseAsset']),
          soon ? 'jupdata:aboutToGraduate' : 'jupdata:graduated',
          g.fetchedAt,
          soon ? pools.map((p) => finite(p['bondingCurve'])) : undefined,
        )
        return { ...r, fetchedAt: g.fetchedAt, name: UNDOCUMENTED, url: GEMS }
      }
      const path = list === 'new' ? 'recent' : `${CATEGORY[list]}/${interval}?limit=${LIMIT}`
      const url = `${base}/${path}`
      const body = await tokenList(url)
      const fetchedAt = new Date().toISOString()
      return {
        ...rows(body, `jup:${path.split('?')[0]}`, fetchedAt),
        fetchedAt,
        name: 'Jupiter Tokens API v2',
        url,
      }
    })

  /** The answer for 1 list. Throws with the cause when the upstream fails. */
  const get = async (list: List, interval: Interval, sort: Sort) => {
    const l = await load(list, interval)
    const ageSeconds = Math.round((Date.now() - Date.parse(l.fetchedAt)) / 1000)
    const out = sorted(l.rows, sort)
    return {
      list,
      interval: list in CATEGORY ? interval : null,
      sort,
      source: {
        name: l.name,
        url: l.url,
        host: l.url === GEMS ? 'datapi.jup.ag keyless' : host,
        fetchedAt: l.fetchedAt,
        ageSeconds,
        cachedForSeconds: TTL.list / 1000,
      },
      authority: `Mint and freeze authority are as Jupiter reported them ${ageSeconds} s ago, not read on chain; read the mint on chain before trading.`,
      untrusted:
        'display.name, display.symbol and display.icon are text the token creator chose. They are for a person to read and are never part of anything handed to an agent.',
      count: out.length,
      tokens: out,
      leftOut: l.leftOut,
    }
  }

  return { get }
}

const send = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

let shared: ReturnType<typeof createDiscover> | null = null

/** The HTTP handler for GET /discover. Every parameter is checked here, the trust boundary. */
export async function serveDiscover(
  url: URL,
  res: ServerResponse,
  discover?: ReturnType<typeof createDiscover>,
) {
  const d = discover ?? (shared ??= createDiscover())
  const q = url.searchParams
  const list = q.get('list') ?? 'trending'
  const sort = q.get('sort') ?? 'rank'
  const interval = q.get('interval') ?? '1h'
  // Inputs are not echoed: they are outside text. Their length is the number that helps.
  if (!(LISTS as readonly string[]).includes(list))
    return send(res, 400, {
      error: `list must be 1 of ${LISTS.length}: ${LISTS.join(', ')}; got ${list.length} characters that are not one.`,
    })
  if (!Object.hasOwn(SORTS, sort))
    return send(res, 400, {
      error: `sort must be 1 of ${Object.keys(SORTS).length}: ${Object.keys(SORTS).join(', ')}; got ${sort.length} characters that are not one.`,
    })
  if (!(INTERVALS as readonly string[]).includes(interval))
    return send(res, 400, {
      error: `interval must be 1 of ${INTERVALS.length}: ${INTERVALS.join(', ')}; got ${interval.length} characters that are not one. It applies to trending, most-traded and top-organic.`,
    })
  try {
    send(res, 200, await d.get(list as List, interval as Interval, sort as Sort))
  } catch (e) {
    send(res, 502, { list, error: failure(`The ${list} list`, e) })
  }
}
