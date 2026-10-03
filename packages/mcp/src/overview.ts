// GET /overview?wallet= (T-C31): vault_status's report plus 3 numbers, each by arithmetic.
//
// The 3 functions at the top are pure: plain data in, a figure out, 0 network calls, so a test, a
// page and the server get the same number from the same inputs. The reads are at the bottom.
//
// - The return in SOL is time-weighted: cut at every deposit and withdrawal, each piece valued at
//   the close of the hour holding its slot, then chained. Holding SOL scores 0 by construction.
// - The equity curve is the holdings at the end of each hour, rebuilt back from today's balances
//   through every transaction read, times that hour's close. A missing close is a gap, never joined.
// - The cap meter is `used = cap - effectiveRemaining` per role and mint, the slot it refills at and
//   the 2 times cap an agent can spend across a window edge.
//
// Amounts are bigint base units and prices exact decimals turned into fractions, so 0 floats touch
// an amount. GeckoTerminal sends closes as JSON numbers; `decimalOf` writes each as the exact
// decimal it was sent as, at the boundary, before any arithmetic.

import type { ServerResponse } from 'node:http'
import {
  effectiveRemaining,
  resolveVault,
  agentRulesOf,
  USDC_MINT,
  WSOL_MINT,
  type ChainRole,
  type TokenSpend,
} from '@agon/chain'
import { Address, network, Overview, Refusal, VaultStatus } from '@agon/core'
import type { RawTransaction } from '@agon/decoder'
import { amount as uiOf } from '@agon/web'
import { Connection, PublicKey } from '@solana/web3.js'
import { fetchNullableSwig } from '@swig-wallet/classic/dist/index.js'
import { callTool } from './index.js'
import { liveIo, type ToolIo, type VaultActivity } from './io.js'
import { serveMarket } from './market.js'

const RULE_VERSION = 'overview/1'
const STEP_S = 3_600
/** GeckoTerminal returns 100 candles a range, so the curve covers at most the last 100 hours. */
const CURVE_POINTS = 100
const SAMPLE_MIN = 30
const SOL_DECIMALS = 9
const PINNED_DECIMALS: Readonly<Record<string, number>> = { [WSOL_MINT]: 9, [USDC_MINT]: 6 }
const CAP_UNITS: Readonly<Record<string, string>> = { [WSOL_MINT]: 'wSOL', [USDC_MINT]: 'USDC' }

const short = (mint: string): string => `${mint.slice(0, 4)}..${mint.slice(-4)}`

// ---------------------------------------------------------------------------------------------
// Pure inputs

/** 1 transaction of the vault: what it moved, signed, and the fee an agent key paid for it. */
interface HistoryEvent {
  signature: string
  slot: number
  /** Block time, Unix seconds, or null when the chain did not say. */
  time: number | null
  /** Per mint, base units; SOL (native and wSOL together) under the wSOL mint. */
  deltas: ReadonlyMap<string, bigint>
  /** Lamports paid in fees by one of the vault's agent keys, 0 when someone else paid. */
  agentFee: bigint
}

/** 1 mint's hourly closes in USD, each an exact decimal, with the holes GeckoTerminal left named. */
export interface PriceSeries {
  mint: string
  stepSeconds: number
  source: string
  fetchedAt: string | null
  stale: string | null
  error: string | null
  closes: ReadonlyArray<{ t: number; usd: string }>
  gaps: ReadonlyArray<{ from: number | null; to: number | null; reason: string }>
}

export interface VaultHistory {
  /** Oldest first. */
  events: readonly HistoryEvent[]
  /** What the vault holds now, SOL under the wSOL mint. The anchor the history is rebuilt from. */
  holdings: ReadonlyMap<string, bigint>
  decimals: ReadonlyMap<string, number>
  now: { slot: number; time: number }
  /** Swaps the report counted, for the sample size line. */
  trades: number
  series: readonly PriceSeries[]
}

// ---------------------------------------------------------------------------------------------
// Exact fractions

