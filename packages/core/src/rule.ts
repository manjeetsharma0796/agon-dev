import { z } from 'zod'
import { Address, BaseUnits } from './primitives.js'

// Frozen contract 3 of 3: what arming a rule consumes and what it produces.
//
// packages/chain (T-D01 to T-D03) produces the armed side; the arm screen (T-E06) and the daemon
// (T-C08) read it.

/**
 * A spend allowance that refills. Defined once and used twice on purpose: it is what the user asks
 * for in the spec, and it is exactly what lands on-chain as Swig's `tokenRecurringLimit`. If those
 * two could drift apart, we could arm a cap the user never typed.
 */
export const RecurringLimit = z.object({
  mint: Address,
  amount: BaseUnits,
  windowSeconds: z.number().int().positive(),
})

export const TriggerType = z.enum([
  'stop',
  'trailing-stop',
  'take-profit',
  /** Fall build, behind F10. Named here so adding it later does not break a frozen contract. */
  'balance',
  'event',
])

/** What the user asks for. */
export const RuleSpec = z.object({
  /** The mints the agent may trade under this rule. Empty would mean "anything", so at least one. */
  mints: z.array(Address).min(1),
  cap: RecurringLimit,
  triggerType: TriggerType,
  /**
   * Null means no end date, and the UI must then say "revoke from your wallet". That is F7's stated
   * fallback. It is never a reason to give the agent `manageAuthority`.
   */
  expiresAt: z.iso.datetime().nullable(),
})

/** What exists on-chain once the user's wallet has signed. */
export const ArmedRule = z.object({
  spec: RuleSpec,
  swigRole: z.object({
    roleId: z.string().min(1),
    /** The agent key the role is granted to. Never holds `manageAuthority`. */
    authority: Address,
    /** Must be Jupiter's program, pinned in config and never read from user input. */
    program: Address,
    tokenRecurringLimit: RecurringLimit,
  }),
  /** Null when the rule needs no Trigger order, or when F6 fell back to local polling. */
  jupiterOrderId: z.string().min(1).nullable(),
})

export type RecurringLimit = z.infer<typeof RecurringLimit>
export type TriggerType = z.infer<typeof TriggerType>
export type RuleSpec = z.infer<typeof RuleSpec>
export type ArmedRule = z.infer<typeof ArmedRule>
