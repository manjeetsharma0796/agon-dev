// The action layer (T-C32): buy, sell, cancel and pause, 1 function each, whoever presses it. A web
// button, a terminal key and the agent are all 1 plain HTTP call here, so the LLM is one more caller
// with no extra power. docs/plans/agon-terminal.md sections 2, 4, 5 and 9.
//
// Who signs, and where, without moving a key. This server never holds one: the agent key lives in
// the OS keychain behind the daemon (T-C08) or in the agent kit's file (T-C26), on the user's
// machine. So an in-cap trade is 2 calls, the boundary prepare_swap already drew:
//   1. POST /actions/buy: proof of who pressed, check_trade, the cap read from chain now, and either
//      a cleared transaction for the agent key (inside the cap) or the owner's link (outside it).
//   2. The daemon signs the cleared bytes on the user's machine (its own rule: a pass under 30 s
//      old), and POST /actions/send hands them back. This server checks they are exactly the bytes
//      it cleared, signed by that agent key, journals `sent` with the signature, sends once, and
//      journals the answer. The key never crosses; only a signature does.
//
// Fails closed throughout: off the fork nothing runs (T-D04); an unread vault, an unverified
// signature or a stale clearance does nothing; a `sent` row that cannot be written means nothing
// is sent; and a trade whose result is unknown is `uncertain` and is never sent again.

import { createPublicKey, randomUUID, verify } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  Address,
  BaseUnits,
  JournalRow,
  network,
  noVault,
  PrepareSwapInput,
  Refusal,
  TxSignature,
  type CheckTradeOutput,
  type JournalAction,
  type Reason,
} from '@agon/core'
import { WSOL_MINT } from '@agon/chain'
import { formatUnits } from '@agon/web'
import { PublicKey, VersionedTransaction } from '@solana/web3.js'
import { ARMED, explorer, pausedSince, prepareSwap, quoteAndJudge, setPaused } from './index.js'
import { chainMismatch, type ToolIo, type VaultRules } from './io.js'
import { signedBy, type Journal } from './journal.js'

/** The chain calls a send needs. A web3.js `Connection` is one. */
export interface ActionChain {
  getVersion(): Promise<unknown>
  sendRawTransaction(
    raw: Buffer | Uint8Array,
    options?: { skipPreflight?: boolean },
  ): Promise<string>
  getSignatureStatuses(
    signatures: string[],
    config?: { searchTransactionHistory: boolean },
  ): Promise<{ value: Array<{ err: unknown; confirmationStatus?: string } | null> }>
  getBlockHeight(commitment?: 'confirmed'): Promise<number>
}

export interface ActionDeps {
  /** A fresh io per request, as the MCP tools get. */
  io: () => ToolIo
  /** Best-effort rows: a failed write is named on the next read and never changes an answer. */
  journal: Journal
  /** The `sent` row only: throws when it did not land, and then nothing is sent. */
  mustRecord: (row: JournalRow) => Promise<void>
  /** The chain sends go to; null when this server names none, and then nothing is sent. */
  chain: ActionChain | null
  /** Where the owner's wallet signs: the web app (AGON_PUBLIC_URL). */
  publicUrl: string | undefined
  /** Seams for tests. */
  waitMs?: number
  watchMs?: number
  pollMs?: number
  proposalMs?: number
  sentRowMs?: number
}

const ACTIONS = ['buy', 'sell', 'cancel', 'pause', 'approve', 'decline'] as const
type ActionName = (typeof ACTIONS)[number]
type Actor = 'owner-web' | 'owner-terminal' | 'agent'
interface Who {
  owner: string
  actor: Actor
  actorKey: string
}

/** How long a signed action may wait before it is used, and how far ahead of us its clock may run. */
const SIGNED_TTL_MS = 60_000
const CLOCK_AHEAD_MS = 5_000
/** How long a clearance lasts: the daemon's own approval window (T-C08), so neither outlives it. */
const CLEARED_TTL_MS = 30_000
/** An agent proposal unanswered this long expires and does nothing. Section 5; open item 12.1. */
const PROPOSAL_MS = 120_000
/** How long a send waits for the chain before the answer is `uncertain`. */
const WAIT_MS = 30_000
/** How long an uncertain send is then watched, reading status only, before it is left as it is. */
const WATCH_MS = 180_000
const POLL_MS = 500
/** How long the `sent` row may take. Neon's cold first write measured 4,657 ms (T-C30). */
const SENT_ROW_MS = 10_000
const BODY_LIMIT = 16_384
const DEFAULT_SLIPPAGE_BPS = 50
const MAX_SLIPPAGE_BPS = 100

/** The fields a signed action can carry, in the order its text lists them. */
const FIELDS = [
  'owner',
  'actor',
  'actorKey',
  'mint',
  'amount',
  'slippageBps',
  'historyWallet',
  'agent',
  'confirmUnsure',
  'propose',
  'order',
  'paused',
  'proposal',
  'at',
] as const

const TRADE_FIELDS = [
  'mint',
  'amount',
  'slippageBps',
  'historyWallet',
  'agent',
  'confirmUnsure',
  'propose',
]
const ALLOWED: Record<ActionName, readonly string[]> = {
  buy: TRADE_FIELDS,
  sell: TRADE_FIELDS,
  cancel: ['order'],
  pause: ['paused'],
  approve: ['proposal', 'confirmUnsure'],
  decline: ['proposal'],
}

/**
 * The exact text the presser signs, as UTF-8 (Phantom's signMessage, or the daemon). Every field it
 * sends is in it, so nothing can be changed after signing, and the network is in it, so a fork
 * request cannot be replayed anywhere else.
 */
export const actionText = (action: string, fields: Readonly<Record<string, unknown>>): string =>
  [
    `Agon action on ${network(process.env['AGON_NETWORK']).id}: ${action}`,
    ...FIELDS.filter((k) => fields[k] !== undefined).map((k) => `${k}: ${String(fields[k])}`),
    'Signing this text asks Agon to run this action. It is not a transaction.',
  ].join('\n')

