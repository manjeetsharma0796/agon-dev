// GET /logo?mint=&size=: a token's logo as a small PNG, so the terminal plugins show logos without
// calling any host but the Agon server (T-C39).
//
// A logo is a URL the token creator chose, so this file treats it as hostile:
// - The request names a mint, never a URL. The icon URL is the one /discover already holds for that
//   mint (Jupiter's `icon`, kept only inside `display`), looked up here and never read from the request.
// - This server never connects to the icon's host. It asks 1 fixed image proxy, wsrv.nl, the one the
//   plugins used before, to fetch and resize it. The outbound host is pinned; the icon host is reached
//   by the proxy, not by us, so a creator cannot point this server at its own network.
// - Before even asking the proxy, an icon URL that is not https, is over 512 characters, carries a
//   user name, a password or a port, or names an IP literal, localhost or a private or single-label
//   host is refused.
// - The proxy's answer is read up to 256 KB and no further, and served only when its content type is
//   image/png, it starts with the PNG signature and its IHDR says at most 64 by 64.
// - Errors name the cause and never echo the icon URL, which is creator text.
//
// Cost: 1 cache by mint and size (bounded, the in-flight promise shared, a logo kept 6 h since it
// changes rarely, a failure 5 min) and 1 queue to the proxy, starting a fetch at most every 100 ms.

import type { ServerResponse } from 'node:http'
import { Address } from '@agon/core'
import type { createDiscover } from './discover.js'

type Discover = ReturnType<typeof createDiscover>
type Get = Discover['get']

const PROXY = 'https://wsrv.nl/'
const MAX_URL = 512
const MAX_BYTES = 256 * 1024
const MAX_SIDE = 64
const TTL = { logo: 6 * 3_600_000, failure: 300_000 }
/**
 * A mint not in the index asks the lists again at most this often: 9 lists cost 7 upstream calls,
 * and a client asking for random mints must not spend /discover's Jupiter budget.
 */
const REFRESH_MS = 300_000
const SPACING_MS = 100
const MAX_WAITING = 256
const TIMEOUT_MS = 10_000
const MAX_ENTRIES = 512
const MAX_ICONS = 4096
const NEXT = 'The client draws the first letter instead.'
/** The lists a miss refreshes: what the plugins show (opencode at 1h, Claude Code at 24h). */
const LISTS: Parameters<Get>[] = [
  ['trending', '24h', 'rank'],
  ['most-traded', '24h', 'rank'],
  ['top-organic', '24h', 'rank'],
  ['trending', '1h', 'rank'],
  ['most-traded', '1h', 'rank'],
  ['top-organic', '1h', 'rank'],
  ['new', '1h', 'rank'],
  ['about-to-graduate', '1h', 'rank'],
  ['graduated', '1h', 'rank'],
]

/** Why this server will not ask the proxy for `icon`, or null when it will. Pure. */
export function iconRefusal(icon: string): string | null {
  if (icon.length > MAX_URL)
    return `its icon URL is ${icon.length} characters, over the ${MAX_URL} this server fetches`
  let u: URL
  try {
    u = new URL(icon)
  } catch {
    return 'its icon URL does not parse as a URL'
  }
  if (u.protocol !== 'https:') return `its icon URL is ${u.protocol.slice(0, 10)}, not https`
  if (u.username || u.password) return 'its icon URL carries a user name or password'
  if (u.port) return 'its icon URL names a port; only the https default is fetched'
  // The URL parser has already turned 0x7f.1 and 2130706433 into 127.0.0.1, and IPv6 keeps its brackets.
  const host = u.hostname.toLowerCase().replace(/\.$/, '')
  if (host.startsWith('[') || /^[\d.]+$/.test(host))
    return 'its icon URL names an IP address, not a host name'
  if (host === 'localhost' || host.endsWith('.localhost')) return 'its icon URL names localhost'
  if (!host.includes('.') || /\.(local|internal|lan|intranet|home\.arpa)$/.test(host))
    return 'its icon URL names a private or single-label host'
  return null
}

// ipfs.io and the other public gateways refuse the proxy (a quarter of trending logos never loaded
// in T-E26); Filebase served 12 of 12 through it on 2026-10-01.
const IPFS = /^https:\/\/[^/]+\/ipfs\/(.+)$/

