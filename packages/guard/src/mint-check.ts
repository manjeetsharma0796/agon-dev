// Our own mint check. T-C04.
//
// This is the primary path for "can this token take my money back", so it reads the chain itself
// rather than asking a scoring service. RugCheck is enrichment and is deliberately absent from
// this file: nothing here may depend on a third party's opinion, because their outage would
// become our verdict.
//
// Everything the check needs arrives in exactly 1 `getMultipleAccounts`. `jsonParsed` gives
// mintAuthority, freezeAuthority and the Token-2022 extension list directly, so there is no
// account layout decoding here.
//
// Nothing in this file caches. Mint and freeze authority can be revoked, and can be handed to a
// new key, between one block and the next, and a cached "no freeze authority" is exactly the
// answer that lets funds move into a token that can freeze them. Reading it again costs one
// account in a batch we are already sending.

import { call, type NetRequest, type NetResult } from '@agon/core'
import type { Reason, Verdict } from '@agon/core'
import { rpcCall } from '@agon/core/dist/net/record.js'

export const RULE_VERSION = 'mint-check/1'

/** What a mint account says about itself. Every field is read fresh, none is cached. */
export interface MintFacts {
  mint: string
  program: 'spl-token' | 'spl-token-2022'
  /** Set means the supply can still grow. Dilution, not seizure, so it is reported and not blocked. */
  mintAuthority: string | null
  /** Set means someone can freeze your balance in place. */
  freezeAuthority: string | null
  /** Set means someone can move your balance without your signature. */
  permanentDelegate: string | null
  /** The hook program, or null. The extension can be present with no hook set; that is not a hook. */
  transferHookProgram: string | null
  /** The worse of the two scheduled fees, in basis points, or null when the token charges none. */
  transferFeeBps: number | null
}

export interface MintCheck {
  mint: string
  verdict: Verdict
  reasons: Reason[]
  /** The slot the facts were read at, or null when nothing could be read, which is why it blocked. */
  dataSlot: number | null
  /** Every verdict is stamped, so a verdict read later says which rules produced it. */
  ruleVersion: string
  facts: MintFacts | null
}

/** The one message the user sees when we could not read the chain. T-C04 fixes the wording. */
const UNVERIFIED = "Couldn't verify this token. Not safe to proceed."

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null

const str = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null

const blocked = (
  mint: string,
  rule: string,
  message: string,
  dataSlot: number | null,
): MintCheck => ({
  mint,
  verdict: 'block',
  reasons: [{ rule, message }],
  dataSlot,
  ruleVersion: RULE_VERSION,
  facts: null,
})

/**
 * The fee that can actually be charged. A Token-2022 mint carries 2 scheduled fees and which one
 * applies depends on the current epoch, which this account does not carry and which we will not
 * spend a second RPC call to learn. So it reports the worse of the two: being told a fee is higher
 * than it turns out to be costs the user nothing, and the reverse costs them the difference.
 */
const feeBps = (state: Record<string, unknown>): number | null => {
  const read = (key: string): number | null => {
    const fee = asRecord(state[key])
    const bps = fee?.['transferFeeBasisPoints']
    return typeof bps === 'number' ? bps : null
  }
  const both = [read('newerTransferFee'), read('olderTransferFee')].filter(
    (n): n is number => n !== null,
  )
  return both.length === 0 ? null : Math.max(...both)
}

const extensionsOf = (info: Record<string, unknown>): Map<string, Record<string, unknown>> => {
  const out = new Map<string, Record<string, unknown>>()
  const list = info['extensions']
  if (!Array.isArray(list)) return out
  for (const entry of list) {
    const record = asRecord(entry)
    const name = str(record?.['extension'])
    const state = asRecord(record?.['state'])
    if (name !== null && state !== null) out.set(name, state)
  }
  return out
}