// ---- State, in this process only. A restart forgets clearances and proposals, which fails closed:
// a forgotten clearance cannot be sent and a forgotten proposal cannot be approved. ----

interface Cleared {
  who: Who
  side: 'buy' | 'sell'
  mint: string
  size: string
  signer: string
  message: Buffer
  verdict: CheckTradeOutput
  lastValidBlockHeight: number
  at: number
}
interface Proposal {
  proposer: Who
  side: 'buy' | 'sell'
  ask: TradeAsk
  verdict: CheckTradeOutput
  at: number
}
const cleared = new Map<string, Cleared>()
const proposals = new Map<string, Proposal>()
const expiredProposals = new Set<string>()
/** Signatures already used, until they would be stale anyway. */
const usedProofs = new Map<string, number>()

// ---- Small helpers. ----

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const toBase58 = (bytes: Uint8Array): string => {
  let n = BigInt('0x' + (Buffer.from(bytes).toString('hex') || '0'))
  let out = ''
  for (; n > 0n; n /= 58n) out = B58[Number(n % 58n)] + out
  for (const b of bytes) {
    if (b !== 0) break
    out = '1' + out
  }
  return out
}

/** DER prefix that turns 32 raw ed25519 public key bytes into an SPKI key node:crypto reads. */
const ED25519_SPKI = Buffer.from('302a300506032b6570032100', 'hex')
const signedBytes = (signer: string, message: Uint8Array, signature: Uint8Array): boolean => {
  try {
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI, new PublicKey(signer).toBuffer()]),
      format: 'der',
      type: 'spki',
    })
    return verify(null, message, key, signature)
  } catch {
    return false
  }
}

/** A cause by name, never an upstream's text, which could carry anything. */
const causeOf = (error: unknown): string => {
  if (error instanceof Refusal) return error.failure.id
  const e = error as { code?: unknown; name?: unknown } | null
  if (typeof e?.code === 'string' && /^[\w-]{2,40}$/.test(e.code)) return e.code
  return typeof e?.name === 'string' && e.name !== '' ? e.name : 'unnamed-error'
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** An amount as a person reads it: wSOL and USDC in their units, anything else in base units. */
const shown = (amount: bigint, mint: string): string => {
  const unit = ARMED[mint]
  return unit === undefined
    ? `${amount} base units of ${mint}`
    : `${formatUnits(amount, unit.decimals)} ${unit.unit}`
}

const NO_LINK =
  'this server has no AGON_PUBLIC_URL, so it has no link to give. Set it and ask again'

const linkFor = (deps: ActionDeps, params: Record<string, string>): string | null =>
  deps.publicUrl === undefined || deps.publicUrl === ''
    ? null
    : `${deps.publicUrl.replace(/\/+$/, '')}/trade#${new URLSearchParams(params).toString()}`

const offFork = (net: string): string =>
  `This server names ${net}, and Agon actions run only on the practice fork until the pre-mainnet ` +
  'checklist, T-D04 (8 boxes, 2 sign-offs), is signed off. Nothing was checked, signed ' +
  'or sent.'

const rowOf = (
  who: Who,
  action: JournalAction,
  status: JournalRow['status'],
  f: {
    reasons: Reason[]
    mint?: string | null
    side?: 'buy' | 'sell' | null
    size?: string | null
    verdict?: CheckTradeOutput | null
    signature?: string | null
  },
): JournalRow =>
  JournalRow.parse({
    id: randomUUID(),
    time: new Date().toISOString(),
    slot: f.verdict?.dataSlot ?? null,
    network: network(process.env['AGON_NETWORK']).id,
    wallet: who.owner,
    actor: who.actor,
    actorKey: who.actorKey,
    action,
    mint: f.mint ?? null,
    side: f.side ?? null,
    size: f.size ?? null,
    received: null,
    verdict: f.verdict?.verdict ?? null,
    reasons: [...f.reasons, ...(f.verdict?.reasons ?? [])],
    ruleVersion: f.verdict?.ruleVersion ?? null,
    signature: f.signature ?? null,
    status,
  })

interface Answer {
  status: number
  body: Record<string, unknown>
}
const answer = (body: Record<string, unknown>, status = 200): Answer => ({ status, body })
const error = (status: number, text: string): Answer => ({ status, body: { error: text } })

// ---- Parsing. Every field is checked by shape; anything not listed for the action is refused. ----

interface TradeAsk {
  mint: string
  amount: string
  slippageBps: number
  historyWallet: string
  agent: string | undefined
  confirmUnsure: boolean
}
interface Parsed extends Who {
  at: string
  atMs: number
  signature: string
  body: Record<string, unknown>
}

const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,3})?Z$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const parseAction = (action: ActionName, raw: unknown): Parsed | string => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    return 'The body is not a JSON object.'
  const body = raw as Record<string, unknown>
  const allowed = new Set(['owner', 'actor', 'actorKey', 'at', 'signature', ...ALLOWED[action]])
  const extra = Object.keys(body).find((k) => !allowed.has(k))
  if (extra !== undefined) return `${extra} is not a field of ${action}, so nothing was done.`
  const bad = (field: string, why: string) => `${field} is not valid: ${why}. Nothing was done.`
  const isAddress = (v: unknown) => Address.safeParse(v).success
  if (!isAddress(body['owner'])) return bad('owner', 'not a base58 Solana address')
  if (!isAddress(body['actorKey'])) return bad('actorKey', 'not a base58 Solana address')
  const actor = body['actor']
  if (actor !== 'owner-web' && actor !== 'owner-terminal' && actor !== 'agent') {
    return bad('actor', 'one of owner-web, owner-terminal or agent')
  }
  const at = body['at']
  const atMs = typeof at === 'string' && ISO.test(at) ? Date.parse(at) : NaN
  if (!Number.isFinite(atMs)) return bad('at', 'an ISO 8601 UTC time, such as 2026-10-03T12:00:00Z')
  if (!TxSignature.safeParse(body['signature']).success) {
    return bad('signature', 'ed25519 over the action text, base58')
  }
  const optionalBool = (k: string) => body[k] === undefined || typeof body[k] === 'boolean'
  if (action === 'buy' || action === 'sell') {
    if (!isAddress(body['mint']) || body['mint'] === WSOL_MINT) {
      return bad('mint', 'the address of the token traded against SOL, not wrapped SOL itself')
    }
    if (!BaseUnits.safeParse(body['amount']).success || /^0+$/.test(String(body['amount']))) {
      return bad('amount', 'a whole number of base units above 0, as a string')
    }
    const slippage = body['slippageBps']
    if (
      slippage !== undefined &&
      !(
        Number.isInteger(slippage) &&
        (slippage as number) >= 1 &&
        (slippage as number) <= MAX_SLIPPAGE_BPS
      )
    ) {
      return bad('slippageBps', `a whole number from 1 to ${MAX_SLIPPAGE_BPS}`)
    }
    for (const k of ['historyWallet', 'agent']) {
      if (body[k] !== undefined && !isAddress(body[k])) return bad(k, 'not a base58 Solana address')
    }
    for (const k of ['confirmUnsure', 'propose']) {
      if (!optionalBool(k)) return bad(k, 'true or false')
    }
    if (body['propose'] === true && actor !== 'agent') {
      return bad('propose', 'only the agent proposes; the owner acts directly')
    }
  }
  if (action === 'cancel' && !isAddress(body['order'])) {
    return bad('order', 'the address of the Jupiter Trigger order')
  }
  if (action === 'pause' && typeof body['paused'] !== 'boolean') {
    return bad('paused', 'true to pause the agent, false to resume it')
  }
  if (action === 'approve' || action === 'decline') {
    if (typeof body['proposal'] !== 'string' || !UUID.test(body['proposal'])) {
      return bad('proposal', 'the id a proposal answer gave')
    }
    if (!optionalBool('confirmUnsure')) return bad('confirmUnsure', 'true or false')
  }
  return {
    owner: body['owner'] as string,
    actor,
    actorKey: body['actorKey'] as string,
    at: at as string,
    atMs,
    signature: body['signature'] as string,
    body,
  }
}

