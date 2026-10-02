import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  Activity,
  ArmedRule,
  JournalRow,
  SyncForkResult,
  VaultStatus,
  ArmRequest,
  PrepareSwapInput,
  PreparedSwap,
  ArmingLink,
  CheckTradeInput,
  CheckTradeOutput,
  Coverage,
  MinedRule,
  Report,
  ReportRange,
  RuleSpec,
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

  // T-C25: 2 tools appended after prepare_swap, by a recorded decision.
  it('vault status, with a P&L that can be negative and never a bare null', () => {
    const status = example('vault-status')
    expect(() => VaultStatus.parse(status)).not.toThrow()
    expect(status.trades.some((t: { pnl: string | null }) => t.pnl?.startsWith('-'))).toBe(true)
    expect(() => VaultStatus.parse({ ...status, pnl: null, pnlNote: '' })).toThrow()
  })

  it('sync fork result', () => {
    expect(() => SyncForkResult.parse(example('sync-fork-result'))).not.toThrow()
  })

  it('arming link, which is what arm_rule returns', () => {
    expect(() => ArmingLink.parse(example('arming-link'))).not.toThrow()
  })

  // A model never names the cap. zod drops unknown keys by default, so without `strict` a cap
  // an agent sent would vanish silently and the agent would believe it had set one.
  it('a rule spec carrying a cap is refused, not silently stripped', () => {
    const spec = { ...example('armed-rule').spec }
    expect(() => RuleSpec.parse(spec)).not.toThrow()
    expect(() =>
      RuleSpec.parse({ ...spec, cap: { mint: spec.mints[0], amount: '1', windowSeconds: 60 } }),
    ).toThrow(/cap/)
  })

  // T-C24: an agent onboarding a user does not know their wallet yet, only its own key. The link
  // carries the key so the arming screen fills it in, and the chain carries the wallet back.
  it('arm_rule takes the agent key, the wallet, or both, but not neither, and still never a cap', () => {
    const { wallet, ...rest } = example('armed-rule').spec
    const agent = 'DNDYmqxubRKmMtnq88AW4aUHreu88XrrGijAKpUojw1A'
    expect(() => ArmRequest.parse({ ...rest, agent })).not.toThrow()
    expect(() => ArmRequest.parse({ ...rest, wallet })).not.toThrow()
    expect(() => ArmRequest.parse({ ...rest, wallet, agent })).not.toThrow()
    expect(() => ArmRequest.parse(rest)).toThrow(/wallet|agent/)
    expect(() =>
      ArmRequest.parse({
        ...rest,
        agent,
        cap: { mint: rest.mints[0], amount: '1', windowSeconds: 60 },
      }),
    ).toThrow(/cap/)
    expect(toolContracts.arm_rule.input).toBe(ArmRequest)
  })

  it('an armed rule names the wallet that owns the vault, which is what prepare_swap takes', () => {
    const { owner, ...rest } = example('armed-rule')
    expect(owner).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
    expect(() => ArmedRule.parse(rest)).toThrow(/owner/)
  })

  // A wallet we read nothing for. It is a separate file because the interesting part is a value
  // rather than a shape: share must be 0 here, and until T-A06 the contract exempted this exact
  // case from its own arithmetic, so a report claiming we had understood 100% of a wallet we had
  // decoded none of parsed clean.
  // T-C30: the journal, read by get_activity and GET /activity.
  it('activity, whose rows have no field for token text', () => {
    const activity = example('activity')
    expect(() => Activity.parse(activity)).not.toThrow()
    const [row] = activity.rows
    // Token text never reaches the agent: a row that tries to carry a token's name is refused, not stripped quietly.
    expect(JournalRow.safeParse({ ...row, name: 'USD Coin' }).success).toBe(false)
    expect(JournalRow.safeParse({ ...row, size: '3.2' }).success).toBe(false)
  })

  it('report for a wallet with nothing decoded', () => {
    const empty = example('report-empty-wallet')
    expect(() => Report.parse(empty)).not.toThrow()
    expect(() => Report.parse({ ...empty, coverage: { ...empty.coverage, share: 1 } })).toThrow()
  })
})

describe('the tool list is the stable four', () => {
  it('names exactly the four tools, in order', () => {
    // prepare_swap is appended last, as DECISIONS.md records, so the first 4 keep their order.
    expect([...TOOLS]).toEqual([
      'get_report',
      'check_trade',
      'arm_rule',
      'list_rules',
      'prepare_swap',
      'vault_status',
      'sync_fork',
      'get_activity',
    ])
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
    // The cap lives on the role, not the spec, since it was taken off what an agent may send.
    expect(typeof parsed.swigRole.tokenRecurringLimit.amount).toBe('string')
    expect(typeof parsed.effectiveRemaining).toBe('string')
  })
})

// T-C17. list_rules reads a rule back from chain, and the chain stores the role but not the
// spec (trigger type, expiry) or the order id, and counts its window in slots. So a rule read from
// chain carries a null spec and a slot window, and never a converted guess at seconds.
describe('an ArmedRule read back from chain', () => {
  const vault = 'C7Bz4nps2z1NDftJUBzXQyeR2iDE5j5ztad5q1k4iA8R'
  const fromChain = {
    spec: null,
    swigRole: {
      roleId: '1',
      authority: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
      program: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
      tokenRecurringLimit: {
        mint: 'So11111111111111111111111111111111111111112',
        amount: '500000000',
        windowSlots: 150,
      },
    },
    jupiterOrderId: null,
    vault,
    owner: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
    effectiveRemaining: '500000000',
    rollingWorstCase: '1000000000',
  }

  it('parses with a null spec and a window in slots', () => {
    expect(() => ArmedRule.parse(fromChain)).not.toThrow()
  })

  it('refuses a limit with no window in either unit', () => {
    const noWindow = {
      ...fromChain,
      swigRole: {
        ...fromChain.swigRole,
        tokenRecurringLimit: { mint: fromChain.swigRole.tokenRecurringLimit.mint, amount: '1' },
      },
    }
    expect(ArmedRule.safeParse(noWindow).success).toBe(false)
  })

  it('refuses a rule that does not say where its vault is or what is left', () => {
    const { vault: _v, ...noVault } = fromChain
    const { effectiveRemaining: _e, ...noRemaining } = fromChain
    expect(ArmedRule.safeParse(noVault).success).toBe(false)
    expect(ArmedRule.safeParse(noRemaining).success).toBe(false)
  })
})

// T-C21: prepare_swap. The owner holds the vault, the history wallet is whose habits the guard
// judges (read only), and the agent is the only signer.
describe('prepare_swap', () => {
  it('accepts the example request and the example prepared transaction', () => {
    expect(() => PrepareSwapInput.parse(example('prepare-swap-input'))).not.toThrow()
    expect(() => PreparedSwap.parse(example('prepare-swap-output'))).not.toThrow()
  })

  it('refuses a request with no amount or no slippage, rather than defaulting either', () => {
    const { amount: _a, ...noAmount } = example('prepare-swap-input')
    const { slippageBps: _s, ...noSlippage } = example('prepare-swap-input')
    expect(PrepareSwapInput.safeParse(noAmount).success).toBe(false)
    expect(PrepareSwapInput.safeParse(noSlippage).success).toBe(false)
  })

  it('never carries a private key in either direction', () => {
    const keys = [...Object.keys(PrepareSwapInput.shape), ...Object.keys(PreparedSwap.shape)]
    expect(keys.filter((k) => /secret|private|keypair|seed/i.test(k))).toEqual([])
  })
})
