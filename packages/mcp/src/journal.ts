// The journal (T-C30): 1 row per verdict and per action, stored in Neon Postgres, read only by
// the vault's owner or a key the vault has hired. docs/plans/agon-terminal.md section 4.
//
// 2 rules shape everything here. A failed write never changes a verdict: `record` cannot throw, and
// what failed is kept and named on the next read. And a row is built field by field from our own
// values, never spread from an input, so a token's name has no way in.

import {
  createHmac,
  createPublicKey,
  randomBytes,
  randomUUID,
  timingSafeEqual,
  verify,
} from 'node:crypto'
import {
  Activity,
  GetActivityInput,
  JournalRow,
  network,
  Refusal,
  type CheckTradeInput,
  type CheckTradeOutput,
  type FailureMessage,
  type JournalAction,
  type WriteFailure,
} from '@agon/core'
import { PublicKey } from '@solana/web3.js'
import postgres from 'postgres'
import type { ToolIo } from './io.js'

/** Where rows live. Postgres in production; the tests hand in a Map. */
export interface JournalStore {
  insert(row: JournalRow): Promise<void>
  /**
   * Newest first, this wallet on this network only. Unattributed rows only when asked for; `hidden`
   * counts those left out.
   */
  list(
    wallet: string,
    net: string,
    limit: number,
    withUnattributed: boolean,
  ): Promise<{ rows: JournalRow[]; hidden: number }>
}

export interface Journal {
  /** Never throws and never alters what it is given: a failure is kept for the next read instead. */
  record(row: JournalRow): Promise<void>
  read(
    wallet: string,
    limit: number,
    withUnattributed: boolean,
  ): Promise<{ rows: JournalRow[]; hidden: number; failures: WriteFailure[] }>
}

/**
 * How long a write may hold up the answer it journals. Neon measured a write p50 of 274 ms from this
 * machine on 2026-10-03 (T-C30's row), so this is about 5 p50s, and a write past it is named as
 * `write-timeout` rather than left to push an agent's client past its own timeout. The first write
 * on a cold connection took 4,657 ms, so that one is named and lands late.
 */
const WRITE_DEADLINE_MS = 1500
/** Failures kept for the next read. Bounded, so a database that is down for a day costs no memory. */
const FAILURES_KEPT = 100
/** Failures listed in 1 answer, newest first; the rest are counted, so the answer stays in budget. */
const FAILURES_LISTED = 5

/** A cause by name: an error code, or a Postgres message. Never a connection string or a host. */
const causeOf = (error: unknown): string => {
  if (error instanceof Refusal) return error.failure.id
  const e = error as { code?: unknown; name?: unknown; message?: unknown } | null
  const code = typeof e?.code === 'string' && /^[\w-]{2,40}$/.test(e.code) ? e.code : null
  // Postgres's own messages name a relation or a column, never the server's address.
  if (e?.name === 'PostgresError' && typeof e.message === 'string') {
    return `${code ?? 'postgres'}: ${e.message.slice(0, 120)}`
  }
  return code ?? (typeof e?.name === 'string' && e.name !== '' ? e.name : 'unnamed-error')
}

export const createJournal = (store: JournalStore, deadlineMs = WRITE_DEADLINE_MS): Journal => {
  const failures: WriteFailure[] = []
  const fail = (row: JournalRow, cause: string) => {
    failures.push({ time: new Date().toISOString(), wallet: row.wallet, action: row.action, cause })
    if (failures.length > FAILURES_KEPT) failures.shift()
  }
  return {
    async record(row) {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          store.insert(JournalRow.parse(row)),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('write-timeout')), deadlineMs)
          }),
        ])
      } catch (error) {
        fail(
          row,
          error instanceof Error && error.message === 'write-timeout'
            ? `write-timeout after ${deadlineMs} ms; the row may still land late`
            : causeOf(error),
        )
      } finally {
        clearTimeout(timer)
      }
    },
    async read(wallet, limit, withUnattributed) {
      const net = network(process.env['AGON_NETWORK']).id
      try {
        const found = await store.list(wallet, net, limit, withUnattributed)
        const rows = found.rows.map((r) => JournalRow.parse(r))
        return { rows, hidden: found.hidden, failures: failures.filter((f) => f.wallet === wallet) }
      } catch (error) {
        throw new Refusal(journalUnreadable({ cause: causeOf(error) }))
      }
    },
  }
}