interface Q {
  n: bigint
  d: bigint
}
const q = (n: bigint, d = 1n): Q => (d < 0n ? { n: -n, d: -d } : { n, d })
const add = (a: Q, b: Q): Q => q(a.n * b.d + b.n * a.d, a.d * b.d)
const mul = (a: Q, b: Q): Q => q(a.n * b.n, a.d * b.d)
const div = (a: Q, b: Q): Q => q(a.n * b.d, a.d * b.n)

/** "12.345" as 12345/1000. The input is already checked to be a plain decimal. */
function fromDecimal(s: string): Q {
  const [whole = '0', frac = ''] = s.split('.')
  return q(BigInt(whole + frac), 10n ** BigInt(frac.length))
}

/**
 * A JSON number as the exact decimal it was written as: the shortest string that reads back as the
 * same double, with any exponent written out. Null for anything that is not a finite price >= 0.
 */
export function decimalOf(x: number): string | null {
  if (!Number.isFinite(x) || x < 0) return null
  const s = String(x)
  const m = /^(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(s)
  if (!m) return null
  const digits = (m[1] ?? '') + (m[2] ?? '')
  const point = (m[1] ?? '').length + Number(m[3] ?? 0)
  const padded = point <= 0 ? '0'.repeat(1 - point) + digits : digits.padEnd(point, '0')
  const at = point <= 0 ? 1 : point
  const whole = padded.slice(0, at).replace(/^0+(?=\d)/, '')
  const frac = padded.slice(at).replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : whole
}

/** Hundredths of a percent, rounded half away from zero, as "9.34" or "-1.00". */
function pctOf(ratio: Q): string {
  const x = (ratio.n - ratio.d) * 20_000n
  const h = x >= 0n ? (x + ratio.d) / (2n * ratio.d) : -((-x + ratio.d) / (2n * ratio.d))
  const a = h < 0n ? -h : h
  return `${h < 0n ? '-' : ''}${a / 100n}.${String(a % 100n).padStart(2, '0')}`
}

const lamports = (v: Q) => {
  const floor = v.n >= 0n ? v.n / v.d : -((-v.n + v.d - 1n) / v.d)
  return { amount: String(floor), ui: uiOf(String(floor), SOL_DECIMALS), unit: 'SOL' }
}

// ---------------------------------------------------------------------------------------------
// Valuing holdings at 1 hour

type PriceUsed = {
  mint: string
  usd: string
  t: number
  stepSeconds: number
  source: string
  fetchedAt: string
}

const bucketOf = (time: number, step = STEP_S) => Math.floor(time / step) * step
const when = (t: number) => new Date(t * 1000).toISOString()

/** The close of `mint` for the hour starting `t`, or why there is none. `back` also takes the hour before. */
function closeAt(
  h: VaultHistory,
  mint: string,
  t: number,
  back = false,
): { usd: Q; used: PriceUsed } | { why: string } {
  const s = h.series.find((x) => x.mint === mint)
  if (!s) return { why: `no candles were asked for ${short(mint)}` }
  if (s.error) return { why: `no candles for ${short(mint)}: ${s.error}` }
  const hit =
    s.closes.find((c) => c.t === t) ??
    (back ? s.closes.find((c) => c.t === t - s.stepSeconds) : undefined)
  if (hit) {
    return {
      usd: fromDecimal(hit.usd),
      used: {
        mint,
        usd: hit.usd,
        t: hit.t,
        stepSeconds: s.stepSeconds,
        source: s.source,
        fetchedAt: s.fetchedAt ?? when(t),
      },
    }
  }
  const first = s.closes[0]?.t
  if (first === undefined || t < first) {
    return {
      why: `no candle for ${short(mint)} at ${when(t)}: it is before the oldest of the ${s.closes.length} hourly candles GeckoTerminal returned`,
    }
  }
  const gap = s.gaps.find((g) => g.from !== null && g.to !== null && g.from <= t && t <= g.to)
  return {
    why: `no candle for ${short(mint)} at ${when(t)}: ${gap ? gap.reason : 'GeckoTerminal sent no usable candle for that hour'}`,
  }
}

/** Holdings at hour `t` in lamports, exact, with every close it used, or why it cannot be valued. */
function valueAt(
  h: VaultHistory,
  holdings: ReadonlyMap<string, bigint>,
  t: number,
  back = false,
): { value: Q; prices: PriceUsed[] } | { why: string } {
  let value = q(0n)
  const prices: PriceUsed[] = []
  let sol: { usd: Q; used: PriceUsed } | null = null
  for (const [mint, units] of holdings) {
    if (units === 0n) continue
    if (units < 0n) {
      return {
        why: `the holdings rebuilt from the transactions read go below 0 for ${short(mint)} at ${when(t)}, so some of its history was not read`,
      }
    }
    if (mint === WSOL_MINT) {
      value = add(value, q(units))
      continue
    }
    const decimals = h.decimals.get(mint) ?? PINNED_DECIMALS[mint]
    if (decimals === undefined) return { why: `the decimals of ${short(mint)} were not read` }
    const own = closeAt(h, mint, t, back)
    if ('why' in own) return own
    if (sol === null) {
      const s = closeAt(h, WSOL_MINT, t, back)
      if ('why' in s)
        return { why: `SOL/USD is needed to value ${short(mint)}, and there is ${s.why}` }
      if (s.usd.n === 0n) return { why: `SOL/USD read 0 at ${when(t)}, which values nothing` }
      sol = s
      prices.push(s.used)
    }
    prices.push(own.used)
    // units / 10^decimals tokens, at usd per token over SOL's usd per SOL, times 10^9 lamports.
    const perToken = div(own.usd, sol.usd)
    value = add(value, mul(q(units * 10n ** 9n, 10n ** BigInt(decimals)), perToken))
  }
  return { value, prices }
}

/** Holdings just before and just after each event, rebuilt back from the holdings now. */
function rebuild(h: VaultHistory) {
  const cur = new Map(h.holdings)
  const before: Array<Map<string, bigint>> = []
  const after: Array<Map<string, bigint>> = []
  for (let i = h.events.length - 1; i >= 0; i--) {
    after[i] = new Map(cur)
    for (const [mint, d] of h.events[i]!.deltas) cur.set(mint, (cur.get(mint) ?? 0n) - d)
    before[i] = new Map(cur)
  }
  return { before, after }
}

/** Value that only arrived or only left: a deposit or a withdrawal, which is not the agent's doing. */
const isFlow = (e: HistoryEvent) => {
  const moved = [...e.deltas.values()].filter((d) => d !== 0n)
  return moved.length > 0 && (moved.every((d) => d > 0n) || moved.every((d) => d < 0n))
}

// ---------------------------------------------------------------------------------------------
// 1. The return in SOL against holding SOL

export function timeWeightedReturn(h: VaultHistory) {
  const flows = h.events.flatMap((e, i) => (isFlow(e) ? [i] : []))
  const firstFlow = flows[0]
  const fees =
    firstFlow === undefined ? 0n : h.events.slice(firstFlow).reduce((n, e) => n + e.agentFee, 0n)
  const fromSlot = firstFlow === undefined ? null : h.events[firstFlow]!.slot
  const n = h.trades
  const base = {
    trades: n,
    flows: flows.length,
    agentFees: { amount: String(fees), ui: uiOf(String(fees), SOL_DECIMALS), unit: 'SOL' },
    fromSlot,
    toSlot: h.now.slot,
    sample:
      n < SAMPLE_MIN ? `${n} trade${n === 1 ? '' : 's'} is too few to judge a strategy.` : null,
    method:
      `In SOL; holding SOL scores 0. Net of ${fees} lamports of network fees paid by the agent key. ` +
      `${flows.length} deposits and withdrawals adjusted at their own slot. ` +
      (fromSlot === null ? 'No deposit read yet.' : `Slots ${fromSlot} to ${h.now.slot}.`),
  }
  const fail = (why: string, prices: PriceUsed[] = []) => ({ ...base, pct: null, why, prices })
  if (firstFlow === undefined) {
    return fail(
      'No deposit into this vault was read, so there is nothing to measure a return from.',
    )
  }

  const { before, after } = rebuild(h)
  const prices: PriceUsed[] = []
  const at = (holdings: ReadonlyMap<string, bigint>, e: HistoryEvent | null) => {
    const time = e === null ? h.now.time : e.time
    if (time === null)
      return { why: `slot ${e?.slot} has no block time, so no close can be matched to it` }
    const v = valueAt(h, holdings, bucketOf(time), e === null)
    if ('why' in v)
      return { why: `at ${e === null ? `now (slot ${h.now.slot})` : `slot ${e.slot}`}, ${v.why}` }
    prices.push(...v.prices)
    return v
  }
  let ratio = q(1n)
  let start = at(after[firstFlow]!, h.events[firstFlow]!)
  if ('why' in start) return fail(start.why)
  const ends = [...flows.slice(1), null]
  let prev = firstFlow
  for (const next of ends) {
    const e = next === null ? null : h.events[next]!
    const end = at(next === null ? h.holdings : before[next]!, e)
    if ('why' in end) return fail(end.why, prices)
    const paid = h.events
      .slice(prev + 1, next === null ? undefined : next + 1)
      .reduce((s, x) => s + x.agentFee, 0n)
    const net = add(end.value, q(-paid))
    if (start.value.n === 0n) {
      if (net.n !== 0n) {
        return fail(
          `value arrived after slot ${h.events[prev]!.slot} while the vault held nothing, without a deposit read`,
          prices,
        )
      }
    } else {
      ratio = mul(ratio, div(net, start.value))
    }
    if (next === null) break
    const restart = at(after[next]!, e)
    if ('why' in restart) return fail(restart.why, prices)
    start = restart
    prev = next
  }
  return { ...base, pct: pctOf(ratio), why: null, prices: dedupe(prices) }
}

const dedupe = (prices: PriceUsed[]) => [
  ...new Map(prices.map((p) => [`${p.mint}:${p.t}`, p])).values(),
]

// ---------------------------------------------------------------------------------------------
// 2. The equity curve

export function equityCurve(h: VaultHistory) {
  const series = h.series.map(({ mint, source, stepSeconds, fetchedAt, stale, error }) => ({
    mint,
    source,
    stepSeconds,
    fetchedAt,
    stale,
    error,
  }))
  const method = (shown: number, from: number | null) =>
    `Holdings at the end of each hour, rebuilt back from the balances at slot ${h.now.slot} ` +
    `through the ${h.events.length} transactions read, times that hour's GeckoTerminal close ` +
    '(mint USD over SOL USD); SOL needs no price. ' +
    (from === null ? '' : `${shown} hours from ${when(from)}. `) +
    'A missing close is a gap with its reason, never a line drawn across it.'
  const none = (why: string) => ({ points: [], gaps: 0, method: method(0, null), why, series })
  const first = h.events[0]
  if (!first) return none('No transactions were read for this vault yet, so there is no curve.')
  const timeless = h.events.filter((e) => e.time === null).length
  if (timeless > 0) {
    return none(
      `${timeless} of ${h.events.length} transactions have no block time, so they cannot be placed on the hourly grid.`,
    )
  }
  const last = bucketOf(h.now.time)
  const from = Math.max(bucketOf(first.time!), last - (CURVE_POINTS - 1) * STEP_S)
  const points: Array<{
    t: number
    value: ReturnType<typeof lamports> | null
    gap: string | null
  }> = []
  for (let t = from; t <= last; t += STEP_S) {
    // Today's holdings minus everything that happened after this hour ended.
    const held = new Map(h.holdings)
    for (const e of h.events) {
      if (e.time! < t + STEP_S) continue
      for (const [mint, d] of e.deltas) held.set(mint, (held.get(mint) ?? 0n) - d)
    }
    const v = valueAt(h, held, t)
    points.push(
      'why' in v ? { t, value: null, gap: v.why } : { t, value: lamports(v.value), gap: null },
    )
  }
  return {
    points,
    gaps: points.filter((p) => p.value === null).length,
    method: method(points.length, from),
    why: null,
    series,
  }
}

// ---------------------------------------------------------------------------------------------
// 3. The cap meter

interface CapInput {
  roleId: number
  agent: string
  mint: string
  spend: TokenSpend
}

export function capMeter(
  rules: readonly CapInput[],
  slot: bigint,
  decimals: ReadonlyMap<string, number>,
) {
  return rules.flatMap((r) => {
    const cap = r.spend.recurringLimit
    if (cap === undefined || r.spend.window === null) return []
    const dec = decimals.get(r.mint) ?? PINNED_DECIMALS[r.mint] ?? 0
    const unit = CAP_UNITS[r.mint] ?? short(r.mint)
    const qty = (n: bigint) => ({ amount: String(n), ui: uiOf(String(n), dec), unit })
    const left = effectiveRemaining(r.spend, slot)
    const used = cap > left ? cap - left : 0n
    const refill =
      r.spend.lastReset === undefined
        ? {
            slot: null,
            why: "the role's last reset slot could not be read, so its refill slot is not known",
          }
        : used === 0n
          ? { slot: null, why: 'nothing spent this window, so nothing waits to refill' }
          : { slot: Number(r.spend.lastReset + r.spend.window + 1n), why: null }
    const burst = cap * 2n
    return [
      {
        roleId: r.roleId,
        agent: r.agent,
        mint: r.mint,
        cap: qty(cap),
        used: qty(used),
        left: qty(left),
        windowSlots: Number(r.spend.window),
        refillSlot: refill.slot,
        refillWhy: refill.why,
        burstWorstCase: qty(burst),
        line:
          `Spent ${uiOf(String(used), dec)} of ${uiOf(String(cap), dec)} ${unit} this window; ` +
          (refill.slot === null ? 'nothing waits to refill' : `refills at slot ${refill.slot}`) +
          `. Across a window edge the agent can spend up to ${uiOf(String(burst), dec)} ${unit}. ` +
          'This limits what the agent can spend, not what you can lose.',
      },
    ]
  })
}

const CAP_METHOD =
  'used = cap - what the agent can spend now (effectiveRemaining), per role and mint. The ' +
  'allowance refills once more than the window has passed since its last reset; spending a whole ' +
  'window just before the edge and another just after is the 2 times cap worst case.'

// ---------------------------------------------------------------------------------------------
// Reads

/** A finalized transaction never changes, so each is fetched once per process. */
const rawOnce = new Map<string, RawTransaction & { blockTime?: number | null }>()
const RAW_CAP = 50_000

/** What 1 transaction moved for `vault`: its token rows and its own lamports, signed. */
function deltasOf(tx: RawTransaction, vault: string): Map<string, bigint> {
  const out = new Map<string, bigint>()
  for (const [rows, sign] of [
    [tx.meta?.preTokenBalances, -1n],
    [tx.meta?.postTokenBalances, 1n],
  ] as const) {
    for (const r of rows ?? []) {
      if (r.owner !== vault) continue
      out.set(r.mint, (out.get(r.mint) ?? 0n) + sign * BigInt(r.uiTokenAmount.amount))
    }
  }
  const keys = tx.transaction.message.accountKeys ?? []
  const at = keys.findIndex((k) => (typeof k === 'string' ? k : k.pubkey) === vault)
  const pre = tx.meta?.preBalances?.[at]
  const post = tx.meta?.postBalances?.[at]
  if (at >= 0 && pre !== undefined && post !== undefined && post !== pre) {
    out.set(WSOL_MINT, (out.get(WSOL_MINT) ?? 0n) + BigInt(post) - BigInt(pre))
  }
  for (const [m, d] of out) if (d === 0n) out.delete(m)
  return out
}

async function readRaw(connection: Connection, signatures: string[], finalized: number) {
  const out = new Map<string, (RawTransaction & { blockTime?: number | null }) | null>()
  for (let i = 0; i < signatures.length; i += 20) {
    await Promise.all(
      signatures.slice(i, i + 20).map(async (sig) => {
        const hit = rawOnce.get(sig)
        if (hit) return out.set(sig, hit)
        const res = await fetch(connection.rpcEndpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getTransaction',
            params: [
              sig,
              { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' },
            ],
          }),
        })
        const tx = ((await res.json()) as { result?: RawTransaction | null }).result ?? null
        if (tx && tx.slot <= finalized) {
          if (rawOnce.size >= RAW_CAP) rawOnce.delete(rawOnce.keys().next().value as string)
          rawOnce.set(sig, tx)
        }
        return out.set(sig, tx)
      }),
    )
  }
  return out
}

