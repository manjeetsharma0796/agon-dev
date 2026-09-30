// The 3 legs T-E03 wires end to end: a report, a trade check, and arming. Pure functions over
// plain data, 0 network calls, so the same code answers the API route, the MCP tool and the tests.
// Integration bugs show here on day 2 rather than in a demo on day 18.
//
// Every leg validates its input against the frozen contract before it does anything, and validates
// what it returns before handing it back. A fixture that drifts out of shape fails here and not in
// front of a judge.

import { readFileSync } from 'node:fs'
import {
  ArmedRule,
  armingOffFork,
  ArmingLink,
  CheckTradeInput,
  CheckTradeOutput,
  network,
  noPublicAddress,
  Refusal,
  Report,
  ArmRequest,
  WalletQuery,
} from '@agon/core'

export { FIXTURE_NOTE } from './fixture-note.js'

/**
 * Reads a contract example. Same loader as packages/core's contract test, including dropping the
 * `synthetic` marker that every file under fixtures/ carries so nothing downstream reads one as a
 * measurement.
 */
const fixture = (name: string): unknown => {
  const url = new URL(`../../../fixtures/contracts/${name}.json`, import.meta.url)
  let text: string
  try {
    text = readFileSync(url, 'utf8')
  } catch {
    throw new Error(
      `The ${name} fixture is missing. It should be at fixtures/contracts/${name}.json, which is ` +
        `what these legs serve until real data lands. Run from the repo root.`,
    )
  }
  const { synthetic: _synthetic, ...rest } = JSON.parse(text) as Record<string, unknown>
  return rest
}

/** Leg 1. Paste an address, get a report. The wallet is the one that was asked about; every number
 *  beside it comes from the fixture, which is what FIXTURE_NOTE has to be shown next to. */
export const report = (input: unknown): Report => {
  const { wallet } = WalletQuery.parse(input)
  return Report.parse({ ...(fixture('report') as object), wallet })
}

/** Leg 2. A verdict for a proposed trade. */
export const checkTrade = (input: unknown): CheckTradeOutput => {
  CheckTradeInput.parse(input)
  return CheckTradeOutput.parse(fixture('check-trade-output'))
}

/** Thrown by arming, which is the one leg that must refuse rather than pretend. */
export class NotArmable extends Refusal {
  readonly code = 'not-armable'
}

/**
 * Leg 3. `arm_rule` hands back a link to the arming screen, and arms nothing itself.
 *
 * Nothing exists on chain until the user's wallet signs on that screen, where the cap is set by the
 * user from the miner's suggestion. So this returns a place, never a role id or an order id it did
 * not create. It still fails closed: off the fork, or with no screen to send anyone to, it refuses
 * with the reason rather than returning a link to a page that would refuse anyway.
 */
export const armRule = (
  input: unknown,
  env: { publicUrl: string | undefined; network: string | undefined },
): ArmingLink => {
  const spec = ArmRequest.parse(input)
  // Refusals name whoever the link was for: the wallet if the agent knew it, else its own key.
  const whose = spec.wallet ?? `the wallet that hires agent ${spec.agent}`
  const net = network(env.network)
  if (net.id !== 'fork') {
    throw new NotArmable(armingOffFork({ wallet: whose, network: net.short }))
  }
  if (!env.publicUrl) {
    throw new NotArmable(noPublicAddress({ wallet: whose }))
  }
  const url = new URL('/arm', env.publicUrl)
  // The fragment, not the query: a browser never sends it to a server, so neither key lands in
  // anyone's request log. The screen reads `agent` to fill in the key the user would paste.
  url.hash = [
    spec.wallet === undefined ? null : `wallet=${spec.wallet}`,
    spec.agent === undefined ? null : `agent=${spec.agent}`,
  ]
    .filter((part) => part !== null)
    .join('&')
  return ArmingLink.parse({
    url: url.toString(),
    wallet: spec.wallet ?? null,
    agent: spec.agent ?? null,
    note:
      `Open this link and connect ${spec.wallet ?? 'your wallet'}. You set the spending limit ` +
      `there yourself, starting from what your own trading history suggests; this tool never ` +
      `names one.`,
  })
}

/** Exported so a caller can show what arming will return once it is on. Never served as a result. */
export const armedRuleExample = (): ArmedRule => ArmedRule.parse(fixture('armed-rule'))