/** No DATABASE_URL: every write is a named failure and every read is refused, never an empty list. */
const noDatabase: JournalStore = {
  insert: async () => {
    throw Object.assign(new Error('no database'), { code: 'no-database-configured' })
  },
  list: async () => {
    throw Object.assign(new Error('no database'), { code: 'no-database-configured' })
  },
}

/**
 * Postgres through `postgres` (porsager), the driver with 0 dependencies of its own. The table is
 * made on first use, so a fresh Neon branch or a local Postgres needs no migration step.
 */
export const postgresStore = (url: string): JournalStore => {
  // Prepared statements make a query 1 round trip instead of 2: on Neon from this machine, a read p50
  // of 260 ms prepared against 541 ms unprepared, 20 calls each. serve.ts passes the direct URL.
  const sql = postgres(url, { max: 4, connect_timeout: 10, onnotice: () => {} })
  let ready: Promise<unknown> | null = null
  const schema = () =>
    (ready ??= sql`
      CREATE TABLE IF NOT EXISTS journal (
        id uuid PRIMARY KEY,
        -- Insertion order, so 2 rows in the same millisecond still read newest first.
        seq bigint GENERATED ALWAYS AS IDENTITY,
        time timestamptz NOT NULL,
        slot bigint,
        network text NOT NULL,
        wallet text NOT NULL,
        actor text NOT NULL,
        actor_key text,
        action text NOT NULL,
        mint text,
        side text,
        size numeric(39, 0),
        received numeric(39, 0),
        verdict text,
        reasons jsonb NOT NULL,
        rule_version text,
        signature text,
        status text NOT NULL,
        note text
      )`
      .then(
        () =>
          sql`CREATE INDEX IF NOT EXISTS journal_wallet_time ON journal (wallet, network, time DESC)`,
      )
      .catch((error: unknown) => {
        ready = null
        throw error
      }))
  return {
    async insert(r) {
      await schema()
      await sql`INSERT INTO journal ${sql({
        id: r.id,
        time: r.time,
        slot: r.slot,
        network: r.network,
        wallet: r.wallet,
        actor: r.actor,
        actor_key: r.actorKey,
        action: r.action,
        mint: r.mint,
        side: r.side,
        size: r.size,
        received: r.received,
        verdict: r.verdict,
        reasons: sql.json(r.reasons),
        rule_version: r.ruleVersion,
        signature: r.signature,
        status: r.status,
        note: r.note ?? null,
      })}`
    },
    async list(wallet, net, limit, withUnattributed) {
      await schema()
      // 2 queries side by side on the pool, so hiding costs no extra round trip in sequence.
      const [found, [count]] = await Promise.all([
        sql`
          SELECT * FROM journal WHERE wallet = ${wallet} AND network = ${net}
          AND (${withUnattributed} OR actor <> 'unattributed')
          ORDER BY time DESC, seq DESC LIMIT ${limit}`,
        withUnattributed
          ? Promise.resolve([{ hidden: 0 }])
          : sql`
              SELECT count(*)::int AS hidden FROM journal
              WHERE wallet = ${wallet} AND network = ${net} AND actor = 'unattributed'`,
      ])
      const rows = found.map((r) => ({
        id: r['id'],
        time: new Date(r['time']).toISOString(),
        slot: r['slot'] === null ? null : Number(r['slot']),
        network: r['network'],
        wallet: r['wallet'],
        actor: r['actor'],
        actorKey: r['actor_key'],
        action: r['action'],
        mint: r['mint'],
        side: r['side'],
        size: r['size'],
        received: r['received'],
        verdict: r['verdict'],
        reasons: r['reasons'],
        ruleVersion: r['rule_version'],
        signature: r['signature'],
        status: r['status'],
        ...(r['note'] === null ? {} : { note: r['note'] }),
      })) as JournalRow[]
      return { rows, hidden: Number(count?.['hidden'] ?? 0) }
    },
  }
}

/** The journal this process writes to: Postgres when a URL is given, else every write a named failure. */
export const journalFor = (url: string | undefined): Journal =>
  createJournal(url !== undefined && url !== '' ? postgresStore(url) : noDatabase)

/**
 * check_trade's row, built from our own values only: the parsed input, and the verdict or the
 * refusal. Over MCP the caller proves no key, and anyone who reaches the server can ask about any
 * wallet, so the row is unattributed: it never reads as the person's or their agent's.
 */