/** /market's own answer for 1 mint, through its 1 queue and cache, as hourly closes. */
async function hourly(mint: string): Promise<PriceSeries> {
  const body = await new Promise<Record<string, unknown>>((resolve, reject) => {
    const res = {
      writeHead: () => res,
      end: (text: string) => {
        try {
          resolve(JSON.parse(text) as Record<string, unknown>)
        } catch (e) {
          reject(e as Error)
        }
      },
    }
    serveMarket(
      new URL(`http://local/market?mint=${mint}&range=1h`),
      res as unknown as ServerResponse,
    ).catch(reject)
  })
  const c = (body['candles'] ?? {}) as {
    pool?: string
    fetchedAt?: string
    error?: string
    staleReason?: string
    list?: Array<{ t: number; close: number }>
    gaps?: PriceSeries['gaps']
  }
  const err = c.error ?? (typeof body['error'] === 'string' ? body['error'] : undefined)
  return {
    mint,
    stepSeconds: STEP_S,
    source: `GeckoTerminal 1h candles${c.pool ? `, pool ${c.pool}` : ''}`,
    fetchedAt: c.fetchedAt ?? null,
    stale: c.staleReason ?? null,
    error: err ?? null,
    closes: (c.list ?? []).flatMap((k) => {
      const usd = decimalOf(k.close)
      return usd === null ? [] : [{ t: k.t, usd }]
    }),
    gaps: c.gaps ?? [],
  }
}

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Everything /overview answers for `wallet`, read and then computed by the 3 functions above. */
async function readOverview(wallet: string, io: ToolIo = liveIo()): Promise<Overview> {
  const net = network(process.env['AGON_NETWORK']).id
  // vault_status itself, so the report is the very one the MCP tool returns, and its activity read
  // once and kept for the 3 numbers.
  let activity: VaultActivity | undefined
  const tapped: ToolIo = {
    ...io,
    loadVaultActivity: async (owner) => (activity = await io.loadVaultActivity(owner)),
  }
  const report = VaultStatus.parse(await callTool('vault_status', { wallet }, tapped))
  if (!activity) throw new Error('vault_status answered without reading the vault')
  const a = activity
  // loadVaultActivity has already checked this RPC is the network the deployment names.
  const connection = new Connection(process.env['AGON_RPC_URL'] ?? '', 'confirmed')
  const fork = net === 'fork'
  const forkNote = fork
    ? " On the fork, block times are the fork's own clock while closes are mainnet's, so a close can belong to another hour."
    : ''

  // The cap meter: the roles as the chain has them now, at 1 slot.
  const cap = await (async () => {
    try {
      const resolved = await resolveVault(
        (address) => fetchNullableSwig(connection, address),
        new PublicKey(wallet),
      )
      const slot = BigInt(await connection.getSlot())
      const roles = (resolved.existing?.roles ?? []) as unknown as Array<
        ChainRole & { actions: { tokenSpend(mint: string): TokenSpend } }
      >
      const rules = agentRulesOf(roles, [WSOL_MINT, USDC_MINT], slot).map((r) => ({
        roleId: r.roleId,
        agent: r.authority,
        mint: r.mint,
        spend: roles.find((x) => x.id === r.roleId)!.actions.tokenSpend(r.mint),
      }))
      return { slot: Number(slot), roles: capMeter(rules, slot, a.decimals), why: null }
    } catch (e) {
      return { slot: a.slot, roles: [], why: `The vault's roles could not be read: ${reason(e)}.` }
    }
  })()

  // Every transaction the report read, again in full, for what it moved and who paid its fee.
  const agents = new Set(a.agents.map((g) => g.address))
  const finalized = await connection.getSlot('finalized')
  const oldestFirst = [...a.decoded].reverse()
  const raw = await readRaw(
    connection,
    oldestFirst.map((x) => x.d.signature),
    finalized,
  )
  const missing = oldestFirst.filter((x) => !raw.get(x.d.signature)).length
  const events: HistoryEvent[] = oldestFirst.flatMap(({ d, time }) => {
    const tx = raw.get(d.signature)
    if (!tx) return []
    const payer = tx.transaction.message.accountKeys?.[0]
    const payerKey = typeof payer === 'string' ? payer : payer?.pubkey
    return [
      {
        signature: d.signature,
        slot: d.slot,
        time,
        deltas: deltasOf(tx, a.vault),
        agentFee: payerKey && agents.has(payerKey) ? BigInt(tx.meta?.fee ?? 0) : 0n,
      },
    ]
  })
  const holdings = new Map(a.balances.map((b) => [b.mint, b.amount]))
  holdings.set(WSOL_MINT, (holdings.get(WSOL_MINT) ?? 0n) + a.nativeSol)
  const mints = new Set<string>(holdings.keys())
  for (const e of events) for (const m of e.deltas.keys()) mints.add(m)
  const priced = [...mints].filter((m) => m !== WSOL_MINT)
  const series = priced.length === 0 ? [] : await Promise.all([WSOL_MINT, ...priced].map(hourly))
  const history: VaultHistory = {
    events,
    holdings,
    decimals: a.decimals,
    now: { slot: a.slot, time: Math.floor(Date.now() / 1000) },
    trades: report.history.trades,
    series,
  }
  const incomplete =
    a.incomplete ??
    (missing > 0
      ? `${missing} transaction(s) were not returned by the chain yet; ask again in a minute`
      : null)

  const twr = timeWeightedReturn(history)
  const curve = equityCurve(history)
  const stamp = (slot: number) => ({ network: net, slot, ruleVersion: RULE_VERSION })
  return Overview.parse({
    network: net,
    dataSlot: a.slot,
    ruleVersion: RULE_VERSION,
    asOf: new Date().toISOString(),
    report,
    returnInSol: {
      ...stamp(a.slot),
      ...twr,
      pct: incomplete ? null : twr.pct,
      why: incomplete
        ? `Not every transaction was read (${incomplete}), so a return would leave some out.`
        : twr.why,
      method: twr.method + forkNote,
    },
    equityCurve: { ...stamp(a.slot), ...curve, method: curve.method + forkNote },
    capMeter: { ...stamp(cap.slot), roles: cap.roles, method: CAP_METHOD, why: cap.why },
  })
}