const askOf = (body: Record<string, unknown>, owner: string): TradeAsk => ({
  mint: body['mint'] as string,
  amount: body['amount'] as string,
  slippageBps: (body['slippageBps'] as number | undefined) ?? DEFAULT_SLIPPAGE_BPS,
  historyWallet: (body['historyWallet'] as string | undefined) ?? owner,
  agent: body['agent'] as string | undefined,
  confirmUnsure: body['confirmUnsure'] === true,
})

/** The swap a trade asks for, parsed into the shape prepare_swap and check_trade take. */
const swapOf = (owner: string, side: 'buy' | 'sell', ask: TradeAsk) =>
  PrepareSwapInput.omit({ agent: true }).parse({
    owner,
    historyWallet: ask.historyWallet,
    inputMint: side === 'buy' ? WSOL_MINT : ask.mint,
    outputMint: side === 'buy' ? ask.mint : WSOL_MINT,
    amount: ask.amount,
    slippageBps: ask.slippageBps,
  })

// ---- Step 1: who pressed, then the action. ----

/**
 * Proof of who pressed: a fresh ed25519 signature over the action's text. An owner actor, on the web
 * or in the terminal, proves the owner's own wallet key; the agent proves a key the owner's vault
 * hires on chain now. Powers follow the key, never the label: the terminal's daemon and the agent
 * hold the same hired key, so a hired key claiming to be the owner could confirm its own unsure,
 * approve its own proposal and lift its own pause. A signature works once.
 */
async function authorize(
  p: Parsed,
  action: ActionName,
  io: ToolIo,
): Promise<{ vault: VaultRules } | Answer> {
  const now = Date.now()
  if (p.atMs - now > CLOCK_AHEAD_MS) {
    return error(
      401,
      `This action is signed for ${p.at}, ${Math.ceil((p.atMs - now) / 1000)} s ahead of this ` +
        "server's clock, so nothing was done. Sign it again with the time now.",
    )
  }
  if (now - p.atMs > SIGNED_TTL_MS) {
    return error(
      401,
      `This action was signed ${Math.floor((now - p.atMs) / 1000)} s ago, and a signed action ` +
        `lasts ${SIGNED_TTL_MS / 1000} s, so nothing was done. Sign it again.`,
    )
  }
  if (usedProofs.has(p.signature)) {
    return error(401, 'This signed action was already used, so nothing was done. Sign it again.')
  }
  if (!signedBy(p.actorKey, actionText(action, p.body), p.signature)) {
    return error(
      401,
      `The signature does not verify for ${p.actorKey} over this action's text, so nothing was ` +
        'done. Sign the exact text actionText gives, as UTF-8, with that key.',
    )
  }
  let vault: VaultRules
  try {
    vault = await io.loadVaultRules(p.owner)
  } catch (e) {
    return error(
      503,
      `The vault of ${p.owner} could not be read from the chain (${causeOf(e)}), so who may act ` +
        'is unknown and nothing was done. Try again.',
    )
  }
  if (vault.vault === null) return error(404, noVault({ owner: p.owner }).text)
  const hired = vault.rules.map((r) => r.authority)
  const allowed = p.actor === 'agent' ? hired.includes(p.actorKey) : p.actorKey === p.owner
  if (!allowed) {
    return error(
      401,
      p.actor === 'agent'
        ? `${p.actorKey} is not among the ${new Set(hired).size} agent keys the vault ` +
            `${vault.vault} hires on chain now, so nothing was done.`
        : `As ${p.actor} only the owner's own wallet ${p.owner} signs, and ${p.actorKey} is not ` +
            'it, so nothing was done. A hired key acts as agent.',
    )
  }
  // Checked again after the read, so 2 concurrent requests with 1 signature cannot both act.
  if (usedProofs.has(p.signature)) {
    return error(401, 'This signed action was already used, so nothing was done. Sign it again.')
  }
  for (const [s, until] of usedProofs) if (until < now) usedProofs.delete(s)
  usedProofs.set(p.signature, p.atMs + SIGNED_TTL_MS)
  return { vault }
}

