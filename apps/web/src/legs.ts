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
  CheckTradeInput,
  CheckTradeOutput,
  Report,
  RuleSpec,
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
export class NotArmable extends Error {
  readonly code = 'not-armable'
}

/**
 * Leg 3. Arming is a no-op, and a no-op that refuses rather than one that answers.
 *
 * `arm_rule` returns an `ArmedRule`, which names a Swig role id and a Jupiter order id. Those are
 * claims that something exists on chain. Nothing does: F5 and F6 have not passed and T-D04 has not
 * been ticked, so no transaction has been built, let alone signed. Returning the fixture here would
 * be a fabricated verification, and this is the path that grants spend authority, so it fails
 * closed. The spec is still validated, because that is the part that is real today.
 */
export const armRule = (input: unknown): never => {
  const spec = RuleSpec.parse(input)
  throw new NotArmable(
    `Arming is off. The rule is valid, covering ${spec.mints.length} mint(s) with a cap of ` +
      `${spec.cap.amount} base units per ${spec.cap.windowSeconds}s, but nothing was created: ` +
      `no Swig role and no Jupiter order exist for it. Arming turns on when F5 and F6 pass and ` +
      `the pre-mainnet checklist is ticked. Until then this endpoint refuses rather than reporting ` +
      `a role that is not there.`,
  )
}

/** Exported so a caller can show what arming will return once it is on. Never served as a result. */
export const armedRuleExample = (): ArmedRule => ArmedRule.parse(fixture('armed-rule'))