export const checkTradeRow = (
  trade: CheckTradeInput,
  outcome: { verdict: CheckTradeOutput } | { error: unknown },
): JournalRow => {
  const answered = 'verdict' in outcome ? outcome.verdict : null
  const error = 'error' in outcome ? outcome.error : null
  return {
    id: randomUUID(),
    time: new Date().toISOString(),
    slot: answered?.dataSlot ?? null,
    network: network(process.env['AGON_NETWORK']).id,
    wallet: trade.wallet,
    actor: 'unattributed',
    actorKey: null,
    action: 'check_trade' satisfies JournalAction,
    mint: trade.mint,
    side: trade.side,
    size: trade.size,
    received: null,
    verdict: answered?.verdict ?? null,
    // A refusal's text is a catalogue row of ours. Any other error's text could carry what an
    // upstream sent, so only its name is kept.
    reasons:
      answered?.reasons ??
      (error instanceof Refusal
        ? [{ rule: error.failure.id, message: error.failure.text }]
        : [{ rule: 'check-failed', message: `check_trade stopped with ${causeOf(error)}.` }]),
    ruleVersion: answered?.ruleVersion ?? null,
    signature: null,
    status: answered === null ? 'refused' : 'checked',
  }
}

// The signed read. A nonce is issued for 1 wallet, works once, and lives NONCE_TTL_S.
//
// Stateless until used: a nonce is its expiry, 8 random bytes and an HMAC over those and the wallet,
// under a key made at start. Issuing stores nothing, so asking for nonces in a loop cannot fill a
// table and lock real readers out. Only a nonce that opened the journal is remembered, until it
// expires, so it cannot open it twice.

const NONCE_TTL_S = 60
const NONCE_KEY = randomBytes(32)
const used = new Map<string, number>()

const nonceMac = (wallet: string, head: Buffer): Buffer =>
  createHmac('sha256', NONCE_KEY).update(head).update(wallet).digest().subarray(0, 16)

/** The exact text the owner or the hired key signs. Says plainly that signing it moves nothing. */
export const activityMessage = (wallet: string, nonce: string): string =>
  `Agon: show the journal of ${wallet}. Nonce ${nonce}. Signing this moves no funds.`

const issueNonce = (wallet: string, now: number): string => {
  const head = Buffer.alloc(16)
  head.writeBigUInt64BE(BigInt(now + NONCE_TTL_S * 1000))
  randomBytes(8).copy(head, 8)
  return Buffer.concat([head, nonceMac(wallet, head)]).toString('hex')
}

/** Why this nonce cannot open this wallet's journal now, or null when it can. */
const nonceProblem = (wallet: string, nonce: string, now: number): string | null => {
  const bytes = Buffer.from(nonce, 'hex')
  const head = bytes.subarray(0, 16)
  if (!timingSafeEqual(bytes.subarray(16), nonceMac(wallet, head))) {
    return 'That nonce was not issued by this server for this wallet, or the server restarted since.'
  }
  const expires = Number(head.readBigUInt64BE(0))
  if (expires <= now) return `That nonce expired ${Math.ceil((now - expires) / 1000)} s ago.`
  if (used.has(nonce)) return 'That nonce was already used.'
  return null
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
/** Base58 to bytes; an empty buffer for any character outside the alphabet. */
const fromBase58 = (text: string): Buffer => {
  let n = 0n
  for (const c of text) {
    const digit = B58.indexOf(c)
    if (digit < 0) return Buffer.alloc(0)
    n = n * 58n + BigInt(digit)
  }
  const bytes: number[] = []
  for (; n > 0n; n /= 256n) bytes.unshift(Number(n % 256n))
  const zeros = text.length - text.replace(/^1+/, '').length
  return Buffer.concat([Buffer.alloc(zeros), Buffer.from(bytes)])
}

/** DER prefix that turns 32 raw ed25519 public key bytes into an SPKI key node:crypto reads. */
const ED25519_SPKI = Buffer.from('302a300506032b6570032100', 'hex')

/** True only for a valid ed25519 signature by `signer` over `message` as UTF-8. Never throws. */
export const signedBy = (signer: string, message: string, signature: string): boolean => {
  try {
    const sig = fromBase58(signature)
    if (sig.length !== 64) return false
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI, new PublicKey(signer).toBuffer()]),
      format: 'der',
      type: 'spki',
    })
    return verify(null, Buffer.from(message, 'utf8'), key, sig)
  } catch {
    return false
  }
}