/** check_trade's words for a stop, with its first reason and what the presser can do next. */
const stopText = (verdict: CheckTradeOutput, actor: Actor): string => {
  const head =
    `check_trade answered ${verdict.verdict} with ${verdict.reasons.length} ` +
    `${verdict.reasons.length === 1 ? 'reason' : 'reasons'}, so nothing was signed or sent. The ` +
    `first: ${verdict.reasons[0]?.message ?? 'none was given.'}`
  if (verdict.verdict === 'block') return head
  return actor === 'agent'
    ? `${head} An agent cannot confirm its own unsure: propose it (propose true), and the owner ` +
        'can approve it with confirmUnsure true.'
    : `${head} To go ahead anyway, send this action again with confirmUnsure true; that ` +
        'confirmation is journaled.'
}

/**
 * An empty history is never a pass here. prepare_swap's practice-fork rule lets it out bounded only
 * by the cap; through the action layer the person confirms it, like any unsure.
 */
const unlessHistory = (
  judged: { closedTrades: number; verdict: CheckTradeOutput },
  historyWallet: string,
): CheckTradeOutput =>
  judged.closedTrades > 0 || judged.verdict.verdict === 'block'
    ? judged.verdict
    : {
        ...judged.verdict,
        verdict: 'unsure',
        reasons: [
          {
            rule: 'no-trading-history',
            message:
              `0 closed trades on mainnet for ${historyWallet}, so this trade was not checked ` +
              'against a history. The owner can confirm it with confirmUnsure true.',
          },
          ...judged.verdict.reasons,
        ],
      }

