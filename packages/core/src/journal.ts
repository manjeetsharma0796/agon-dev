import { z } from 'zod'
import { Address, BaseUnits, Slot } from './primitives.js'
import { Reason, Side, Verdict } from './check-trade.js'

// The journal (T-C30): 1 row per verdict and per action, with who did it, so the person and the agent
// read the same record. docs/plans/agon-terminal.md section 4.
//
// Mints, never token text. A row has no field that can hold a token's name, symbol or description,
// and `strictObject` refuses a row that tries to add one, because `get_activity` hands these rows to
// the agent and token text never reaches the agent.

/** Who pressed it. The owner on the web signs in Phantom; in a terminal or as the agent, a hired key. */
export const Actor = z.enum(['owner-web', 'owner-terminal', 'agent'])

/** What was done. `check_trade` is a verdict asked for; the rest are actions T-C32 writes. */
export const JournalAction = z.enum(['check_trade', 'buy', 'sell', 'cancel', 'pause', 'note'])

/**
 * Where the row stands. `checked`: a verdict was given. `refused`: the call stopped before a verdict,
 * and `reasons` says why. The rest are an action's life, from the plan's section 4.
 */
export const JournalStatus = z.enum([
  'checked',
  'refused',
  'proposed',
  'approved',
  'declined',
  'expired',
  'sent',
  'confirmed',
  'failed',
  'uncertain',
])

/** A Solana transaction signature, base58 of 64 bytes. */
export const TxSignature = z
  .string()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/, 'not a base58 transaction signature')

export const JournalRow = z.strictObject({
  id: z.uuid(),
  /** When the row was written, ISO 8601 UTC. */
  time: z.iso.datetime(),
  /** The slot the verdict's reads were taken at; null when the call stopped before any read. */
  slot: Slot.nullable(),
  network: z.enum(['fork', 'devnet', 'mainnet', 'unset']),
  /** The wallet whose journal this is: check_trade's wallet, or the vault owner for an action. */
  wallet: Address,
  actor: Actor,
  /**
   * The key that acted. Null when the caller proved no key: check_trade over MCP takes none (its
   * input is a frozen contract), so such a row says an unidentified agent asked, nothing more.
   */
  actorKey: Address.nullable(),
  action: JournalAction,
  mint: Address.nullable(),
  side: Side.nullable(),
  /** Base units of the asset spent, check_trade's meaning: the quote asset on a buy, the mint on a sell. */
  size: BaseUnits.nullable(),
  /** Base units that arrived, once the chain confirms a trade; null before that and for a check. */
  received: BaseUnits.nullable(),
  verdict: Verdict.nullable(),
  reasons: z.array(Reason),
  ruleVersion: z.string().min(1).nullable(),
  signature: TxSignature.nullable(),
  status: JournalStatus,
  /** Written by the person, never by a fetched source. */
  note: z.string().min(1).max(500).optional(),
})

/** A write that did not land, kept in memory and named on the next read so it is never silent. */
export const WriteFailure = z.strictObject({
  time: z.iso.datetime(),
  wallet: Address,
  action: JournalAction,
  /** The cause by name, for example `ECONNREFUSED` or `write-timeout`. Never the database's address. */
  cause: z.string().min(1),
})

/**
 * get_activity, and `GET /activity`. Called with the wallet alone, it is refused with a nonce to
 * sign; called again with the signer, that nonce and the signature, it answers.
 */
export const GetActivityInput = z.strictObject({
  wallet: Address,
  /** The vault's owner, or an agent key the vault has hired. */
  signer: Address.optional(),
  nonce: z
    .string()
    .regex(/^[0-9a-f]{64}$/, 'not a nonce this server issued')
    .optional(),
  /** Ed25519 over the exact text the refusal gave, base58. */
  signature: TxSignature.optional(),
  /** Newest rows to return, 10 at most. */
  limit: z.number().int().min(1).max(10).optional(),
})

export const Activity = z.object({
  wallet: Address,
  /** Newest first. */
  rows: z.array(JournalRow),
  /** The newest 5 writes for this wallet that failed since this server started; `basis` counts all. */
  writeFailures: z.array(WriteFailure),
  /** What the rows are and are not. Never blank. */
  basis: z.string().min(1),
})

export type Actor = z.infer<typeof Actor>
export type JournalAction = z.infer<typeof JournalAction>
export type JournalRow = z.infer<typeof JournalRow>
export type WriteFailure = z.infer<typeof WriteFailure>
export type GetActivityInput = z.infer<typeof GetActivityInput>
export type Activity = z.infer<typeof Activity>
