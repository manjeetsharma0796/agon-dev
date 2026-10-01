// vault_status's answer, pure: the chain's reads and the prices in, the answer out, 0 network calls.
// The MCP tool, a page reading it and a test all get the same numbers from the same inputs.
//
// P&L is first in, first out with SOL as the only quote. Realised P&L is chain arithmetic and needs
// no price. Open positions are capped at what the vault holds on chain, because a lot whose tokens
// left by a withdrawal or a swap not against SOL is not held, whatever the ledger says.

import { USDC_MINT, WSOL_MINT } from '@agon/chain'
import { fifoLedger, openPositions, type Decoded, type Swap } from '@agon/decoder'
import { amount as decimalOf } from '@agon/web'
import type { Prices, VaultActivity } from './io.js'

/** Pinned units; any other mint is shown by its short address, never by a name it gave itself. */
const UNITS: Readonly<Record<string, string>> = {
  [WSOL_MINT]: 'SOL',
  [USDC_MINT]: 'USDC',
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 'USDT',
}
const SOL_DECIMALS = 9
/** The answer's size is bounded however many mints a vault has touched; totals cover them all. */
const TRADES_SHOWN = 3
const POSITIONS_SHOWN = 5
const POSITION_LINES = 3

const short = (mint: string): string => `${mint.slice(0, 4)}..${mint.slice(-4)}`

/** What a lot is worth from a USD price, in lamports, or null when either price is unusable. */
export function usdToLamports(
  units: bigint,
  decimals: number,
  usdPerToken: number,
  solUsd: number,
): bigint | null {
  const x = ((Number(units) / 10 ** decimals) * usdPerToken * 1e9) / solUsd
  return Number.isFinite(x) && x > 0 && x < 1e30 ? BigInt(Math.round(x)) : null
}

/** Integer division rounding half away from zero, for cents. */
const roundDiv = (n: bigint, d: bigint): bigint =>
  n >= 0n ? (2n * n + d) / (2n * d) : -((2n * -n + d) / (2n * d))

/** Lamports in cents at `microUsd` per SOL: whole cents, so parts add up to their total exactly. */
const centsOf = (lamports: bigint, microUsd: bigint): bigint =>
  roundDiv(lamports * microUsd, 10n ** 13n)

const dollars = (cents: bigint): string => {
  const a = cents < 0n ? -cents : cents
  return `${cents < 0n ? '-' : ''}${a / 100n}.${String(a % 100n).padStart(2, '0')}`
}

/** How each kind of transaction the ledger did not count reads to a person. */
const NOT_COUNTED: ReadonlyArray<[RegExp, string]> = [
  [/value only arrived/, 'deposits into the vault, which are not trades'],
  [/value only left/, 'withdrawals from the vault, which are not trades'],
  [
    /no token balance of this wallet changed/,
    'transactions that moved none of its tokens (hires, fees, revokes)',
  ],
  [/neither side is a quote asset/, 'swaps where neither side is SOL, so they have no cost in SOL'],
  [
    /mints left and .* arrived/,
    'transactions moving several of its tokens at once, which pair ambiguously',
  ],
  [/both sides are quote assets/, 'swaps between quote assets'],
]

const notCountedReason = (d: Exclude<Decoded, Swap>): string =>
  NOT_COUNTED.find(([re]) => re.test(d.reason))?.[1] ?? d.reason

interface OpenPosition {
  mint: string
  /** Held now: the ledger's open amount, capped at the vault's on-chain balance. */
  amount: bigint
  /** The cost of `amount`, in lamports, scaled down with it when the cap applied. */
  cost: bigint
}

/** The ledger over every counted trade, and the open positions the chain confirms. */
export function vaultLedger(a: VaultActivity) {
  // The chain lists newest first; the ledger needs the order trades happened, which within 1 slot
  // is only knowable from that list, so it is reversed rather than re-sorted.
  const swaps = a.decoded
    .map((x) => x.d)
    .filter((d): d is Swap => d.kind === 'swap')
    .reverse()
  const ledger = fifoLedger(swaps, [WSOL_MINT])
  const onChain = new Map(a.balances.map((b) => [b.mint, b.amount]))
  const open: OpenPosition[] = []
  const left: Array<{ mint: string; amount: bigint }> = []
  for (const p of openPositions(ledger.openLots)) {
    const held = BigInt(p.amount)
    const have = onChain.get(p.mint) ?? 0n
    const kept = have < held ? have : held
    if (kept < held) left.push({ mint: p.mint, amount: held - kept })
    if (kept > 0n)
      open.push({ mint: p.mint, amount: kept, cost: (BigInt(p.costBasis) * kept) / held })
  }
  open.sort((x, y) => (y.cost > x.cost ? 1 : y.cost < x.cost ? -1 : 0))
  return { swaps, ledger, open, left }
}

export type Valuation = { value: bigint; source: string } | { why: string }