/** Refused for want of proof. Carries a fresh challenge when the caller sent none. */
export class Unauthorized extends Refusal {
  constructor(
    failure: FailureMessage,
    readonly challenge?: { nonce: string; message: string; expiresInS: number },
  ) {
    super(failure)
  }
}

/**
 * get_activity and `GET /activity`, 1 function. The wallet alone gets a nonce to sign. The signer,
 * that nonce and an ed25519 signature over its text get rows, if the signer is the wallet itself or
 * a key the wallet's vault hires on chain right now. Anything else is Unauthorized, with the reason.
 */
export const readActivity = async (
  input: GetActivityInput,
  io: ToolIo,
  journal: Journal,
  now = Date.now(),
): Promise<Activity> => {
  const { wallet, signer, nonce, signature } = input
  if (signer === undefined || nonce === undefined || signature === undefined) {
    const fresh = issueNonce(wallet, now)
    const message = activityMessage(wallet, fresh)
    throw new Unauthorized(needsSignature({ wallet, message, seconds: NONCE_TTL_S }), {
      nonce: fresh,
      message,
      expiresInS: NONCE_TTL_S,
    })
  }

  const problem = nonceProblem(wallet, nonce, now)
  if (problem !== null) throw new Unauthorized(nonceRejected({ why: problem }))
  if (!signedBy(signer, activityMessage(wallet, nonce), signature)) {
    throw new Unauthorized(badSignature({ signer }))
  }
  if (signer !== wallet) {
    let hired: string[]
    let vault: string | null
    try {
      const found = await io.loadVaultRules(wallet)
      hired = found.rules.map((r) => r.authority)
      vault = found.vault
    } catch (error) {
      throw new Unauthorized(hiringUnread({ wallet, signer, cause: causeOf(error) }))
    }
    if (!hired.includes(signer)) {
      throw new Unauthorized(notHired({ wallet, signer, vault, hired: new Set(hired).size }))
    }
  }
  // Spent only once it has opened the journal, so a wrong attempt cannot burn a reader's nonce and
  // only an authorised reader adds to this map. 2 concurrent reads with 1 nonce by the same reader
  // can both pass the check above; each shows that reader what they may read anyway.
  if (used.has(nonce))
    throw new Unauthorized(nonceRejected({ why: 'That nonce was already used.' }))
  for (const [n, expires] of used) if (expires <= now) used.delete(n)
  used.set(nonce, Number(Buffer.from(nonce, 'hex').readBigUInt64BE(0)))

  const limit = input.limit ?? 10
  const withUnattributed = input.unattributed === true
  const { rows, hidden, failures } = await journal.read(wallet, limit, withUnattributed)
  const net = network(process.env['AGON_NETWORK']).id
  return {
    wallet,
    rows,
    writeFailures: failures.slice(-FAILURES_LISTED).reverse(),
    unattributedHidden: hidden,
    basis:
      `Newest first, ${rows.length} of this wallet's journal rows on ${net}, ${limit} at most. ` +
      (failures.length === 0
        ? '0 writes failed since this server started. '
        : `${failures.length} write${failures.length === 1 ? '' : 's'} failed since this server ` +
          `started, the newest ${Math.min(failures.length, FAILURES_LISTED)} listed in ` +
          'writeFailures; those calls have no row. ') +
      (withUnattributed
        ? 'Unattributed rows are included as asked: anyone who reaches this server can write ' +
          'them, so they are not proof that the person or their agent asked.'
        : `${hidden} unattributed row${hidden === 1 ? '' : 's'} hidden: checks by a caller who ` +
          'proved no key, which anyone can write. Pass unattributed true to see them.'),
  }
}

/**
 * `GET /activity?wallet=&signer=&nonce=&signature=&limit=&unattributed=`, as a status and a body. 400 for a
 * malformed query, 401 with the reason (and a nonce when none was sent), 503 when the journal cannot
 * be read, 200 with rows.
 */