/** The 1 URL this server fetches for an icon: wsrv.nl, the icon URL encoded inside it. Pure. */
export function proxyUrl(icon: string, size: number): string {
  const ipfs = IPFS.exec(icon)
  const src = ipfs ? `https://ipfs.filebase.io/ipfs/${ipfs[1]}` : icon
  // Level 0: stored deflate blocks, so a client with no zlib can still read the pixels.
  return `${PROXY}?url=${encodeURIComponent(src)}&w=${size}&h=${size}&fit=cover&output=png&l=0`
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** Why `b` is not a PNG of at most 64 by 64, or null. Reads the signature and IHDR only. Pure. */
export function checkPng(b: Uint8Array): string | null {
  if (SIGNATURE.some((v, i) => b[i] !== v))
    return 'the answer is not a PNG: its first 8 bytes are not the PNG signature'
  if (b.length < 33) return `the answer is ${b.length} bytes, too short for a PNG`
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  if (dv.getUint32(8) !== 13 || String.fromCharCode(...b.subarray(12, 16)) !== 'IHDR')
    return 'the answer is not a PNG: its first chunk is not IHDR'
  const w = dv.getUint32(16)
  const h = dv.getUint32(20)
  if (w < 1 || h < 1 || w > MAX_SIDE || h > MAX_SIDE)
    return `the PNG is ${w} by ${h}, outside 1 by 1 to ${MAX_SIDE} by ${MAX_SIDE}`
  return null
}

/** The body of `res`, or a throw once it passes 256 KB, without reading the rest. */
export async function readCapped(res: Response): Promise<Uint8Array> {
  const over = `the image proxy sent more than ${MAX_BYTES / 1024} KB, so the fetch was stopped`
  if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) {
    await res.body?.cancel()
    throw new Error(over)
  }
  const parts: Uint8Array[] = []
  let total = 0
  const reader = res.body?.getReader()
  if (!reader) return new Uint8Array(0)
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > MAX_BYTES) {
      await reader.cancel()
      throw new Error(over)
    }
    parts.push(value)
  }
  return Buffer.concat(parts)
}

/** Fetches 1 proxy URL: its content type and its body up to 256 KB. Swapped in tests. */
export type Proxy = (url: string) => Promise<{ contentType: string | null; body: Uint8Array }>

