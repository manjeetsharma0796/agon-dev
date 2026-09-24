import { z } from 'zod'

// Shared value types. Every contract below is built from these, so "what is a valid mint" is
// answered in exactly one place.

/**
 * A Solana address, base58. Validated by shape only: whether the account exists, and whether it is
 * a mint we will trade, is the guard's job (T-C04), not the parser's.
 */
export const Address = z
  .string()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, 'not a base58 Solana address')
  .brand<'Address'>()

/**
 * An integer amount in the asset's smallest unit, carried as a decimal string.
 *
 * Not a number. A u64 of lamports exceeds Number.MAX_SAFE_INTEGER, so JSON.parse would round it
 * silently and we would sign a transaction for an amount nobody asked for. Every amount that can
 * move funds is this type; only derived statistics are plain numbers.
 */
export const BaseUnits = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/, 'not a non-negative integer in base units')
  .brand<'BaseUnits'>()

/**
 * A signed integer amount in base units, carried as a decimal string, for values that can be
 * negative: realised P&L, and what a broken rule cost.
 */
export const SignedBaseUnits = z
  .string()
  .regex(/^-?(0|[1-9][0-9]*)$/, 'not an integer in base units')
  .brand<'SignedBaseUnits'>()

/** The slot a read was taken at. Every verdict and every fixture states one, so a run is reproducible. */
export const Slot = z.number().int().nonnegative()

/** A ratio in [0, 1], for example the share of a wallet's swaps we could decode. */
export const Share = z.number().min(0).max(1)

export type Address = z.infer<typeof Address>
export type BaseUnits = z.infer<typeof BaseUnits>
export type SignedBaseUnits = z.infer<typeof SignedBaseUnits>
export type Slot = z.infer<typeof Slot>