/** Buy or sell: check_trade first, then the agent key inside its cap, else the owner's link. */
async function trade(
  side: 'buy' | 'sell',
  ask: TradeAsk,
  who: Who,
  vault: VaultRules,
  io: ToolIo,
  deps: ActionDeps,
): Promise<Answer> {
  const inputMint = side === 'buy' ? WSOL_MINT : ask.mint
  const facts = { mint: ask.mint, side, size: ask.amount }
  const refuse = (message: string, verdict: CheckTradeOutput | null, rule: string) => {
    void deps.journal.record(
      rowOf(who, side, 'refused', { ...facts, verdict, reasons: [{ rule, message }] }),
    )
    return answer({ outcome: 'refused', message, verdict })
  }

  // Pause: no new entries by the agent. Its sells, and everything the owner does, go on.
  const since = pausedSince(who.owner)
  if (side === 'buy' && who.actor === 'agent' && since !== undefined) {
    return refuse(
      `The owner paused new buys by the agent at ${since}, so nothing was checked, signed or ` +
        'sent. Sells still work; the owner can resume, or make this buy themselves.',
      null,
      'agent-paused',
    )
  }

  // Who would sign inside the cap: never on the web, where only the owner's wallet signs.
  const hired = vault.rules.map((r) => r.authority)
  const signer =
    who.actor === 'owner-web' ? null : who.actor === 'agent' ? who.actorKey : (ask.agent ?? null)
  if (signer !== null && !hired.includes(signer)) {
    return refuse(
      `Agent key ${signer} is not hired by the vault ${vault.vault} on chain now, so nothing was ` +
        'signed or sent. Name a hired key in agent, or leave it out to sign with your wallet.',
      null,
      'agent-not-hired',
    )
  }
  const confirmed = ask.confirmUnsure && who.actor !== 'agent'
  const amount = BigInt(ask.amount)
  const rule = vault.rules.find((r) => r.authority === signer && r.mint === inputMint)
  const swap = swapOf(who.owner, side, ask)

  if (signer !== null && rule !== undefined && amount <= rule.effectiveRemaining) {
    // Inside the cap the chain holds now: the agent key signs, after the same build prepare_swap runs.
    const seen: { verdict?: CheckTradeOutput } = {}
    let prepared
    try {
      prepared = await prepareSwap(PrepareSwapInput.parse({ ...swap, agent: signer }), io, {
        confirmedUnsure: confirmed,
        onVerdict: (v) => {
          seen.verdict = v
        },
      })
    } catch (e) {
      const verdict = seen.verdict ?? null
      if (
        verdict !== null &&
        verdict.verdict !== 'pass' &&
        !(verdict.verdict === 'unsure' && confirmed)
      ) {
        return refuse(stopText(verdict, who.actor), verdict, `check-${verdict.verdict}`)
      }
      if (e instanceof Refusal) return refuse(e.message, verdict, e.failure.id)
      return refuse(
        `The ${side} stopped with ${causeOf(e)} before anything was signed, so nothing was sent. ` +
          'Try again.',
        verdict,
        'action-failed',
      )
    }
    const id = randomUUID()
    const message = Buffer.from(
      VersionedTransaction.deserialize(
        Buffer.from(prepared.transaction, 'base64'),
      ).message.serialize(),
    )
    const now = Date.now()
    for (const [k, c] of cleared) if (now - c.at > CLEARED_TTL_MS) cleared.delete(k)
    cleared.set(id, {
      who,
      side,
      mint: ask.mint,
      size: ask.amount,
      signer,
      message,
      verdict: prepared.verdict,
      lastValidBlockHeight: prepared.lastValidBlockHeight,
      at: now,
    })
    const text =
      `check_trade answered ${prepared.verdict.verdict}. ${shown(amount, inputMint)} is within the ` +
      `${shown(rule.effectiveRemaining, inputMint)} agent key ${signer} may still spend in this ` +
      `window, so that key signs it. Sign the transaction and POST it with cleared to /actions/send ` +
      `within ${CLEARED_TTL_MS / 1000} s. Nothing is sent until then.`
    const reasons: Reason[] = [{ rule: 'agent-signs', message: text }]
    if (prepared.verdict.verdict === 'unsure') {
      reasons.unshift({
        rule: 'unsure-confirmed',
        message: `${who.actorKey} confirmed this trade over an unsure verdict.`,
      })
    }
    void deps.journal.record(
      rowOf(who, side, 'approved', { ...facts, verdict: prepared.verdict, reasons }),
    )
    return answer({
      outcome: 'sign',
      message: text,
      verdict: prepared.verdict,
      sign: {
        cleared: id,
        transaction: prepared.transaction,
        agent: signer,
        signWithinMs: CLEARED_TTL_MS,
        sendTo: '/actions/send',
        lastValidBlockHeight: prepared.lastValidBlockHeight,
      },
    })
  }

  // Outside the cap, with no hired key for this mint, or on the web: the owner's wallet signs. Not
  // bounded by the agent's cap, and check_trade still applies, so it runs first.
  let verdict: CheckTradeOutput
  try {
    verdict = unlessHistory((await quoteAndJudge(io, swap, side, true)).judged, ask.historyWallet)
  } catch (e) {
    return refuse(
      e instanceof Refusal
        ? e.message
        : `The check stopped with ${causeOf(e)}, so nothing was signed or sent. Try again.`,
      null,
      e instanceof Refusal ? e.failure.id : 'check-failed',
    )
  }
  if (verdict.verdict === 'block' || (verdict.verdict === 'unsure' && !confirmed)) {
    return refuse(stopText(verdict, who.actor), verdict, `check-${verdict.verdict}`)
  }
  const link = linkFor(deps, {
    owner: who.owner,
    side,
    mint: ask.mint,
    amount: ask.amount,
    slippageBps: String(ask.slippageBps),
    historyWallet: ask.historyWallet,
  })
  const where = link === null ? `but ${NO_LINK}.` : `at ${link}.`
  const why =
    who.actor === 'owner-web'
      ? 'A web trade is signed by your own wallet, never by an agent key, so nothing was signed or sent here.'
      : rule === undefined
        ? `No agent key ${signer === null ? '' : `${signer} `}of the vault ${vault.vault} may spend ` +
          `${ARMED[inputMint]?.unit ?? inputMint}, so no agent key signs it and nothing was sent.`
        : `${shown(amount, inputMint)} is over the ${shown(rule.effectiveRemaining, inputMint)} ` +
          `agent key ${signer} may still spend in this window, so no agent key signs it and ` +
          'nothing was sent.'
  const text =
    `${why} ${who.actor === 'agent' ? 'The owner can do this on the web,' : 'Your wallet signs it'} ${where} ` +
    `Signed by the owner's wallet it is outside the agent's limit; check_trade answered ` +
    `${verdict.verdict}.`
  void deps.journal.record(
    rowOf(who, side, 'approved', {
      ...facts,
      verdict,
      reasons: [
        ...(verdict.verdict === 'unsure'
          ? [
              {
                rule: 'unsure-confirmed',
                message: `${who.actorKey} confirmed this trade over an unsure verdict.`,
              },
            ]
          : []),
        { rule: 'owner-signs', message: text },
      ],
    }),
  )
  return answer({ outcome: 'owner', message: text, verdict, ownerLink: link })
}

/** An agent's proposal: judged now, a `proposed` row, and the owner's to answer within the window. */
async function propose(
  side: 'buy' | 'sell',
  ask: TradeAsk,
  who: Who,
  io: ToolIo,
  deps: ActionDeps,
): Promise<Answer> {
  const facts = { mint: ask.mint, side, size: ask.amount }
  const since = pausedSince(who.owner)
  if (side === 'buy' && since !== undefined) {
    const message =
      `The owner paused new buys by the agent at ${since}, so this buy was not proposed. Sells ` +
      'can still be proposed.'
    void deps.journal.record(
      rowOf(who, side, 'refused', { ...facts, reasons: [{ rule: 'agent-paused', message }] }),
    )
    return answer({ outcome: 'refused', message, verdict: null })
  }
  let verdict: CheckTradeOutput
  try {
    verdict = unlessHistory(
      (await quoteAndJudge(io, swapOf(who.owner, side, ask), side, true)).judged,
      ask.historyWallet,
    )
  } catch (e) {
    const message = e instanceof Refusal ? e.message : `The check stopped with ${causeOf(e)}.`
    void deps.journal.record(
      rowOf(who, side, 'refused', { ...facts, reasons: [{ rule: 'check-failed', message }] }),
    )
    return answer({ outcome: 'refused', message, verdict: null })
  }
  if (verdict.verdict === 'block') {
    const message = stopText(verdict, who.actor)
    void deps.journal.record(
      rowOf(who, side, 'refused', {
        ...facts,
        verdict,
        reasons: [{ rule: 'check-block', message }],
      }),
    )
    return answer({ outcome: 'refused', message, verdict })
  }
  const windowMs = deps.proposalMs ?? PROPOSAL_MS
  const id = randomUUID()
  const at = Date.now()
  proposals.set(id, { proposer: who, side, ask: { ...ask, agent: who.actorKey }, verdict, at })
  setTimeout(() => expire(id, deps), windowMs).unref()
  const message =
    `Proposed: ${side} ${shown(BigInt(ask.amount), side === 'buy' ? WSOL_MINT : ask.mint)}` +
    `${side === 'buy' ? ` of ${ask.mint}` : ''}; check_trade answered ${verdict.verdict}. The owner ` +
    `has ${windowMs / 1000} s to approve or decline proposal ${id}. Unanswered, it expires and ` +
    'nothing happens.'
  void deps.journal.record(
    rowOf(who, side, 'proposed', { ...facts, verdict, reasons: [{ rule: 'proposed', message }] }),
  )
  return answer({
    outcome: 'proposed',
    message,
    verdict,
    proposal: { id, expiresAt: new Date(at + windowMs).toISOString() },
  })
}