/** Reads one account from a `getMultipleAccounts` result. Anything unexpected is a block. */
const readAccount = (mint: string, account: unknown, slot: number): MintCheck => {
  const node = asRecord(account)
  if (node === null) {
    // getMultipleAccounts returns null for an address that holds no account.
    return blocked(mint, 'mint-not-found', `${UNVERIFIED} No account exists at ${mint}.`, slot)
  }
  const data = asRecord(node['data'])
  const program = str(data?.['program'])
  const parsed = asRecord(data?.['parsed'])
  const info = asRecord(parsed?.['info'])

  if (program !== 'spl-token' && program !== 'spl-token-2022') {
    return blocked(
      mint,
      'mint-unknown-program',
      `${UNVERIFIED} ${mint} is owned by ${program ?? 'an unreadable program'}, not by a token program.`,
      slot,
    )
  }
  if (str(parsed?.['type']) !== 'mint' || info === null) {
    return blocked(mint, 'mint-not-a-mint', `${UNVERIFIED} ${mint} is not a mint account.`, slot)
  }

  const extensions = extensionsOf(info)
  const hook = extensions.get('transferHook')
  const delegate = extensions.get('permanentDelegate')
  const fee = extensions.get('transferFeeConfig')

  const facts: MintFacts = {
    mint,
    program,
    mintAuthority: str(info['mintAuthority']),
    freezeAuthority: str(info['freezeAuthority']),
    permanentDelegate: delegate ? str(delegate['delegate']) : null,
    transferHookProgram: hook ? str(hook['programId']) : null,
    transferFeeBps: fee ? feeBps(fee) : null,
  }

  const reasons: Reason[] = []
  // Blocking: each of these lets somebody other than the holder move or immobilise the balance.
  if (facts.freezeAuthority !== null) {
    reasons.push({
      rule: 'mint-freeze-authority',
      message:
        `Freeze authority is live on this token, held by ${facts.freezeAuthority}. That key can ` +
        `freeze your balance in place at any time, including while you are trying to sell. Trade ` +
        `a token whose freeze authority is revoked.`,
    })
  }
  if (facts.permanentDelegate !== null) {
    reasons.push({
      rule: 'mint-permanent-delegate',
      message:
        `This token has a permanent delegate, ${facts.permanentDelegate}, which can move your ` +
        `balance without your signature. There is no setting that protects you from it. Trade a ` +
        `token without one.`,
    })
  }
  if (facts.transferHookProgram !== null) {
    reasons.push({
      rule: 'mint-transfer-hook',
      message:
        `Every transfer of this token runs program ${facts.transferHookProgram} first, which can ` +
        `make a sale fail at a time it chooses. Trade a token with no transfer hook.`,
    })
  }

  // Reported, not blocking. A mint authority dilutes; it does not take what you hold, and revoking
  // it is not the norm: USDC has one. Blocking on it would refuse most of what people actually trade.
  if (facts.mintAuthority !== null) {
    reasons.push({
      rule: 'mint-authority-live',
      message:
        `The supply of this token can still be increased by ${facts.mintAuthority}. That dilutes ` +
        `holders but cannot take what you hold.`,
    })
  }
  if (facts.transferFeeBps !== null && facts.transferFeeBps > 0) {
    reasons.push({
      rule: 'mint-transfer-fee',
      message:
        `This token charges ${(facts.transferFeeBps / 100).toFixed(2)}% on every transfer, so a ` +
        `round trip costs you that twice before any price move.`,
    })
  }

  // What blocks is what can take a position or immobilise it. A freeze authority is reported with
  // its own reason and does not block, decided at CP1 on 2026-09-24 after F3 measured USDC and USDT
  // flagged by it. Both have a live freeze authority, as do PYUSD, USDG, cbBTC and the tokenised
  // equities: for a regulated issuer it is how a court order is obeyed, and for a memecoin deployer
  // it is how your position is taken. The mint account cannot tell those apart, so the check states
  // the fact and lets the trade through, and a guard that blocks the most traded token on Solana
  // gets switched off by its user on day 1. Telling Circle from a stranger needs an issuer
  // allowlist, which is T-C06 work with a threshold of its own.
  const blocking = new Set(['mint-permanent-delegate', 'mint-transfer-hook'])
  const verdict: Verdict = reasons.some((r) => blocking.has(r.rule)) ? 'block' : 'pass'
  return { mint, verdict, reasons, dataSlot: slot, ruleVersion: RULE_VERSION, facts }
}

export interface MintCheckDeps {
  /** Injectable so a budget test can count calls. Defaults to the recorded and replayed wrapper. */
  net?: (req: NetRequest) => Promise<NetResult>
}

/**
 * Reads every mint in 1 call and returns a verdict per mint, in the order asked for.
 *
 * Fails closed. If the call throws, comes back non-200, carries a JSON-RPC error, or returns a
 * result that is not shaped like an account list, every mint asked about is blocked. A token we
 * could not read is not a token we can say is safe.
 */
export async function checkMints(
  mints: readonly string[],
  deps: MintCheckDeps = {},
): Promise<Map<string, MintCheck>> {
  const net = deps.net ?? call
  const out = new Map<string, MintCheck>()
  if (mints.length === 0) return out

  const failClosed = (detail: string): Map<string, MintCheck> => {
    for (const mint of mints)
      out.set(mint, blocked(mint, 'mint-rpc-unreachable', `${UNVERIFIED} ${detail}`, null))
    return out
  }

  let result: NetResult
  try {
    result = await net(rpcCall('getMultipleAccounts', [[...mints], { encoding: 'jsonParsed' }]))
  } catch (error) {
    return failClosed(
      `The chain could not be reached (${error instanceof Error ? error.name : 'unknown error'}).`,
    )
  }

  if (result.status !== 200) {
    return failClosed(`The chain answered ${result.status}.`)
  }
  const body = asRecord(result.body)
  if (body?.['error'] !== undefined) {
    const message = str(asRecord(body['error'])?.['message']) ?? 'an error'
    return failClosed(`The chain answered with ${message}.`)
  }
  const rpcResult = asRecord(body?.['result'])
  const value = rpcResult?.['value']
  const slot = asRecord(rpcResult?.['context'])?.['slot']
  if (!Array.isArray(value) || value.length !== mints.length || typeof slot !== 'number') {
    return failClosed('The chain answered with something that is not an account list.')
  }

  for (const [index, mint] of mints.entries()) {
    out.set(mint, readAccount(mint, value[index], slot))
  }
  return out
}
