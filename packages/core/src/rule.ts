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
export const RecurringLimit = z
  .object({
    mint: Address,
    amount: BaseUnits,
    /** What a user types. Absent when the limit is read back from chain, which counts slots. */
    windowSeconds: z.number().int().positive().optional(),
    /**
     * What Swig enforces. Present when read back from chain, and never converted from seconds by
     * guessing a slot time: numbers are arithmetic, and slot time is not a constant.
     */
    windowSlots: z.number().int().positive().optional(),
  })
  .refine((l) => l.windowSeconds !== undefined || l.windowSlots !== undefined, {
    message: 'A recurring limit needs a window, in seconds or in slots.',
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
  /**
   * What the user asked for. Null when the rule is read back from chain (`list_rules`), because the
   * chain stores the role and not the trigger type or the expiry.
   */
  spec: RuleSpec.nullable(),
  swigRole: z.object({
    roleId: z.string().min(1),
    /** The agent key the role is granted to. Never holds `manageAuthority`. */
    authority: Address,
    /** Must be Jupiter's program, pinned in config and never read from user input. */
    program: Address,
    tokenRecurringLimit: RecurringLimit,
  }),
  /** Null when the rule needs no Trigger order, when F6 fell back to local polling, or when read from chain. */
  jupiterOrderId: z.string().min(1).nullable(),
  /** Where the funds sit: the Swig's wallet address, not the Swig account that holds the roles. */
  vault: Address,
  /**
   * What the agent can spend right now. Not the raw field, which Swig leaves stale until the next
   * spend; see `effectiveRemaining` in packages/chain (T-C17).
   */
  effectiveRemaining: BaseUnits,
  /**
   * The most the agent can spend across a window edge: 2 full windows in about 2 slots, because
   * windows follow the slot clock. Printed beside every remaining figure.
   */
  rollingWorstCase: BaseUnits,
})

export type RecurringLimit = z.infer<typeof RecurringLimit>
export type TriggerType = z.infer<typeof TriggerType>
export type RuleSpec = z.infer<typeof RuleSpec>
export type ArmedRule = z.infer<typeof ArmedRule>