/** A proposal's window ran out: it does nothing, and the journal says so. */
function expire(id: string, deps: ActionDeps): void {
  const p = proposals.get(id)
  if (p === undefined) return
  proposals.delete(id)
  expiredProposals.add(id)
  if (expiredProposals.size > 1000) {
    const [oldest] = expiredProposals
    if (oldest !== undefined) expiredProposals.delete(oldest)
  }
  void deps.journal.record(
    rowOf(p.proposer, p.side, 'expired', {
      mint: p.ask.mint,
      side: p.side,
      size: p.ask.amount,
      verdict: p.verdict,
      reasons: [
        {
          rule: 'proposal-expired',
          message: `Unanswered for ${(deps.proposalMs ?? PROPOSAL_MS) / 1000} s, so proposal ${id} expired and did nothing.`,
        },
      ],
    }),
  )
}

/** The proposal behind an approve or a decline, or the answer when there is none to answer. */
const openProposal = (id: string, owner: string, deps: ActionDeps): Proposal | Answer => {
  const p = proposals.get(id)
  if (p !== undefined && p.proposer.owner === owner) {
    if (Date.now() - p.at <= (deps.proposalMs ?? PROPOSAL_MS)) return p
    expire(id, deps)
  }
  if (expiredProposals.has(id)) {
    return answer({
      outcome: 'expired',
      message:
        `Proposal ${id} expired after ${(deps.proposalMs ?? PROPOSAL_MS) / 1000} s unanswered, so ` +
        'nothing was done. Ask the agent to propose it again.',
    })
  }
  return error(
    404,
    `No open proposal ${id} for ${owner}: it was answered already, never made, or this server ` +
      'restarted. Nothing was done.',
  )
}

/** POST /actions/<action>: 1 signed press, whoever pressed it. */
async function act(action: ActionName, raw: unknown, deps: ActionDeps): Promise<Answer> {
  const p = parseAction(action, raw)
  if (typeof p === 'string') return error(400, p)
  const io = deps.io()
  const authorized = await authorize(p, action, io)
  if ('status' in authorized) return authorized
  const { vault } = authorized
  const who: Who = { owner: p.owner, actor: p.actor, actorKey: p.actorKey }
  const body = p.body

  if (action === 'buy' || action === 'sell') {
    const ask = askOf(body, p.owner)
    return body['propose'] === true
      ? propose(action, ask, who, io, deps)
      : trade(action, ask, who, vault, io, deps)
  }

  if (action === 'approve' || action === 'decline') {
    const id = body['proposal'] as string
    if (action === 'approve' && who.actor === 'agent') {
      return error(
        403,
        'An agent cannot approve a proposal, its own included: the owner approves it, on the web or ' +
          'in the terminal. Nothing was done.',
      )
    }
    const found = openProposal(id, p.owner, deps)
    if ('status' in found) return found
    if (action === 'decline' && who.actor === 'agent' && who.actorKey !== found.proposer.actorKey) {
      return error(
        403,
        `Only the owner or the agent key that proposed ${id} can decline it. Nothing was done.`,
      )
    }
    proposals.delete(id)
    const facts = { mint: found.ask.mint, side: found.side, size: found.ask.amount }
    if (action === 'decline') {
      const message = `Proposal ${id} declined by ${who.actorKey}; nothing was done.`
      void deps.journal.record(
        rowOf(who, found.side, 'declined', {
          ...facts,
          verdict: found.verdict,
          reasons: [{ rule: 'proposal-declined', message }],
        }),
      )
      return answer({ outcome: 'declined', message })
    }
    void deps.journal.record(
      rowOf(who, found.side, 'approved', {
        ...facts,
        reasons: [
          {
            rule: 'proposal-approved',
            message:
              `Proposal ${id} by agent key ${found.proposer.actorKey} approved by ${who.actorKey}; ` +
              'it runs now as a fresh trade, checked again.',
          },
        ],
      }),
    )
    // The same function a direct press runs, with a fresh quote and a fresh check.
    return trade(
      found.side,
      { ...found.ask, confirmUnsure: body['confirmUnsure'] === true },
      who,
      vault,
      io,
      deps,
    )
  }

  if (action === 'cancel') {
    // A Trigger order is placed by the vault's root, the owner's wallet (decided 2026-09-26), so only that wallet
    // cancels it. Not judged by check_trade: a cancel opens no position, and refusing one would keep
    // funds inside an order, which fails in the wrong direction.
    const order = body['order'] as string
    const link = linkFor(deps, { owner: p.owner, cancel: order })
    const message =
      `Only the owner's wallet can cancel Jupiter order ${order}: the owner placed it, and no ` +
      `agent key can sign for it. Nothing was sent. ${link === null ? `There is no link: ${NO_LINK}.` : `Cancel it at ${link}.`}`
    void deps.journal.record(
      rowOf(who, 'cancel', 'approved', { reasons: [{ rule: 'owner-signs', message }] }),
    )
    return answer({ outcome: 'owner', message, ownerLink: link })
  }

  // pause. Not judged by check_trade either: it only ever stops entries.
  if (body['paused'] === false) {
    if (who.actor === 'agent') {
      return error(
        403,
        'Only the owner resumes a paused agent, on the web or in the terminal. Nothing was done.',
      )
    }
    setPaused(p.owner, null)
    const message = 'Resumed: the agent can buy again, inside the limit the chain holds.'
    void deps.journal.record(
      rowOf(who, 'pause', 'approved', { reasons: [{ rule: 'resumed', message }] }),
    )
    return answer({ outcome: 'resumed', message })
  }
  const since = new Date().toISOString()
  setPaused(p.owner, since)
  const arm = deps.publicUrl ? `${deps.publicUrl.replace(/\/+$/, '')}/arm` : 'the arming page'
  const message =
    `Paused at ${since}: new buys by the agent are refused, here and in prepare_swap, until the ` +
    "owner resumes or this server restarts. Sells, cancels, the owner's own trades and every " +
    "Jupiter order already placed keep running. The agent's key still holds its limit on chain, " +
    `so to stop it for certain, revoke it at ${arm}.`
  void deps.journal.record(
    rowOf(who, 'pause', 'approved', { reasons: [{ rule: 'paused', message }] }),
  )
  return answer({ outcome: 'paused', message })
}

