import { z } from 'zod'
import { Address } from './primitives.js'
import { CheckTradeInput, CheckTradeOutput } from './check-trade.js'
import { Report } from './report.js'
import { ArmedRule, ArmingLink, ArmRequest } from './rule.js'
import { PrepareSwapInput, PreparedSwap } from './trade.js'

// Frozen contracts and the shared types every other package builds on. Owned by T-C01.
//
// One definition, four consumers: the MCP tool schemas below, runtime validation at the API edge
// (`Schema.parse(body)`), frontend types (`z.infer`), and the example checks in the tests. A field
// changed in one of the three contract files fails in all four, which is the point.

export * from './primitives.js'
export * from './check-trade.js'
export * from './report.js'
export * from './rule.js'
export * from './trade.js'

// The failure-message catalogue, T-E10. Every message a user ever sees when something did not
// work lives here, so "something went wrong" has nowhere to be written.
export * from './messages.js'

// Which chain this deployment points at, shown to people and agents alike.
export * from './network.js'

// The record and replay wrapper, T-C02. Everything above is the frozen contract; this is the
// one door every external call goes through.
export * from './net/index.js'

// The provider request builders, so the CLI and the spikes do not each know a provider URL.
export { heliusTransactions, jupiterQuote, jupiterSwapInstructions } from './net/record.js'

/** get_report and list_rules both take just an address. */
export const WalletQuery = z.object({ wallet: Address })
export type WalletQuery = z.infer<typeof WalletQuery>

/**
 * The MCP tool list, and it is stable: the agent's prompt cache is keyed on it, so adding or
 * reordering a tool costs every user a cache miss. prepare_swap was appended as the 5th, last, by a
 * recorded decision, so the first 4 kept their order.
 */
export const TOOLS = [
  'get_report',
  'check_trade',
  'arm_rule',
  'list_rules',
  'prepare_swap',
] as const
export type ToolName = (typeof TOOLS)[number]

const contracts = {
  get_report: { input: WalletQuery, output: Report },
  check_trade: { input: CheckTradeInput, output: CheckTradeOutput },
  arm_rule: { input: ArmRequest, output: ArmingLink },
  list_rules: { input: WalletQuery, output: z.array(ArmedRule) },
  prepare_swap: { input: PrepareSwapInput, output: PreparedSwap },
} satisfies Record<ToolName, { input: z.ZodType; output: z.ZodType }>

/** The zod schemas behind each tool, for validating a call and its result. */
export const toolContracts = contracts

/**
 * JSON Schema for each tool, generated from the same zod schemas rather than written beside them.
 *
 * `io: 'input'` because a tool call is validated on the way in, and `unrepresentable: 'any'` because
 * the cross-field invariants are `.refine()` checks that JSON Schema cannot express. Those still run
 * at the API edge, where they matter: JSON Schema tells the agent the shape, `.parse()` enforces the
 * rules.
 */
export const toolJsonSchemas: Record<ToolName, { input: unknown; output: unknown }> =
  Object.fromEntries(
    TOOLS.map((name) => [
      name,
      {
        input: z.toJSONSchema(contracts[name].input, { io: 'input', unrepresentable: 'any' }),
        output: z.toJSONSchema(contracts[name].output, { io: 'output', unrepresentable: 'any' }),
      },
    ]),
  ) as Record<ToolName, { input: unknown; output: unknown }>
