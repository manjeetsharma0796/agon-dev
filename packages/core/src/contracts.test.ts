import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ArmedRule,
  CheckTradeInput,
  CheckTradeOutput,
  Coverage,
  MinedRule,
  Report,
  ReportRange,
  Reason,
  TOOLS,
  toolContracts,
  toolJsonSchemas,
} from './index.js'

/**
 * Read a contract fixture, dropping the `synthetic` marker every file under fixtures/ carries to
 * declare where it came from. The marker is provenance, not part of any contract.
 */
const example = (name: string) => {
  const { synthetic, ...body } = JSON.parse(
    readFileSync(new URL(`../../../fixtures/contracts/${name}.json`, import.meta.url), 'utf8'),
  )
  if (synthetic !== true) throw new Error(`${name}.json must declare synthetic: true`)
  return body
}

// Consumer 4 of 4: the examples. A renamed or retyped field fails here with the field name in the
// error, which is what makes a shape change loud instead of quiet.
describe('examples parse against their contract', () => {
  it('check_trade input', () => {
    expect(() => CheckTradeInput.parse(example('check-trade-input'))).not.toThrow()
  })

  it('check_trade output', () => {
    expect(() => CheckTradeOutput.parse(example('check-trade-output'))).not.toThrow()
  })

  it('report', () => {
    expect(() => Report.parse(example('report'))).not.toThrow()
  })

  it('armed rule', () => {
    expect(() => ArmedRule.parse(example('armed-rule'))).not.toThrow()
  })

  // A wallet we read nothing for. It is a separate file because the interesting part is a value
  // rather than a shape: share must be 0 here, and until T-A06 the contract exempted this exact
  // case from its own arithmetic, so a report claiming we had understood 100% of a wallet we had
  // decoded none of parsed clean.
  it('report for a wallet with nothing decoded', () => {
    const empty = example('report-empty-wallet')
    expect(() => Report.parse(empty)).not.toThrow()
    expect(() => Report.parse({ ...empty, coverage: { ...empty.coverage, share: 1 } })).toThrow()
  })
})

describe('the tool list is the stable four', () => {
  it('names exactly the four tools, in order', () => {
    expect([...TOOLS]).toEqual(['get_report', 'check_trade', 'arm_rule', 'list_rules'])
  })

  // Consumers 1 and 3: the MCP JSON schemas and the zod validators are the same definition, so a
  // tool cannot have a schema the validator disagrees with.
  it('generates a JSON schema for every tool from the same zod schema', () => {
    for (const name of TOOLS) {
      expect(toolContracts[name].input).toBeDefined()
      expect(toolJsonSchemas[name].input).toMatchObject({ type: 'object' })
      expect(toolJsonSchemas[name].output).toBeDefined()
    }
  })

  // Consumer 2 of 4: frontend types. `keyof CheckTradeInput` is a compile-time check, so renaming a
  // field in the contract breaks tsc on this line as well as the runtime comparison below it.
  it('pins the input field names in the type and in the generated schema', () => {
    const keys: ReadonlyArray<keyof CheckTradeInput> = ['mint', 'side', 'size', 'wallet']
    const input = toolJsonSchemas.check_trade.input as { properties: Record<string, unknown> }
    expect(Object.keys(input.properties).sort()).toEqual([...keys].sort())
  })
})

// The invariants below are the report's honesty rules. They are the reason these are schemas and not
// bare TypeScript interfaces: a type cannot stop a partial read being rendered as a complete one.
describe('a contract refuses a dishonest value', () => {
  it('rejects a number without its limit or unit', () => {
    expect(Reason.safeParse({ rule: 'size', message: 'too big', observed: 4.1 }).success).toBe(
      false,
    )
  })

  it('rejects a non-pass verdict with no reason', () => {
    const bare = { verdict: 'block', reasons: [], dataSlot: 1, ruleVersion: 'v1' }
    expect(CheckTradeOutput.safeParse(bare).success).toBe(false)
  })

  it('rejects an incomplete read that does not say why it stopped', () => {
    const silent = {
      readTransactions: 1240,
      estimatedTotal: 2000,
      throughSlot: 1,
      complete: false,
      stoppedBecause: null,
    }
    expect(ReportRange.safeParse(silent).success).toBe(false)
  })

  it('rejects a found rule with no value, and an unfound rule with no reason', () => {
    const base = { kind: 'stop', sampleSize: 22, requiredSampleSize: 20 }
    expect(MinedRule.safeParse({ ...base, found: true, value: null, reason: null }).success).toBe(
      false,
    )
    expect(MinedRule.safeParse({ ...base, found: false, value: null, reason: null }).success).toBe(
      false,
    )
  })

  it('rejects a coverage share that disagrees with its own counts', () => {
    expect(Coverage.safeParse({ decodedSwaps: 83, totalSwaps: 100, share: 0.99 }).success).toBe(
      false,
    )
    expect(Coverage.safeParse({ decodedSwaps: 120, totalSwaps: 100, share: 1 }).success).toBe(false)
  })

  it('rejects an amount that would lose precision as a JSON number', () => {
    // 18446744073709551615 is u64 max. As a number it rounds; as a string it survives.
    const big = '18446744073709551615'
    expect(Number(big).toString()).not.toBe(big)
    const parsed = ArmedRule.parse(example('armed-rule'))
    expect(typeof parsed.spec.cap.amount).toBe('string')
  })
})