interface VaultReportInput {
  owner: string
  activity: VaultActivity
  prices: Prices
  valuations: ReadonlyMap<string, Valuation>
  network: string
  now: Date
  explorer: (kind: 'address' | 'tx', id: string) => string
}

export function vaultReport(i: VaultReportInput) {
  const a = i.activity
  const { swaps, ledger, open, left } = vaultLedger(a)
  const decimals = (mint: string): number | undefined =>
    mint === WSOL_MINT ? SOL_DECIMALS : a.decimals.get(mint)
  const unitOf = (mint: string): string =>
    UNITS[mint] ?? (decimals(mint) === undefined ? `base units of ${short(mint)}` : short(mint))
  const quantity = (n: bigint, mint: string) => ({
    amount: String(n),
    ui: decimalOf(String(n), decimals(mint) ?? 0),
    unit: unitOf(mint),
  })
  const sol = (lamports: bigint) => quantity(lamports, WSOL_MINT)

  const primary = i.prices.sol[0]
  const micro = primary ? BigInt(Math.round(primary.usd * 1e6)) : null
  const inSol = (lamports: bigint, cents: bigint | null) => ({
    sol: { ...sol(lamports), amount: String(lamports) },
    usd: cents === null ? null : dollars(cents),
  })
  const cents = (lamports: bigint) => (micro === null ? null : centsOf(lamports, micro))
  const signed = (lamports: bigint, c: bigint | null) =>
    `${lamports > 0n ? '+' : ''}${decimalOf(String(lamports), SOL_DECIMALS)} SOL` +
    (c === null
      ? ''
      : c === 0n
        ? ' ($0.00)'
        : ` (${c < 0n ? '-' : '+'}$${dollars(c < 0n ? -c : c)})`)

  const realised = BigInt(ledger.realisedPnlByQuote[WSOL_MINT] ?? '0')
  const realisedCents = cents(realised)
  const valued = open.map((p) => {
    const v = i.valuations.get(p.mint)
    if (v === undefined || 'why' in v) return { ...p, value: null, why: v?.why ?? 'not valued' }
    const unrealised = v.value - p.cost
    return { ...p, value: v.value, source: v.source, unrealised, cents: cents(unrealised) }
  })
  const priced = valued.filter((p) => p.value !== null)
  const unpriced = valued.filter((p) => p.value === null)
  const unrealised = priced.reduce((n, p) => n + (p.unrealised ?? 0n), 0n)
  // The total's dollars are the sum of its parts' rounded dollars, so the lines always add up.
  const unrealisedCents = micro === null ? null : priced.reduce((n, p) => n + (p.cents ?? 0n), 0n)
  const totalCents =
    realisedCents === null || unrealisedCents === null ? null : realisedCents + unrealisedCents

  const sells = ledger.closedTrades.length
  const realisedBy = new Map(
    ledger.closedTrades.map((c) => [c.closedBySignature, BigInt(c.realisedPnl)]),
  )
  const times = new Map(a.decoded.map((x) => [x.d.signature, x.time]))

  const groups = new Map<string, number>()
  const add = (reason: string, n = 1) => groups.set(reason, (groups.get(reason) ?? 0) + n)
  for (const { d } of a.decoded) if (d.kind !== 'swap') add(notCountedReason(d))
  const unmatched = ledger.exceptions.filter((e) => e.kind === 'sold-more-than-held')
  if (unmatched.length > 0) {
    const e = unmatched[0]
    add(
      `sells of more than the counted buys hold (e.g. ${unitOf(e?.mint ?? '')} in ${short(e?.signature ?? '')}): ` +
        'only the part bought here is realised',
      unmatched.length,
    )
  }
  for (const l of left) {
    add(
      `${decimalOf(String(l.amount), decimals(l.mint) ?? 0)} ${unitOf(l.mint)} left the vault without a counted trade, so it is not valued`,
    )
  }
  const notCounted = [...groups].map(([reason, count]) => ({ count, reason }))

  const sources = i.prices.sol
  const spread =
    sources.length > 1
      ? (() => {
          const usds = sources.map((s) => s.usd)
          const lo = Math.min(...usds)
          return (((Math.max(...usds) - lo) / lo) * 100).toFixed(2)
        })()
      : null
  const order = new Map([[WSOL_MINT, -1], ...valued.map((p, k) => [p.mint, k] as [string, number])])
  const rank = (mint: string) => order.get(mint) ?? valued.length
  const show = (p: (typeof valued)[number]) =>
    `${decimalOf(String(p.amount), decimals(p.mint) ?? 0)} ${unitOf(p.mint)}`

  const summary = [
    `Total P&L ${signed(realised + unrealised, totalCents)}: realised ${signed(realised, realisedCents)} over ${sells} sell${sells === 1 ? '' : 's'}, unrealised ${signed(unrealised, unrealisedCents)} on ${priced.length} of ${open.length} open position${open.length === 1 ? '' : 's'}` +
      (unpriced.length > 0
        ? `; ${unpriced.length} unpriced and left out (${unpriced
            .slice(0, 3)
            .map((p) => unitOf(p.mint))
            .join(', ')}).`
        : '.'),
    ...valued
      .slice(0, POSITION_LINES)
      .map((p) =>
        p.value === null
          ? `Open ${show(p)}: cost ${decimalOf(String(p.cost), 9)} SOL, no price (${p.why}).`
          : `Open ${show(p)}: cost ${decimalOf(String(p.cost), 9)} SOL, worth ${decimalOf(String(p.value), 9)} SOL now (${p.source}), ${signed(p.unrealised ?? 0n, p.cents ?? null)}.`,
      ),
    ...(open.length > POSITION_LINES
      ? [
          `${open.length - POSITION_LINES} more open position(s); the ${Math.min(POSITIONS_SHOWN, open.length)} largest by cost are in positions.`,
        ]
      : []),
    primary
      ? `Dollars use SOL/USD $${primary.usd.toFixed(2)} now (${sources.map((s) => `${s.name} $${s.usd.toFixed(2)}`).join(', ')}${spread === null ? '' : `, ${spread}% apart`}), not the price on each trade's day.`
      : `No dollars: ${i.prices.errors.join('; ')}.`,
    `${swaps.length} trade${swaps.length === 1 ? '' : 's'} counted${a.incomplete ? ` (${a.incomplete})` : ''}; ${[...groups.values()].reduce((n, c) => n + c, 0)} other transaction(s) or amount(s) not counted, see history.`,
  ]

  return {
    vault: a.vault,
    owner: i.owner,
    summary,
    totals: {
      realised: inSol(realised, realisedCents),
      unrealised: inSol(unrealised, unrealisedCents),
      total: inSol(realised + unrealised, totalCents),
      unpriced: unpriced.map((p) => p.mint),
      note:
        'First in, first out over every trade the vault made, with SOL as the quote: a buy opens ' +
        'a lot, a sell closes the oldest. Realised is exact from the chain and needs no price. ' +
        "Unrealised values what is still open, capped at the vault's on-chain balance, at what " +
        'selling it fetches now, each with its source. Dollars are SOL figures times SOL/USD now.' +
        (i.network === 'fork'
          ? " Trade times are the fork's own clock, which can lag real time until sync_fork runs."
          : ''),
    },
    solUsd: primary
      ? {
          usd: primary.usd.toFixed(2),
          sources: sources.map((s) => ({ name: s.name, usd: s.usd.toFixed(2) })),
          spreadPct: spread ?? 'only 1 source',
        }
      : null,
    positions: valued.slice(0, POSITIONS_SHOWN).map((p) => ({
      mint: p.mint,
      held: quantity(p.amount, p.mint),
      cost: sol(p.cost),
      value: p.value === null ? null : sol(p.value),
      unrealised: p.value === null ? null : inSol(p.unrealised ?? 0n, p.cents ?? null),
      source: p.value === null ? null : (p.source ?? null),
      whyUnpriced: p.value === null ? p.why : null,
    })),
    // SOL first, then the positions' mints in their order, so the list is bounded and still useful.
    balances: [...a.balances]
      .sort((x, y) => rank(x.mint) - rank(y.mint))
      .slice(0, POSITIONS_SHOWN)
      .map((b) => ({ mint: b.mint, held: quantity(b.amount, b.mint) })),
    nativeSol: sol(a.nativeSol),
    agents: a.agents.map((g) => ({ address: g.address, feeSol: sol(g.feeSol) })),
    trades: [...swaps]
      .reverse()
      .slice(0, TRADES_SHOWN)
      .map((t) => {
        const mint = t.side === 'buy' ? t.boughtMint : t.soldMint
        const r = realisedBy.get(t.signature)
        const time = times.get(t.signature) ?? null
        return {
          signature: t.signature,
          slot: t.slot,
          time: time === null ? null : new Date(time * 1000).toISOString(),
          side: t.side,
          mint,
          token: quantity(BigInt(t.side === 'buy' ? t.boughtAmount : t.soldAmount), mint),
          sol: sol(BigInt(t.side === 'buy' ? t.soldAmount : t.boughtAmount)),
          realised: r === undefined ? null : { ...sol(r), amount: String(r) },
          explorer: i.explorer('tx', t.signature),
        }
      }),
    history: {
      trades: swaps.length,
      shown: Math.min(TRADES_SHOWN, swaps.length),
      positions: open.length,
      positionsShown: Math.min(POSITIONS_SHOWN, open.length),
      balances: a.balances.length,
      signaturesRead: a.signaturesRead,
      complete: a.incomplete === null,
      incomplete: a.incomplete,
      notCounted,
    },
    explorer: i.explorer('address', a.vault),
    dataSlot: a.slot,
    asOf: i.now.toISOString(),
  }
}