export const activityRoute = async (
  url: URL,
  io: ToolIo,
  journal: Journal,
): Promise<{ status: number; body: unknown }> => {
  const net = network(process.env['AGON_NETWORK']).short
  // No prototype, so a key named __proto__ is just a key, and strictObject refuses it.
  const query: Record<string, unknown> = Object.create(null)
  for (const [key, value] of url.searchParams) {
    if (key in query) {
      return { status: 400, body: { network: net, error: `${key} is given twice; send it once.` } }
    }
    // Typed here so the contract can refuse anything else: a limit is a number, a flag true or false.
    query[key] =
      key === 'limit'
        ? Number(value)
        : key === 'unattributed' && (value === 'true' || value === 'false')
          ? value === 'true'
          : value
  }
  const parsed = GetActivityInput.safeParse(query)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return {
      status: 400,
      body: {
        network: net,
        error:
          `${String(issue?.path[0] ?? 'query')} is not valid: ${issue?.message ?? 'unreadable'}. ` +
          'Send wallet, then signer, nonce, signature (base58) and limit (1 to 10) to read rows.',
      },
    }
  }
  try {
    return {
      status: 200,
      body: { network: net, ...(await readActivity(parsed.data, io, journal)) },
    }
  } catch (error) {
    if (error instanceof Unauthorized) {
      return { status: 401, body: { network: net, error: error.message, ...error.challenge } }
    }
    const message = error instanceof Refusal ? error.message : `Reading failed: ${causeOf(error)}.`
    return { status: 503, body: { network: net, error: message } }
  }
}

// This module's failure rows. Each names the cause, the number and what to do next (T-E10's rule).

const needsSignature = (a: {
  wallet: string
  message: string
  seconds: number
}): FailureMessage => ({
  id: 'activity-needs-signature',
  text:
    `The journal of ${a.wallet} is shown only to that wallet or to a key its vault hires. Sign ` +
    `this exact text, as UTF-8, with that key, then call again with signer, nonce and signature ` +
    `(base58) within ${a.seconds} s: ${a.message}`,
  mode: 'closed',
  systemDoes: 'Issues 1 nonce for this wallet, valid once, and shows no rows.',
})

const nonceRejected = (a: { why: string }): FailureMessage => ({
  id: 'activity-nonce-rejected',
  text:
    `${a.why} A nonce works once, for ${NONCE_TTL_S} s, for the wallet it was issued for. Call ` +
    'again with the wallet alone for a new one.',
  mode: 'closed',
  systemDoes: 'Shows no rows.',
})

const badSignature = (a: { signer: string }): FailureMessage => ({
  id: 'activity-bad-signature',
  text:
    `The signature does not verify for ${a.signer} over the text this nonce was issued with, so ` +
    'no rows are shown. Sign that exact text, as UTF-8, with the ed25519 key of the signer you name.',
  mode: 'closed',
  systemDoes: 'Shows no rows. The nonce is not spent, so the right signature can still use it.',
})

const notHired = (a: {
  wallet: string
  signer: string
  vault: string | null
  hired: number
}): FailureMessage => ({
  id: 'activity-not-hired',
  text:
    a.vault === null
      ? `${a.signer} is not ${a.wallet}, and ${a.wallet} has no vault on this chain, so no key is ` +
        'hired by it and no rows are shown. Sign with the wallet itself.'
      : `${a.signer} is not ${a.wallet} and not among the ${a.hired} agent key${a.hired === 1 ? '' : 's'} ` +
        `its vault ${a.vault} hires on chain now, so no rows are shown. Sign with the wallet or a hired key.`,
  mode: 'closed',
  systemDoes: 'Reads the vault from the chain, finds no role for the signer, and shows no rows.',
})

const hiringUnread = (a: { wallet: string; signer: string; cause: string }): FailureMessage => ({
  id: 'activity-hiring-unread',
  text:
    `The vault of ${a.wallet} could not be read from the chain (${a.cause}), so whether ` +
    `${a.signer} is hired is unknown and no rows are shown. Try again, or sign with the wallet ` +
    'itself, which needs no chain read.',
  mode: 'closed',
  systemDoes: 'Fails closed: an unverified key is never treated as hired.',
})

const journalUnreadable = (a: { cause: string }): FailureMessage => ({
  id: 'journal-unreadable',
  text:
    `The journal could not be read (${a.cause}), so no rows are shown, which is not the same as ` +
    'an empty journal. Try again in a minute; if it repeats, the database is down or not set.',
  mode: 'open',
  systemDoes: 'Shows no rows and says why, rather than an empty list.',
})