// ---------------------------------------------------------------------------------------------
// The route

/** GET /overview?wallet=. The wallet is checked here, the trust boundary, and never echoed. */
export async function overviewRoute(
  url: URL,
  read: (wallet: string) => Promise<unknown> = readOverview,
): Promise<{ status: number; body: unknown }> {
  const net = network(process.env['AGON_NETWORK']).id
  const given = url.searchParams.getAll('wallet')
  const raw = given[0] ?? ''
  let ok = given.length === 1 && Address.safeParse(raw).success
  if (ok) {
    try {
      ok = new PublicKey(raw).toBytes().length === 32
    } catch {
      ok = false
    }
  }
  if (!ok) {
    return {
      status: 400,
      body: {
        network: net,
        error:
          given.length > 1
            ? `wallet is given ${given.length} times; send it once.`
            : `wallet must be a Solana address: base58, 32 to 44 characters; got ${raw.length} characters that are not one. Pass /overview?wallet=<address>.`,
      },
    }
  }
  try {
    return { status: 200, body: await read(raw) }
  } catch (e) {
    if (e instanceof Refusal) {
      return {
        status: e.failure.id === 'no-vault' ? 404 : 503,
        body: { network: net, error: e.message },
      }
    }
    return {
      status: 502,
      body: { network: net, error: `Reading the overview failed: ${reason(e)}.` },
    }
  }
}
