// One wrapper around every external call: Helius, Jupiter, RPC, RugCheck and Jev. Owned by T-C02.
//
// Three modes, chosen by AGON_NET_MODE:
//   replay  read a recorded fixture, never touch the network. The default, so a test that forgets
//           to set the mode cannot silently reach the internet or burn a rate limit.
//   record  make the real call, then write the fixture.
//   live    make the real call, write nothing.
//
// Every result carries `ms`, measured from the first attempt rather than the last, so a call that
// retried three times reports what the caller actually waited. Benchmark B reads these numbers,
// and a per-attempt timing would quietly flatter us.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type Provider = 'helius' | 'jupiter' | 'rpc' | 'rugcheck' | 'jev'
export type Mode = 'live' | 'record' | 'replay'

export interface NetRequest {
  provider: Provider
  url: string
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: unknown
}

export interface NetResult {
  status: number
  body: unknown
  /** Milliseconds from the first attempt to the response that was returned. */
  ms: number
  attempts: number
  /** The slot the response was observed at, when the provider reports one. */
  slot: number | null
  fromFixture: boolean
}

export interface Recording {
  /**
   * The chain slot this response was observed at: the slot the provider reported, or the slot the
   * chain was on when the recording ran. Jev and RugCheck answer no chain query and report none of
   * their own, and a fixture with no provenance at all is indistinguishable from an invented one,
   * which is the thing the fixture gate exists to catch.
   */
  slot: number | null
  synthetic?: true
  provider: Provider
  recordedAt: string
  request: { method: string; url: string; headers: Record<string, string>; body: unknown }
  response: { status: number; body: unknown }
}

// Query parameters and headers that carry a key. A recorded fixture is committed to the repo and
// read by CI, so a secret must never reach one. This is an allowlist-shaped denylist on purpose:
// anything matching is dropped whether or not we recognise the provider.
const SECRET_PARAMS = /^(api[-_]?key|key|token|access[-_]?token|secret)$/i
const SECRET_HEADERS = /^(authorization|x-api-key|x-access-token|cookie)$/i
const REDACTED = 'REDACTED'

/** Strip every credential from a URL, keeping the shape so the fixture stays readable. */
export function redactUrl(raw: string): string {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return raw
  }
  for (const name of [...u.searchParams.keys()]) {
    if (SECRET_PARAMS.test(name)) u.searchParams.set(name, REDACTED)
  }
  // URL.toString() preserves user:pass@host verbatim. No builder writes one today, but this
  // function's whole contract is that nothing it returns can carry a credential into a committed
  // file, and a contract with an exception is not one.
  if (u.username !== '') u.username = REDACTED
  if (u.password !== '') u.password = REDACTED
  return u.toString()
}

export function redactHeaders(headers: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) out[k] = SECRET_HEADERS.test(k) ? REDACTED : v
  return out
}

/**
 * The fixture name. Derived from the redacted request, so the same logical call resolves to the
 * same file whoever recorded it and whatever key they used. A key in the hash would mean every
 * teammate recorded a different file for the same call.
 */
export function fixtureKey(req: NetRequest): string {
  const canonical = JSON.stringify({
    provider: req.provider,
    method: req.method ?? 'GET',
    url: redactUrl(req.url),
    body: req.body ?? null,
  })
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16)
}

export function fixturePath(req: NetRequest, root = 'fixtures/recorded'): string {
  return join(root, req.provider, `${fixtureKey(req)}.json`)
}

/** Providers report the slot under different names. Null when the response carries none. */
export function slotOf(body: unknown): number | null {
  if (typeof body !== 'object' || body === null) return null
  const b = body as Record<string, unknown>
  const ctx = b['result'] as Record<string, unknown> | undefined
  const nested = ctx?.['context'] as Record<string, unknown> | undefined
  for (const n of [nested?.['slot'], b['contextSlot'], b['priceBlockId'], b['slot']]) {
    if (typeof n === 'number' && Number.isFinite(n)) return n
  }
  return null
}

export function mode(): Mode {
  const m = process.env['AGON_NET_MODE']
  return m === 'record' || m === 'live' ? m : 'replay'
}

class OfflineError extends Error {
  constructor(req: NetRequest, path: string) {
    super(
      `No recorded response for this ${req.provider} call, and the net wrapper is in replay mode ` +
        `so it will not reach the network. Expected ${path}. Record it with ` +
        `AGON_NET_MODE=record, or fix the call if that fixture should already exist.`,
    )
    this.name = 'OfflineError'
  }
}

/**
 * Make one external call, or replay one.
 *
 * `retries` exists because a 429 is normal on the Jupiter tier we are on (10 requests per 10
 * seconds, as measured against that tier). The clock starts before the first attempt, so a caller that waited
 * through two backoffs sees the time it actually waited.
 */
export async function call(
  req: NetRequest,
  opts: { retries?: number; backoffMs?: number; root?: string; slotHint?: number } = {},
): Promise<NetResult> {
  const started = Date.now()
  const path = fixturePath(req, opts.root)
  const m = mode()

  if (m === 'replay') {
    if (!existsSync(path)) throw new OfflineError(req, path)
    const rec = JSON.parse(readFileSync(path, 'utf8')) as Recording
    return {
      status: rec.response.status,
      body: rec.response.body,
      ms: Date.now() - started,
      attempts: 1,
      slot: rec.slot,
      fromFixture: true,
    }
  }

  const retries = opts.retries ?? 3
  const backoffMs = opts.backoffMs ?? 1100
  let attempts = 0
  let status = 0
  let body: unknown = null

  for (;;) {
    attempts += 1
    const res = await fetch(req.url, {
      method: req.method ?? 'GET',
      headers: {
        ...(req.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...req.headers,
      },
      ...(req.body === undefined ? {} : { body: JSON.stringify(req.body) }),
    })
    status = res.status
    const text = await res.text()
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
    if (status !== 429 || attempts > retries) break
    await new Promise((r) => setTimeout(r, backoffMs * attempts))
  }

  const slot = slotOf(body) ?? opts.slotHint ?? null

  if (m === 'record' && status === 200) {
    const rec: Recording = {
      slot,
      provider: req.provider,
      recordedAt: new Date().toISOString(),
      request: {
        method: req.method ?? 'GET',
        url: redactUrl(req.url),
        headers: redactHeaders(req.headers),
        body: req.body ?? null,
      },
      response: { status, body },
    }
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify(rec, null, 2)}\n`)
  }

  return { status, body, ms: Date.now() - started, attempts, slot, fromFixture: false }
}