// ---- Step 2: the cleared bytes, signed on the user's machine, sent once. ----

type Settled = { status: 'confirmed' } | { status: 'failed'; why: string } | null

/**
 * Reads status only, never sends. Block height is read before status, so a transaction that landed
 * by the last valid block is seen, and one with no status past it can never land.
 */
async function settle(
  chain: ActionChain,
  signature: string,
  lastValidBlockHeight: number,
  until: number,
  pollMs: number,
): Promise<Settled> {
  for (;;) {
    try {
      const height = await chain.getBlockHeight('confirmed')
      const [s] = (
        await chain.getSignatureStatuses([signature], { searchTransactionHistory: true })
      ).value
      if (s?.confirmationStatus === 'confirmed' || s?.confirmationStatus === 'finalized') {
        return s.err === null || s.err === undefined
          ? { status: 'confirmed' }
          : {
              status: 'failed',
              why:
                `It landed and failed on chain (${JSON.stringify(s.err).slice(0, 160)}), so the swap ` +
                'did not happen and only the fee was spent. Run the action again for a fresh check.',
            }
      }
      if (s === null && height > lastValidBlockHeight) {
        return {
          status: 'failed',
          why:
            `Its blockhash expired at block ${lastValidBlockHeight} (now ${height}) with no status, ` +
            'so it can never land and nothing moved. Run the action again for a fresh check.',
        }
      }
    } catch {
      // No answer this round. The deadline below is what turns silence into uncertain.
    }
    if (Date.now() >= until) return null
    await sleep(pollMs)
  }
}

const finalRow = (c: Cleared, signature: string, settled: NonNullable<Settled>): JournalRow =>
  rowOf(c.who, c.side, settled.status, {
    mint: c.mint,
    side: c.side,
    size: c.size,
    verdict: c.verdict,
    signature,
    reasons: [
      settled.status === 'confirmed'
        ? { rule: 'confirmed', message: `Landed and confirmed: ${explorer('tx', signature)}` }
        : { rule: 'failed', message: settled.why },
    ],
  })