const viaWsrv: Proxy = async (url) => {
  let res: Response
  try {
    // No redirect is followed: the proxy is the only host this server reaches for a logo.
    res = await fetch(url, {
      redirect: 'error',
      headers: { accept: 'image/png' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (e) {
    // The error text can carry the URL, so only its kind is named.
    const code = (e as { cause?: { code?: unknown } })?.cause?.code
    throw new Error(
      e instanceof Error && e.name === 'TimeoutError'
        ? `wsrv.nl did not answer within ${TIMEOUT_MS / 1000} s`
        : `wsrv.nl could not be reached${typeof code === 'string' ? ` (${code.slice(0, 20)})` : ''}`,
    )
  }
  if (!res.ok) {
    await res.body?.cancel()
    throw new Error(
      `wsrv.nl answered ${res.status}${res.status === 404 ? ', it could not fetch or read the icon' : ''}`,
    )
  }
  return { contentType: res.headers.get('content-type'), body: await readCapped(res) }
}

/** A full queue: answered 503 and never cached, so the client simply asks again. */
class Busy extends Error {}
type Result = { ok: true; png: Uint8Array } | { ok: false; error: string; busy?: true }
type Entry = { at: number; ttl: number; settled: boolean; promise: Promise<Result> }

export function createLogos({
  discover,
  proxy = viaWsrv,
  maxEntries = MAX_ENTRIES,
  maxWaiting = MAX_WAITING,
}: {
  discover: Discover
  proxy?: Proxy
  maxEntries?: number
  maxWaiting?: number
}) {
  // mint -> icon URL (null: Jupiter sent none usable), from every /discover answer this server made.
  const icons = new Map<string, string | null>()
  const remember = (tokens: { mint: string; display: { icon: string | null } }[]) => {
    for (const t of tokens) {
      icons.delete(t.mint)
      icons.set(t.mint, t.display.icon)
      if (icons.size > MAX_ICONS) icons.delete(icons.keys().next().value!)
    }
  }
  const get: Get = async (...args) => {
    const r = await discover.get(...args)
    remember(r.tokens)
    return r
  }

  let refreshedAt = -Infinity
  let refreshing: Promise<unknown> | null = null
  const refresh = () => {
    if (refreshing) return refreshing
    if (Date.now() - refreshedAt < REFRESH_MS) return Promise.resolve()
    refreshedAt = Date.now()
    refreshing = Promise.allSettled(LISTS.map((a) => get(...a))).finally(() => (refreshing = null))
    return refreshing
  }

  // 1 queue to the proxy, as discover.ts keeps 1 per upstream.
  let tail: Promise<unknown> = Promise.resolve()
  let nextAt = 0
  let waiting = 0
  const queued = (url: string) => {
    if (waiting >= maxWaiting)
      return Promise.reject(
        new Busy(`${waiting} logo fetches are already waiting for wsrv.nl; ask again in a few s`),
      )
    waiting++
    const run = tail.then(async () => {
      const wait = nextAt - Date.now()
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      nextAt = Date.now() + SPACING_MS
      waiting--
      return proxy(url)
    })
    tail = run.catch(() => undefined)
    return run
  }

  const load = async (icon: string, size: number): Promise<Result> => {
    try {
      const { contentType, body } = await queued(proxyUrl(icon, size))
      const type = (contentType ?? '').split(';')[0]!.trim().toLowerCase()
      if (type !== 'image/png')
        return {
          ok: false,
          error: `the image proxy answered ${type ? type.replace(/[^\w./+-]/g, '').slice(0, 40) : 'no content type'}, not image/png`,
        }
      const bad = checkPng(body)
      return bad ? { ok: false, error: bad } : { ok: true, png: body }
    } catch (e) {
      // Our own messages name only wsrv.nl and a status; anything else could carry the URL.
      const m = e instanceof Error ? e.message : ''
      if (e instanceof Busy) return { ok: false, error: m, busy: true }
      return {
        ok: false,
        error: /^(wsrv\.nl|the image proxy|\d+ logo fetches)/.test(m)
          ? m
          : 'the fetch through wsrv.nl failed',
      }
    }
  }

  const cache = new Map<string, Entry>()

  /** The logo for `mint` at `size` by `size`, or why there is none. */
  const logo = async (mint: string, size: number): Promise<Result> => {
    if (!icons.has(mint)) await refresh()
    if (!icons.has(mint))
      return {
        ok: false,
        error: `No logo for this mint: it is in none of the /discover lists this server fetched in the last ${REFRESH_MS / 1000} s, so there is no icon URL to fetch. ${NEXT}`,
      }
    const icon = icons.get(mint)
    if (!icon)
      return { ok: false, error: `No logo: Jupiter sent no usable icon for this mint. ${NEXT}` }
    const refused = iconRefusal(icon)
    if (refused) return { ok: false, error: `No logo: ${refused}, so it was not fetched. ${NEXT}` }

    // Keyed by the icon too, so a token whose creator changes its icon gets the new one.
    const k = `${mint}:${size}:${icon}`
    const now = Date.now()
    let entry = cache.get(k)
    if (!entry || (entry.settled && now - entry.at >= entry.ttl)) {
      const e: Entry = { at: now, ttl: TTL.logo, settled: false, promise: load(icon, size) }
      void e.promise.then((r) =>
        Object.assign(e, { at: Date.now(), settled: true, ttl: r.ok ? TTL.logo : TTL.failure }),
      )
      cache.delete(k)
      cache.set(k, e)
      while (cache.size > maxEntries) cache.delete(cache.keys().next().value!)
      entry = e
    }
    const r = await entry.promise
    if (r.ok) return r
    if (r.busy) {
      if (cache.get(k) === entry) cache.delete(k)
      return { ok: false, busy: true, error: `No logo yet: ${r.error}.` }
    }
    return { ok: false, error: `No logo: ${r.error}. ${NEXT}` }
  }

  return { discover: { get }, get: logo }
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

/** The HTTP handler for GET /logo. Every parameter is checked here, the trust boundary. */
export async function serveLogo(
  url: URL,
  res: ServerResponse,
  logos: ReturnType<typeof createLogos>,
) {
  const q = url.searchParams
  const mint = q.get('mint') ?? ''
  const size = q.get('size') ?? '32'
  const encoding = q.get('encoding')
  // Inputs are not echoed: they are outside text. Their length is the number that helps.
  if (!Address.safeParse(mint).success)
    return json(res, 400, {
      error: `mint must be a Solana address; got ${mint.length} characters that are not one.`,
    })
  if (!/^\d{1,2}$/.test(size) || Number(size) < 1 || Number(size) > MAX_SIDE)
    return json(res, 400, {
      error: `size must be a whole number of pixels from 1 to ${MAX_SIDE}; got ${size.length} characters that are not one.`,
    })
  if (encoding !== null && encoding !== 'base64')
    return json(res, 400, {
      error: `encoding is base64 or left out; got ${encoding.length} characters that are neither.`,
    })
  const r = await logos.get(mint, Number(size))
  if (!r.ok) return json(res, r.busy ? 503 : 404, { mint, error: r.error })
  const headers = {
    'x-content-type-options': 'nosniff',
    'cache-control': 'public, max-age=3600',
  }
  if (encoding === 'base64') {
    res.writeHead(200, { ...headers, 'content-type': 'text/plain; charset=us-ascii' })
    res.end(Buffer.from(r.png).toString('base64'))
    return
  }
  res.writeHead(200, { ...headers, 'content-type': 'image/png' })
  res.end(r.png)
}
