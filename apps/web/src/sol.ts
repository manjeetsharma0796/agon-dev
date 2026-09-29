// SOL as a person types it, and lamports as the chain counts them. Exact both ways.
//
// A float cannot do this. 0.3 is 0.299999999999999988898 as a double, and a cap parsed that way is
// not the cap the user typed, which is the one number the arming screen must never get wrong. So
// the conversion is string arithmetic on the 9 decimal places a lamport has.

const LAMPORTS_PER_SOL = 1_000_000_000n
const DECIMALS = 9

/** "0.5" to 500000000n. Refuses anything that is not an exact positive amount, saying why. */
export function parseSol(text: string): bigint {
  const t = text.trim()
  if (/^-\d/.test(t)) throw new Error(`"${t}" SOL is negative. Type a positive amount.`)
  const m = /^(\d+)(?:\.(\d+))?$/.exec(t)
  if (m === null) {
    throw new Error(
      `"${text}" is not a number of SOL. Type digits with at most one point, like 0.5.`,
    )
  }
  const [, whole, frac = ''] = m
  if (frac.length > DECIMALS) {
    throw new Error(
      `"${t}" has ${frac.length} decimals; SOL has 9 decimal places, 1 lamport is 0.000000001.`,
    )
  }
  const lamports = BigInt(whole as string) * LAMPORTS_PER_SOL + BigInt(frac.padEnd(DECIMALS, '0'))
  if (lamports <= 0n) throw new Error(`"${t}" SOL is not a positive amount. Type more than 0.`)
  return lamports
}

/** Base units to a decimal string, for a token with `decimals` places. Never rounded. */
export function formatUnits(amount: bigint, decimals: number): string {
  const unit = 10n ** BigInt(decimals)
  const whole = amount / unit
  const frac = (amount % unit).toString().padStart(decimals, '0').replace(/0+$/, '')
  return frac === '' ? whole.toString() : `${whole}.${frac}`
}

/** 500000000n to "0.5". Trailing zeros dropped, never rounded. */
export const formatSol = (lamports: bigint): string => formatUnits(lamports, DECIMALS)