/** POST /actions/send: the transaction step 1 cleared, signed by its agent key, sent exactly once. */
async function sendCleared(raw: unknown, deps: ActionDeps): Promise<Answer> {
  const body = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const id = body['cleared']
  const transaction = body['transaction']
  if (
    Object.keys(body).some((k) => k !== 'cleared' && k !== 'transaction') ||
    typeof id !== 'string' ||
    !UUID.test(id) ||
    typeof transaction !== 'string' ||
    transaction.length > 4096
  ) {
    return error(
      400,
      'Send cleared, the id step 1 gave, and transaction, the signed bytes as base64. Nothing was sent.',
    )
  }
  const c = cleared.get(id)
  if (c === undefined) {
    return error(
      409,
      `No cleared action ${id}: it was sent already, never cleared here, or this server ` +
        'restarted. Nothing was sent; run the action again.',
    )
  }
  // Single use from here: whatever happens next, these bytes are never sent a second time.
  cleared.delete(id)
  const facts = { mint: c.mint, side: c.side, size: c.size, verdict: c.verdict }
  const refuse = (message: string, rule: string) => {
    void deps.journal.record(
      rowOf(c.who, c.side, 'refused', { ...facts, reasons: [{ rule, message }] }),
    )
    return answer({ outcome: 'refused', message })
  }

  const age = Date.now() - c.at
  if (age > CLEARED_TTL_MS) {
    return refuse(
      `This was cleared ${age} ms ago, past the ${CLEARED_TTL_MS} ms a clearance lasts, so nothing ` +
        'was sent. Run the action again for a fresh check.',
      'clearance-stale',
    )
  }
  let tx: VersionedTransaction
  try {
    tx = VersionedTransaction.deserialize(Buffer.from(transaction, 'base64'))
  } catch {
    return refuse(
      'The transaction does not parse, so nothing was sent. Sign the cleared bytes as given.',
      'unreadable',
    )
  }
  if (!Buffer.from(tx.message.serialize()).equals(c.message)) {
    return refuse(
      'This is not the transaction this action cleared: a different amount, route or blockhash is a ' +
        'different trade, so nothing was sent. Sign the cleared bytes as given.',
      'not-cleared-bytes',
    )
  }
  const [sig] = tx.signatures
  if (tx.signatures.length !== 1 || sig === undefined || !signedBytes(c.signer, c.message, sig)) {
    return refuse(
      `The transaction is not signed by the agent key ${c.signer} alone, so nothing was sent. ` +
        'That key signs it, on the machine that holds it.',
      'not-agent-signed',
    )
  }
  const chain = deps.chain
  if (chain === null) {
    return refuse('This server names no chain (AGON_RPC_URL), so nothing was sent.', 'no-chain')
  }
  let version: unknown
  try {
    version = await chain.getVersion()
  } catch (e) {
    return refuse(
      `The chain did not say which network it is (${causeOf(e)}), so nothing was sent. Try again.`,
      'chain-unread',
    )
  }
  const net = network(process.env['AGON_NETWORK']).id
  const mismatch =
    net === 'fork' ? chainMismatch(net, (version ?? {}) as Record<string, unknown>) : 'not the fork'
  if (mismatch !== null) {
    return refuse(`${offFork(net)} The chain says: ${mismatch}.`, 'not-the-fork')
  }

  const signature = toBase58(sig)
  const sentRowMs = deps.sentRowMs ?? SENT_ROW_MS
  const write = deps.mustRecord(
    rowOf(c.who, c.side, 'sent', {
      ...facts,
      signature,
      reasons: [
        {
          rule: 'sent',
          message: `Signed by agent key ${c.signer} and sent once as ${signature}. Agon never sends it again.`,
        },
      ],
    }),
  )
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      write,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('write-timeout')), sentRowMs)
      }),
    ])
  } catch (e) {
    // The `sent` row carries the signature an uncertain trade is found by later. Without it the
    // journal could not say what went out, so nothing goes out. A write that timed out may still
    // land, so once it settles either way a `failed` row with the same signature says it never went.
    const cause =
      e instanceof Error && e.message === 'write-timeout'
        ? `no answer in ${sentRowMs} ms`
        : causeOf(e)
    const message =
      `The send could not be journaled (${cause}), so nothing was sent: a trade the journal ` +
      'cannot account for does not go out. Try again once the journal is back.'
    void write
      .catch(() => undefined)
      .then(() =>
        deps.journal.record(
          rowOf(c.who, c.side, 'failed', {
            ...facts,
            signature,
            reasons: [{ rule: 'not-sent', message }],
          }),
        ),
      )
    return answer({ outcome: 'refused', message })
  } finally {
    clearTimeout(timer)
  }

  // 1 send. The RPC's own rebroadcast of these same bytes cannot land them twice; Agon never sends
  // them again. A send that throws is not evidence either way: the status read decides.
  await chain.sendRawTransaction(tx.serialize(), { skipPreflight: true }).catch(() => null)
  const pollMs = deps.pollMs ?? POLL_MS
  const waitMs = deps.waitMs ?? WAIT_MS
  const settled = await settle(
    chain,
    signature,
    c.lastValidBlockHeight,
    Date.now() + waitMs,
    pollMs,
  )
  if (settled !== null) {
    await deps.journal.record(finalRow(c, signature, settled))
    return answer({
      outcome: settled.status,
      message:
        settled.status === 'confirmed'
          ? `Landed and confirmed: ${explorer('tx', signature)}`
          : settled.why,
      signature,
      explorer: explorer('tx', signature),
    })
  }
  const message =
    `Sent once as ${signature}, and the chain gave no answer in ${waitMs / 1000} s. Agon never ` +
    'sends it again: this row keeps its signature until the chain answers, and a confirmed or ' +
    `failed row follows when it does. Check ${explorer('tx', signature)} before trading again.`
  await deps.journal.record(
    rowOf(c.who, c.side, 'uncertain', {
      ...facts,
      signature,
      reasons: [{ rule: 'uncertain', message }],
    }),
  )
  // Status only, never a send, until the chain answers or the blockhash has long expired.
  void settle(
    chain,
    signature,
    c.lastValidBlockHeight,
    Date.now() + (deps.watchMs ?? WATCH_MS),
    pollMs * 4,
  ).then((later) =>
    later === null ? undefined : deps.journal.record(finalRow(c, signature, later)),
  )
  return answer({ outcome: 'uncertain', message, signature, explorer: explorer('tx', signature) })
}

// ---- HTTP. ----

const readBody = (req: IncomingMessage): Promise<string | null> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size <= BODY_LIMIT) chunks.push(chunk)
    })
    req.on('end', () => resolve(size > BODY_LIMIT ? null : Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })

/**
 * `POST /actions/{buy,sell,cancel,pause,approve,decline,send}`, JSON in and out, every answer led by
 * the network. Returns false for any other path, so serve.ts can try its next route.
 */
export async function handleActions(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ActionDeps,
): Promise<boolean> {
  const path = (req.url ?? '').split('?')[0] ?? ''
  if (path !== '/actions' && !path.startsWith('/actions/')) return false
  const net = network(process.env['AGON_NETWORK'])
  const reply = ({ status, body }: Answer) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify({ network: net.short, ...body }))
  }
  // Before anything is read: off the fork there is nothing to check, sign or send.
  if (net.id !== 'fork') {
    reply(error(403, offFork(net.id)))
    return true
  }
  const name = path.slice('/actions/'.length)
  if (
    req.method !== 'POST' ||
    !(name === 'send' || (ACTIONS as readonly string[]).includes(name))
  ) {
    reply(
      error(
        404,
        `No action at ${req.method ?? 'GET'} ${path}. POST JSON to /actions/buy, sell, cancel, ` +
          'pause, approve, decline or send.',
      ),
    )
    return true
  }
  if (!(req.headers['content-type'] ?? '').startsWith('application/json')) {
    reply(error(415, 'Send the action as JSON, content-type application/json. Nothing was done.'))
    return true
  }
  try {
    const text = await readBody(req)
    if (text === null) {
      reply(error(413, `The body is over ${BODY_LIMIT} bytes, so nothing was done.`))
      return true
    }
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      reply(error(400, 'The body is not JSON, so nothing was done.'))
      return true
    }
    reply(
      name === 'send' ? await sendCleared(json, deps) : await act(name as ActionName, json, deps),
    )
  } catch (e) {
    if (!res.headersSent) {
      reply(error(502, `The action stopped with ${causeOf(e)}, so nothing was sent. Try again.`))
    }
  }
  return true
}
